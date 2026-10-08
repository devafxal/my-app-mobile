import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  ScrollView,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { disconnectSocket, joinConversationRoom } from '../sockets';
import { unregisterPushNotifications } from '../services/push';
import { clearAllMessages } from '../db';
import ServerSettingsModal from '../components/ServerSettingsModal';
import { useSettingsStore, ThemeMode, SecretGesture } from '../store/settingsStore';
import { useHideOnBackground } from '../hooks/useHideOnBackground';
import { FadeSlideIn, PressableScale, Pulse } from '../components/ui/motion';
import Field from '../components/ui/Field';
import {
  radius,
  space,
  Theme,
  type,
  useTheme,
  useThemedStyles,
  useThemeMode,
} from '../theme';
import apiClient from '../api';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const GESTURE_OPTIONS: { value: SecretGesture; label: string }[] = [
  { value: 'tap', label: 'Tap title ×3' },
  { value: 'hold', label: 'Hold + button' },
];

export default function ProfileScreen({ navigation }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [themeMode, setThemeMode] = useThemeMode();

  const { user, logout, setPartner, setConversationId } = useAuthStore();
  const clearChat = useChatStore((state) => state.clearChat);
  const serverUrl = useSettingsStore((state) => state.serverUrl);
  const secretGesture = useSettingsStore((state) => state.secretGesture);
  const setSecretGesture = useSettingsStore((state) => state.setSecretGesture);

  const [partnerCode, setPartnerCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);

  // Also behind the secret gesture — don't leave it open in the recents list
  useHideOnBackground(navigation);

  const isPaired = !!user?.partner_id;
  const partnerInfo: any = typeof user?.partner_id === 'object' ? user.partner_id : null;

  const handlePairing = async () => {
    if (!partnerCode) {
      setError('Please enter a pair code');
      return;
    }

    setPairing(true);
    setError('');

    try {
      const response = await apiClient.post('/conversation/pair', {
        pair_code: partnerCode.trim(),
      });

      const { partner, conversationId } = response.data;

      // Update partner in local profile store
      setPartner(partner);

      Alert.alert('Paired', `Successfully paired with ${partner.display_name}.`, [
        {
          text: 'Start Chatting',
          onPress: () => {
            setConversationId(conversationId);
            useChatStore.getState().setConversationId(conversationId);
            joinConversationRoom(conversationId);
            navigation.navigate('Chat');
          },
        },
      ]);
    } catch (err: any) {
      console.error('Pairing error:', err);
      setError(err.response?.data?.error || 'Pairing failed. Check the code and try again.');
    } finally {
      setPairing(false);
    }
  };

  const handleUnpair = () => {
    Alert.alert(
      'Disconnect Partner',
      'This will remove the pairing and delete all chat history. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.delete('/conversation/pair');
              disconnectSocket();
              clearChat();
              await clearAllMessages();
              // Clear partner and conversation from local state
              setPartner(null);
              setConversationId(null);
              useChatStore.getState().setConversationId(null);
              Alert.alert('Done', 'You have been unpaired. You can now connect with someone else.');
            } catch (err: any) {
              console.error('Unpair error:', err);
              Alert.alert('Error', err.response?.data?.error || 'Failed to unpair. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          // Stop notifications for this account on this device, then wipe the
          // cached history so a different account starts clean.
          await unregisterPushNotifications();
          disconnectSocket();
          clearChat();
          await clearAllMessages();
          await logout();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surfaces.canvas}
      />
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeSlideIn index={0}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Account</Text>
            <Text style={styles.headerSubtitle}>Profile, pairing and appearance</Text>
          </View>
        </FadeSlideIn>

        {/* My Details */}
        <FadeSlideIn index={1} offsetY={16}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>My Profile</Text>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Name</Text>
              <Text style={styles.detailValue}>{user?.display_name}</Text>
            </View>
            <View style={[styles.detailRow, styles.detailRowLast]}>
              <Text style={styles.detailLabel}>Contact</Text>
              <Text style={styles.detailValue}>{user?.phone_or_email}</Text>
            </View>

            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Share this code with your partner</Text>
              <Text style={styles.codeValue}>{user?.pair_code}</Text>
            </View>
          </View>
        </FadeSlideIn>

        {/* Appearance */}
        <FadeSlideIn index={2} offsetY={16}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Appearance</Text>
            <View style={styles.segment}>
              {THEME_OPTIONS.map((option) => {
                const active = themeMode === option.value;
                return (
                  <PressableScale
                    key={option.value}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                    activeScale={0.95}
                    onPress={() => setThemeMode(option.value)}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {option.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
            <Text style={styles.segmentHint}>
              {themeMode === 'system'
                ? `Following your device — currently ${theme.mode}.`
                : `Always ${themeMode}.`}
            </Text>
          </View>
        </FadeSlideIn>

        {/* Chat access gesture */}
        <FadeSlideIn index={3} offsetY={16}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Chat Access</Text>
            <View style={styles.segment}>
              {GESTURE_OPTIONS.map((option) => {
                const active = secretGesture === option.value;
                return (
                  <PressableScale
                    key={option.value}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                    activeScale={0.95}
                    onPress={() => setSecretGesture(option.value)}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {option.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
            <Text style={styles.segmentHint}>
              {secretGesture === 'tap'
                ? 'Tap "Tasks" three times quickly to open chat.'
                : 'Hold the + button for 20 seconds to open chat.'}
            </Text>
          </View>
        </FadeSlideIn>

        {/* Pairing Panel */}
        {!isPaired ? (
          <FadeSlideIn index={4} offsetY={16}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Pair with Partner</Text>
              <Text style={styles.infoText}>
                Enter your partner's 6-digit invitation code to create a private chat room.
              </Text>

              {error ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Field
                containerStyle={styles.codeFieldWrap}
                inputStyle={styles.codeInput}
                placeholder="000000"
                keyboardType="number-pad"
                maxLength={6}
                value={partnerCode}
                onChangeText={setPartnerCode}
              />

              <PressableScale
                style={styles.primaryButton}
                activeScale={0.97}
                onPress={handlePairing}
                disabled={pairing}
              >
                {pairing ? (
                  <ActivityIndicator color={theme.palette.onAccent} />
                ) : (
                  <Text style={styles.primaryButtonText}>Link Partner Account</Text>
                )}
              </PressableScale>
            </View>
          </FadeSlideIn>
        ) : (
          <FadeSlideIn index={4} offsetY={16}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Linked Partner</Text>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Partner Name</Text>
                <Text style={styles.detailValue}>{partnerInfo?.display_name || 'Paired Partner'}</Text>
              </View>
              <View style={[styles.detailRow, styles.detailRowLast]}>
                <Text style={styles.detailLabel}>Partner Contact</Text>
                <Text style={styles.detailValue}>{partnerInfo?.phone_or_email || 'Linked'}</Text>
              </View>

              <View style={styles.statusRow}>
                <View style={styles.statusDotWrap}>
                  <Pulse size={8} active />
                  <View style={styles.statusDot} />
                </View>
                <Text style={styles.statusLabel}>Securely paired &amp; connected</Text>
              </View>

              <PressableScale
                style={styles.primaryButton}
                activeScale={0.97}
                onPress={() => navigation.navigate('Chat')}
              >
                <Text style={styles.primaryButtonText}>Go to Chat</Text>
              </PressableScale>

              <PressableScale
                style={styles.dangerButton}
                activeScale={0.97}
                onPress={handleUnpair}
              >
                <Text style={styles.dangerButtonText}>Disconnect Partner</Text>
              </PressableScale>
            </View>
          </FadeSlideIn>
        )}

        {/* Server address (changes with the network the backend runs on) */}
        <FadeSlideIn index={5}>
          <PressableScale
            style={styles.serverButton}
            activeScale={0.96}
            onPress={() => setShowServerSettings(true)}
          >
            <Text style={styles.serverButtonText}>Server · {serverUrl}</Text>
          </PressableScale>
        </FadeSlideIn>

        {/* Logout Button */}
        <FadeSlideIn index={6}>
          <PressableScale style={styles.dangerButton} activeScale={0.97} onPress={handleLogout}>
            <Text style={styles.dangerButtonText}>Sign Out</Text>
          </PressableScale>
        </FadeSlideIn>
      </ScrollView>

      <ServerSettingsModal
        visible={showServerSettings}
        onClose={() => setShowServerSettings(false)}
      />
    </SafeAreaView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.surfaces.canvas,
    },
    scrollContainer: {
      padding: space.base,
      paddingBottom: space.huge,
    },
    header: {
      marginTop: space.sm,
      marginBottom: space.lg,
    },
    headerTitle: {
      ...type.display,
      color: t.ink.max,
    },
    headerSubtitle: {
      ...type.callout,
      color: t.ink.low,
      marginTop: space.xxs,
    },
    card: {
      backgroundColor: t.surfaces.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.xl,
      padding: space.base,
      marginBottom: space.md,
      ...t.elevation.md,
    },
    cardTitle: {
      ...type.overline,
      color: t.ink.low,
      marginBottom: space.md,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.borders.subtle,
    },
    detailRowLast: {
      borderBottomWidth: 0,
    },
    detailLabel: {
      fontSize: 12.5,
      color: t.ink.low,
    },
    detailValue: {
      fontSize: 13.5,
      fontWeight: '600',
      color: t.ink.max,
      flexShrink: 1,
      textAlign: 'right',
      marginLeft: space.base,
    },
    codeBox: {
      backgroundColor: t.surfaces.sunken,
      borderRadius: radius.md,
      padding: space.md,
      alignItems: 'center',
      marginTop: space.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
    },
    codeLabel: {
      fontSize: 10.5,
      color: t.ink.low,
      marginBottom: space.sm,
      letterSpacing: 0.3,
    },
    codeValue: {
      fontSize: 27,
      fontWeight: '700',
      color: t.ink.max,
      letterSpacing: 7,
      fontVariant: ['tabular-nums'],
    },

    // ── Appearance segment ──
    segment: {
      flexDirection: 'row',
      backgroundColor: t.surfaces.sunken,
      borderRadius: radius.sm,
      padding: 3,
      gap: 3,
    },
    segmentItem: {
      flex: 1,
      paddingVertical: space.sm + 1,
      borderRadius: radius.xs,
      alignItems: 'center',
    },
    segmentItemActive: {
      backgroundColor: t.palette.accent,
    },
    segmentText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: t.ink.mid,
    },
    segmentTextActive: {
      color: t.palette.onAccent,
      fontWeight: '700',
    },
    segmentHint: {
      fontSize: 11,
      color: t.ink.faint,
      marginTop: space.sm,
      textAlign: 'center',
    },

    infoText: {
      fontSize: 12.5,
      color: t.ink.mid,
      lineHeight: 18,
      marginBottom: space.md,
    },
    errorBanner: {
      backgroundColor: t.surfaces.washStrong,
      borderLeftWidth: 2,
      borderLeftColor: t.ink.max,
      borderRadius: radius.xs,
      paddingVertical: space.md,
      paddingHorizontal: space.md,
      marginBottom: space.md,
    },
    errorText: {
      color: t.ink.high,
      fontSize: 12.5,
    },
    codeFieldWrap: {
      marginBottom: space.md,
    },
    codeInput: {
      textAlign: 'center',
      fontSize: 18,
      letterSpacing: 7,
      fontVariant: ['tabular-nums'],
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.md,
    },
    statusDotWrap: {
      width: 8,
      height: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: space.sm,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.ink.max,
    },
    statusLabel: {
      fontSize: 11.5,
      color: t.ink.mid,
      fontWeight: '500',
    },
    primaryButton: {
      backgroundColor: t.palette.accent,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: space.base,
      ...t.elevation.md,
    },
    primaryButtonText: {
      color: t.palette.onAccent,
      fontSize: 14,
      fontWeight: '700',
    },
    dangerButton: {
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: space.md,
    },
    dangerButtonText: {
      color: t.ink.mid,
      fontSize: 13.5,
      fontWeight: '600',
    },
    serverButton: {
      alignItems: 'center',
      paddingVertical: space.md,
      marginBottom: space.xxs,
    },
    serverButtonText: {
      color: t.ink.faint,
      fontSize: 11.5,
    },
  });
