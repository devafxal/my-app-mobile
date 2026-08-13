import axios from 'axios';
import { getServerUrl, REQUEST_TIMEOUT_MS } from '../config';
import { useAuthStore } from '../store/authStore';

const apiClient = axios.create({
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: REQUEST_TIMEOUT_MS,
});

// Request Interceptor: resolve the (user-configurable) server URL and inject the JWT
apiClient.interceptors.request.use(
  async (config) => {
    config.baseURL = getServerUrl();

    const { accessToken } = useAuthStore.getState();
    if (accessToken && config.headers) {
      config.headers['Authorization'] = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Handle Token Expiration (Rotate/Refresh)
let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

/**
 * Exchange the refresh token for a fresh pair. Shared with the socket layer so
 * a websocket that was rejected for an expired token can recover too.
 * Returns the new access token, or null when the session is truly over.
 */
export const refreshAccessToken = async (): Promise<string | null> => {
  const { refreshToken, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken) {
    await logout();
    return null;
  }

  try {
    const response = await axios.post(
      `${getServerUrl()}/auth/refresh`,
      { refreshToken },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const { accessToken, refreshToken: newRefreshToken } = response.data;
    await setTokens(accessToken, newRefreshToken || refreshToken);
    return accessToken;
  } catch (error: any) {
    // Only sign out when the server actively rejected the refresh token.
    // A network failure must not wipe a perfectly good session.
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      await logout();
    }
    return null;
  }
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If unauthorized and we haven't retried yet
    if (
      (error.response?.status === 401 || error.response?.status === 403) &&
      originalRequest &&
      !originalRequest._retry
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newAccessToken = await refreshAccessToken();

        if (!newAccessToken) {
          processQueue(error, null);
          return Promise.reject(error);
        }

        processQueue(null, newAccessToken);

        // Retry original request
        originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

/** Quick reachability probe used by the server-settings screen. */
export const pingServer = async (url: string): Promise<boolean> => {
  try {
    const response = await axios.get(`${url}/health`, { timeout: 6000 });
    return response.data?.status === 'ok';
  } catch {
    return false;
  }
};

export default apiClient;
