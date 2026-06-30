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

  const cloudReachable = useCloudReachabilityStore(s => s.cloudReachable);
  const reachableSinceMs = useCloudReachabilityStore(s => s.reachableSinceMs);

  return useMemo<UseRoutingDecisionResult>(() => {
    // A NAS is "available" to fail over to when we hold a cached, validated
    // last-known-good target. Reachability of that target is best-effort in
    // M1 (no live LAN probe loop) — we treat a cached+ok target as reachable
    // and let the cascade fail-closed on an explicit cert mismatch.
    const nasAvailable = !!cachedLocalUrl && cacheStatus === 'ok';

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
      nasReachable: nasAvailable,
      nasCertTrust: certTrust,
      currentMode,
      cloudReachableSustainedMs,
      // M1 NAS isn't taking writes yet → no outbox to drain → conservatively
      // drained, so failback is gated on hysteresis alone (Phase 2 wires the
      // real reconcile-queue signal here).
      reconcileQueueDrained: true,
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
    cloudReachable,
    reachableSinceMs,
  ]);
}
