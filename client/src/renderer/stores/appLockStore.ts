import { create } from 'zustand';

// Placeholder — Phase 3 will wire this up with PIN setup, idle detection,
// window-blur tracking, and lockout cooldowns. For now it's a simple
// boolean so AppShell-level routing can branch on locked state.

interface AppLockStore {
  locked: boolean;
  pinConfigured: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useAppLockStore = create<AppLockStore>((set) => ({
  locked: false,
  pinConfigured: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));
