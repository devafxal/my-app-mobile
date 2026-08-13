import apiClient from '../api';
import {
  LocalMessage,
  getLatestMessageDate,
  getOldestMessageDate,
  saveLocalMessages,
} from '../db';
import { useConnectionStore } from '../store/connectionStore';

interface ServerMessage {
  _id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  content_type: 'text' | 'image' | 'file';
  status: 'sent' | 'delivered' | 'seen';
  client_msg_id: string;
  created_at: string;
  seen_at?: string;
  reply_to?: string;
}

const toLocal = (m: ServerMessage): LocalMessage => ({
  id: m._id,
  conversation_id: m.conversation_id,
  sender_id: m.sender_id,
  content: m.content,
  content_type: m.content_type || 'text',
  status: m.status,
  client_msg_id: m.client_msg_id,
  created_at: new Date(m.created_at).toISOString(),
  // Carried over so an already-read message keeps counting down after a
  // reinstall instead of starting its minute again
  seen_at: m.seen_at ? new Date(m.seen_at).toISOString() : undefined,
  // Kept so a quoted reply still shows its quote after a reinstall
  reply_to: m.reply_to || undefined,
});

const fetchPage = async (params: Record<string, any>) => {
  const response = await apiClient.get('/conversation/messages', { params });
  const data = response.data;
  // Tolerate both the old bare-array shape and the current { messages } shape
  const messages: ServerMessage[] = Array.isArray(data) ? data : data?.messages || [];
  const hasMore: boolean = Array.isArray(data) ? false : Boolean(data?.hasMore);
  return { messages: messages.map(toLocal), hasMore };
};

let inFlight: Promise<LocalMessage[]> | null = null;

/**
 * Pull everything the server has that this device is missing — messages that
 * arrived while the app was closed, offline, or freshly reinstalled. They are
 * written to SQLite and returned so the caller can merge them into the UI.
 * Safe to call often; overlapping calls share one run.
 */
export const syncMessages = async (conversationId: string): Promise<LocalMessage[]> => {
  if (!conversationId) return [];
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { setSyncing } = useConnectionStore.getState();
    setSyncing(true);
    const imported: LocalMessage[] = [];

    try {
      let cursor = await getLatestMessageDate(conversationId);
      let hasMore = true;
      let guard = 0;

      while (hasMore && guard < 50) {
        guard += 1;

        const params: Record<string, any> = { conversation_id: conversationId, limit: 100 };
        // With no local history at all, grab the most recent page instead of
        // replaying the entire conversation from the beginning.
        if (cursor) params.after = cursor;

        const page = await fetchPage(params);
        if (page.messages.length === 0) break;

        await saveLocalMessages(page.messages);
        imported.push(...page.messages);

        cursor = page.messages[page.messages.length - 1].created_at;
        hasMore = page.hasMore && Boolean(cursor);
      }

      if (imported.length > 0) {
        console.log(`🔄 Synced ${imported.length} message(s) from the server`);
      }
    } catch (error: any) {
      console.warn('⚠️ Message sync failed:', error?.message || error);
    } finally {
      setSyncing(false);
      inFlight = null;
    }

    return imported;
  })();

  return inFlight;
};

/**
 * Fetch a page of older history from the server when the local cache runs dry
 * (e.g. after a reinstall, scrolling further back than the device has cached).
 */
export const fetchOlderMessages = async (
  conversationId: string,
  limit = 50
): Promise<LocalMessage[]> => {
  try {
    const oldest = await getOldestMessageDate(conversationId);
    const params: Record<string, any> = { conversation_id: conversationId, limit };
    if (oldest) params.before = oldest;

    const page = await fetchPage(params);
    if (page.messages.length > 0) {
      await saveLocalMessages(page.messages);
    }
    return page.messages;
  } catch (error: any) {
    console.warn('⚠️ Fetching older messages failed:', error?.message || error);
    return [];
  }
};
