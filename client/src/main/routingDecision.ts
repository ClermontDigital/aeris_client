// routingDecision (Electron main) — the pure §19.2 client routing cascade.
// FAITHFUL port of mobile/src/services/routingDecisionService.ts so Electron's
// auto-failover behaviour is identical to mobile's (the parity target).
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.2 +
// docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-A/§M3-D, §3 guardrails.
//
// No I/O, no module state — inputs in, a decision out — so the cascade is
// exhaustively unit-testable. failoverOrchestrator wires the live signals
// (cloudReachability, drState, nasHealthProbe, transaction state) into these
// inputs; everything decision-bearing lives here.
//
// Governing principles (§19.2): cloud-first; FAIL CLOSED on cert mismatch;
// never switch mid-transaction; no flapping (hysteresis on failback).

// The §19.1 routing directive. `cloud` = normal; `local` = operator cutover.
export type RoutingDirective = 'cloud' | 'local';

// The authority the device is selling against (matches mobile's RoutingMode).
export type RoutingMode = 'cloud' | 'local' | 'switching' | 'offline';

// Cert-trust posture for the cached Direct endpoint (§18 / §22.5 Q7).
//   unknown    — not yet evaluated.
//   trusted    — SAN/pin verified (target state).
//   unverified — reachable but cert identity NOT proven (current reality).
//   mismatch   — cert identity check failed → FAIL CLOSED (§19.2 rule 5).
export type CertTrust = 'unknown' | 'trusted' | 'unverified' | 'mismatch';

// Snapshot of everything the cascade needs to decide. Flat + serialisable so
// tests construct it inline. Mirrors mobile's RoutingInputs.
export interface RoutingInputs {
  // --- Mid-transaction signal (§19.2 rule 1 / §22.5 Q1) ---
  // NEVER switch mid-sale. On Electron the §22.5 Q1 definition maps to:
  //   cart non-empty || on the Checkout route || an in-flight createSale /
  //   refundSale || an in-flight settlement/print || an open account write.
  cartItemCount: number;
  activeScreen: string | null;
  saleInFlight: boolean;
  settlementOrPrintInFlight: boolean;
  accountWriteInFlight: boolean;

  // --- Directive (§19.1 / rule 2) ---
  directive: RoutingDirective;

  // --- Reachability (rules 2/3/4/5) ---
  cloudReachable: boolean;
  nasReachable: boolean;
  nasCertTrust: CertTrust;

  // --- Failback hysteresis (rule 6 / §22.5 Q1) ---
  currentMode: RoutingMode;
  cloudReachableSustainedMs: number;
  // True once the NAS→cloud reconcile outbox has fully drained (the M3-B real
  // drain signal — drState.failbackEligible). Gated by drEnabled upstream so a
  // non-DR deployment keeps the hysteresis-only behaviour.
  reconcileQueueDrained: boolean;

  // --- M3-D: automated-failover master switch (rule 4 ONLY) ---
  // The SINGLE gate converting Rule 4 from a cashier PROMPT (M2 manual path)
  // into an AUTO-APPLY cloud→on-prem swap. Default false everywhere. NOTHING
  // ELSE in the cascade reads it ⇒ flag-off is provably ≡ M2.
  autoFailoverEnabled?: boolean;
}

export type RoutingReason =
  | 'mid-transaction-defer'
  | 'directive-local'
  | 'cloud-primary'
  | 'outage-prompt'
  | 'outage-auto'
  | 'degraded-fail-closed'
  | 'failback-hold'
  | 'failback-ready';

export interface RoutingDecision {
  mode: RoutingMode;
  reason: RoutingReason;
  promptFailover: boolean;
  deferred: boolean;
}

// §22.5 Q1: 45s sustained-reachable before failback (anti 4G↔wifi flap).
export const FAILBACK_HYSTERESIS_MS = 45_000;

// Rule 1 — never switch mid-transaction (§22.5 Q1 definition).
export function isMidTransaction(input: RoutingInputs): boolean {
  return (
    input.cartItemCount > 0 ||
    input.activeScreen === 'Checkout' ||
    input.saleInFlight ||
    input.settlementOrPrintInFlight ||
    input.accountWriteInFlight
  );
}

// A NAS is only a valid failover target when it's reachable AND its cert
// identity has NOT failed the pin (§19.2 rule 5 — fail closed on mismatch).
function nasUsable(input: RoutingInputs): boolean {
  return input.nasReachable && input.nasCertTrust !== 'mismatch';
}

// The §19.2 cascade — first match wins. Logic is identical to mobile.
export function decideRouting(input: RoutingInputs): RoutingDecision {
  // Rule 1 — mid-transaction: defer any switch until complete/aborted.
  if (isMidTransaction(input)) {
    return {
      mode: input.currentMode,
      reason: 'mid-transaction-defer',
      promptFailover: false,
      deferred: true,
    };
  }

  // Rule 2 — operator directive=local (planned cutover) AND NAS usable.
  if (input.directive === 'local' && nasUsable(input)) {
    return {
      mode: 'local',
      reason: 'directive-local',
      promptFailover: false,
      deferred: false,
    };
  }

  // Rule 6 (before plain cloud-primary so failback hysteresis can hold us in
  // local while the cloud is freshly back but not yet sustained).
  if (input.currentMode === 'local' && input.cloudReachable) {
    const sustained = input.cloudReachableSustainedMs >= FAILBACK_HYSTERESIS_MS;
    if (sustained && input.reconcileQueueDrained) {
      return {
        mode: 'cloud',
        reason: 'failback-ready',
        promptFailover: false,
        deferred: false,
      };
    }
    return {
      mode: 'local',
      reason: 'failback-hold',
      promptFailover: false,
      deferred: false,
    };
  }

  // Rule 3 — cloud reachable by any path → route CLOUD.
  if (input.cloudReachable) {
    return {
      mode: 'cloud',
      reason: 'cloud-primary',
      promptFailover: false,
      deferred: false,
    };
  }

  // Rule 4 — cloud unreachable + NAS usable → outage failover.
  // M3-D SINGLE GATE: autoFailoverEnabled decides PROMPT vs AUTO here and ONLY
  // here. flag OFF (default / M2) ⇒ prompt; flag ON ⇒ auto-apply.
  if (!input.cloudReachable && nasUsable(input)) {
    if (input.autoFailoverEnabled) {
      return {
        mode: 'local',
        reason: 'outage-auto',
        promptFailover: false,
        deferred: false,
      };
    }
    return {
      mode: input.currentMode,
      reason: 'outage-prompt',
      promptFailover: true,
      deferred: false,
    };
  }

  // Rule 5 — neither reachable, or NAS fails the cert pin → DEGRADED/OFFLINE.
  // FAIL CLOSED: never connect to a NAS failing the cert pin (§18 anti-spoof).
  return {
    mode: 'offline',
    reason: 'degraded-fail-closed',
    promptFailover: false,
    deferred: false,
  };
}
