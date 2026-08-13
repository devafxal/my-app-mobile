import { io, Socket } from 'socket.io-client';
import { getServerUrl } from '../config';
import { useChatStore } from '../store/chatStore';
import { usePresenceStore } from '../store/presenceStore';
import { useConnectionStore } from '../store/connectionStore';
import { useAuthStore } from '../store/authStore';
import { refreshAccessToken } from '../api';
import { syncMessages } from '../services/sync';

let socket: Socket | null = null;
let connectedUrl: string | null = null;
let isRefreshingToken = false;
// Replayed on every (re)connect so a socket that dropped while backgrounded
// does not come back claiming the app is on screen.
let lastAppState: 'active' | 'background' = 'active';

const setStatus = (status: 'idle' | 'connecting' | 'connected' | 'offline', error?: string | null) =>
  useConnectionStore.getState().setStatus(status, error);

/**
 * Open (or re-open) the realtime connection using the token currently in the
 * auth store. Called on login, on app start, and whenever the app returns to
 * the foreground — it is a no-op when already connected.
 */
export const connectSocket = () => {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) return;

  const url = getServerUrl();

  // The server address is user-editable; a change means a brand new socket.
  if (socket && connectedUrl !== url) {
    disconnectSocket();
  }

  if (socket) {
    socket.auth = { token: accessToken };
    if (!socket.connected) {
      setStatus('connecting');
      socket.connect();
    }
    return;
  }

  connectedUrl = url;
  setStatus('connecting');

  socket = io(url, {
    auth: { token: accessToken },
    autoConnect: false,
    transports: ['websocket', 'polling'], // WebSocket preferred, polling fallback
    reconnection: true,
    reconnectionAttempts: Infinity, // a chat app should never stop trying
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 15000,
  });

  registerHandlers(socket);
  socket.connect();
};

const registerHandlers = (s: Socket) => {
  // --- CONNECTION EVENTS ---
  s.on('connect', () => {
    console.log('🔌 Connected to Chat WebSocket Server (Socket ID:', s.id, ')');
    setStatus('connected');

    s.emit('app:state', { state: lastAppState });

    const activeConvId = useChatStore.getState().conversationId;
    if (activeConvId) {
      s.emit('room:join', { conversationId: activeConvId });
      // Pull anything that happened while we were away, then push what we owe
      syncMessages(activeConvId)
        .then((synced) => useChatStore.getState().mergeMessages(synced))
        .finally(() => {
          useChatStore.getState().flushOfflineQueue();
        });
    } else {
      useChatStore.getState().flushOfflineQueue();
    }
  });

  s.on('disconnect', (reason) => {
    console.log('🔌 Disconnected from Chat WebSocket Server. Reason:', reason);
    setStatus('offline', reason);
    usePresenceStore.getState().setPartnerOnline(false);
    usePresenceStore.getState().setPartnerTyping(false);
  });

  s.on('connect_error', async (error: any) => {
    const message = error?.message || 'connection error';
    console.warn('🔌 Socket Connection Error:', message);
    setStatus('offline', message);
    usePresenceStore.getState().setPartnerTyping(false);

    // An expired/invalid token is fatal for reconnection attempts unless we
    // swap in a fresh one — the handshake would keep failing forever.
    if (message.includes('Authentication error') && !isRefreshingToken) {
      isRefreshingToken = true;
      try {
        const newToken = await refreshAccessToken();
        if (newToken && socket) {
          console.log('🔑 Refreshed access token, retrying socket connection');
          socket.auth = { token: newToken };
        }
      } finally {
        isRefreshingToken = false;
      }
    }
  });

  // --- REALTIME MESSAGE EVENTS ---
  s.on('message:new', (data: { message: any }) => {
    const incoming = data?.message;
    if (!incoming) return;

    console.log('📩 Incoming real-time message:', incoming.client_msg_id);

    useChatStore.getState().receiveChatMessage({
      id: incoming.id,
      conversation_id: incoming.conversation_id,
      sender_id: incoming.sender_id,
      content: incoming.content,
      content_type: incoming.content_type || 'text',
      status: incoming.status,
      client_msg_id: incoming.client_msg_id,
      created_at: new Date(incoming.created_at).toISOString(),
      // The server relays the quoted text; without this the recipient saw a
      // reply with no indication of what it was replying to
      reply_to: incoming.reply_to || undefined,
    });

    // If the user is actively viewing this conversation, mark it read
    const { conversationId, isScreenActive } = useChatStore.getState();
    if (isScreenActive && conversationId === incoming.conversation_id && incoming.id) {
      s.emit('message:seen', {
        conversationId,
        lastSeenMsgId: incoming.id,
      });
    }
  });

  s.on('message:ack', (data: { clientMsgId: string; serverMsgId: string; status: any }) => {
    useChatStore.getState().handleMessageAck(data.clientMsgId, data.serverMsgId, data.status);
  });

  s.on('message:error', (data: { clientMsgId?: string; message: string }) => {
    console.warn('✉️ Message rejected by server:', data?.message);
    if (data?.clientMsgId) {
      useChatStore.getState().handleMessageFailure(data.clientMsgId, data.message);
    }
  });

  s.on(
    'message:status',
    (data: { conversationId: string; status: 'seen' | 'delivered'; upTo?: string }) => {
      console.log('👁️ Partner receipt:', data?.status);
      if (useChatStore.getState().conversationId === data.conversationId) {
        useChatStore.getState().handlePartnerMessageStatus(data.status, data.upTo);
      }
    }
  );

  // Burn-after-reading: the server deleted messages whose time was up
  s.on(
    'messages:deleted',
    (data: { conversationId: string; messageIds?: string[]; clientMsgIds?: string[] }) => {
      useChatStore
        .getState()
        .handleMessagesDeleted(data?.messageIds || [], data?.clientMsgIds || []);
    }
  );

  // --- PRESENCE & TYPING EVENTS ---
  s.on('presence:update', (data: { userId: string; isOnline: boolean; lastSeen: string }) => {
    // Only two people exist in this app, so any presence event is the partner's
    usePresenceStore.getState().setPartnerOnline(data.isOnline, data.lastSeen);
    if (!data.isOnline) usePresenceStore.getState().setPartnerTyping(false);
  });

  s.on('typing:update', (data: { userId: string; isTyping: boolean }) => {
    usePresenceStore.getState().setPartnerTyping(data.isTyping);
  });
};

export const disconnectSocket = () => {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    connectedUrl = null;
    setStatus('idle');
    console.log('🔌 Socket disconnected and closed.');
  }
};

export const isSocketConnected = (): boolean => Boolean(socket?.connected);

/**
 * Tell the server whether the app is on screen. Android keeps the socket alive
 * for a while after the app is backgrounded, so without this the server thinks
 * the user is watching the chat and skips the push notification entirely.
 */
export const emitAppState = (state: 'active' | 'background') => {
  lastAppState = state;
  if (socket && socket.connected) {
    socket.emit('app:state', { state });
  }
};

export const emitMessage = (data: {
  clientMsgId: string;
  conversationId: string;
  content: string;
  /** 'image' means content is an attachment id, not the message text */
  contentType?: 'text' | 'image' | 'file';
  replyTo?: string;
}) => {
  if (socket && socket.connected) {
    socket.emit('message:send', data);
    return true;
  }
  console.warn('⚠️ Socket not connected. Message queued locally.');
  return false;
};

export const emitTyping = (conversationId: string, isTyping: boolean) => {
  if (socket && socket.connected) {
    socket.emit(isTyping ? 'typing:start' : 'typing:stop', { conversationId });
  }
};

export const emitMessageSeen = (conversationId: string, lastSeenMsgId?: string) => {
  if (socket && socket.connected) {
    socket.emit('message:seen', { conversationId, lastSeenMsgId });
  }
};

export const joinConversationRoom = (conversationId: string) => {
  if (socket && socket.connected) {
    socket.emit('room:join', { conversationId });
  }
};
