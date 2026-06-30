import {useEffect} from 'react';
import {useRoutingDecision} from './useRoutingDecision';
import {useFailoverAbortStore} from '../stores/failoverAbortStore';

// useFailoverDetection — the M-R6 wiring that turns the pure §19.2 cascade's
// Rule 5 (fail-closed: cloud unreachable AND the NAS is unusable mid-outage)
// into the `failoverAbortStore.setNasUnavailable(...)` signal that drives the
// "NAS unreachable — use manual/paper" banner + the write-gate.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §17.4, §19.2 rule 5, §25 M-R6.
//
// Why a separate hook (not inside useRoutingDecision): the routing hook is a
// documented PURE OBSERVER (multiple components subscribe to it without owning
// any side effect). This hook is the single producer of the NAS-unavailable
// signal and is mounted ONCE near the app root, alongside usePresenceBeacon.
//
// This is DETECTION ONLY — it raises a banner; it does NOT auto-switch the
// connection mode (that is the §19.2 cascade prompt + the cashier action, and
// full auto-failover is M2/Phase-3). It surfaces "the NAS we'd fail over to is
// gone" so the cashier isn't left staring at a hung till with no signal.
//
// M3-A: this hook is now also the cert-mismatch surface. The continuous NAS
// health probe (useNasHealthProbe) writes nasProbeReachable=false on a
// 'mismatch' cert-trust (as well as on a genuine reachability miss), which
// drops the cascade to Rule 5 (degraded-fail-closed) when the cloud is also
// down — so this hook raises the nasUnavailable banner for BOTH the
// reachable-but-gone outage case AND a cert-mismatch'd NAS. (Until a native
// SPKI pinning module lands — out of M3 scope, §5 — drStore still only emits
// 'unverified'/'unknown' in practice, so mismatch is dormant-but-wired: the
// path is active and tested, awaiting a real mismatch producer.)
export function useFailoverDetection(): void {
  const {reason, nasAvailable, currentMode} = useRoutingDecision();

  useEffect(() => {
    const setNasUnavailable =
      useFailoverAbortStore.getState().setNasUnavailable;

    // Rule 5 (degraded-fail-closed): cloud is unreachable AND the NAS failed
    // its usability check (unreachable or cert mismatch). Only surface the
    // "NAS unreachable" banner when a NAS was actually expected to be there —
    // either we hold a cached failover target, or we are currently operating
    // in local/Direct mode and it has dropped. A plain offline device with no
    // NAS configured must NOT raise a NAS-specific banner.
    const nasExpected = nasAvailable || currentMode === 'local';
    const nasGoneMidOutage = reason === 'degraded-fail-closed' && nasExpected;

    setNasUnavailable(nasGoneMidOutage);
  }, [reason, nasAvailable, currentMode]);
}
