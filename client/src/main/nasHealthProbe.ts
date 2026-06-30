import { drState } from './drState';
import { isLocalUrlSafeForCache } from './drUrlValidator';
import { logger } from './logger';

// nasHealthProbe (Electron main) — M3-A continuous NAS reachability probe.
// Port of mobile's useNasHealthProbe (a React hook there; a timer loop here).
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-A.
//
// Replaces the one-time validate-on-cache LAN probe with a CONTINUOUS loop that
// runs while a NAS failover target is cached. Each tick re-probes the cached
// LAN address and writes the verdict to drState.nasProbeReachable, which the
// routing cascade reads (failoverOrchestrator) so:
//   - the auto-swap (Rule 4, flag-on) only fires when the NAS is CURRENTLY
//     reachable AND cert-trust is not 'mismatch';
//   - a NAS that goes away mid-outage drops the cascade to Rule 5
//     (degraded-fail-closed / offline).
//
// CERT-MISMATCH (M3-A "activate the dormant trigger"): when certTrust is
// 'mismatch' the NAS is unusable no matter what the liveness probe says — a
// reachable-but-spoofed host is exactly the credential-harvest case. We mark
// nasProbeReachable=false on mismatch and SKIP the network probe entirely, so
// the cascade fails closed (Rule 5 via nasUsable()).
//
// Cadence: a liveness GET against the LAN every 15s — cheap on-LAN and fresh
// enough that an auto-swap decision acts on current reachability. Matches
// mobile's NAS_PROBE_INTERVAL_MS.

const NAS_PROBE_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 4_000;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

// A cheap liveness check against the LAN target. Any HTTP answer (even 401/404)
// means the host is up; only a transport throw / timeout is "unreachable". We
// re-validate the URL with the SAME strict gate the cold-start path uses so a
// poisoned cachedLocalUrl can never become a probe (or, later, swap) target.
async function probeOnce(url: string): Promise<boolean> {
  if (!isLocalUrlSafeForCache(url)) return false;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // A lightweight GET to the deployment health/ping. Aeris2 answers /api on
    // any reachable instance; we only care that the socket + TLS came up, not
    // the status code.
    await fetch(`${url.replace(/\/+$/, '')}/api/v1/ping`, {
      method: 'GET',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function tick(): Promise<void> {
  if (inFlight) return;
  const { cachedLocalUrl, certTrust } = drState.get();

  // No cached target → nothing to probe. Reset to null (unknown) so a stale
  // verdict from a prior target can't influence the cascade.
  if (!cachedLocalUrl) {
    drState.setNasProbeReachable(null);
    return;
  }
  // Cert mismatch → fail closed without touching the network.
  if (certTrust === 'mismatch') {
    drState.setNasProbeReachable(false);
    return;
  }

  inFlight = true;
  try {
    const reachable = await probeOnce(cachedLocalUrl);
    // Re-check mismatch at write time — cert posture could flip mid-probe.
    if (drState.get().certTrust === 'mismatch') {
      drState.setNasProbeReachable(false);
    } else {
      drState.setNasProbeReachable(reachable);
    }
  } finally {
    inFlight = false;
  }
}

export const nasHealthProbe = {
  // Start the continuous probe loop (idempotent). Mounted once at app ready.
  start(): void {
    if (timer) return;
    void tick();
    timer = setInterval(() => void tick(), NAS_PROBE_INTERVAL_MS);
    logger.info('[nasHealthProbe] started');
  },

  stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  },

  // Test hook — run a single probe tick synchronously-awaitable.
  _tickForTests(): Promise<void> {
    return tick();
  },
};
