import {create} from 'zustand';

// Cross-tab breadcrumb history.
//
// The bottom-tab + per-tab-stack architecture is great for forward jumps
// but bad at "back through where I was". Example user journey:
//
//   TransactionList → SaleDetail(saleA) → ProductDetail(prodX) →
//   SaleDetail(saleB) → ProductDetail(prodY)
//
// The first hop is a native stack push (Transactions stack: [List, A]).
// The next three hops are cross-tab jumps via getParent().navigate(...),
// which only ever push one frame onto the destination stack. So Back from
// ProductDetail(prodY) using `navigation.goBack()` would land on
// ItemsList — losing all the breadcrumbs.
//
// This store keeps a running list of "places I came from". Cross-tab nav
// helpers `push` the current screen before jumping. Detail screens' Back
// button consults `popPrev`: if there's a breadcrumb, navigate back to
// that spot; otherwise fall through to native goBack (single-stack pop).
//
// The bottom tab bar (AppTabs) calls `reset()` on every tab press, giving
// the user a clean "I'm done exploring, take me to the root of this tab"
// affordance that matches the user's mental model.

export type CrumbTab =
  | 'Dashboard'
  | 'QuickSale'
  | 'Items'
  | 'Customers'
  | 'Transactions'
  | 'ERP';

export interface Crumb {
  tab: CrumbTab;
  screen: string;
  params?: Record<string, unknown>;
}

// Cap to avoid an unbounded history if the user explores forever. 20 is
// well past any plausible breadcrumb depth and well under any memory
// concern.
const MAX_DEPTH = 20;

interface NavHistoryState {
  history: Crumb[];
  // Push a crumb representing the place we're leaving. Drops the oldest
  // entry when the depth cap is hit.
  push: (crumb: Crumb) => void;
  // Pop the most recent crumb (the destination of a "back" tap). Returns
  // null when history is empty so the caller can fall back to goBack().
  popPrev: () => Crumb | null;
  // Wipe the breadcrumb trail. Called by the bottom-tab bar on tap so
  // each tap is a fresh start.
  reset: () => void;
  // Number of crumbs available for back-stepping (UI affordance hint).
  depth: () => number;
}

export const useNavHistoryStore = create<NavHistoryState>((set, get) => ({
  history: [],
  push: (crumb: Crumb) => {
    set(s => {
      const next = [...s.history, crumb];
      if (next.length > MAX_DEPTH) next.shift();
      return {history: next};
    });
  },
  popPrev: () => {
    const h = get().history;
    if (h.length === 0) return null;
    const last = h[h.length - 1];
    set({history: h.slice(0, -1)});
    return last;
  },
  reset: () => set({history: []}),
  depth: () => get().history.length,
}));
