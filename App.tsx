import React, { useEffect, useState } from 'react';
import { AppState, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Shimmer } from './src/components/ui/motion';
import { radius, ThemeProvider, useTheme } from './src/theme';
import Navigation from './src/navigation';
import { useAuthStore } from './src/store/authStore';
import { useSettingsStore } from './src/store/settingsStore';
import { useChatStore } from './src/store/chatStore';
import { connectSocket, disconnectSocket, emitAppState } from './src/sockets';
import { registerPushNotifications } from './src/services/push';
import { syncMessages } from './src/services/sync';
import { initDB } from './src/db';

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const settingsHydrated = useSettingsStore((state) => state.hasHydrated);
  const [authHydrated, setAuthHydrated] = useState(() => useAuthStore.persist.hasHydrated());

  // Wait for the persisted session to load before deciding which screen to
  // show — otherwise a signed-in user sees the Login screen flash on launch.
  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setAuthHydrated(true);
      return;
    }
    const unsubscribe = useAuthStore.persist.onFinishHydration(() => setAuthHydrated(true));
    return unsubscribe;
  }, []);

  const isReady = authHydrated && settingsHydrated;

  // Own the connection lifecycle at the root so it survives screen changes
  useEffect(() => {
    if (!isReady) return;

    if (isAuthenticated) {
      initDB().catch((err) => console.error('DB init failed:', err));
      connectSocket();
      registerPushNotifications();
    } else {
      disconnectSocket();
    }
  }, [isReady, isAuthenticated]);

  // Burn-after-reading runs on the device too, so read messages disappear on
  // time whether or not the phone can reach the server.
  useEffect(() => {
    if (!isReady || !isAuthenticated) return;

    const prune = () => useChatStore.getState().pruneExpiredMessages();
    prune();
    const timer = setInterval(prune, 3000);
    return () => clearInterval(timer);
  }, [isReady, isAuthenticated]);

  // Coming back from the background: reconnect and pull anything we missed
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      // The server needs this either way: while the app is backgrounded it must
      // send a push notification instead of relying on the socket relay.
      emitAppState(nextState === 'active' ? 'active' : 'background');

      if (nextState !== 'active') return;
      if (!useAuthStore.getState().isAuthenticated) return;

      connectSocket();

      const conversationId = useChatStore.getState().conversationId;
      if (conversationId) {
        syncMessages(conversationId).then((synced) =>
          useChatStore.getState().mergeMessages(synced)
        );
      }
    });

    return () => subscription.remove();
  }, []);

  if (!isReady) {
    return <Splash />;
  }

  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

/**
 * Reads the theme, so it has to sit inside ThemeProvider rather than in the
 * root component that renders it.
 */
function Shell() {
  const theme = useTheme();
  return (
    <>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surfaces.canvas}
      />
      <Navigation />
    </>
  );
}

function Splash() {
  const theme = useTheme();
  return (
    <View style={[styles.splash, { backgroundColor: theme.surfaces.canvas }]}>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surfaces.canvas}
      />
      <Shimmer width={64} height={4} radius={radius.pill} />
    </View>
  );
}

/** Theme has to wrap everything, including the splash. */
export default function Root() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
