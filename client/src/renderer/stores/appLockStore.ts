import { create } from 'zustand';
import type { AppLockState, VerifyPinResult, SetPinResult } from '../../shared-types/ipc';

// Renderer mirror of main's appLockManager state. Same pattern as
// authStore: reads via lock:get-state at boot, subscribes to
// lock:state-changed for live updates.

interface AppLockStore extends AppLockState {
  init: () => Promise<void>;
  setPin: (pin: string) => Promise<SetPinResult>;
  verifyPin: (pin: string) => Promise<VerifyPinResult>;
  clearPin: () => Promise<void>;
  lockNow: () => Promise<void>;
}

const initial: AppLockState = {
  initialized: false,
  isPinSet: false,
  locked: false,
  attempts: 0,
  lockedOutUntilMs: null,
};

let unsubscribe: (() => void) | null = null;

export const useAppLockStore = create<AppLockStore>((set) => ({
  ...initial,

  init: async () => {
    if (unsubscribe) return;
    const s = await window.aeris.lock.getState();
    set({ ...s });
    unsubscribe = window.aeris.lock.onStateChanged((next) => {
      set({ ...next });
    });
  },

  setPin: async (pin) => {
    const result = await window.aeris.lock.setPin(pin);
    return result;
  },

  verifyPin: async (pin) => {
    const result = await window.aeris.lock.verifyPin(pin);
    return result;
  },

  clearPin: async () => {
    await window.aeris.lock.clearPin();
  },

  lockNow: async () => {
    await window.aeris.lock.lockNow();
  },
}));
