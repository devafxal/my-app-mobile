import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export type MessageStatus = 'sending' | 'queued' | 'sent' | 'delivered' | 'seen';

export interface LocalMessage {
  id?: string; // Server message ID (undefined until the server acks it)
  conversation_id: string;
  sender_id: string;
  content: string;
  content_type: 'text' | 'image' | 'file';
  status: MessageStatus;
  client_msg_id: string;
  created_at: string; // ISO date string
  /** When it was read — starts the burn-after-reading countdown */
  seen_at?: string;
  /** Quoted reply text if replying to a message */
  reply_to?: string;
}

/** A read message self-destructs this many seconds after it was read. */
export const READ_MESSAGE_TTL_SECONDS = 60;

export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  priority: TodoPriority;
  due_date?: string;   // ISO date string
  category?: string;
  notes?: string;
}

/**
 * Message status only ever moves forward. Without this, a slow "sent" ack
 * arriving after the partner already read the message would knock a blue
 * double-tick back to a single grey one.
 */
export const STATUS_RANK: Record<MessageStatus, number> = {
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  seen: 4,
};

export const isStatusUpgrade = (from: MessageStatus, to: MessageStatus) =>
  (STATUS_RANK[to] ?? 0) > (STATUS_RANK[from] ?? 0);

// SQL fragment mapping a status column to its rank
const rankSql = (column: string) =>
  `CASE ${column} WHEN 'queued' THEN 0 WHEN 'sending' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'seen' THEN 4 ELSE 0 END`;

export const initDB = async (): Promise<SQLite.SQLiteDatabase> => {
  if (db) return db;
  // Several screens call initDB() at once on startup — share one open attempt
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const database = await SQLite.openDatabase({
        name: 'chat.db',
        location: 'default',
      });

      console.log('✅ SQLite Database opened successfully');

      await database.executeSql(`
        CREATE TABLE IF NOT EXISTS messages (
          client_msg_id TEXT PRIMARY KEY,
          id TEXT,
          conversation_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          content TEXT NOT NULL,
          content_type TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);

      await database.executeSql(`
        CREATE INDEX IF NOT EXISTS idx_messages_conv_date
        ON messages(conversation_id, created_at DESC)
      `);

      // The server id is what sync and receipts look messages up by
      await database.executeSql(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_server_id
        ON messages(id) WHERE id IS NOT NULL
      `);

      // Added later — existing installs need the column bolted on
      const [columnInfo] = await database.executeSql(`PRAGMA table_info(messages)`);
      let hasSeenAt = false;
      let hasReplyTo = false;
      for (let i = 0; i < columnInfo.rows.length; i++) {
        const colName = columnInfo.rows.item(i).name;
        if (colName === 'seen_at') hasSeenAt = true;
        if (colName === 'reply_to') hasReplyTo = true;
      }
      if (!hasSeenAt) {
        await database.executeSql(`ALTER TABLE messages ADD COLUMN seen_at TEXT`);
        console.log('🗃️ Added seen_at column for burn-after-reading');
      }
      if (!hasReplyTo) {
        await database.executeSql(`ALTER TABLE messages ADD COLUMN reply_to TEXT`);
        console.log('🗃️ Added reply_to column for message replies');
      }

      // Image bytes for photo messages, held as a data URI so no filesystem
      // permission or native FS module is needed. Keyed by client_msg_id, which
      // exists from the moment a photo is picked — before the server has given
      // the upload an id — and is what every deletion path already knows.
      // Deleting the message deletes the picture with it.
      await database.executeSql(`
        CREATE TABLE IF NOT EXISTS media_cache (
          client_msg_id TEXT PRIMARY KEY,
          data_uri TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);

      // The decoy home screen's data
      await database.executeSql(`
        CREATE TABLE IF NOT EXISTS todos (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          done INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'low',
          due_date TEXT,
          category TEXT,
          notes TEXT
        )
      `);

      // Migration: add new todo columns for existing installs
      const [todoColInfo] = await database.executeSql(`PRAGMA table_info(todos)`);
      const todoColNames = new Set<string>();
      for (let i = 0; i < todoColInfo.rows.length; i++) {
        todoColNames.add(todoColInfo.rows.item(i).name);
      }
      if (!todoColNames.has('priority')) {
        await database.executeSql(`ALTER TABLE todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'low'`);
      }
      if (!todoColNames.has('due_date')) {
        await database.executeSql(`ALTER TABLE todos ADD COLUMN due_date TEXT`);
      }
      if (!todoColNames.has('category')) {
        await database.executeSql(`ALTER TABLE todos ADD COLUMN category TEXT`);
      }
      if (!todoColNames.has('notes')) {
        await database.executeSql(`ALTER TABLE todos ADD COLUMN notes TEXT`);
      }

      db = database;
      console.log('✅ SQLite Tables & Indices initialized successfully');
      return database;
    } catch (error) {
      initPromise = null;
      console.error('❌ Failed to open/initialize SQLite database:', error);
      throw error;
    }
  })();

  return initPromise;
};

export const getDB = async (): Promise<SQLite.SQLiteDatabase> => {
  if (db) return db;
  return initDB();
};

// Save or update a message. Status never moves backwards, and a row that
// already carries a server id keeps it.
export const saveLocalMessage = async (msg: LocalMessage): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(
      `INSERT INTO messages (client_msg_id, id, conversation_id, sender_id, content, content_type, status, created_at, seen_at, reply_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_msg_id) DO UPDATE SET
         id = coalesce(excluded.id, id),
         content = excluded.content,
         created_at = excluded.created_at,
         seen_at = coalesce(seen_at, excluded.seen_at),
         reply_to = coalesce(reply_to, excluded.reply_to),
         status = CASE WHEN ${rankSql('excluded.status')} > ${rankSql('status')}
                       THEN excluded.status ELSE status END`,
      [
        msg.client_msg_id,
        msg.id || null,
        msg.conversation_id,
        msg.sender_id,
        msg.content,
        msg.content_type,
        msg.status,
        msg.created_at,
        msg.seen_at || null,
        msg.reply_to || null,
      ]
    );
  } catch (error) {
    console.error('❌ SQLite saveLocalMessage error:', error);
  }
};

export const deleteLocalMessage = async (clientMsgId: string): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(`DELETE FROM messages WHERE client_msg_id = ?`, [clientMsgId]);
    await deleteCachedMedia([clientMsgId]);
  } catch (error) {
    console.error('❌ SQLite deleteLocalMessage error:', error);
  }
};

export const deleteAllLocalMessages = async (conversationId: string): Promise<void> => {
  try {
    const database = await getDB();
    // Collect the photo rows before the messages that point at them are gone
    const [rows] = await database.executeSql(
      `SELECT client_msg_id FROM messages WHERE conversation_id = ?`,
      [conversationId]
    );
    const ids: string[] = [];
    for (let i = 0; i < rows.rows.length; i++) ids.push(rows.rows.item(i).client_msg_id);

    await database.executeSql(`DELETE FROM messages WHERE conversation_id = ?`, [conversationId]);
    await deleteCachedMedia(ids);
  } catch (error) {
    console.error('❌ SQLite deleteAllLocalMessages error:', error);
  }
};

/* ---------------------------------------------------------- media cache --- */

export const saveCachedMedia = async (clientMsgId: string, dataUri: string): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(
      `INSERT INTO media_cache (client_msg_id, data_uri, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(client_msg_id) DO UPDATE SET data_uri = excluded.data_uri`,
      [clientMsgId, dataUri, new Date().toISOString()]
    );
  } catch (error) {
    console.error('❌ SQLite saveCachedMedia error:', error);
  }
};

export const getCachedMedia = async (clientMsgId: string): Promise<string | null> => {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT data_uri FROM media_cache WHERE client_msg_id = ?`,
      [clientMsgId]
    );
    return results.rows.length > 0 ? results.rows.item(0).data_uri : null;
  } catch (error) {
    console.error('❌ SQLite getCachedMedia error:', error);
    return null;
  }
};

export const deleteCachedMedia = async (clientMsgIds: string[]): Promise<void> => {
  if (clientMsgIds.length === 0) return;
  try {
    const database = await getDB();
    await database.executeSql(
      `DELETE FROM media_cache WHERE client_msg_id IN (${clientMsgIds.map(() => '?').join(',')})`,
      clientMsgIds
    );
  } catch (error) {
    console.error('❌ SQLite deleteCachedMedia error:', error);
  }
};

/**
 * Photo bytes with no surviving message row — the message was deleted through a
 * path that missed the cache, or the app died mid-send. Without this the images
 * would sit in SQLite forever, which is exactly what burn-after-reading is
 * meant to prevent.
 */
export const pruneOrphanedMedia = async (): Promise<number> => {
  try {
    const database = await getDB();
    const [result] = await database.executeSql(
      `DELETE FROM media_cache
       WHERE client_msg_id NOT IN (SELECT client_msg_id FROM messages)`
    );
    return result.rowsAffected || 0;
  } catch (error) {
    console.error('❌ SQLite pruneOrphanedMedia error:', error);
    return 0;
  }
};

export const saveLocalMessages = async (messages: LocalMessage[]): Promise<void> => {
  for (const msg of messages) {
    await saveLocalMessage(msg);
  }
};

// Get messages for a conversation with cursor-based pagination
export const getLocalMessages = async (
  conversationId: string,
  limit: number = 30,
  beforeDate?: string
): Promise<LocalMessage[]> => {
  try {
    const database = await getDB();
    let query = `
      SELECT client_msg_id, id, conversation_id, sender_id, content, content_type, status, created_at, seen_at, reply_to
      FROM messages
      WHERE conversation_id = ?
    `;
    const params: any[] = [conversationId];

    if (beforeDate) {
      query += ` AND created_at < ?`;
      params.push(beforeDate);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const [results] = await database.executeSql(query, params);
    const messages: LocalMessage[] = [];

    for (let i = 0; i < results.rows.length; i++) {
      messages.push(rowToMessage(results.rows.item(i)));
    }

    // Return in chronological order for chat UI rendering
    return messages.reverse();
  } catch (error) {
    console.error('❌ SQLite getLocalMessages error:', error);
    return [];
  }
};

const rowToMessage = (row: any): LocalMessage => ({
  client_msg_id: row.client_msg_id,
  id: row.id || undefined,
  conversation_id: row.conversation_id,
  sender_id: row.sender_id,
  content: row.content,
  content_type: row.content_type as 'text' | 'image' | 'file',
  status: row.status as MessageStatus,
  created_at: row.created_at,
  seen_at: row.seen_at || undefined,
  reply_to: row.reply_to || undefined,
});

// Retrieve unsent queued/sending messages (e.g. on app restart or reconnection)
export const getQueuedMessages = async (): Promise<LocalMessage[]> => {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT client_msg_id, id, conversation_id, sender_id, content, content_type, status, created_at, seen_at, reply_to
       FROM messages
       WHERE status IN ('queued', 'sending')
       ORDER BY created_at ASC`
    );

    const messages: LocalMessage[] = [];
    for (let i = 0; i < results.rows.length; i++) {
      messages.push(rowToMessage(results.rows.item(i)));
    }
    return messages;
  } catch (error) {
    console.error('❌ SQLite getQueuedMessages error:', error);
    return [];
  }
};

/** Newest message timestamp we hold locally — the cursor used to sync. */
export const getLatestMessageDate = async (conversationId: string): Promise<string | null> => {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      // Only messages the server has acknowledged count as synced
      `SELECT MAX(created_at) AS latest FROM messages WHERE conversation_id = ? AND id IS NOT NULL`,
      [conversationId]
    );
    return results.rows.length ? results.rows.item(0).latest || null : null;
  } catch (error) {
    console.error('❌ SQLite getLatestMessageDate error:', error);
    return null;
  }
};

/** Oldest locally cached message — the cursor used to page history backwards. */
export const getOldestMessageDate = async (conversationId: string): Promise<string | null> => {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT MIN(created_at) AS oldest FROM messages WHERE conversation_id = ?`,
      [conversationId]
    );
    return results.rows.length ? results.rows.item(0).oldest || null : null;
  } catch (error) {
    console.error('❌ SQLite getOldestMessageDate error:', error);
    return null;
  }
};

// Update status of a message (never downgrading it)
export const updateLocalMessageStatus = async (
  clientMsgId: string,
  status: MessageStatus,
  serverMsgId?: string
): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(
      `UPDATE messages
         SET id = coalesce(?, id),
             status = CASE WHEN ${rankSql("?")} > ${rankSql('status')} THEN ? ELSE status END
       WHERE client_msg_id = ?`,
      [serverMsgId || null, status, status, clientMsgId]
    );
  } catch (error) {
    console.error('❌ SQLite updateLocalMessageStatus error:', error);
  }
};

/** Re-queue a message the server refused, so the next connection retries it. */
export const requeueLocalMessage = async (clientMsgId: string): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(
      `UPDATE messages SET status = 'queued' WHERE client_msg_id = ? AND status IN ('sending','queued')`,
      [clientMsgId]
    );
  } catch (error) {
    console.error('❌ SQLite requeueLocalMessage error:', error);
  }
};

// Update bulk seen status for received unread messages
export const markReceivedMessagesAsSeen = async (
  conversationId: string,
  partnerId: string,
  upToDate: string
): Promise<number> => {
  try {
    const database = await getDB();
    // Reading is what starts the self-destruct timer
    const [result] = await database.executeSql(
      `UPDATE messages
       SET status = 'seen', seen_at = coalesce(seen_at, ?)
       WHERE conversation_id = ?
         AND sender_id = ?
         AND status != 'seen'
         AND created_at <= ?`,
      [new Date().toISOString(), conversationId, partnerId, upToDate]
    );
    return result.rowsAffected;
  } catch (error) {
    console.error('❌ SQLite markReceivedMessagesAsSeen error:', error);
    return 0;
  }
};

/** Apply a delivered/seen receipt to the messages *we* sent. */
export const markOwnMessagesStatus = async (
  conversationId: string,
  ownUserId: string,
  status: 'delivered' | 'seen',
  upToDate?: string
): Promise<number> => {
  try {
    const database = await getDB();
    // A 'seen' receipt also starts this side's self-destruct countdown
    const seenAt = status === 'seen' ? new Date().toISOString() : null;
    // Order matches the placeholders below: status, seenAt, seenAt, status, ids
    const params: any[] = [status, seenAt, seenAt, status, conversationId, ownUserId];
    let sql = `UPDATE messages
                 SET status = ?, seen_at = CASE WHEN ? IS NULL THEN seen_at ELSE coalesce(seen_at, ?) END
               WHERE ${rankSql("?")} > ${rankSql('status')}
                 AND conversation_id = ?
                 AND sender_id = ?
                 AND status NOT IN ('queued', 'sending')`;

    if (upToDate) {
      sql += ` AND created_at <= ?`;
      params.push(upToDate);
    }

    const [result] = await database.executeSql(sql, params);
    return result.rowsAffected;
  } catch (error) {
    console.error('❌ SQLite markOwnMessagesStatus error:', error);
    return 0;
  }
};

/**
 * Burn-after-reading, enforced on the device itself: delete every message whose
 * read countdown has run out. Runs regardless of connectivity, so messages
 * still disappear on time even if the phone is offline.
 * Returns the client_msg_ids that were removed.
 */
export const deleteExpiredMessages = async (
  ttlSeconds: number = READ_MESSAGE_TTL_SECONDS
): Promise<string[]> => {
  try {
    const database = await getDB();
    const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString();

    const [rows] = await database.executeSql(
      `SELECT client_msg_id FROM messages WHERE seen_at IS NOT NULL AND seen_at <= ?`,
      [cutoff]
    );

    const expired: string[] = [];
    for (let i = 0; i < rows.rows.length; i++) {
      expired.push(rows.rows.item(i).client_msg_id);
    }
    if (expired.length === 0) return [];

    await database.executeSql(
      `DELETE FROM messages WHERE seen_at IS NOT NULL AND seen_at <= ?`,
      [cutoff]
    );
    // A photo message burns its picture at the same moment as its row
    await deleteCachedMedia(expired);
    return expired;
  } catch (error) {
    console.error('❌ SQLite deleteExpiredMessages error:', error);
    return [];
  }
};

/** Remove specific messages the server reports as expired/deleted. */
export const deleteMessagesByServerIds = async (
  messageIds: string[],
  clientMsgIds: string[] = []
): Promise<void> => {
  if (messageIds.length === 0 && clientMsgIds.length === 0) return;
  try {
    const database = await getDB();
    // media_cache is keyed by client id, so resolve the server ids first —
    // otherwise a burn reported by server id would leave the picture behind.
    const doomed = new Set(clientMsgIds);

    if (messageIds.length > 0) {
      const [rows] = await database.executeSql(
        `SELECT client_msg_id FROM messages WHERE id IN (${messageIds.map(() => '?').join(',')})`,
        messageIds
      );
      for (let i = 0; i < rows.rows.length; i++) doomed.add(rows.rows.item(i).client_msg_id);

      await database.executeSql(
        `DELETE FROM messages WHERE id IN (${messageIds.map(() => '?').join(',')})`,
        messageIds
      );
    }
    if (clientMsgIds.length > 0) {
      await database.executeSql(
        `DELETE FROM messages WHERE client_msg_id IN (${clientMsgIds.map(() => '?').join(',')})`,
        clientMsgIds
      );
    }

    await deleteCachedMedia(Array.from(doomed));
  } catch (error) {
    console.error('❌ SQLite deleteMessagesByServerIds error:', error);
  }
};

/* ---------------------------------------------------------------- todos --- */

export const getTodos = async (): Promise<TodoItem[]> => {
  try {
    const database = await getDB();
    const [results] = await database.executeSql(
      `SELECT id, title, done, created_at, priority, due_date, category, notes
       FROM todos
       ORDER BY done ASC,
         CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
         due_date ASC,
         created_at DESC`
    );

    const todos: TodoItem[] = [];
    for (let i = 0; i < results.rows.length; i++) {
      const row = results.rows.item(i);
      todos.push({
        id: row.id,
        title: row.title,
        done: Boolean(row.done),
        created_at: row.created_at,
        priority: row.priority || 'low',
        due_date: row.due_date || undefined,
        category: row.category || undefined,
        notes: row.notes || undefined,
      });
    }
    return todos;
  } catch (error) {
    console.error('❌ SQLite getTodos error:', error);
    return [];
  }
};

export const insertTodo = async (
  title: string,
  priority: TodoPriority = 'low',
  dueDate?: string,
  category?: string,
  notes?: string
): Promise<TodoItem> => {
  const todo: TodoItem = {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    done: false,
    created_at: new Date().toISOString(),
    priority,
    due_date: dueDate,
    category,
    notes,
  };

  try {
    const database = await getDB();
    await database.executeSql(
      `INSERT INTO todos (id, title, done, created_at, priority, due_date, category, notes)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?)`,
      [todo.id, todo.title, todo.created_at, todo.priority, todo.due_date || null, todo.category || null, todo.notes || null]
    );
  } catch (error) {
    console.error('❌ SQLite insertTodo error:', error);
  }

  return todo;
};

export const updateTodo = async (
  id: string,
  fields: Partial<Pick<TodoItem, 'title' | 'priority' | 'due_date' | 'category' | 'notes'>>
): Promise<void> => {
  try {
    const database = await getDB();
    const sets: string[] = [];
    const params: any[] = [];

    if (fields.title !== undefined) { sets.push('title = ?'); params.push(fields.title); }
    if (fields.priority !== undefined) { sets.push('priority = ?'); params.push(fields.priority); }
    if (fields.due_date !== undefined) { sets.push('due_date = ?'); params.push(fields.due_date || null); }
    if (fields.category !== undefined) { sets.push('category = ?'); params.push(fields.category || null); }
    if (fields.notes !== undefined) { sets.push('notes = ?'); params.push(fields.notes || null); }

    if (sets.length === 0) return;
    params.push(id);

    await database.executeSql(
      `UPDATE todos SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
  } catch (error) {
    console.error('❌ SQLite updateTodo error:', error);
  }
};

export const setTodoDone = async (id: string, done: boolean): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(`UPDATE todos SET done = ? WHERE id = ?`, [done ? 1 : 0, id]);
  } catch (error) {
    console.error('❌ SQLite setTodoDone error:', error);
  }
};

export const removeTodo = async (id: string): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(`DELETE FROM todos WHERE id = ?`, [id]);
  } catch (error) {
    console.error('❌ SQLite removeTodo error:', error);
  }
};

/** Wipe the cache — used on sign out so the next account starts clean. */
export const clearAllMessages = async (): Promise<void> => {
  try {
    const database = await getDB();
    await database.executeSql(`DELETE FROM messages`);
    console.log('🧹 Local message cache cleared');
  } catch (error) {
    console.error('❌ SQLite clearAllMessages error:', error);
  }
};
