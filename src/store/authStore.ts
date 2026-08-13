import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface UserProfile {
  id: string;
  display_name: string;
  phone_or_email: string;
  pair_code: string;
  partner_id?:
    | {
        // Mongo documents serialise as _id; the pairing endpoint returns id
        id?: string;
        _id?: string;
        display_name: string;
        phone_or_email: string;
        is_online: boolean;
        last_seen: string;
      }
    | string;
}

/**
 * The partner arrives as a plain id, as a document with `_id`, or as a pairing
 * response with `id` depending on the endpoint — always resolve it through here.
 */
export const getPartnerId = (user: UserProfile | null): string | undefined => {
  const partner = user?.partner_id;
  if (!partner) return undefined;
  if (typeof partner === 'string') return partner;
  return partner.id || partner._id;
};

interface AuthState {
  user: UserProfile | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  /** Remembered so cached history can be shown before the server answers */
  conversationId: string | null;
  login: (user: UserProfile, accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  setPartner: (partner: any) => void;
  setConversationId: (conversationId: string | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      conversationId: null,
      login: async (user, accessToken, refreshToken) => {
        set({ user, accessToken, refreshToken, isAuthenticated: true });
      },
      logout: async () => {
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          conversationId: null,
        });
      },
      setConversationId: (conversationId) => set({ conversationId }),
      setTokens: async (accessToken, refreshToken) => {
        set({ accessToken, refreshToken });
      },
      setPartner: (partner) => {
        set((state) => {
          if (!state.user) return state;
          return {
            user: {
              ...state.user,
              partner_id: partner,
            },
          };
        });
      },
    }),
    {
      name: 'chat-app-auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
