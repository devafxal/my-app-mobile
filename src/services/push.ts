import { PermissionsAndroid, Platform } from 'react-native';
import {
  getMessaging,
  getToken,
  onTokenRefresh,
  requestPermission,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import apiClient from '../api';

let tokenRefreshUnsubscribe: (() => void) | null = null;
let lastRegisteredToken: string | null = null;

/** Android 13+ needs an explicit runtime permission before anything is shown. */
const ensureAndroidPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;

  const permission = 'android.permission.POST_NOTIFICATIONS' as any;
  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) return true;

  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
};

const uploadToken = async (token: string) => {
  if (!token || token === lastRegisteredToken) return;
  await apiClient.post('/auth/push-token', { push_token: token });
  lastRegisteredToken = token;
  console.log('🔔 Push token registered with the server');
};

/**
 * Ask for notification permission, then hand the device's FCM token to the
 * backend so it can wake this phone when a message arrives while offline.
 * Failures are non-fatal — the chat still works, just without notifications.
 */
export const registerPushNotifications = async (): Promise<void> => {
  try {
    const granted = await ensureAndroidPermission();
    if (!granted) {
      console.warn('🔕 Notification permission denied — push notifications are off.');
      return;
    }

    const messaging = getMessaging();

    const status = await requestPermission(messaging);
    const authorized =
      status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;

    if (!authorized) {
      console.warn('🔕 Firebase messaging permission not granted.');
      return;
    }

    const token = await getToken(messaging);
    await uploadToken(token);

    // FCM rotates tokens (app restore, data clear); keep the server in step
    tokenRefreshUnsubscribe?.();
    tokenRefreshUnsubscribe = onTokenRefresh(messaging, (newToken) => {
      uploadToken(newToken).catch((err) =>
        console.warn('⚠️ Failed to update refreshed push token:', err?.message || err)
      );
    });
  } catch (error: any) {
    console.warn('⚠️ Push notification setup failed:', error?.message || error);
  }
};

/** Called on sign out so the next account on this device starts clean. */
export const unregisterPushNotifications = async (): Promise<void> => {
  tokenRefreshUnsubscribe?.();
  tokenRefreshUnsubscribe = null;
  lastRegisteredToken = null;

  try {
    await apiClient.post('/auth/logout');
  } catch {
    // Signing out locally must succeed even if the server is unreachable
  }
};
