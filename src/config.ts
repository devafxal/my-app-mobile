import { useSettingsStore, DEFAULT_SERVER_URL } from './store/settingsStore';

/**
 * The backend address is a user setting (Login screen → "Server settings"), so
 * it is always read at call time rather than captured in a constant.
 */
export const getServerUrl = (): string =>
  useSettingsStore.getState().serverUrl || DEFAULT_SERVER_URL;

export { DEFAULT_SERVER_URL };

// How long to wait before giving up on a REST call
export const REQUEST_TIMEOUT_MS = 15000;
