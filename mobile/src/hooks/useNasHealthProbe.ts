import {useEffect} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import {useDrStore} from '../stores/drStore';
import {useSettingsStore} from '../stores/settingsStore';

// useNasHealthProbe — M3-A continuous NAS reachability probe.
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-A.
//
// Replaces the one-time validate-on-cache LAN probe with a CONTINUOUS loop
// that runs while a NAS failover target is cached. Each tick re-probes the
// cached LAN address and writes the verdict to drStore.nasProbeReachable,
// which the routing cascade reads (useRoutingDecision) so:
//   - the auto-swap (Rule 4, flag-on) only fires when the NAS is currently
//     reachable AND cert-trust is not 'mismatch';
//   - a NAS that goes away mid-outage drops the cascade to Rule 5
//     (degraded-fail-closed), which useFailoverDetection turns into the
//     nasUnavailable banner via its EXISTING producer path (this is the
//     health-probe producer the plan calls for — it feeds setNasUnavailable
//     indirectly through the cascade reason, not by writing it directly).
//
// CERT-MISMATCH (M3-A "activate the dormant trigger"): when certTrust is
// 'mismatch' the NAS is unusable no matter what the liveness probe says — a
// reachable-but-spoofed host is exactly the credential-harvest case. We mark
// nasProbeReachable=false on mismatch and SKIP the network probe entirely, so
// the cascade fails closed (Rule 5 via nasUsable()) and the bearer never
// leaves the device (ApiClient.active also hard-throws on mismatch — M-R3).
//
// Mounted ONCE near the app root.
//
// Cadence: a liveness GET against the LAN every 15s is cheap on-LAN and keeps
// the failover verdict fresh enough that an auto-swap decision is acting on
// current reachability. Skipped while backgrounded; refreshed on foreground.
const NAS_PROBE_INTERVAL_MS = 15_000;

export function useNasHealthProbe(): void {
  const cachedLocalUrl = useDrStore(s => s.cachedLocalUrl);
  const certTrust = useDrStore(s => s.certTrust);

  useEffect(() => {
    const set = useDrStore.getState().setNasProbeReachable;

    // No cached target → nothing to probe. Reset to null (unknown) so a stale
    // verdict from a prior target can't influence the cascade.
    if (!cachedLocalUrl) {
      set(null);
      return;
    }

    // Cert mismatch → fail closed without touching the network. The cascade's
    // nasUsable() also fails closed on mismatch; this keeps the live signal
    // consistent (and avoids a liveness GET to a host we've deemed spoofed).
    if (certTrust === 'mismatch') {
      set(false);
      return;
    }

    let cancelled = false;

    const probe = async () => {
      const testConnection = useSettingsStore.getState().testConnection;
      let reachable = false;
      try {
        reachable = await testConnection(cachedLocalUrl);
      } catch {
        reachable = false;
      }
      if (cancelled) return;
      // Re-check mismatch at write time — pinning could flip mid-flight.
      if (useDrStore.getState().certTrust === 'mismatch') {
        set(false);
        return;
      }
      set(reachable);
    };

    // Immediate probe so the verdict is fresh as soon as a target is cached,
    // then on the interval.
    void probe();
    const interval = setInterval(() => void probe(), NAS_PROBE_INTERVAL_MS);

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void probe();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [cachedLocalUrl, certTrust]);
}
