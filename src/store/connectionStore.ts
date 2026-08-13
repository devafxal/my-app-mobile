import { create } from 'zustand';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'offline';

interface ConnectionState {
  status: ConnectionStatus;
  lastError: string | null;
  isSyncing: boolean;
  setStatus: (status: ConnectionStatus, error?: string | null) => void;
  setSyncing: (isSyncing: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'idle',
  lastError: null,
  isSyncing: false,
  setStatus: (status, error = null) => set({ status, lastError: error }),
  setSyncing: (isSyncing) => set({ isSyncing }),
}));
