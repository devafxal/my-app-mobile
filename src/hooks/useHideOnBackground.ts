import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Privacy guard for the screens behind the secret gesture: as soon as the app
 * leaves the foreground, jump back to the task list. Without this, anyone
 * reopening the app from the recents list would land straight in the chat and
 * the decoy home screen would be pointless.
 */
export const useHideOnBackground = (navigation: { reset: (state: any) => void }) => {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
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
