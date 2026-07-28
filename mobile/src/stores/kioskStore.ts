import {create} from 'zustand';

// Customer self-signup kiosk mode. When `active`, App.tsx renders the
// KioskSignup overlay ABOVE the tabs and the app-lock, the auto-lock is
// suppressed (see appLockStore.lockNow), and hardware back is swallowed.
//
// Deliberately NOT persisted: a force-kill during kiosk (the recents-swipe
// escape is unblockable in a soft kiosk) must NOT resume kiosk — a cold start
// lands on the app-lock (appLockStore.init sets isLocked = hasPin), which is
// the safe posture. It's also reset on logout AND the 401 clearLocalSession
// path (authStore) so a session wipe can't leave `active` stuck true and
// wrongly suppress the next operator's auto-lock.
interface KioskState {
  active: boolean;
  enter: () => void;
  exit: () => void;
}

export const useKioskStore = create<KioskState>(set => ({
  active: false,
  enter: () => set({active: true}),
  exit: () => set({active: false}),
}));
