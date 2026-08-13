import React, { useEffect, useMemo, useRef } from 'react';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  NavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/authStore';
import {
  getMessaging,
  getInitialNotification,
  onNotificationOpenedApp,
} from '@react-native-firebase/messaging';

import LoginScreen from '../screens/LoginScreen';

import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import TodoScreen from '../screens/TodoScreen';
import { useTheme } from '../theme';

export type RootStackParamList = {
  Login: undefined;
  Todo: undefined;
  Chat: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Navigate to the screen specified in the notification data payload. */
const handleNotificationNav = (
  navRef: React.RefObject<NavigationContainerRef<RootStackParamList> | null>,
  data: Record<string, string> | undefined
) => {
  const screen = (data?.screen || 'Todo') as keyof RootStackParamList;
  // Wait for the navigator to be ready before navigating
  const tryNavigate = () => {
    if (navRef.current?.isReady()) {
      navRef.current.navigate(screen);
    } else {
      setTimeout(tryNavigate, 200);
    }
  };
  tryNavigate();
};

export default function Navigation() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const theme = useTheme();

  const navTheme = useMemo(() => {
    const base = theme.mode === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: theme.surfaces.canvas,
        card: theme.surfaces.bar,
        text: theme.ink.max,
        // The accent is the high-contrast neutral — this system has no hue
        primary: theme.palette.accent,
        border: theme.borders.subtle,
        notification: theme.palette.accent,
      },
    };
  }, [theme]);

  useEffect(() => {
    const messaging = getMessaging();

    // App was opened from a quit state by tapping a notification
    getInitialNotification(messaging).then((remoteMessage) => {
      if (remoteMessage) {
        handleNotificationNav(navigationRef, remoteMessage.data as Record<string, string>);
      }
    });

    // App was in background and user tapped the notification
    const unsubscribe = onNotificationOpenedApp(messaging, (remoteMessage) => {
      handleNotificationNav(navigationRef, remoteMessage.data as Record<string, string>);
    });

    return unsubscribe;
  }, []);

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          // A soft cross-fade between screens rather than a hard platform push
          animation: 'fade',
          animationDuration: 260,
          contentStyle: { backgroundColor: theme.surfaces.canvas },
        }}
      >
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
          </>
        ) : (
          <>
            {/* The task list is the app's front door; Chat is only reachable
                from it by the secret gestures. */}
            <Stack.Screen name="Todo" component={TodoScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
