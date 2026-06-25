import {create} from 'zustand';

// Drives the optional left-side "Back" affordance in the shared brand header
// (AppTabsInner). A drill-down screen registers its own back handler on focus
// (via useFocusEffect) and clears it on blur, so the header back button only
// appears where it makes sense (e.g. item detail/edit) and runs that screen's
// own goBack logic (which can include cross-tab breadcrumb handling).
//
// Why a store instead of useNavigationState: same reason as
// scannerVisibilityStore — AppTabsInner sits in the parent AppStack, so it
// can't see routes nested inside the tab stacks. The focused screen knows its
// own state and pushes the handler here; the chrome reads from it.
//
// Ownership discipline: cleanup is identity-aware (`clearIf`). When two
// registering screens are adjacent in a stack (detail -> edit), React
// Navigation's blur(old)/focus(new) ordering means the new screen may register
// before the old one's cleanup runs; an unconditional clear would then wipe the
// freshly-registered handler. clearIf only nulls the slot if it still holds the
// caller's own handler, so a late blur-cleanup can't clobber the active screen.
interface HeaderBackState {
  onBack: (() => void) | null;
  setOnBack: (fn: () => void) => void;
  clearIf: (fn: () => void) => void;
}

export const useHeaderBackStore = create<HeaderBackState>((set, get) => ({
  onBack: null,
  setOnBack: (fn: () => void) => set({onBack: fn}),
  clearIf: (fn: () => void) => {
    if (get().onBack === fn) set({onBack: null});
  },
}));
