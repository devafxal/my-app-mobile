import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useSettingsStore,
  normalizeServerUrl,
  DEFAULT_SERVER_URL,
} from '../store/settingsStore';
import { pingServer } from '../api';
import { PressableScale } from './ui/motion';
import Field from './ui/Field';
import { motion, radius, space, Theme, type, useTheme, useThemedStyles } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The backend runs on the user's own machine, so its address changes with the
 * network (emulator vs. physical phone vs. different Wi-Fi). Editing it here
 * beats rebuilding the app every time.
 */
export default function ServerSettingsModal({ visible, onClose }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const serverUrl = useSettingsStore((state) => state.serverUrl);
  const setServerUrl = useSettingsStore((state) => state.setServerUrl);

  const [draft, setDraft] = useState(serverUrl);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; label: string } | null>(null);

  /** Kept mounted through the exit animation. */
  const [rendered, setRendered] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setDraft(serverUrl);
      setResult(null);
    }
  }, [visible, serverUrl]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.spring(anim, {
        toValue: 1,
        ...motion.spring.gentle,
        useNativeDriver: true,
      }).start();
    } else if (rendered) {
      Animated.timing(anim, {
        toValue: 0,
        duration: motion.duration.fast,
        easing: motion.easing.in,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [visible, anim, rendered]);

  const handleTest = async () => {
    const url = normalizeServerUrl(draft);
    setDraft(url);
    setTesting(true);
    setResult(null);

    const reachable = await pingServer(url);
    setTesting(false);
    setResult({
      ok: reachable,
      label: reachable ? 'Server reachable' : 'Could not reach the server',
    });
  };

  const handleSave = () => {
    setServerUrl(draft);
    onClose();
  };

  return (
    <Modal visible={rendered} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdropWrap}>
        <Animated.View style={[styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
              ],
            },
          ]}
        >
          <Text style={styles.title}>Server settings</Text>
          <Text style={styles.help}>
            Emulator: {DEFAULT_SERVER_URL}
            {'\n'}Physical phone: use your computer's LAN IP, e.g. http://192.168.1.20:3000
          </Text>

          <Field
            value={draft}
            onChangeText={setDraft}
            placeholder={DEFAULT_SERVER_URL}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {result ? (
            <View style={styles.resultRow}>
              <View style={[styles.resultDot, !result.ok && styles.resultDotFail]} />
              <Text style={styles.resultText}>{result.label}</Text>
            </View>
          ) : null}

          <View style={styles.row}>
            <PressableScale
              style={styles.secondaryButton}
              activeScale={0.96}
              onPress={handleTest}
              disabled={testing}
            >
              {testing ? (
                <ActivityIndicator color={theme.ink.high} />
              ) : (
                <Text style={styles.secondaryButtonText}>Test</Text>
              )}
            </PressableScale>

            <PressableScale style={styles.primaryButton} activeScale={0.96} onPress={handleSave}>
              <Text style={styles.primaryButtonText}>Save</Text>
            </PressableScale>
          </View>

          <PressableScale onPress={onClose} style={styles.cancel} activeScale={0.95}>
            <Text style={styles.cancelText}>Cancel</Text>
          </PressableScale>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    backdropWrap: {
      flex: 1,
      justifyContent: 'center',
      padding: space.lg,
    },
    backdrop: {
      ...(StyleSheet.absoluteFill as object),
      backgroundColor: t.surfaces.scrim,
    },
    card: {
      backgroundColor: t.surfaces.card,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      padding: space.lg,
      ...t.elevation.lg,
    },
    title: {
      ...type.heading,
      color: t.ink.max,
      marginBottom: space.sm,
    },
    help: {
      fontSize: 11.5,
      color: t.ink.low,
      lineHeight: 17,
      marginBottom: space.base,
    },
    resultRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: space.md,
    },
    resultDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.ink.max,
      marginRight: space.sm,
    },
    resultDotFail: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.ink.faint,
    },
    resultText: {
      fontSize: 12.5,
      color: t.ink.mid,
    },
    row: {
      flexDirection: 'row',
      marginTop: space.base,
      gap: space.md,
    },
    secondaryButton: {
      flex: 1,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      borderRadius: radius.md,
      paddingVertical: space.md,
      alignItems: 'center',
    },
    secondaryButtonText: {
      color: t.ink.high,
      fontWeight: '600',
      fontSize: 13.5,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: t.palette.accent,
      borderRadius: radius.md,
      paddingVertical: space.md,
      alignItems: 'center',
      ...t.elevation.md,
    },
    primaryButtonText: {
      color: t.palette.onAccent,
      fontWeight: '700',
      fontSize: 13.5,
    },
    cancel: {
      marginTop: space.base,
      alignItems: 'center',
      paddingVertical: space.sm,
    },
    cancelText: {
      color: t.ink.low,
      fontSize: 12.5,
    },
  });
