import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { Theme, themes } from './tokens';
import { useSettingsStore, ThemeMode } from '../store/settingsStore';

export * from './tokens';

const ThemeContext = createContext<Theme>(themes.dark);

/**
 * Resolves the active theme from the user's preference, falling back to the
 * OS setting when they've chosen "system". Sits above the navigator so a mode
 * change re-renders every screen at once.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSettingsStore((state) => state.themeMode);
  const systemScheme = useColorScheme();

  const theme = useMemo(() => {
    const resolved: 'light' | 'dark' =
      mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;
    return themes[resolved];
  }, [mode, systemScheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** The user's stored preference, plus a setter — for the mode switcher UI. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = useSettingsStore((state) => state.themeMode);
  const setThemeMode = useSettingsStore((state) => state.setThemeMode);
  return [mode, setThemeMode];
}

/**
 * Builds a themed StyleSheet and memoises it against the active theme, so
 * styles are only recreated when the mode actually flips.
 *
 *   const styles = useThemedStyles(createStyles)
 *   const createStyles = (t: Theme) => StyleSheet.create({ ... })
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: Theme) => T
): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
