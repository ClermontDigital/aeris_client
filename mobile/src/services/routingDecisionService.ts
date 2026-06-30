import type {
  CertTrust,
  RoutingDirective,
  RoutingMode,
} from '../types/dr.types';

// routingDecisionService — the pure §19.2 client routing cascade.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.2, §22.5 Q1/Q4.
//
// No React, no store reads — inputs in, a decision out — so the whole cascade
// is exhaustively unit-testable. The useRoutingDecision() hook wires the live
// stores into these inputs; everything decision-bearing lives here.
//
// Governing principles (§19.2): cloud-first; FAIL CLOSED on cert mismatch;
// never switch mid-transaction; no flapping (hysteresis on failback).

// Snapshot of everything the cascade needs to decide. Deliberately flat +
// serialisable so tests construct it inline.
export interface RoutingInputs {
  // --- Mid-transaction signal (§19.2 rule 1 / §22.5 Q1) ---
  // First match wins: NEVER switch mid-sale. The §22.5 Q1 definition:
  //   cart non-empty || on Checkout || an in-flight createSale/refundSale,
  //   PLUS in-flight settlement/print and an open account write.
  cartItemCount: number;
  activeScreen: string | null;
  saleInFlight: boolean; // createSale OR refundSale in flight
  settlementOrPrintInFlight: boolean; // §22.5 Q1 addition
  accountWriteInFlight: boolean; // §22.5 Q1 addition (open account write)

  // --- Directive (§19.1 / rule 2) ---
  directive: RoutingDirective;

  // --- Reachability (rules 2/3/4/5) ---
  cloudReachable: boolean;
  nasReachable: boolean;
  // Cert posture of the cached NAS endpoint (§18/§22.5 Q7). 'mismatch' forces
  // FAIL CLOSED. Until pinning exists, 'unverified' is treated as usable for
  // the prompt path but flagged in the UI (see useRoutingDecision wiring).
  nasCertTrust: CertTrust;

  // --- Failback hysteresis (rule 6 / §22.5 Q1) ---
  currentMode: RoutingMode;
  // Milliseconds the cloud has been continuously reachable again while we are
  // currently in local mode. Failback waits HYSTERESIS_MS sustained.
  cloudReachableSustainedMs: number;
  // True once the NAS→cloud reconcile outbox has fully drained (Phase-2
  // signal; in M1 this is conservatively `true` since the NAS isn't yet
  // taking writes — failback is then gated on hysteresis alone).
  reconcileQueueDrained: boolean;

  // --- M3-D: automated-failover master switch (rule 4 ONLY) ---
  // The SINGLE gate that converts Rule 4 from a cashier PROMPT (M2 manual
  // path) into an AUTO-APPLY cloud→on-prem swap. Default false everywhere.
  //   false ⇒ Rule 4 returns promptFailover:true, mode=current (M2 behaviour,
  //           proven identical by test). NOTHING ELSE in the cascade reads
  //           this flag — flag-off is provably ≡ M2.
  //   true  ⇒ Rule 4 returns mode='local' (auto-apply). The cloud-unreachable
  //           hysteresis (N consecutive failures) lives upstream in
  //           cloudReachableSustainedMs/cloudReachable producers + the M3-A
  //           swap orchestrator; the cert/usability fail-closed guard
  //           (nasUsable) still applies here.
  // Default-undefined coerces to false (see useRoutingDecision wiring) so an
  // input constructed without it is the M2 path.
  autoFailoverEnabled?: boolean;
}

// Why a decision was reached — drives copy + telemetry + the §19.3 sub-reason.
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
  // The mode the engine wants. NOTE: 'prompt' is NOT a mode — when the engine
  // wants the cashier to confirm an outage failover (rule 4) it returns
  // mode=current + promptFailover=true rather than auto-switching (Phase 1).
  mode: RoutingMode;
  reason: RoutingReason;
  // Phase-1 outage case: surface the "Cloud unreachable — switch to in-store
  // mode?" prompt rather than auto-switching (§19.2 rule 4).
  promptFailover: boolean;
  // True while the engine is deferring any change because a transaction is in
  // flight (rule 1). The caller holds the current mode until this clears.
  deferred: boolean;
}

// §22.5 Q1: faster flaps on 4G↔wifi handovers vs slower frustrates the cashier
// post-recovery → 45s sustained.
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
// 'unknown'/'unverified' are permitted for the prompt path in M1 (pinning is
// not yet implemented — see drStore §22.5 Q7 TODO); 'mismatch' is hard-fail.
function nasUsable(input: RoutingInputs): boolean {
  return input.nasReachable && input.nasCertTrust !== 'mismatch';
}

// The §19.2 cascade — first match wins.
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

  // Rule 2 — operator directive=local (planned cutover) AND NAS usable →
  // route LOCAL. Operator-driven, so this may auto-apply.
  if (input.directive === 'local' && nasUsable(input)) {
    return {
      mode: 'local',
      reason: 'directive-local',
      promptFailover: false,
      deferred: false,
    };
  }

  // Rule 6 (evaluated before plain cloud-primary so failback hysteresis can
  // hold us in local while the cloud is freshly back but not yet sustained):
  // we were local and the cloud has returned. Only switch back once it has
  // been reachable a sustained window AND the reconcile queue has drained.
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
    // Hold in local — no flapping (§19.2 governing principle).
    return {
      mode: 'local',
      reason: 'failback-hold',
      promptFailover: false,
      deferred: false,
    };
  }

  // Rule 3 — cloud reachable by any path (incl. 4G) → route CLOUD. This is
  // what keeps a 4G handheld on the cloud (G3).
  if (input.cloudReachable) {
    return {
      mode: 'cloud',
      reason: 'cloud-primary',
      promptFailover: false,
      deferred: false,
    };
  }

  // Rule 4 — cloud unreachable + NAS usable → outage failover.
  //
  // M3-D SINGLE GATE: the autoFailoverEnabled flag decides PROMPT vs AUTO here
  // and ONLY here. Everything else in the cascade is flag-independent, so
  // "flag-off ≡ M2 manual prompt" is a one-line invariant (test-covered).
  //   flag OFF (default / M2): return mode=current + promptFailover:true — the
  //     cashier confirms the switch in Settings, no auto-swap. IDENTICAL to the
  //     pre-M3 behaviour.
  //   flag ON (M3-A, post §6): return mode='local' — auto-apply. The upstream
  //     hysteresis (N consecutive cloud-unreachable) gates whether cloudReachable
  //     is even false yet; nasUsable() still fails-closed on cert mismatch
  //     (M-R3) and an unreachable NAS. Mid-transaction defer (rule 1) already
  //     ran above, so an auto-swap never interrupts a sale.
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
