import {useMemo} from 'react';
import {useCartStore} from '../stores/cartStore';
import {useDrStore} from '../stores/drStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useCloudReachabilityStore} from '../stores/cloudReachabilityStore';
import {useTransactionActivityStore} from '../stores/transactionActivityStore';
import {
  decideRouting,
  type RoutingDecision,
  type RoutingInputs,
} from '../services/routingDecisionService';
import type {RoutingMode} from '../types/dr.types';

// useRoutingDecision — the React binding over the pure §19.2 cascade.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.2.
//
// It assembles the live store state into RoutingInputs and runs decideRouting.
// It is a PURE OBSERVER in M1: it returns the engine's recommended mode +
// whether to prompt, but does NOT itself flip connectionMode or re-auth — that
// orchestration (the cashier prompt → SettingsModal mode switch, the planned-
// cutover auto-apply) is wired by the consuming UI. Keeping the hook side-
// effect-free means the indicator + any prompt host can both subscribe without
// fighting over who owns the switch.

// The mode the device is currently OPERATING in (derived from connectionMode +
// reachability), distinct from the mode the engine RECOMMENDS. The §19.3
// indicator shows the operating mode; a divergence (recommended != operating)
// is what surfaces a prompt.
function deriveCurrentMode(
  connectionMode: 'direct' | 'relay',
  cloudReachable: boolean | null,
): RoutingMode {
  // Direct/LAN configured → we're operating against the NAS (local).
  if (connectionMode === 'direct') return 'local';
  // Relay configured: cloud unless we've positively determined it's down.
  if (cloudReachable === false) return 'offline';
  return 'cloud';
}

export interface UseRoutingDecisionResult extends RoutingDecision {
  // The mode the device is operating in right now (for the §19.3 chip).
  currentMode: RoutingMode;
  // True when a usable cached NAS target exists to fail over to.
  nasAvailable: boolean;
}

export function useRoutingDecision(): UseRoutingDecisionResult {
  const cartItemCount = useCartStore(s => s.items.length);
  const connectionMode = useSettingsStore(
    s => s.settings.connectionMode ?? 'relay',
  );
  // M3-D — the single auto-failover gate. Default OFF: an undefined flag is
  // the M2 manual-prompt path. Read here and threaded into the pure cascade.
  const autoFailoverEnabled = useSettingsStore(
    s => s.settings.autoFailoverEnabled ?? false,
  );

  const activeScreen = useTransactionActivityStore(s => s.activeScreen);
  const saleInFlight = useTransactionActivityStore(s => s.saleInFlight);
  const settlementOrPrintInFlight = useTransactionActivityStore(
    s => s.settlementOrPrintInFlight,
  );
  const accountWriteInFlight = useTransactionActivityStore(
    s => s.accountWriteInFlight,
  );

  const directive = useDrStore(s => s.routingDirective);
  const cacheStatus = useDrStore(s => s.cacheStatus);
  const certTrust = useDrStore(s => s.certTrust);
  const cachedLocalUrl = useDrStore(s => s.cachedLocalUrl);
  // M3-B — the REAL failback drain signal from the dr.routing seam. The
  // deployment computes `failback_eligible` server-side as
  // `drained && no open conflicts` (the dr.readiness / DR-status surface) and
  // delivers it over the relay; drStore persists it as `failbackEligible`.
  // This replaces the Wave-1 hardcoded `reconcileQueueDrained: true` stub so
  // Rule 6 never fails back while the NAS→cloud outbox is still draining or a
  // conflict is open. `drEnabled` lets us distinguish "DR served, not yet
  // eligible" (gate the failback) from "no DR surface at all" (no signal —
  // fall back to the M1 hysteresis-only behaviour so a non-DR / pre-seam
  // deployment is unchanged).
  const failbackEligible = useDrStore(s => s.failbackEligible);
  const drEnabled = useDrStore(s => s.drEnabled);
  // M3-A — live continuous NAS reachability from the health-probe loop. null =
  // not probed yet (treated as reachable, like cloud's null cold-start rule);
  // false = the probe positively failed → NAS unusable for failover.
  const nasProbeReachable = useDrStore(s => s.nasProbeReachable);

  const cloudReachable = useCloudReachabilityStore(s => s.cloudReachable);
  const reachableSinceMs = useCloudReachabilityStore(s => s.reachableSinceMs);

  return useMemo<UseRoutingDecisionResult>(() => {
    // A NAS is "available" (we hold a cached, validated last-known-good
    // target) — drives the banners' "provisioned" gate.
    const nasAvailable = !!cachedLocalUrl && cacheStatus === 'ok';

    // M3-A — NAS *reachability* for the cascade now reflects the live health
    // probe. A cached+ok target is reachable UNLESS the continuous probe has
    // positively returned false (null = not-yet-probed ⇒ optimistic reachable,
    // mirroring the cloud null cold-start rule). When the probe says false
    // while we hold a target and the cloud is down, the cascade drops to Rule 5
    // (degraded-fail-closed) and useFailoverDetection raises nasUnavailable.
    const nasReachable = nasAvailable && nasProbeReachable !== false;

    const currentMode = deriveCurrentMode(connectionMode, cloudReachable);

    const cloudReachableSustainedMs =
      cloudReachable === true && reachableSinceMs != null
        ? Math.max(0, Date.now() - reachableSinceMs)
        : 0;

    const inputs: RoutingInputs = {
      cartItemCount,
      activeScreen,
      saleInFlight,
      settlementOrPrintInFlight,
      accountWriteInFlight,
      directive,
      // Unknown (null) cloud reachability is treated as reachable — Phase 1 is
      // cloud-first and we don't want a cold start with no signal to read as
      // an outage. Only a positively-determined `false` counts as unreachable.
      cloudReachable: cloudReachable !== false,
      nasReachable,
      nasCertTrust: certTrust,
      currentMode,
      cloudReachableSustainedMs,
      // M3-B — the real reconcile-queue drain signal. When DR is served on this
      // deployment (drEnabled), gate failback on the deployment's
      // `failbackEligible` (server-side `drained && no open conflicts`) so we
      // NEVER fail back mid-drain or with an open conflict. When DR is NOT
      // served (no seam / non-DR deployment, drEnabled=false), there is no NAS
      // outbox to drain so we keep the M1 behaviour (drained ⇒ failback gated on
      // the cloud-sustained hysteresis alone) — flag-off / non-DR is unchanged.
      reconcileQueueDrained: drEnabled ? failbackEligible : true,
      autoFailoverEnabled,
    };

    const decision = decideRouting(inputs);
    return {...decision, currentMode, nasAvailable};
  }, [
    cartItemCount,
    connectionMode,
    autoFailoverEnabled,
    activeScreen,
    saleInFlight,
    settlementOrPrintInFlight,
    accountWriteInFlight,
    directive,
    cacheStatus,
    certTrust,
    cachedLocalUrl,
    failbackEligible,
    drEnabled,
    nasProbeReachable,
    cloudReachable,
    reachableSinceMs,
  ]);
}
