import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Animated,
  Alert,
  PanResponder,
  BackHandler,
  Vibration,
  Clipboard,
  useWindowDimensions,
  Image,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../navigation';
import { useAuthStore, getPartnerId } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { usePresenceStore } from '../store/presenceStore';
import { useConnectionStore } from '../store/connectionStore';
import { connectSocket, emitTyping, emitMessageSeen, joinConversationRoom } from '../sockets';
import { initDB, READ_MESSAGE_TTL_SECONDS, LocalMessage } from '../db';
import { syncMessages } from '../services/sync';
import { pickImageFromGallery, takePhotoWithCamera } from '../services/media';
import { useHideOnBackground } from '../hooks/useHideOnBackground';
import { FadeSlideIn, PressableScale, Pulse, Shimmer } from '../components/ui/motion';
import {
  CameraIcon,
  CheckTicks,
  ChevronDown,
  ChevronLeft,
  CloseIcon,
  PendingIcon,
  ReplyIcon,
  SendIcon,
} from '../components/ui/icons';
import {
  CHROME_FONT_CAP,
  motion,
  radius,
  space,
  Theme,
  type,
  useTheme,
  useThemedStyles,
} from '../theme';
import apiClient from '../api';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

const MAX_CHARS = 1000;
const CHAR_WARN_THRESHOLD = 900;
const GROUP_TIME_MS = 2 * 60 * 1000; // 2 minutes for message grouping

/** Share of the usable row width a bubble may occupy. */
const BUBBLE_WIDTH_RATIO = 0.8;
/** Horizontal padding on the list content, both sides. */
const LIST_H_PADDING = space.sm * 2;
/** Size of the bubble tail on the first message of a run. */
const TAIL_W = 8;
const TAIL_H = 13;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Haptics are cosmetic — a device with no vibrator, or a build whose VIBRATE
 * permission was stripped, must never be able to crash the send path.
 */
const haptic = (ms: number) => {
  try {
    Vibration.vibrate(ms);
  } catch {
    // ignore — non-essential feedback
  }
};

const isSameDay = (d1: string, d2: string) => {
  const a = new Date(d1);
  const b = new Date(d2);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

const getDateLabel = (isoString: string): string => {
  const d = new Date(isoString);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(isoString, now.toISOString())) return 'Today';
  if (isSameDay(isoString, yesterday.toISOString())) return 'Yesterday';

  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

const formatTime = (isoString: string) => {
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

// ─── Heart Particle (love animation) ────────────────────────────────────────

interface HeartParticle {
  id: string;
  glyph: string;
  startX: number;
  scale: number;
  animY: Animated.Value;
  animX: Animated.Value;
  animScale: Animated.Value;
  animOpacity: Animated.Value;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Three bouncing dots typing indicator, styled as an incoming bubble. */
function BouncingDotsIndicator() {
  const styles = useThemedStyles(createStyles);
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createBounce = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: -6,
            duration: 300,
            easing: motion.easing.out,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 300,
            easing: motion.easing.in,
            useNativeDriver: true,
          }),
          Animated.delay(600 - delay),
        ])
      );

    const a1 = createBounce(dot1, 0);
    const a2 = createBounce(dot2, 150);
    const a3 = createBounce(dot3, 300);

    a1.start();
    a2.start();
    a3.start();

    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  return (
    <FadeSlideIn offsetY={8} style={styles.typingWrapper}>
      <View style={styles.typingBubble}>
        {[dot1, dot2, dot3].map((anim, i) => (
          <Animated.View key={i} style={[styles.typingDot, { transform: [{ translateY: anim }] }]} />
        ))}
      </View>
    </FadeSlideIn>
  );
}

/**
 * Burn-after-reading countdown. Urgency is carried by a quickening pulse and
 * a brighter bar rather than by turning red.
 */
function BurnRing({ seenAt, isMe }: { seenAt: string; isMe: boolean }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const [secondsLeft, setSecondsLeft] = useState(() => {
    const elapsed = (Date.now() - new Date(seenAt).getTime()) / 1000;
    return Math.max(0, Math.ceil(READ_MESSAGE_TTL_SECONDS - elapsed));
  });

  const isUrgent = secondsLeft <= 10;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - new Date(seenAt).getTime()) / 1000;
      setSecondsLeft(Math.max(0, Math.ceil(READ_MESSAGE_TTL_SECONDS - elapsed)));
    }, 1000);
    return () => clearInterval(timer);
  }, [seenAt, secondsLeft <= 0]);

  useEffect(() => {
    if (!isUrgent) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 500,
          easing: motion.easing.inOut,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 500,
          easing: motion.easing.inOut,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isUrgent, pulse]);

  const percent = Math.max(0, Math.min(100, (secondsLeft / READ_MESSAGE_TTL_SECONDS) * 100));
  const tone = isMe ? theme.chat.outMeta : theme.chat.inMeta;
  const urgentTone = isMe ? theme.chat.outText : theme.chat.inText;

  return (
    <Animated.View style={[styles.burnRow, { opacity: pulse }]}>
      <View style={[styles.burnTrack, { backgroundColor: tone }]}>
        <View
          style={[
            styles.burnFill,
            { width: `${percent}%`, backgroundColor: isUrgent ? urgentTone : tone },
          ]}
        />
      </View>
      <Text
        style={[styles.burnText, { color: isUrgent ? urgentTone : tone }]}
        maxFontSizeMultiplier={CHROME_FONT_CAP}
      >
        {secondsLeft}s
      </Text>
    </Animated.View>
  );
}

/**
 * Bubbles arrive from their own side of the conversation and leave the same
 * way — direction does the work colour would normally do.
 */
function AnimatedBubbleEntrance({
  children,
  isMe,
  isDeleting,
}: {
  children: React.ReactNode;
  isMe: boolean;
  isDeleting?: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const translateX = useRef(new Animated.Value(isMe ? 20 : -20)).current;
  const scale = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.duration.normal,
        easing: motion.easing.out,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: motion.duration.normal,
        easing: motion.easing.out,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.duration.fast,
        useNativeDriver: true,
      }),
      Animated.spring(scale, { toValue: 1, ...motion.spring.gentle, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (isDeleting) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: motion.duration.fast,
          easing: motion.easing.in,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.85,
          duration: motion.duration.fast,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: isMe ? 40 : -40,
          duration: motion.duration.fast,
          easing: motion.easing.in,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isDeleting]);

  return (
    <Animated.View
      style={{ opacity, transform: [{ translateY }, { translateX }, { scale }] }}
    >
      {children}
    </Animated.View>
  );
}

/** Swipe-to-reply wrapper. A reply arrow fades in as the bubble is dragged. */
function SwipeableMessage({
  children,
  onSwipeLeft,
  onPress,
  onLongPress,
  onDoublePress,
}: {
  children: React.ReactNode;
  onSwipeLeft: () => void;
  onPress: () => void;
  onLongPress: () => void;
  onDoublePress: () => void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const panX = useRef(new Animated.Value(0)).current;
  const lastTapRef = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dy) < 12,
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) panX.setValue(Math.max(-60, g.dx));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -35) onSwipeLeft();
        Animated.spring(panX, { toValue: 0, ...motion.spring.snappy, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(panX, { toValue: 0, ...motion.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      onDoublePress();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      setTimeout(() => {
        if (lastTapRef.current !== 0) {
          onPress();
          lastTapRef.current = 0;
        }
      }, 300);
    }
  };

  return (
    <View style={styles.swipeRoot}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.replyHint,
          {
            opacity: panX.interpolate({
              inputRange: [-50, -12, 0],
              outputRange: [1, 0, 0],
            }),
            transform: [
              {
                scale: panX.interpolate({
                  inputRange: [-50, 0],
                  outputRange: [1, 0.6],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      >
        <ReplyIcon color={theme.ink.mid} size={15} />
      </Animated.View>

      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX: panX }] }}>
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={handlePress}
          onLongPress={onLongPress}
          delayLongPress={400}
        >
          {children}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

/** Scroll-to-latest floating button. */
function ScrollToBottomFAB({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [rendered, setRendered] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.spring(anim, { toValue: 1, ...motion.spring.gentle, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: motion.duration.fast,
        easing: motion.easing.in,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [visible, anim]);

  if (!rendered) return null;

  return (
    <Animated.View
      style={[
        styles.scrollFab,
        {
          opacity: anim,
          transform: [
            { scale: anim },
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
      ]}
    >
      <PressableScale onPress={onPress} activeScale={0.88} style={styles.scrollFabButton}>
        <ChevronDown color={theme.ink.high} size={15} />
      </PressableScale>
    </Animated.View>
  );
}

/** Reaction mark — springs in when a message is double-tapped. */
function ReactionBadge({ isMe }: { isMe: boolean }) {
  const styles = useThemedStyles(createStyles);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true }).start();
  }, [pop]);

  return (
    <Animated.View
      style={[
        styles.reactionBadge,
        isMe ? styles.reactionBadgeMe : styles.reactionBadgeThem,
        { opacity: pop, transform: [{ scale: pop }] },
      ]}
    >
      <Text style={styles.reactionGlyph}>♥</Text>
    </Animated.View>
  );
}

/**
 * A photo inside a bubble. The bytes are held in the chat store keyed by
 * client_msg_id and fetched on first render; a picture that has already burned
 * resolves to null, which is shown as a tombstone rather than a broken image.
 */
function PhotoBubble({
  message,
  maxWidth,
  isMe,
  onPress,
}: {
  message: LocalMessage;
  maxWidth: number;
  isMe: boolean;
  onPress: (uri: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const theme = useTheme();
  const uri = useChatStore((state) => state.mediaUris[message.client_msg_id]);
  const ensureImageLoaded = useChatStore((state) => state.ensureImageLoaded);
  const isResolved = useChatStore((state) => message.client_msg_id in state.mediaUris);

  useEffect(() => {
    void ensureImageLoaded(message.client_msg_id, message.content);
  }, [ensureImageLoaded, message.client_msg_id, message.content]);

  // Photos are capped at 1600px on the long edge, so the aspect ratio the
  // sender saw is preserved rather than letterboxed into a fixed box.
  const width = Math.min(maxWidth, 260);
  const height = Math.round(width * 1.25);

  if (uri) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => onPress(uri)}>
        <Image
          source={{ uri }}
          style={[styles.photo, { width, height }]}
          resizeMode="cover"
        />
        {message.status === 'sending' && (
          <View style={styles.photoUploading}>
            <ActivityIndicator size="small" color={theme.palette.onAccent} />
          </View>
        )}
      </TouchableOpacity>
    );
  }

  // Not resolved yet means still loading — or a failed fetch, which leaves the
  // slot empty on purpose so tapping can retry rather than stranding a spinner.
  return (
    <TouchableOpacity
      activeOpacity={isResolved ? 1 : 0.7}
      disabled={isResolved}
      onPress={() => void ensureImageLoaded(message.client_msg_id, message.content)}
      style={[styles.photo, styles.photoPlaceholder, { width, height }]}
    >
      {isResolved ? (
        <Text style={[styles.photoGoneText, isMe ? styles.myBubbleText : styles.theirBubbleText]}>
          Photo deleted
        </Text>
      ) : (
        <ActivityIndicator size="small" color={theme.ink.low} />
      )}
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── MAIN COMPONENT ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export default function ChatScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  /**
   * Bubble width is resolved in real pixels rather than a percentage.
   * A `maxWidth: '80%'` here resolved against an auto-sized ancestor chain
   * (SwipeableMessage's wrapper → TouchableOpacity), which is circular —
   * the parent sizes to its content while the child sizes to its parent — so
   * long words and URLs escaped the cap and ran off the screen edge.
   * Reading the live window width also keeps bubbles correct across rotation
   * and split-screen resizes.
   */
  const { width: windowWidth } = useWindowDimensions();
  const maxBubbleWidth = Math.round((windowWidth - LIST_H_PADDING) * BUBBLE_WIDTH_RATIO);

  const user = useAuthStore((state) => state.user);
  const storedConversationId = useAuthStore((state) => state.conversationId);
  const setStoredConversationId = useAuthStore((state) => state.setConversationId);
  const setPartner = useAuthStore((state) => state.setPartner);
  const isScreenActive = useChatStore((state) => state.isScreenActive);

  const {
    conversationId,
    messages,
    isLoading,
    isFetchingMore,
    setConversationId,
    setScreenActive,
    loadCachedMessages,
    loadMoreMessages,
    sendChatMessage,
    sendImageMessage,
    deleteMessageLocally,
    clearAllMessages,
    markPartnerMessagesRead,
  } = useChatStore();

  // The store records rejected sends; without this the user never learned
  // their message had bounced.
  const lastError = useChatStore((state) => state.lastError);
  const clearError = useChatStore((state) => state.clearError);

  const { isPartnerOnline, partnerLastSeen, isPartnerTyping } = usePresenceStore();
  const connectionStatus = useConnectionStore((state) => state.status);

  const [inputMessage, setInputMessage] = useState('');
  const [checkingPair, setCheckingPair] = useState(true);
  const [replyToMessage, setReplyToMessage] = useState<any>(null);
  const [deletingMsgIds, setDeletingMsgIds] = useState<Set<string>>(new Set());
  const [reactedMsgIds, setReactedMsgIds] = useState<Set<string>>(new Set());
  const [showScrollFab, setShowScrollFab] = useState(false);
  /** Data URI of the photo open in the full-screen viewer, if any */
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);

  // ── Send button animation ─────────────────────────────────────────────
  const hasDraft = inputMessage.trim().length > 0;
  const sendAppear = useRef(new Animated.Value(0)).current;
  const sendPress = useRef(new Animated.Value(1)).current;
  /** Drives the plane "flying off" on send. */
  const sendFly = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(sendAppear, {
      toValue: hasDraft ? 1 : 0,
      ...motion.spring.bouncy,
      useNativeDriver: true,
    }).start();
  }, [hasDraft, sendAppear]);

  const playSendAnimation = () => {
    Animated.sequence([
      Animated.timing(sendPress, {
        toValue: 0.82,
        duration: 70,
        easing: motion.easing.in,
        useNativeDriver: true,
      }),
      Animated.spring(sendPress, { toValue: 1, ...motion.spring.bouncy, useNativeDriver: true }),
    ]).start();

    // The plane launches out of the button, then a fresh one fades back in
    Animated.sequence([
      Animated.timing(sendFly, {
        toValue: 1,
        duration: 200,
        easing: motion.easing.in,
        useNativeDriver: true,
      }),
      Animated.timing(sendFly, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]).start();
  };

  // ── Floating Love Hearts ──────────────────────────────────────────────
  const [loveHearts, setLoveHearts] = useState<HeartParticle[]>([]);

  const triggerLoveAnimation = useCallback(() => {
    // Monochrome glyphs, not colour emoji — the rest of the app has no hue
    const GLYPHS = ['♥', '♡'];

    const newHearts: HeartParticle[] = [];

    for (let i = 0; i < 8; i++) {
      const id = `heart-${Date.now()}-${i}-${Math.random()}`;
      const startX = 10 + Math.random() * 76;
      const animY = new Animated.Value(0);
      const animX = new Animated.Value(0);
      const animScale = new Animated.Value(0.2);
      const animOpacity = new Animated.Value(1);

      newHearts.push({
        id,
        glyph: GLYPHS[i % GLYPHS.length],
        startX,
        scale: 0.7 + Math.random() * 0.6,
        animY,
        animX,
        animScale,
        animOpacity,
      });

      const delay = i * 140;
      const duration = 2200 + Math.random() * 600;

      setTimeout(() => {
        Animated.parallel([
          Animated.timing(animY, {
            toValue: -340 - Math.random() * 160,
            duration,
            easing: motion.easing.out,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(animX, {
              toValue: 20,
              duration: duration / 2,
              easing: motion.easing.inOut,
              useNativeDriver: true,
            }),
            Animated.timing(animX, {
              toValue: -20,
              duration: duration / 2,
              easing: motion.easing.inOut,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.spring(animScale, {
              toValue: 1.3,
              ...motion.spring.bouncy,
              useNativeDriver: true,
            }),
            Animated.timing(animScale, {
              toValue: 0.85,
              duration: duration - 300,
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(animOpacity, { toValue: 0, duration, useNativeDriver: true }),
        ]).start();
      }, delay);
    }

    setLoveHearts((prev) => [...prev, ...newHearts]);
    setTimeout(() => {
      setLoveHearts((prev) => prev.filter((h) => !newHearts.some((nh) => nh.id === h.id)));
    }, 3600);
  }, []);

  const lastSeenMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    const latest = messages[messages.length - 1];
    if (latest.client_msg_id !== lastSeenMsgIdRef.current) {
      lastSeenMsgIdRef.current = latest.client_msg_id;
      if (/jaan/i.test(latest.content)) {
        triggerLoveAnimation();
      }
    }
  }, [messages, triggerLoveAnimation]);

  // ── 1. Startup ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const startup = async () => {
      try {
        await initDB();

        if (storedConversationId) {
          setConversationId(storedConversationId);
          await loadCachedMessages(storedConversationId);
          if (!cancelled) setCheckingPair(false);
        }

        connectSocket();
        await checkPairingStatus();
      } catch (err) {
        console.error('Error in chat startup:', err);
        if (!cancelled) setCheckingPair(false);
      }
    };

    startup();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Confirm pairing ───────────────────────────────────────────────
  const checkPairingStatus = async () => {
    try {
      const response = await apiClient.get('/conversation');

      if (!response.data.paired) {
        setCheckingPair(false);
        navigation.navigate('Profile');
        return;
      }

      const { conversationId: convId, partner } = response.data;

      setStoredConversationId(convId);
      setConversationId(convId);
      joinConversationRoom(convId);

      await loadCachedMessages(convId);

      if (partner) {
        setPartner(partner);
        usePresenceStore.getState().setPartnerOnline(partner.is_online, partner.last_seen);
      }

      setCheckingPair(false);

      const synced = await syncMessages(convId);
      useChatStore.getState().mergeMessages(synced);
    } catch (err: any) {
      console.warn('Could not confirm pairing status:', err?.message || err);
      setCheckingPair(false);
    }
  };

  // ── 3. Screen active state ────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      setScreenActive(true);
      return () => setScreenActive(false);
    }, [setScreenActive])
  );

  // ── 4. Mark partner messages as read ──────────────────────────────────
  useEffect(() => {
    if (!isScreenActive || !conversationId || messages.length === 0 || !user) return;

    const lastFromPartner = [...messages]
      .reverse()
      .find((m) => m.sender_id !== user.id && m.status !== 'seen');

    if (!lastFromPartner) return;

    emitMessageSeen(conversationId, lastFromPartner.id);

    const partnerId = getPartnerId(user) || lastFromPartner.sender_id;

    if (partnerId) {
      markPartnerMessagesRead(partnerId, lastFromPartner.created_at);
    }
  }, [isScreenActive, messages, conversationId, user, markPartnerMessagesRead]);

  // ── Privacy guards ────────────────────────────────────────────────────
  useHideOnBackground(navigation);

  useEffect(() => {
    const onBackPress = () => {
      navigation.reset({ index: 0, routes: [{ name: 'Todo' }] });
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [navigation]);

  // ── 5. Typing indicator ───────────────────────────────────────────────
  const handleTextChange = (text: string) => {
    setInputMessage(text);
    if (!conversationId) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      emitTyping(conversationId, true);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      emitTyping(conversationId, false);
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current && conversationId) {
        emitTyping(conversationId, false);
      }
    };
  }, [conversationId]);

  // ── 6. Send ───────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!inputMessage.trim() || !user || !conversationId) return;

    const messageText = inputMessage.trim();
    setInputMessage('');

    if (isTypingRef.current) {
      isTypingRef.current = false;
      emitTyping(conversationId, false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }

    playSendAnimation();
    haptic(10);

    // Quoting a photo must not put its attachment id in the quote line
    const replyText = replyToMessage
      ? replyToMessage.content_type === 'image'
        ? 'Photo'
        : replyToMessage.content
      : undefined;
    setReplyToMessage(null);

    await sendChatMessage(messageText, user.id, replyText);

    // Sending while scrolled back through history used to leave the new
    // message off-screen — follow it down to the newest end of the list.
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // ── 6b. Send a photo ──────────────────────────────────────────────────
  const sendPickedImage = async (source: 'camera' | 'gallery') => {
    if (!user || !conversationId || isAttaching) return;

    setIsAttaching(true);
    try {
      const image =
        source === 'camera' ? await takePhotoWithCamera() : await pickImageFromGallery();

      // Cancelled the picker — not an error, just nothing to send
      if (!image) return;

      haptic(10);

      const replyText = replyToMessage
        ? replyToMessage.content_type === 'image'
          ? 'Photo'
          : replyToMessage.content
        : undefined;
      setReplyToMessage(null);

      await sendImageMessage(image, user.id, replyText);
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (error: any) {
      Alert.alert('Could not attach photo', error?.message || 'Something went wrong.');
    } finally {
      setIsAttaching(false);
    }
  };

  const handleAttachPress = () => {
    Alert.alert('Send a photo', undefined, [
      { text: 'Take photo', onPress: () => void sendPickedImage('camera') },
      { text: 'Choose from gallery', onPress: () => void sendPickedImage('gallery') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ── 7. Load older messages ────────────────────────────────────────────
  const handleLoadMore = () => {
    if (conversationId) loadMoreMessages(conversationId);
  };

  // ── Presence text ─────────────────────────────────────────────────────
  const getPartnerPresenceText = () => {
    if (connectionStatus !== 'connected') return 'connecting…';
    if (isPartnerTyping) return 'typing…';
    if (isPartnerOnline) return 'online';
    if (!partnerLastSeen) return 'offline';

    try {
      const diffMins = Math.floor((Date.now() - new Date(partnerLastSeen).getTime()) / 60000);
      if (diffMins < 1) return 'last seen just now';
      if (diffMins < 60) return `last seen ${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `last seen ${diffHours}h ago`;
      return `last seen ${new Date(partnerLastSeen).toLocaleDateString()}`;
    } catch {
      return 'offline';
    }
  };

  // ── Status ticks (WhatsApp-style, drawn) ──────────────────────────────
  const renderStatusTicks = (status: string) => {
    switch (status) {
      case 'queued':
      case 'sending':
        return <PendingIcon color={theme.chat.outMeta} size={11} />;
      case 'sent':
        return <CheckTicks color={theme.chat.outMeta} size={12} />;
      case 'delivered':
        return <CheckTicks double color={theme.chat.outMeta} size={12} />;
      case 'seen':
        return <CheckTicks double color={theme.chat.tickRead} size={12} />;
      default:
        return null;
    }
  };

  // ── Double-tap react ──────────────────────────────────────────────────
  const handleDoubleTap = useCallback((clientMsgId: string) => {
    haptic(15);
    setReactedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientMsgId)) {
        next.delete(clientMsgId);
      } else {
        next.add(clientMsgId);
      }
      return next;
    });
  }, []);

  // ── Long-press menu ───────────────────────────────────────────────────
  const handleLongPress = useCallback(
    (msg: any) => {
      haptic(25);

      const isPhoto = msg.content_type === 'image';

      Alert.alert(
        '',
        undefined,
        [
          // Copying a photo message would only put its attachment id on the
          // clipboard, so the option is text-only.
          ...(isPhoto
            ? []
            : [
                {
                  text: 'Copy',
                  onPress: () => {
                    Clipboard.setString(msg.content);
                  },
                },
              ]),
          {
            text: 'Reply',
            onPress: () => setReplyToMessage(msg),
          },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              setDeletingMsgIds((prev) => new Set(prev).add(msg.client_msg_id));
              setTimeout(() => {
                deleteMessageLocally(msg.client_msg_id);
                setDeletingMsgIds((prev) => {
                  const next = new Set(prev);
                  next.delete(msg.client_msg_id);
                  return next;
                });
              }, 220);
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    },
    [deleteMessageLocally]
  );

  // ── Scroll tracking ──────────────────────────────────────────────────
  const handleScroll = useCallback((e: any) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    setShowScrollFab(offsetY > 300);
  }, []);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // ── Computed data ─────────────────────────────────────────────────────
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const partnerInfo: any = typeof user?.partner_id === 'object' ? user.partner_id : null;
  const partnerName = partnerInfo?.display_name || 'My Partner';
  const partnerInitial = partnerName.charAt(0).toUpperCase();

  // ── Header press ──────────────────────────────────────────────────────
  const handleHeaderPress = useCallback(() => {
    Alert.alert(
      partnerName,
      'Choose an option:',
      [
        { text: 'Profile & Settings', onPress: () => navigation.navigate('Profile') },
        {
          text: 'Clear Chat History',
          style: 'destructive',
          onPress: () => { if (conversationId) clearAllMessages(conversationId); },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [partnerName, conversationId, clearAllMessages, navigation]);

  // ── Render message item ───────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const isMe = item.sender_id === user?.id;
      const isBurning = !!item.seen_at;
      const isDeleting = deletingMsgIds.has(item.client_msg_id);
      const hasReaction = reactedMsgIds.has(item.client_msg_id);

      // Grouping: the list is inverted, so "next" is the older neighbour
      const nextItem = invertedMessages[index + 1];
      const prevItem = index > 0 ? invertedMessages[index - 1] : null;

      const isFirstInGroup = !nextItem ||
        nextItem.sender_id !== item.sender_id ||
        Math.abs(new Date(item.created_at).getTime() - new Date(nextItem.created_at).getTime()) > GROUP_TIME_MS;

      const isLastInGroup = !prevItem ||
        prevItem.sender_id !== item.sender_id ||
        Math.abs(new Date(item.created_at).getTime() - new Date(prevItem.created_at).getTime()) > GROUP_TIME_MS;

      const showDateSeparator = !nextItem || !isSameDay(item.created_at, nextItem.created_at);

      return (
        <>
          {/* Date separator, WhatsApp-style centred pill */}
          {showDateSeparator && (
            <View style={styles.dateSeparator}>
              <View style={styles.datePill}>
                <Text style={styles.datePillText} maxFontSizeMultiplier={CHROME_FONT_CAP}>
                  {getDateLabel(item.created_at)}
                </Text>
              </View>
            </View>
          )}

          <AnimatedBubbleEntrance isMe={isMe} isDeleting={isDeleting}>
            <View style={[
              styles.messageRow,
              isMe ? styles.messageRowMe : styles.messageRowThem,
              { marginBottom: isLastInGroup ? 8 : 2 },
            ]}>
              <SwipeableMessage
                onSwipeLeft={() => setReplyToMessage(item)}
                onLongPress={() => handleLongPress(item)}
                onPress={() => {}}
                onDoublePress={() => handleDoubleTap(item.client_msg_id)}
              >
                <View style={[styles.bubbleColumn, { maxWidth: maxBubbleWidth }]}>
                  {/* Tail on the first bubble of a run, as WhatsApp does */}
                  {isFirstInGroup && (
                    <View style={isMe ? styles.tailMe : styles.tailThem} />
                  )}

                  <View style={[
                    styles.bubble,
                    isMe ? styles.myBubble : styles.theirBubble,
                    isFirstInGroup && (isMe ? styles.myBubbleTailCorner : styles.theirBubbleTailCorner),
                  ]}>
                    {/* Quoted reply */}
                    {item.reply_to ? (
                      <View style={[styles.quote, isMe ? styles.quoteMe : styles.quoteThem]}>
                        <View style={[styles.quoteBar, isMe ? styles.quoteBarMe : styles.quoteBarThem]} />
                        <Text
                          style={[styles.quoteText, isMe ? styles.quoteTextMe : styles.quoteTextThem]}
                          numberOfLines={2}
                        >
                          {item.reply_to}
                        </Text>
                      </View>
                    ) : null}

                    {/*
                      Text and meta share a wrapping row. Short messages get the
                      time on the same line; long ones push it to its own line,
                      right-aligned — the WhatsApp behaviour, without needing to
                      measure text.
                    */}
                    <View style={styles.bubbleInner}>
                      {item.content_type === 'image' ? (
                        <PhotoBubble
                          message={item}
                          maxWidth={maxBubbleWidth}
                          isMe={isMe}
                          onPress={setViewerUri}
                        />
                      ) : (
                        <Text
                          style={[styles.bubbleText, isMe ? styles.myBubbleText : styles.theirBubbleText]}
                        >
                          {item.content}
                        </Text>
                      )}

                      <View style={styles.metaInline}>
                        <Text
                          style={[styles.metaTime, isMe ? styles.metaTimeMe : styles.metaTimeThem]}
                          maxFontSizeMultiplier={CHROME_FONT_CAP}
                        >
                          {formatTime(item.created_at)}
                        </Text>
                        {isMe && (
                          <View style={styles.tickWrapper}>{renderStatusTicks(item.status)}</View>
                        )}
                      </View>
                    </View>

                    {/* Burn countdown lives inside the bubble */}
                    {isBurning && (
                      <View style={styles.burnWrapper}>
                        <BurnRing seenAt={item.seen_at} isMe={isMe} />
                      </View>
                    )}
                  </View>

                  {hasReaction && <ReactionBadge isMe={isMe} />}
                </View>
              </SwipeableMessage>
            </View>
          </AnimatedBubbleEntrance>
        </>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, deletingMsgIds, reactedMsgIds, invertedMessages, maxBubbleWidth, styles, theme, handleLongPress, handleDoubleTap]
  );

  // ── Back button handler ───────────────────────────────────────────────
  const handleBackPress = useCallback(() => {
    navigation.reset({ index: 0, routes: [{ name: 'Todo' }] });
  }, [navigation]);

  // ═══════════════════════════════════════════════════════════════════════
  // ─── RENDER ───────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  if (checkingPair && messages.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar
          barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
          backgroundColor={theme.surfaces.canvas}
        />
        <FadeSlideIn offsetY={0} scaleFrom={0.85}>
          <View style={styles.lockMark}>
            <View style={styles.lockShackle} />
            <View style={styles.lockBody} />
          </View>
        </FadeSlideIn>
        <FadeSlideIn index={1}>
          <Text style={styles.loadingText}>Entering secure room</Text>
        </FadeSlideIn>
      </View>
    );
  }

  const charCount = inputMessage.length;
  const showCharCounter = charCount >= CHAR_WARN_THRESHOLD;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surfaces.bar}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.bottom : (Platform.OS === 'android' ? 25 : 0)}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <PressableScale onPress={handleBackPress} style={styles.headerBackBtn} activeScale={0.86}>
            <ChevronLeft color={theme.ink.high} size={18} />
          </PressableScale>

          <PressableScale onPress={handleHeaderPress} style={styles.headerCenter} activeScale={0.985}>
            <View style={styles.avatarContainer}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{partnerInitial}</Text>
              </View>
              {isPartnerOnline && connectionStatus === 'connected' && (
                <>
                  <View style={styles.onlineDotWrap}>
                    <Pulse size={9} active />
                  </View>
                  <View style={styles.onlineDot} />
                </>
              )}
            </View>

            <View style={styles.headerInfo}>
              <Text style={styles.headerName} numberOfLines={1}>{partnerName}</Text>
              <Text style={styles.headerPresence} numberOfLines={1}>
                {getPartnerPresenceText()}
              </Text>
            </View>
          </PressableScale>

          <View style={styles.headerSpacer} />
        </View>

        {/* ── Offline Banner ── */}
        {connectionStatus !== 'connected' && (
          <FadeSlideIn offsetY={-8} duration={motion.duration.fast}>
            <View style={styles.offlineBanner}>
              <View style={styles.offlineDot} />
              <Text style={styles.offlineText}>
                {connectionStatus === 'connecting' ? 'Reconnecting' : 'Offline — messages queued'}
              </Text>
            </View>
          </FadeSlideIn>
        )}

        {/* ── Message List ── */}
        <FlatList
          ref={flatListRef}
          data={invertedMessages}
          keyExtractor={(item) => item.client_msg_id}
          renderItem={renderItem}
          inverted
          contentContainerStyle={styles.listContent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.2}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            isFetchingMore ? (
              <View style={styles.fetchingMore}>
                <Shimmer width={80} height={7} radius={radius.pill} />
              </View>
            ) : null
          }
          ListHeaderComponent={isPartnerTyping ? <BouncingDotsIndicator /> : null}
        />

        {/* ── Empty State ── */}
        {messages.length === 0 && !isLoading && (
          <View style={styles.emptyOverlay} pointerEvents="none">
            <FadeSlideIn scaleFrom={0.9} offsetY={10}>
              <View style={styles.lockMark}>
                <View style={styles.lockShackle} />
                <View style={styles.lockBody} />
              </View>
            </FadeSlideIn>
            <FadeSlideIn index={1}>
              <Text style={styles.emptyTitle}>End-to-end private</Text>
            </FadeSlideIn>
            <FadeSlideIn index={2}>
              <Text style={styles.emptySubtitle}>Messages self-destruct after being read</Text>
            </FadeSlideIn>
          </View>
        )}

        {isLoading && messages.length === 0 && (
          <View style={styles.fetchingMore}>
            <Shimmer width={80} height={7} radius={radius.pill} />
          </View>
        )}

        <ScrollToBottomFAB visible={showScrollFab} onPress={scrollToBottom} />

        {/* ── Floating Love Hearts ── */}
        {loveHearts.length > 0 && (
          <View style={styles.heartsOverlay} pointerEvents="none">
            {loveHearts.map((h) => (
              <Animated.View
                key={h.id}
                style={[
                  styles.floatingHeart,
                  {
                    left: `${h.startX}%`,
                    opacity: h.animOpacity,
                    transform: [
                      { translateY: h.animY },
                      { translateX: h.animX },
                      { scale: h.animScale },
                    ],
                  },
                ]}
              >
                <Text style={[styles.floatingHeartGlyph, { fontSize: 24 * h.scale }]}>
                  {h.glyph}
                </Text>
              </Animated.View>
            ))}
          </View>
        )}

        {/* ── Send failure notice ── */}
        {lastError && (
          <FadeSlideIn offsetY={12} duration={motion.duration.fast}>
            <View style={styles.noticeBanner}>
              <View style={styles.noticeBar} />
              <View style={styles.noticeContent}>
                <Text style={styles.noticeLabel}>Message not sent</Text>
                <Text style={styles.noticeText} numberOfLines={2}>
                  {lastError} — it stays queued and will retry.
                </Text>
              </View>
              <PressableScale onPress={clearError} style={styles.noticeClose} activeScale={0.85}>
                <CloseIcon color={theme.ink.low} size={11} />
              </PressableScale>
            </View>
          </FadeSlideIn>
        )}

        {/* ── Reply Preview ── */}
        {replyToMessage && (
          <FadeSlideIn offsetY={12} duration={motion.duration.fast}>
            <View style={styles.replyBanner}>
              <View style={styles.replyBannerBar} />
              <View style={styles.replyBannerContent}>
                <Text style={styles.replyBannerLabel}>
                  {replyToMessage.sender_id === user?.id ? 'You' : partnerName}
                </Text>
                <Text style={styles.replyBannerText} numberOfLines={1}>
                  {replyToMessage.content_type === 'image' ? 'Photo' : replyToMessage.content}
                </Text>
              </View>
              <PressableScale
                onPress={() => setReplyToMessage(null)}
                style={styles.replyBannerClose}
                activeScale={0.85}
              >
                <CloseIcon color={theme.ink.low} size={11} />
              </PressableScale>
            </View>
          </FadeSlideIn>
        )}

        {/* ── Input Bar ── */}
        <View style={styles.inputBar}>
          <PressableScale
            onPress={handleAttachPress}
            style={styles.attachBtn}
            activeScale={0.86}
            disabled={isAttaching}
          >
            {isAttaching ? (
              <ActivityIndicator size="small" color={theme.ink.low} />
            ) : (
              <CameraIcon color={theme.ink.low} size={20} />
            )}
          </PressableScale>

          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder="Aur btaao"
              placeholderTextColor={theme.ink.faint}
              multiline
              value={inputMessage}
              onChangeText={handleTextChange}
              maxLength={MAX_CHARS}
            />
            {showCharCounter && (
              <Text
                style={[styles.charCounter, charCount >= MAX_CHARS && styles.charCounterMax]}
                maxFontSizeMultiplier={CHROME_FONT_CAP}
              >
                {MAX_CHARS - charCount}
              </Text>
            )}
          </View>

          <TouchableOpacity onPress={handleSend} disabled={!hasDraft} activeOpacity={0.85}>
            <Animated.View
              style={[
                styles.sendBtn,
                {
                  transform: [
                    {
                      scale: Animated.multiply(
                        sendPress,
                        sendAppear.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] })
                      ),
                    },
                  ],
                  opacity: sendAppear.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.38, 1],
                  }),
                },
              ]}
            >
              {/* The plane itself launches out of the button on send */}
              <Animated.View
                style={{
                  opacity: sendFly.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                  transform: [
                    {
                      translateX: sendFly.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 22],
                      }),
                    },
                    {
                      translateY: sendFly.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -14],
                      }),
                    },
                    {
                      scale: sendFly.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0.6],
                      }),
                    },
                  ],
                  // Nudge right so the dart reads as centred in the circle
                  marginLeft: 2,
                }}
              >
                <SendIcon size={18} color={theme.palette.onAccent} notchColor={theme.palette.accent} />
              </Animated.View>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/*
        Full-screen photo viewer. Deliberately has no save or share action —
        these pictures are meant to disappear, and the countdown keeps running
        underneath while the viewer is open.
      */}
      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
      >
        <View style={styles.viewerBackdrop}>
          <TouchableOpacity
            style={styles.viewerDismissArea}
            activeOpacity={1}
            onPress={() => setViewerUri(null)}
          >
            {viewerUri && (
              <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />
            )}
          </TouchableOpacity>

          <PressableScale
            onPress={() => setViewerUri(null)}
            style={[styles.viewerClose, { top: insets.top + space.sm }]}
            activeScale={0.85}
          >
            <CloseIcon color={theme.palette.onAccent} size={14} />
          </PressableScale>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── STYLES ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.chat.canvas,
    },
    flex: {
      flex: 1,
    },

    // ── Loading / lock mark ──
    loadingContainer: {
      flex: 1,
      backgroundColor: t.chat.canvas,
      justifyContent: 'center',
      alignItems: 'center',
    },
    lockMark: {
      alignItems: 'center',
      marginBottom: space.base,
    },
    lockShackle: {
      width: 18,
      height: 12,
      borderTopLeftRadius: 10,
      borderTopRightRadius: 10,
      borderWidth: 2,
      borderBottomWidth: 0,
      borderColor: t.ink.faint,
    },
    lockBody: {
      width: 28,
      height: 21,
      borderRadius: radius.xs,
      borderWidth: 2,
      borderColor: t.ink.low,
      marginTop: -1,
    },
    loadingText: {
      ...type.callout,
      color: t.ink.low,
    },

    // ── Header ──
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.sm,
      paddingVertical: space.sm,
      backgroundColor: t.surfaces.bar,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borders.default,
    },
    headerBackBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerCenter: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: space.xs,
    },
    avatarContainer: {
      position: 'relative',
      width: 36,
      height: 36,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.surfaces.washStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      fontSize: 14,
      fontWeight: '700',
      color: t.ink.high,
    },
    onlineDotWrap: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 9,
      height: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    onlineDot: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: t.ink.max,
      borderWidth: 1.5,
      borderColor: t.surfaces.bar,
    },
    headerInfo: {
      marginLeft: space.sm,
      flex: 1,
    },
    headerName: {
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: -0.2,
      color: t.ink.max,
    },
    headerPresence: {
      fontSize: 11,
      color: t.ink.low,
      marginTop: 1,
    },
    headerSpacer: {
      width: space.sm,
    },

    // ── Offline Banner ──
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaces.wash,
      paddingVertical: 6,
      paddingHorizontal: space.base,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borders.subtle,
    },
    offlineDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: t.ink.mid,
      marginRight: space.sm,
    },
    offlineText: {
      fontSize: 11,
      fontWeight: '500',
      color: t.ink.mid,
    },

    // ── List ──
    listContent: {
      paddingHorizontal: space.sm,
      paddingVertical: space.sm,
      flexGrow: 1,
    },
    fetchingMore: {
      alignItems: 'center',
      paddingVertical: space.md,
    },

    // ── Date separator ──
    dateSeparator: {
      alignItems: 'center',
      marginVertical: space.md,
    },
    datePill: {
      backgroundColor: t.surfaces.washStrong,
      paddingHorizontal: space.md,
      paddingVertical: 4,
      borderRadius: radius.sm,
    },
    datePillText: {
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.4,
      color: t.ink.mid,
      textTransform: 'uppercase',
    },

    // ── Message row ──
    messageRow: {
      width: '100%',
      flexDirection: 'row',
    },
    messageRowMe: {
      justifyContent: 'flex-end',
    },
    messageRowThem: {
      justifyContent: 'flex-start',
    },
    swipeRoot: {
      flexShrink: 1,
    },

    // ── Reply swipe hint ──
    replyHint: {
      position: 'absolute',
      right: 0,
      top: 0,
      bottom: 0,
      width: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ── Bubble ──
    // maxWidth is applied inline in px — see the note in ChatScreen()
    bubbleColumn: {
      flexDirection: 'column',
      flexShrink: 1,
    },
    bubble: {
      borderRadius: radius.md,
      paddingHorizontal: space.sm + 2,
      paddingTop: 6,
      paddingBottom: 5,
      flexShrink: 1,
      ...t.elevation.sm,
    },
    myBubble: {
      backgroundColor: t.chat.outBubble,
    },
    theirBubble: {
      backgroundColor: t.chat.inBubble,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.chat.inBorder,
    },
    // Square off the corner the tail joins onto
    myBubbleTailCorner: {
      borderTopRightRadius: 3,
    },
    theirBubbleTailCorner: {
      borderTopLeftRadius: 3,
    },
    tailMe: {
      position: 'absolute',
      top: 0,
      right: -TAIL_W + 1,
      width: 0,
      height: 0,
      borderTopWidth: 0,
      borderBottomWidth: TAIL_H,
      borderLeftWidth: TAIL_W,
      borderBottomColor: 'transparent',
      borderLeftColor: t.chat.outBubble,
    },
    tailThem: {
      position: 'absolute',
      top: 0,
      left: -TAIL_W + 1,
      width: 0,
      height: 0,
      borderTopWidth: 0,
      borderBottomWidth: TAIL_H,
      borderRightWidth: TAIL_W,
      borderBottomColor: 'transparent',
      borderRightColor: t.chat.inBubble,
    },

    // Text + inline meta share a wrapping row
    bubbleInner: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
    },
    bubbleText: {
      fontSize: 14.5,
      lineHeight: 19,
      letterSpacing: -0.1,
      // Without this a single unbroken token (a long URL, "aaaaaa…") measures
      // wider than the bubble and pushes past the cap instead of wrapping
      flexShrink: 1,
    },
    myBubbleText: {
      color: t.chat.outText,
    },
    theirBubbleText: {
      color: t.chat.inText,
    },
    metaInline: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 'auto',
      paddingLeft: space.sm,
      // Lifts the meta onto the text baseline rather than the line box
      paddingTop: 3,
    },
    metaTime: {
      fontSize: 10,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    metaTimeMe: {
      color: t.chat.outMeta,
    },
    metaTimeThem: {
      color: t.chat.inMeta,
    },
    tickWrapper: {
      marginLeft: 3,
    },

    // ── Quoted reply ──
    quote: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderRadius: radius.xs,
      marginBottom: 4,
      paddingVertical: 4,
      paddingRight: space.sm,
      overflow: 'hidden',
    },
    quoteMe: {
      backgroundColor: t.chat.outQuoteBg,
    },
    quoteThem: {
      backgroundColor: t.chat.inQuoteBg,
    },
    quoteBar: {
      width: 3,
      alignSelf: 'stretch',
      marginRight: space.sm,
      minHeight: 16,
    },
    quoteBarMe: {
      backgroundColor: t.chat.outQuoteBar,
    },
    quoteBarThem: {
      backgroundColor: t.chat.inQuoteBar,
    },
    quoteText: {
      fontSize: 12,
      lineHeight: 16,
      flexShrink: 1,
    },
    quoteTextMe: {
      color: t.chat.outMeta,
    },
    quoteTextThem: {
      color: t.chat.inMeta,
    },

    // ── Reaction ──
    reactionBadge: {
      position: 'absolute',
      bottom: -8,
      backgroundColor: t.surfaces.raised,
      borderRadius: radius.pill,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      zIndex: 10,
      ...t.elevation.sm,
    },
    reactionBadgeMe: {
      right: space.sm,
    },
    reactionBadgeThem: {
      left: space.sm,
    },
    reactionGlyph: {
      fontSize: 10,
      color: t.ink.max,
    },

    // ── Burn countdown ──
    burnWrapper: {
      marginTop: 2,
      alignSelf: 'flex-start',
    },
    burnRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    burnTrack: {
      width: 26,
      height: 2,
      borderRadius: 2,
      overflow: 'hidden',
      opacity: 0.45,
    },
    burnFill: {
      height: '100%',
      borderRadius: 2,
    },
    burnText: {
      fontSize: 9,
      marginLeft: space.xs,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },

    // ── Typing indicator ──
    typingWrapper: {
      paddingHorizontal: space.sm,
      paddingVertical: space.sm,
    },
    typingBubble: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.chat.inBubble,
      paddingHorizontal: space.md,
      paddingVertical: 10,
      borderRadius: radius.md,
      borderTopLeftRadius: 3,
      alignSelf: 'flex-start',
      gap: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.chat.inBorder,
      ...t.elevation.sm,
    },
    typingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.chat.inMeta,
    },

    // ── Hearts ──
    heartsOverlay: {
      ...(StyleSheet.absoluteFill as object),
      zIndex: 999,
    },
    floatingHeart: {
      position: 'absolute',
      bottom: 80,
    },
    floatingHeartGlyph: {
      color: t.ink.max,
    },

    // ── Empty state ──
    emptyOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: {
      ...type.heading,
      color: t.ink.mid,
    },
    emptySubtitle: {
      ...type.caption,
      color: t.ink.faint,
      marginTop: space.xs,
    },

    // ── Scroll FAB ──
    scrollFab: {
      position: 'absolute',
      right: space.md,
      bottom: 76,
      zIndex: 100,
    },
    scrollFabButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.surfaces.bar,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      justifyContent: 'center',
      alignItems: 'center',
      ...t.elevation.md,
    },

    // ── Notice / reply banners ──
    noticeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaces.bar,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borders.default,
    },
    noticeBar: {
      width: 2,
      alignSelf: 'stretch',
      minHeight: 28,
      backgroundColor: t.ink.max,
      borderRadius: 1,
      marginRight: space.md,
    },
    noticeContent: {
      flex: 1,
    },
    noticeLabel: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: t.ink.max,
    },
    noticeText: {
      fontSize: 11,
      lineHeight: 15,
      color: t.ink.mid,
      marginTop: 1,
    },
    noticeClose: {
      padding: space.sm,
    },
    replyBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaces.bar,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borders.default,
    },
    replyBannerBar: {
      width: 2,
      alignSelf: 'stretch',
      minHeight: 28,
      backgroundColor: t.ink.mid,
      borderRadius: 1,
      marginRight: space.md,
    },
    replyBannerContent: {
      flex: 1,
    },
    replyBannerLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: t.ink.high,
    },
    replyBannerText: {
      fontSize: 12,
      color: t.ink.low,
      marginTop: 1,
    },
    replyBannerClose: {
      padding: space.sm,
    },

    // ── Input bar ──
    inputBar: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: space.sm,
      paddingVertical: space.sm,
      gap: space.sm,
      backgroundColor: t.surfaces.bar,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.borders.default,
    },
    inputWrapper: {
      flex: 1,
      position: 'relative',
    },
    attachBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaces.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
    },
    photo: {
      borderRadius: radius.md,
      backgroundColor: t.surfaces.sunken,
      overflow: 'hidden',
    },
    photoPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoGoneText: {
      ...type.caption,
      opacity: 0.7,
    },
    photoUploading: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.28)',
      borderRadius: radius.md,
    },
    viewerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.94)',
    },
    viewerDismissArea: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerImage: {
      width: '100%',
      height: '100%',
    },
    viewerClose: {
      position: 'absolute',
      right: space.md,
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.16)',
    },
    textInput: {
      backgroundColor: t.surfaces.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.xl,
      color: t.ink.max,
      paddingHorizontal: space.base,
      paddingTop: Platform.OS === 'ios' ? 9 : 7,
      paddingBottom: Platform.OS === 'ios' ? 9 : 7,
      fontSize: 14.5,
      maxHeight: 110,
      lineHeight: 19,
    },
    charCounter: {
      position: 'absolute',
      bottom: -13,
      right: space.md,
      fontSize: 10,
      color: t.ink.faint,
      fontVariant: ['tabular-nums'],
    },
    charCounterMax: {
      color: t.ink.max,
      fontWeight: '700',
    },

    // ── Send button ──
    sendBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: t.palette.accent,
      justifyContent: 'center',
      alignItems: 'center',
      ...t.elevation.md,
    },
  });
