// txnActivity (Electron main) — the mid-transaction signal feeding the routing
// cascade's Rule 1 (§22.5 Q1: NEVER switch mid-sale). Port of the inputs mobile
// reads from its cart store + nav state + ApiClient in-flight flags.
//
// Two sources:
//   1. RENDERER-REPORTED (cartItemCount, activeScreen) via DR_REPORT_ACTIVITY —
//      the renderer owns cart + routing, so it pushes these on change.
//   2. MAIN-TRACKED in-flight writes — relayBridge (and the print IPC) bracket
//      each dispatch with begin/end so the orchestrator sees an in-flight write
//      even if the renderer hasn't reported yet.
//
// The orchestrator reads these as the cascade's mid-transaction inputs so an
// auto-swap can never interrupt a sale, refund, catalog edit, customer write,
// stock adjust, image upload, or print job.

interface ActivityState {
  cartItemCount: number;
  activeScreen: string | null;
  // Refcounts so concurrent writes of the same class compose. A write is
  // "in flight" while its refcount is > 0.
  saleInFlight: number;
  // Catalog edits, stock adjusts, image uploads, and print jobs all gate
  // here — match mobile's `setSettlementOrPrintInFlight` producer set.
  settlementOrPrintInFlight: number;
  // Customer create / update / delete — match mobile's
  // `setAccountWriteInFlight` producer set.
  accountWriteInFlight: number;
}

let state: ActivityState = {
  cartItemCount: 0,
  activeScreen: null,
  saleInFlight: 0,
  settlementOrPrintInFlight: 0,
  accountWriteInFlight: 0,
};

export const txnActivity = {
  report(report: { cartItemCount: number; activeScreen: string | null }): void {
    state = {
      ...state,
      cartItemCount: Math.max(0, Math.floor(report.cartItemCount) || 0),
      activeScreen: report.activeScreen,
    };
  },

  beginSale(): void {
    state = { ...state, saleInFlight: state.saleInFlight + 1 };
  },

  endSale(): void {
    state = { ...state, saleInFlight: Math.max(0, state.saleInFlight - 1) };
  },

  beginSettlementOrPrint(): void {
    state = {
      ...state,
      settlementOrPrintInFlight: state.settlementOrPrintInFlight + 1,
    };
  },

  endSettlementOrPrint(): void {
    state = {
      ...state,
      settlementOrPrintInFlight: Math.max(0, state.settlementOrPrintInFlight - 1),
    };
  },

  beginAccountWrite(): void {
    state = {
      ...state,
      accountWriteInFlight: state.accountWriteInFlight + 1,
    };
  },

  endAccountWrite(): void {
    state = {
      ...state,
      accountWriteInFlight: Math.max(0, state.accountWriteInFlight - 1),
    };
  },

  // The cascade inputs. Booleans derived from the refcounts; the orchestrator
  // ORs them in Rule 1 — any in-flight write defers an auto-swap.
  snapshot(): {
    cartItemCount: number;
    activeScreen: string | null;
    saleInFlight: boolean;
    settlementOrPrintInFlight: boolean;
    accountWriteInFlight: boolean;
  } {
    return {
      cartItemCount: state.cartItemCount,
      activeScreen: state.activeScreen,
      saleInFlight: state.saleInFlight > 0,
      settlementOrPrintInFlight: state.settlementOrPrintInFlight > 0,
      accountWriteInFlight: state.accountWriteInFlight > 0,
    };
  },

  reset(): void {
    state = {
      cartItemCount: 0,
      activeScreen: null,
      saleInFlight: 0,
      settlementOrPrintInFlight: 0,
      accountWriteInFlight: 0,
    };
  },
};
