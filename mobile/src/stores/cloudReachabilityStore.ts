import {create} from 'zustand';

// cloudReachabilityStore — a thin, NON-authoritative signal of whether the
// cloud/relay is currently reachable, derived from relay fetch outcomes.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §14.7 Q9, §19.2.
//
// Phase 1 has NO health probe (§19.2 rule 4 prompts; auto-failover is Phase 3).
// Rather than add a probe, we observe the natural request stream: every relay
// call reports success or a transport-class failure here, and after a run of
// consecutive failures we flip `cloudReachable` false and render the §14.7 Q9
// "Cloud unreachable" banner so the cashier knows to consider Direct mode.
// This is deliberately advisory — the cashier remains the authority (cashier-
// as-detector, accepted for Phase 1).

// Consecutive transport failures before we declare the cloud unreachable. A
// small threshold avoids a single blip flipping the banner, while staying
// responsive enough to be useful when the WAN actually drops.
const UNREACHABLE_AFTER_FAILURES = 3;

interface CloudReachabilityState {
  // null = unknown (no calls yet); true/false once we have signal.
  cloudReachable: boolean | null;
  consecutiveFailures: number;
  // Monotonic-ish stamps for the failback hysteresis input (§19.2 rule 6):
  // when the cloud most recently transitioned back to reachable.
  reachableSinceMs: number | null;
  lastFailureAt: string | null;

  // Called by transports after each cloud/relay attempt.
  reportSuccess: () => void;
  // `isTransport` distinguishes a network/timeout/5xx failure (counts toward
  // unreachable) from an application 4xx (does NOT — the server answered).
  reportFailure: (isTransport: boolean) => void;
  reset: () => void;

  // Derived: ms the cloud has been continuously reachable (0 when not).
  reachableSustainedMs: () => number;
}

export const useCloudReachabilityStore = create<CloudReachabilityState>(
  (set, get) => ({
    cloudReachable: null,
    consecutiveFailures: 0,
    reachableSinceMs: null,
    lastFailureAt: null,

    reportSuccess: () => {
      const wasReachable = get().cloudReachable;
      set({
        cloudReachable: true,
        consecutiveFailures: 0,
        // Start (or keep) the reachable-since clock for hysteresis.
        reachableSinceMs:
          wasReachable === true ? get().reachableSinceMs ?? Date.now() : Date.now(),
      });
    },

    reportFailure: (isTransport: boolean) => {
      // Application errors (4xx) mean the server answered — the cloud is
      // reachable. Don't count them toward "unreachable".
      if (!isTransport) {
        return;
      }
      const next = get().consecutiveFailures + 1;
      const nowUnreachable = next >= UNREACHABLE_AFTER_FAILURES;
      set({
        consecutiveFailures: next,
        lastFailureAt: new Date().toISOString(),
        ...(nowUnreachable
          ? {cloudReachable: false, reachableSinceMs: null}
          : {}),
      });
    },

    reset: () =>
      set({
        cloudReachable: null,
        consecutiveFailures: 0,
        reachableSinceMs: null,
        lastFailureAt: null,
      }),

    reachableSustainedMs: () => {
      const since = get().reachableSinceMs;
      if (get().cloudReachable !== true || since == null) return 0;
      return Math.max(0, Date.now() - since);
    },
  }),
);
