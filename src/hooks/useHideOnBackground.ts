import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Opening the system camera or photo picker briefly backgrounds this app too
 * — there's no way to tell that apart from the user actually leaving via
 * AppState alone. The picker helpers in `services/media.ts` flip this flag
 * for the duration of that call so the guard below knows to stand down.
 */
export const pendingExternalPicker = { current: false };

/**
 * Privacy guard for the screens behind the secret gesture: as soon as the app
 * leaves the foreground, jump back to the task list. Without this, anyone
 * reopening the app from the recents list would land straight in the chat and
 * the decoy home screen would be pointless.
 */
export const useHideOnBackground = (navigation: { reset: (state: any) => void }) => {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !pendingExternalPicker.current) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Todo' }],
        });
      }
    });

    return () => subscription.remove();
  }, [navigation]);
};

export default useHideOnBackground;
