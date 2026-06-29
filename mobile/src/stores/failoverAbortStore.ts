import {create} from 'zustand';

// failoverAbortStore — the §17.4 "abort to manual" path.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §17.4, §21 (mobile).
//
// If the NAS turns out broken mid-outage, the cashier must be able to bail to
// manual/paper. This store owns:
//   - `nasUnavailable` — the NAS failed its reachability/cert check while we
//     needed it (drives the global "NAS unreachable — use manual/paper"
//     banner and disables write actions).
//   - `manualMode` — the cashier explicitly chose "Return to manual" from the
//     §19.3 detail sheet; writes are frozen until cloud or a valid NAS returns.
//
// WRITE-GATE SCAFFOLD (M1): `areWritesBlocked()` is the single mechanism
// CheckoutScreen / refund / customer-account screens consult to disable their
// write actions. M1 wires the DECISION-INDEPENDENT cases (NAS unavailable, or
// the cashier chose manual). The §9-policy-gated disabled-states (offline card,
// refund-of-cloud-origin, account/layby during an outage) are M2 — see the
// clearly-marked TODO in `isWriteActionBlocked` below.

// Which write surface is asking. Lets M2 apply per-action §9 policy without
// changing call sites (CheckoutScreen passes 'sale', refund sheet 'refund',
// account screen 'account').
export type WriteAction = 'sale' | 'refund' | 'account' | 'stock' | 'customer';

interface FailoverAbortState {
  // NAS failed its check while we needed it (reachability/cert). Set by the
  // routing layer; surfaces the global banner + blocks writes.
  nasUnavailable: boolean;
  // Cashier explicitly returned to manual from the detail sheet.
  manualMode: boolean;

  setNasUnavailable: (v: boolean) => void;
  // "Return to manual" CTA (§17.4 / §19.3 detail sheet).
  returnToManual: () => void;
  // Clear manual mode once cloud or a valid NAS is back and the cashier
  // resumes (or automatically when routing recovers).
  clearManual: () => void;
  reset: () => void;

  // Global gate: are ALL writes currently blocked (decision-independent)?
  areWritesBlocked: () => boolean;
  // Per-action gate the write screens call. M1 = the global gate; M2 layers
  // the §9 policy decisions on top (see TODO).
  isWriteActionBlocked: (action: WriteAction) => boolean;
}

export const useFailoverAbortStore = create<FailoverAbortState>((set, get) => ({
  nasUnavailable: false,
  manualMode: false,

  setNasUnavailable: (v: boolean) => set({nasUnavailable: v}),
  returnToManual: () => set({manualMode: true}),
  clearManual: () => set({manualMode: false}),
  reset: () => set({nasUnavailable: false, manualMode: false}),

  areWritesBlocked: () => {
    const s = get();
    return s.nasUnavailable || s.manualMode;
  },

  isWriteActionBlocked: (_action: WriteAction): boolean => {
    // M1 — decision-independent gate only.
    if (get().areWritesBlocked()) return true;

    // TODO(DR-M2, §9): layer the owner-policy write-UX disabled-states here,
    // keyed off the live routing mode (cloud vs Direct/NAS). When connected to
    // the NAS during an outage, the §9 decisions gate specific actions:
    //   - 'sale'    → offline-card acceptance (§9 / FIN-B2): disable the card
    //                 tender, or stamp it unsettled, per the owner ruling.
    //   - 'refund'  → refund-of-cloud-origin on the NAS (§9 / G2): block, or
    //                 NAS-origin-only, per the ruling.
    //   - 'account' → account/layby when the NAS can't see the true cloud
    //                 balance (§9 / FIN-B3): disable or warn, per the ruling.
    // These are intentionally NOT wired in M1 — they are blocked on the §9
    // owner decisions (§22.4 gate 1). The `action` param + the routing mode are
    // the inputs M2 will switch on; the scaffold is here so call sites don't
    // change when the policies land.
    return false;
  },
}));
