import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  StatusBar,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import ServerSettingsModal from '../components/ServerSettingsModal';
import { FadeSlideIn, PressableScale } from '../components/ui/motion';
import Field from '../components/ui/Field';
import { motion, radius, space, Theme, type, useTheme, useThemedStyles } from '../theme';
import apiClient from '../api';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/** Wordmark stand-in: a drawn task-list glyph, so the screen stays hueless. */
function BrandMark() {
  const styles = useThemedStyles(createStyles);
  const draw = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(draw, { toValue: 1, ...motion.spring.gentle, useNativeDriver: true }).start();
  }, [draw]);

  return (
    <Animated.View
      style={[
        styles.brandMark,
        {
          opacity: draw,
          transform: [
            { scale: draw.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
          ],
        },
      ]}
    >
      <View style={[styles.brandMarkLine, styles.brandMarkLineA]} />
      <View style={[styles.brandMarkLine, styles.brandMarkLineB]} />
      <View style={[styles.brandMarkLine, styles.brandMarkLineC]} />
    </Animated.View>
  );
}

export default function LoginScreen(_props: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const serverUrl = useSettingsStore((state) => state.serverUrl);

  const loginStore = useAuthStore((state) => state.login);

  /** Error banner shakes rather than turning red. */
  const shake = useRef(new Animated.Value(0)).current;

  const showError = (message: string) => {
    setError(message);
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (!phoneOrEmail || !password) {
      showError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await apiClient.post('/auth/login', {
        phone_or_email: phoneOrEmail.trim(),
        password,
      });

      const { user, accessToken, refreshToken } = response.data;
      await loginStore(user, accessToken, refreshToken);
      console.log('✅ Logged in successfully!');
    } catch (err: any) {
      console.error('Login error:', err);
      showError(
        err.response?.data?.error ||
          (err.message?.includes('Network')
            ? `Cannot reach the server at ${serverUrl}. Check Server settings.`
            : 'Invalid credentials or connection issue')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surfaces.canvas}
      />
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {/* Brand Header */}
        <View style={styles.headerContainer}>
          <BrandMark />
          <FadeSlideIn index={1}>
            <Text style={styles.title}>Tasky</Text>
          </FadeSlideIn>
          <FadeSlideIn index={2}>
            <Text style={styles.subtitle}>Sign in to manage your tasks & workspace</Text>
          </FadeSlideIn>
        </View>

        {/* Form */}
        <FadeSlideIn index={3} offsetY={20}>
          <View style={styles.formContainer}>
            {error ? (
              <Animated.View
                style={[
                  styles.errorBanner,
                  {
                    transform: [
                      {
                        translateX: shake.interpolate({
                          inputRange: [-1, 1],
                          outputRange: [-8, 8],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Text style={styles.errorText}>{error}</Text>
              </Animated.View>
            ) : null}

            <Field
              label="Email / Account"
              containerStyle={styles.inputContainer}
              placeholder="user1@app.com"
              value={phoneOrEmail}
              onChangeText={setPhoneOrEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Field
              label="Password"
              containerStyle={styles.inputContainer}
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <PressableScale
              style={[styles.button, loading && styles.buttonDisabled]}
              activeScale={0.97}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.palette.onAccent} />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </PressableScale>
          </View>
        </FadeSlideIn>

        <FadeSlideIn index={4}>
          <PressableScale
            style={styles.serverButton}
            activeScale={0.96}
            onPress={() => setShowServerSettings(true)}
          >
            <Text style={styles.serverButtonText}>Server · {serverUrl}</Text>
          </PressableScale>
        </FadeSlideIn>
      </ScrollView>

      <ServerSettingsModal
        visible={showServerSettings}
        onClose={() => setShowServerSettings(false)}
      />
    </KeyboardAvoidingView>
  );
}

const createStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.surfaces.canvas,
    },
    scrollContainer: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: space.lg,
    },
    headerContainer: {
      alignItems: 'center',
      marginBottom: space.xxl,
    },
    brandMark: {
      width: 60,
      height: 60,
      borderRadius: radius.lg,
      backgroundColor: t.surfaces.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.default,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.base,
      gap: 5,
      ...t.elevation.md,
    },
    brandMarkLine: {
      height: 3,
      borderRadius: 2,
      backgroundColor: t.ink.max,
    },
    brandMarkLineA: {
      width: 26,
    },
    brandMarkLineB: {
      width: 18,
      opacity: 0.6,
    },
    brandMarkLineC: {
      width: 22,
      opacity: 0.35,
    },
    title: {
      ...type.display,
      color: t.ink.max,
    },
    subtitle: {
      ...type.callout,
      color: t.ink.low,
      marginTop: space.xs,
      textAlign: 'center',
    },
    formContainer: {
      backgroundColor: t.surfaces.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.borders.subtle,
      borderRadius: radius.xl,
      padding: space.lg,
      ...t.elevation.lg,
    },
    errorBanner: {
      backgroundColor: t.surfaces.washStrong,
      borderLeftWidth: 2,
      borderLeftColor: t.ink.max,
      borderRadius: radius.xs,
      paddingVertical: space.md,
      paddingHorizontal: space.md,
      marginBottom: space.base,
    },
    errorText: {
      color: t.ink.high,
      fontSize: 12.5,
      lineHeight: 17,
    },
    inputContainer: {
      marginBottom: space.base,
    },
    button: {
      backgroundColor: t.palette.accent,
      borderRadius: radius.md,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: space.sm,
      ...t.elevation.md,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    buttonText: {
      color: t.palette.onAccent,
      fontSize: 14.5,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    serverButton: {
      marginTop: space.lg,
      alignItems: 'center',
      paddingVertical: space.sm,
    },
    serverButtonText: {
      color: t.ink.faint,
      fontSize: 11.5,
    },
  });
