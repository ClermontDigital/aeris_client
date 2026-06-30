// txnActivity (Electron main) — the mid-transaction signal feeding the routing
// cascade's Rule 1 (§22.5 Q1: NEVER switch mid-sale). Port of the inputs mobile
// reads from its cart store + nav state + ApiClient in-flight flags.
//
// Two sources:
//   1. RENDERER-REPORTED (cartItemCount, activeScreen) via DR_REPORT_ACTIVITY —
//      the renderer owns cart + routing, so it pushes these on change.
//   2. MAIN-TRACKED in-flight writes (createSale / refundSale) — relayBridge
//      brackets each sale/refund dispatch with begin/end so the orchestrator
//      sees an in-flight write even if the renderer hasn't reported yet.
//
// The orchestrator reads these as the cascade's mid-transaction inputs so an
// auto-swap can never interrupt a sale, a refund, or a Checkout session.

interface ActivityState {
  cartItemCount: number;
  activeScreen: string | null;
  saleInFlight: number; // refcount of in-flight createSale/refundSale
}

let state: ActivityState = {
  cartItemCount: 0,
  activeScreen: null,
  saleInFlight: 0,
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

  // The cascade inputs. settlementOrPrint / accountWrite are folded into
  // saleInFlight on desktop (print is a separate IPC that doesn't gate a swap
  // the way an in-flight sale does); kept as explicit fields for parity.
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
      settlementOrPrintInFlight: false,
      accountWriteInFlight: false,
    };
  },

  reset(): void {
    state = { cartItemCount: 0, activeScreen: null, saleInFlight: 0 };
  },
};
