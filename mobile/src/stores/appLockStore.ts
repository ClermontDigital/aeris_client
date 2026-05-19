import {create} from 'zustand';
import AppLockService from '../services/AppLockService';

interface AppLockState {
  // `initialized` flips true once secure-store reads complete. App.tsx gates
  // the navigator on this so the user can't see protected content during the
  // brief async init window after a cold start.
  initialized: boolean;
  isLocked: boolean;
  hasPin: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  failedAttempts: number;

  init: () => Promise<void>;
  lockNow: () => void;
  unlock: () => void;
  recordFailedAttempt: () => number;
  resetAttempts: () => void;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  reset: () => Promise<void>;
}

export const useAppLockStore = create<AppLockState>((set, get) => ({
  initialized: false,
  isLocked: false,
  hasPin: false,
  biometricEnabled: false,
  biometricAvailable: false,
  failedAttempts: 0,

  init: async () => {
    const [hasPin, biometricEnabled, biometricAvailable] = await Promise.all([
      AppLockService.hasPin(),
      AppLockService.isBiometricEnabled(),
      AppLockService.isBiometricAvailable(),
    ]);
    // If a PIN is configured, default to locked — App.tsx's mount effect
    // will also lock, but starting locked here removes any window between
    // initialized=true and the lock effect running.
    set({
      hasPin,
      biometricEnabled,
      biometricAvailable,
      isLocked: hasPin,
      initialized: true,
    });
  },

  lockNow: () => {
    if (!get().hasPin) return;
    set({isLocked: true, failedAttempts: 0});
  },

  unlock: () => set({isLocked: false, failedAttempts: 0}),

  recordFailedAttempt: () => {
    const next = get().failedAttempts + 1;
    set({failedAttempts: next});
    return next;
  },

  resetAttempts: () => set({failedAttempts: 0}),

  setPin: async (pin: string) => {
    await AppLockService.setPin(pin);
    set({hasPin: true});
  },

  verifyPin: async (pin: string) => {
    const ok = await AppLockService.verifyPin(pin);
    if (!ok && get().hasPin) {
      // AppLockService.verifyPin wipes the stored payload when it's stale
      // (legacy bare-hash string, missing salt, non-JSON). If the wipe just
      // fired, hasPin in storage now reads false but our cached state is
      // still true — the user would otherwise see "wrong PIN" five times
      // and get force-logged-out. Re-read presence and flip the flag so
      // App.tsx unmounts AppLockScreen and the user lands in the app
      // PIN-less (Settings → Set PIN reseeds it).
      const stillHasPin = await AppLockService.hasPin();
      if (!stillHasPin) {
        set({hasPin: false, isLocked: false, failedAttempts: 0});
      }
    }
    return ok;
  },

  setBiometricEnabled: async (enabled: boolean) => {
    await AppLockService.setBiometricEnabled(enabled);
    set({biometricEnabled: enabled});
  },

  reset: async () => {
    await AppLockService.clearPin();
    set({
      isLocked: false,
      hasPin: false,
      biometricEnabled: false,
      failedAttempts: 0,
    });
  },
}));
