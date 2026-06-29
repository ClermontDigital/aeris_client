import {create} from 'zustand';

// failoverAbortStore — system-detected NAS-down state.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §17.4, §21 (mobile).
//
// `nasUnavailable` is set by the routing layer when the NAS fails its
// reachability/cert check while we needed it. It drives the on-prem-
// unreachable banner and blocks write actions (Checkout's sale gate).
//
// The previous "Return to manual / paper" cashier-controlled toggle was
// removed: it was half-wired (Checkout only — refund + account TODO), it
// surfaced on cloud-only shops that have no NAS to fall back to, and there
// was no clear path back. The system-detected state above is sufficient.

// Which write surface is asking. Lets M2 apply per-action §9 policy without
// changing call sites (CheckoutScreen passes 'sale', refund sheet 'refund',
// account screen 'account').
export type WriteAction = 'sale' | 'refund' | 'account' | 'stock' | 'customer';

interface FailoverAbortState {
  // NAS failed its check while we needed it (reachability/cert). Set by the
  // routing layer; surfaces the global banner + blocks writes.
  nasUnavailable: boolean;

  setNasUnavailable: (v: boolean) => void;
  reset: () => void;

  // Global gate: are ALL writes currently blocked (decision-independent)?
  areWritesBlocked: () => boolean;
  // Per-action gate the write screens call. M1 = the global gate; M2 layers
  // the §9 policy decisions on top (see TODO).
  isWriteActionBlocked: (action: WriteAction) => boolean;
}

export const useFailoverAbortStore = create<FailoverAbortState>((set, get) => ({
  nasUnavailable: false,

  setNasUnavailable: (v: boolean) => set({nasUnavailable: v}),
  reset: () => set({nasUnavailable: false}),

  areWritesBlocked: () => get().nasUnavailable,

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
