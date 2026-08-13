import { create } from 'zustand';
import {
  LocalMessage,
  MessageStatus,
  isStatusUpgrade,
  saveLocalMessage,
  getLocalMessages,
  getQueuedMessages,
  updateLocalMessageStatus,
  requeueLocalMessage,
  markOwnMessagesStatus,
  markReceivedMessagesAsSeen,
  deleteExpiredMessages,
  deleteMessagesByServerIds,
  deleteLocalMessage,
  deleteAllLocalMessages,
  saveCachedMedia,
  getCachedMedia,
  pruneOrphanedMedia,
} from '../db';
import { emitMessage, isSocketConnected } from '../sockets';
import { fetchOlderMessages } from '../services/sync';
import { downloadImage, uploadImage, PickedImage } from '../services/media';
import { useAuthStore } from './authStore';

const PAGE_SIZE = 30;

/** Attachment ids are Mongo ObjectIds; anything else is still a local file. */
const isAttachmentId = (value: string) => /^[a-f\d]{24}$/i.test(value);

/** Photos currently being read from cache or downloaded, so two renders of the
 *  same bubble do not both fetch it. */
const mediaLoadsInFlight = new Set<string>();

/**
 * Drop decoded photo bytes for messages that no longer exist. Burning a photo
 * has to clear it from memory too, or it stays on screen — and in RAM — after
 * the message it belonged to is gone.
 */
const retainMedia = (
  mediaUris: Record<string, string | null>,
  messages: LocalMessage[]
): Record<string, string | null> => {
  const live = new Set(messages.map((m) => m.client_msg_id));
  const next: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(mediaUris)) {
    if (live.has(key)) next[key] = value;
  }
  return next;
};

const sortByDate = (messages: LocalMessage[]) =>
  [...messages].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

interface ChatState {
  conversationId: string | null;
  messages: LocalMessage[];
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  /** True while the chat screen is on top, used to decide auto "seen" receipts */
  isScreenActive: boolean;
  lastError: string | null;
  /**
   * Decoded photo bytes by client_msg_id. `null` means the picture is gone for
   * good (burned on the server) rather than merely not fetched yet.
   */
  mediaUris: Record<string, string | null>;
  setConversationId: (id: string | null) => void;
  setScreenActive: (active: boolean) => void;
  loadCachedMessages: (convId: string, limit?: number) => Promise<void>;
  loadMoreMessages: (convId: string, limit?: number) => Promise<void>;
  sendChatMessage: (content: string, senderId: string, replyTo?: string) => Promise<void>;
  sendImageMessage: (image: PickedImage, senderId: string, replyTo?: string) => Promise<void>;
  /** Load a photo into memory from the local cache, downloading it if needed. */
  ensureImageLoaded: (clientMsgId: string, content: string) => Promise<void>;
  deleteMessageLocally: (clientMsgId: string) => Promise<void>;
  clearAllMessages: (convId: string) => Promise<void>;
  receiveChatMessage: (msg: LocalMessage) => Promise<void>;
  mergeMessages: (msgs: LocalMessage[]) => void;
  handleMessageAck: (clientMsgId: string, serverMsgId: string, status: MessageStatus) => Promise<void>;
  handleMessageFailure: (clientMsgId: string, error: string) => Promise<void>;
  handlePartnerMessageStatus: (status: 'seen' | 'delivered', upTo?: string) => Promise<void>;
  markPartnerMessagesRead: (partnerId: string, upToDate: string) => Promise<void>;
  handleMessagesDeleted: (messageIds: string[], clientMsgIds: string[]) => Promise<void>;
  pruneExpiredMessages: () => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
  clearError: () => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  isLoading: false,
  isFetchingMore: false,
  hasMore: true,
  isScreenActive: false,
  lastError: null,
  mediaUris: {},

  setConversationId: (id) => {
    if (get().conversationId === id) return;
    set({ conversationId: id, messages: [], mediaUris: {}, hasMore: true });
  },

  setScreenActive: (active) => set({ isScreenActive: active }),

  deleteMessageLocally: async (clientMsgId: string) => {
    await deleteLocalMessage(clientMsgId);
    set((state) => {
      const survivors = state.messages.filter((m) => m.client_msg_id !== clientMsgId);
      return { messages: survivors, mediaUris: retainMedia(state.mediaUris, survivors) };
    });
  },

  clearAllMessages: async (convId: string) => {
    await deleteAllLocalMessages(convId);
    set({ messages: [], mediaUris: {} });
  },

  loadCachedMessages: async (convId, limit = PAGE_SIZE) => {
    set({ isLoading: true });
    try {
      const cached = await getLocalMessages(convId, limit);
      set({
        messages: cached,
        isLoading: false,
        hasMore: cached.length === limit,
      });
    } catch (err) {
      console.error('Error loading cached messages:', err);
      set({ isLoading: false });
    }
  },

  loadMoreMessages: async (convId, limit = PAGE_SIZE) => {
    const { messages, isFetchingMore, hasMore } = get();
    if (isFetchingMore || !hasMore || messages.length === 0) return;

    set({ isFetchingMore: true });
    try {
      const beforeDate = messages[0].created_at; // oldest message currently shown
      let older = await getLocalMessages(convId, limit, beforeDate);

      if (older.length === 0) {
        const fetched = await fetchOlderMessages(convId, limit);
        if (fetched.length > 0) {
          older = await getLocalMessages(convId, limit, beforeDate);
        }
      }

      const existing = new Set(get().messages.map((m) => m.client_msg_id));
      const filtered = older.filter((m) => !existing.has(m.client_msg_id));

      set({
        messages: sortByDate([...filtered, ...messages]),
        hasMore: older.length === limit,
        isFetchingMore: false,
      });
    } catch (err) {
      console.error('Error loading older messages:', err);
      set({ isFetchingMore: false });
    }
  },

  sendChatMessage: async (content, senderId, replyTo) => {
    const { conversationId } = get();
    if (!conversationId) return;

    const clientMsgId = `client-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
    const createdAt = new Date().toISOString();

    const isConnected = isSocketConnected();

    const newMsg: LocalMessage = {
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      content_type: 'text',
      status: isConnected ? 'sending' : 'queued',
      client_msg_id: clientMsgId,
      created_at: createdAt,
      reply_to: replyTo,
    };

    set((state) => ({ messages: [...state.messages, newMsg], lastError: null }));

    await saveLocalMessage(newMsg);

    if (isConnected) {
      emitMessage({ clientMsgId, conversationId, content, replyTo });
    }
  },

  /**
   * Photos take a different path to text: the bytes go over HTTP to the
   * server's upload folder first, and the chat message then carries only the
   * attachment id. The picture shows in the bubble immediately from the local
   * copy, so the upload happens behind an already-visible message.
   */
  sendImageMessage: async (image, senderId, replyTo) => {
    const { conversationId } = get();
    if (!conversationId) return;

    const clientMsgId = `client-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
    const createdAt = new Date().toISOString();

    // Cache before anything can fail, so the bubble always has something to show
    await saveCachedMedia(clientMsgId, image.dataUri);

    const newMsg: LocalMessage = {
      conversation_id: conversationId,
      sender_id: senderId,
      // Holds the local file URI until the upload swaps in the attachment id
      content: image.uri,
      content_type: 'image',
      status: 'sending',
      client_msg_id: clientMsgId,
      created_at: createdAt,
      reply_to: replyTo,
    };

    set((state) => ({
      messages: [...state.messages, newMsg],
      mediaUris: { ...state.mediaUris, [clientMsgId]: image.dataUri },
      lastError: null,
    }));

    await saveLocalMessage(newMsg);

    try {
      const attachmentId = await uploadImage(image, conversationId, clientMsgId);

      // The message now references the stored file rather than a local path
      await saveLocalMessage({ ...newMsg, content: attachmentId });
      set((state) => ({
        messages: state.messages.map((m) =>
          m.client_msg_id === clientMsgId ? { ...m, content: attachmentId } : m
        ),
      }));

      if (isSocketConnected()) {
        emitMessage({
          clientMsgId,
          conversationId,
          content: attachmentId,
          contentType: 'image',
          replyTo,
        });
      } else {
        // Uploaded but not announced — the queue flush will emit it
        await requeueLocalMessage(clientMsgId);
        set((state) => ({
          messages: state.messages.map((m) =>
            m.client_msg_id === clientMsgId ? { ...m, status: 'queued' } : m
          ),
        }));
      }
    } catch (error: any) {
      // The upload failed (offline, too large, rejected). Keep the local file
      // URI in place so a retry can upload the same picture.
      console.warn('⚠️ Image upload failed:', error?.message || error);
      await requeueLocalMessage(clientMsgId);
      set((state) => ({
        lastError:
          error?.response?.data?.error || error?.message || 'Could not upload that photo',
        messages: state.messages.map((m) =>
          m.client_msg_id === clientMsgId ? { ...m, status: 'queued' } : m
        ),
      }));
    }
  },

  ensureImageLoaded: async (clientMsgId, content) => {
    // Already resolved, either to a picture or to a confirmed "it's gone"
    if (clientMsgId in get().mediaUris) return;

    // De-duplicate concurrent loads outside the store: parking a null in
    // mediaUris to claim the slot would render as "Photo deleted" for as long
    // as the fetch takes, which is exactly wrong for a photo that is fine.
    if (mediaLoadsInFlight.has(clientMsgId)) return;
    mediaLoadsInFlight.add(clientMsgId);

    try {
      const cached = await getCachedMedia(clientMsgId);
      if (cached) {
        set((state) => ({ mediaUris: { ...state.mediaUris, [clientMsgId]: cached } }));
        return;
      }

      // Nothing local and nothing uploaded yet — there is nothing to fetch
      if (!isAttachmentId(content)) return;

      const downloaded = await downloadImage(content, clientMsgId);
      // null here is authoritative: the server said the photo is burned
      set((state) => ({ mediaUris: { ...state.mediaUris, [clientMsgId]: downloaded } }));
    } catch (error: any) {
      // A network failure is not a burned photo — leave the key unset so the
      // next render can try again rather than showing a false tombstone
      console.warn('⚠️ Could not load photo:', error?.message || error);
    } finally {
      mediaLoadsInFlight.delete(clientMsgId);
    }
  },

  receiveChatMessage: async (msg) => {
    await saveLocalMessage(msg);
    get().mergeMessages([msg]);

    // Pull the picture down now rather than when the bubble scrolls into view —
    // it may burn shortly after being read, and a late fetch would find nothing
    if (msg.content_type === 'image') {
      void get().ensureImageLoaded(msg.client_msg_id, msg.content);
    }
  },

  /** Insert/refresh messages in the visible list without ever duplicating one. */
  mergeMessages: (incoming) => {
    const { conversationId } = get();
    if (!conversationId) return;

    const relevant = incoming.filter((m) => m.conversation_id === conversationId);
    if (relevant.length === 0) return;

    set((state) => {
      const byClientId = new Map(state.messages.map((m) => [m.client_msg_id, m]));
      let changed = false;

      for (const msg of relevant) {
        const existing = byClientId.get(msg.client_msg_id);
        if (!existing) {
          byClientId.set(msg.client_msg_id, msg);
          changed = true;
        } else {
          const status = isStatusUpgrade(existing.status, msg.status) ? msg.status : existing.status;
          const id = existing.id || msg.id;
          if (status !== existing.status || id !== existing.id) {
            byClientId.set(msg.client_msg_id, { ...existing, status, id });
            changed = true;
          }
        }
      }

      if (!changed) return state;
      return { ...state, messages: sortByDate(Array.from(byClientId.values())) };
    });
  },

  handleMessageAck: async (clientMsgId, serverMsgId, status) => {
    await updateLocalMessageStatus(clientMsgId, status, serverMsgId);

    set((state) => ({
      messages: state.messages.map((m) =>
        m.client_msg_id === clientMsgId
          ? {
              ...m,
              id: serverMsgId,
              status: isStatusUpgrade(m.status, status) ? status : m.status,
            }
          : m
      ),
    }));
  },

  handleMessageFailure: async (clientMsgId, error) => {
    // Put it back in the queue so the next successful connection retries it
    await requeueLocalMessage(clientMsgId);

    set((state) => ({
      lastError: error,
      messages: state.messages.map((m) =>
        m.client_msg_id === clientMsgId && (m.status === 'sending' || m.status === 'queued')
          ? { ...m, status: 'queued' }
          : m
      ),
    }));
  },

  handlePartnerMessageStatus: async (status, upTo) => {
    const { conversationId } = get();
    const myId = useAuthStore.getState().user?.id;
    if (!conversationId || !myId) return;

    const upToDate = upTo ? new Date(upTo).toISOString() : undefined;

    await markOwnMessagesStatus(conversationId, myId, status, upToDate);

    const seenAt = status === 'seen' ? new Date().toISOString() : undefined;

    // Receipts only ever apply to messages *we* sent that the server has stored
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.sender_id !== myId) return m;
        if (m.status === 'queued' || m.status === 'sending') return m;
        if (upToDate && m.created_at > upToDate) return m;
        if (!isStatusUpgrade(m.status, status)) return m;
        // "Read" also starts this message's self-destruct countdown
        return { ...m, status, seen_at: m.seen_at || seenAt };
      }),
    }));
  },

  /** We just read the partner's messages — start their countdown on this side. */
  markPartnerMessagesRead: async (partnerId, upToDate) => {
    const { conversationId } = get();
    if (!conversationId || !partnerId) return;

    const updated = await markReceivedMessagesAsSeen(conversationId, partnerId, upToDate);
    if (updated === 0) return;

    const seenAt = new Date().toISOString();
    set((state) => ({
      messages: state.messages.map((m) =>
        m.sender_id === partnerId && !m.seen_at && m.created_at <= upToDate
          ? { ...m, status: 'seen', seen_at: seenAt }
          : m
      ),
    }));
  },

  handleMessagesDeleted: async (messageIds, clientMsgIds) => {
    await deleteMessagesByServerIds(messageIds, clientMsgIds);

    const removedIds = new Set(messageIds);
    const removedClientIds = new Set(clientMsgIds);

    set((state) => {
      const survivors = state.messages.filter(
        (m) => !(m.id && removedIds.has(m.id)) && !removedClientIds.has(m.client_msg_id)
      );
      return { messages: survivors, mediaUris: retainMedia(state.mediaUris, survivors) };
    });
  },

  /** Local half of burn-after-reading — runs on a timer, offline included. */
  pruneExpiredMessages: async () => {
    // Sweeps photo bytes left behind by any deletion path that missed them
    void pruneOrphanedMedia();

    const expired = await deleteExpiredMessages();
    if (expired.length === 0) return;

    const removed = new Set(expired);
    set((state) => {
      const survivors = state.messages.filter((m) => !removed.has(m.client_msg_id));
      return { messages: survivors, mediaUris: retainMedia(state.mediaUris, survivors) };
    });
    console.log(`🔥 ${expired.length} read message(s) self-destructed`);
  },

  flushOfflineQueue: async () => {
    if (!isSocketConnected()) return;

    try {
      const queued = await getQueuedMessages();
      if (queued.length === 0) return;

      console.log(`🔄 Flushing ${queued.length} queued message(s)...`);

      for (const msg of queued) {
        await updateLocalMessageStatus(msg.client_msg_id, 'sending');
        set((state) => ({
          messages: state.messages.map((m) =>
            m.client_msg_id === msg.client_msg_id ? { ...m, status: 'sending' } : m
          ),
        }));

        let content = msg.content;

        // A photo queued while offline still holds its local file URI — the
        // bytes have to reach the upload folder before the message can name it
        if (msg.content_type === 'image' && !isAttachmentId(content)) {
          const dataUri = await getCachedMedia(msg.client_msg_id);
          if (!dataUri) {
            console.warn('⚠️ Queued photo has no local copy left; dropping it');
            await get().deleteMessageLocally(msg.client_msg_id);
            continue;
          }

          try {
            content = await uploadImage(
              { uri: msg.content, dataUri, fileName: `photo-${msg.client_msg_id}.jpg`, type: 'image/jpeg' },
              msg.conversation_id,
              msg.client_msg_id
            );
            await saveLocalMessage({ ...msg, content, status: 'sending' });
            set((state) => ({
              messages: state.messages.map((m) =>
                m.client_msg_id === msg.client_msg_id ? { ...m, content } : m
              ),
            }));
          } catch (error: any) {
            console.warn('⚠️ Retried photo upload failed:', error?.message || error);
            await requeueLocalMessage(msg.client_msg_id);
            break; // still no usable connection — leave the rest queued
          }
        }

        const sent = emitMessage({
          clientMsgId: msg.client_msg_id,
          conversationId: msg.conversation_id,
          content,
          contentType: msg.content_type,
          // Carried through, otherwise a reply composed while offline arrives
          // at the partner stripped of the message it was quoting
          replyTo: msg.reply_to,
        });

        // Connection dropped mid-flush — leave the rest queued for next time
        if (!sent) {
          await requeueLocalMessage(msg.client_msg_id);
          break;
        }
      }
    } catch (err) {
      console.error('Error flushing offline queue:', err);
    }
  },

  clearError: () => set({ lastError: null }),

  clearChat: () =>
    set({ messages: [], mediaUris: {}, conversationId: null, hasMore: true, lastError: null }),
}));
