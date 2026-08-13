import React, { useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import { FadeSlideIn, PressableScale } from '../components/ui/motion';
import Field from '../components/ui/Field';
import { radius, space, Theme, type, useTheme, useThemedStyles } from '../theme';
import apiClient from '../api';

type Props = NativeStackScreenProps<any, any>;

export default function RegisterScreen({ navigation }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const [displayName, setDisplayName] = useState('');
  const [phoneOrEmail, setPhoneOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loginStore = useAuthStore((state) => state.login);

  /** Errors announce themselves with a shake — no red available. */
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

  const handleRegister = async () => {
    if (!displayName || !phoneOrEmail || !password) {
      showError('Please fill in all fields');
      return;
    }

    // Mirrors the server-side rule so the error shows up before the round trip
    if (password.length < 6) {
      showError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await apiClient.post('/auth/register', {
        display_name: displayName.trim(),
        phone_or_email: phoneOrEmail.trim(),
        password,
      });

      const { user, accessToken, refreshToken } = response.data;

      // App.tsx picks it up from here: socket, push registration, navigation
      await loginStore(user, accessToken, refreshToken);

      console.log('✅ Registered successfully!');
    } catch (err: any) {
      console.error('Registration error:', err);
      showError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surfaces.canvas}
      />
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.headerContainer}>
          <FadeSlideIn index={0}>
            <Text style={styles.title}>Create Account</Text>
          </FadeSlideIn>
          <FadeSlideIn index={1}>
            <Text style={styles.subtitle}>Start chatting with your partner</Text>
          </FadeSlideIn>
        </View>

        <FadeSlideIn index={2} offsetY={20}>
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
              label="Display Name"
              containerStyle={styles.inputContainer}
              placeholder="e.g. John Doe"
              value={displayName}
              onChangeText={setDisplayName}
              autoCorrect={false}
            />

            <Field
              label="Phone or Email"
              containerStyle={styles.inputContainer}
              placeholder="e.g. +1234567890 or user@mail.com"
              value={phoneOrEmail}
              onChangeText={setPhoneOrEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Field
              label="Password"
              containerStyle={styles.inputContainer}
              placeholder="Create a password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <PressableScale
              style={[styles.button, loading && styles.buttonDisabled]}
              activeScale={0.97}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={theme.palette.onAccent} />
              ) : (
                <Text style={styles.buttonText}>Register</Text>
              )}
            </PressableScale>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <PressableScale activeScale={0.92} onPress={() => navigation.navigate('Login')}>
                <Text style={styles.linkText}>Sign In</Text>
              </PressableScale>
            </View>
          </View>
        </FadeSlideIn>
      </ScrollView>
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
    title: {
      ...type.display,
      color: t.ink.max,
    },
    subtitle: {
      ...type.callout,
      color: t.ink.low,
      marginTop: space.xs,
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
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: space.lg,
    },
    footerText: {
      color: t.ink.low,
      fontSize: 12.5,
    },
    linkText: {
      color: t.ink.max,
      fontSize: 12.5,
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
  });
