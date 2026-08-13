import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Android emulators reach the host machine's localhost through 10.0.2.2.
// On a physical phone this has to be changed to the computer's LAN IP
// (e.g. http://192.168.1.20:3000), which is why it is editable in the app.
// For production, point to the Railway deployment.
export const DEFAULT_SERVER_URL = 'https://web-production-27dec.up.railway.app';

/** Trim trailing slashes and add a scheme if the user typed a bare host. */
export const normalizeServerUrl = (raw: string): string => {
  let url = (raw || '').trim();
  if (!url) return DEFAULT_SERVER_URL;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
};

/** 'system' follows the OS appearance setting. */
export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  serverUrl: string;
  themeMode: ThemeMode;
  hasHydrated: boolean;
  setServerUrl: (url: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      themeMode: 'system',
      hasHydrated: false,
      setServerUrl: (url) => set({ serverUrl: normalizeServerUrl(url) }),
      setThemeMode: (mode) => set({ themeMode: mode }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: 'chat-app-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ serverUrl: state.serverUrl, themeMode: state.themeMode }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
