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
// Ownership discipline:
//   - setOnBack: drill-down screen (ProductDetail, ProductEdit) registers
//     on focus. NO cleanup on blur (the v1.3.70 fix), because with
//     react-native-screens v4 the popped screen's blur fires BEFORE the
//     revealed screen's focus on goBack(), so an unconditional cleanup
//     wipes the slot just as Detail re-installs its own handler.
//   - clearIf: identity-matched conditional clear. Kept for completeness
//     but no longer called from anywhere — left in case a future screen
//     wants the old "clear if it's still mine" semantic.
//   - clearOnBack: unconditional null. Called by tab roots from their
//     own useFocusEffect so that navigating back to a tab root (Items,
//     QuickSale, Customers, Transactions, Dashboard, ERP) wipes any
//     handler a detail screen left behind. Without this, the slot leaks
//     forever the first time a user enters Detail/Edit and a stale Back
//     button shows on every subsequent screen.
interface HeaderBackState {
  onBack: (() => void) | null;
  setOnBack: (fn: () => void) => void;
  clearOnBack: () => void;
  clearIf: (fn: () => void) => void;
}

export const useHeaderBackStore = create<HeaderBackState>((set, get) => ({
  onBack: null,
  setOnBack: (fn: () => void) => set({onBack: fn}),
  clearOnBack: () => set({onBack: null}),
  clearIf: (fn: () => void) => {
    if (get().onBack === fn) set({onBack: null});
  },
}));
