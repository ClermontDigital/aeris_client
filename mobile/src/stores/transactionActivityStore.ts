import {create} from 'zustand';

// transactionActivityStore — the live "are we mid-transaction?" signals the
// §19.2 routing cascade (rule 1) consults so it never switches mode mid-sale.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.2 rule 1, §22.5 Q1.
//
// The cart contents come from cartStore; this store captures the rest of the
// §22.5 Q1 definition — the focused screen plus the in-flight write flags
// (createSale/refundSale, settlement/print, open account write). Screens set
// these around their write calls; the routing hook reads them.
//
// Kept intentionally tiny + dependency-free so any screen can set a flag in a
// finally block without import cycles.

interface TransactionActivityState {
  // The currently-focused screen name (e.g. 'Checkout'). Set on focus/blur.
  activeScreen: string | null;
  // An in-flight createSale OR refundSale request.
  saleInFlight: boolean;
  // In-flight payment settlement or receipt/invoice print (§22.5 Q1 add).
  settlementOrPrintInFlight: boolean;
  // An open customer-account write in flight (§22.5 Q1 add).
  accountWriteInFlight: boolean;

  setActiveScreen: (screen: string | null) => void;
  setSaleInFlight: (v: boolean) => void;
  setSettlementOrPrintInFlight: (v: boolean) => void;
  setAccountWriteInFlight: (v: boolean) => void;
}

export const useTransactionActivityStore = create<TransactionActivityState>(
  (set) => ({
    activeScreen: null,
    saleInFlight: false,
    settlementOrPrintInFlight: false,
    accountWriteInFlight: false,

    setActiveScreen: (screen) => set({activeScreen: screen}),
    setSaleInFlight: (v) => set({saleInFlight: v}),
    setSettlementOrPrintInFlight: (v) => set({settlementOrPrintInFlight: v}),
    setAccountWriteInFlight: (v) => set({accountWriteInFlight: v}),
  }),
);
