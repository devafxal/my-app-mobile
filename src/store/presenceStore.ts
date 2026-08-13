import { create } from 'zustand';

interface PresenceState {
  isPartnerOnline: boolean;
  partnerLastSeen: Date | null;
  isPartnerTyping: boolean;
  setPartnerOnline: (isOnline: boolean, lastSeen?: string | Date | null) => void;
  setPartnerTyping: (isTyping: boolean) => void;
  resetPresence: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  isPartnerOnline: false,
  partnerLastSeen: null,
  isPartnerTyping: false,
  setPartnerOnline: (isOnline, lastSeen) => {
    set({
      isPartnerOnline: isOnline,
      partnerLastSeen: lastSeen ? new Date(lastSeen) : null,
    });
  },
  setPartnerTyping: (isTyping) => {
    set({ isPartnerTyping: isTyping });
  },
  resetPresence: () => {
    set({ isPartnerOnline: false, partnerLastSeen: null, isPartnerTyping: false });
  },
}));
