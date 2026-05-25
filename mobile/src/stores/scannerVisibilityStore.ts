import {create} from 'zustand';

// Tracks whether the BarcodeScannerScreen is currently focused. Used by
// AppTabsInner to hide the pendant header + gear button when the camera
// is up, so the scanner can take over the full top of the screen.
//
// Why a store instead of useNavigationState: AppTabsInner is rendered
// inside the parent AppStack (Tabs + Settings), so a `useNavigationState`
// call there returns the AppStack's state — which only contains
// `['Tabs', 'Settings']`. It never sees tab routes or the Scanner inside
// Items/QuickSale stacks, so the selector was always returning false
// and the pendant never hid. The Scanner itself knows when it's focused
// via `useFocusEffect`; we flip this store and the chrome reads from it.
interface ScannerVisibilityState {
  isScannerVisible: boolean;
  setScannerVisible: (visible: boolean) => void;
}

export const useScannerVisibilityStore = create<ScannerVisibilityState>(set => ({
  isScannerVisible: false,
  setScannerVisible: (visible: boolean) => set({isScannerVisible: visible}),
}));
