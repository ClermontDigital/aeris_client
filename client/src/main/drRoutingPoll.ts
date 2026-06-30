import { getDrRouting } from './relayBridge';
import { drState } from './drState';
import { getState as getAuthState } from './authManager';
import { isLocalUrlSafeForCache } from './drUrlValidator';
import { logger } from './logger';

// drRoutingPoll (Electron main) — M3-0 consume the dr.routing delivery seam.
// Port of mobile's useDrRoutingPoll. Source of truth:
// docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-0 (option B delivery seam).
//
// Polls RelayClient.getDrRouting() on a post-login cadence (relay/cloud). The
// shared method already maps a flag-off / non-DR deployment's 404 / NOT_FOUND
// (and dr_enabled=false) to null → we treat null as "no DR routing" and reset
// drState to dormant defaults (the M2 manual path; never error — §3 guardrail 1).
//
// On a real payload we:
//   1. ingest directive + failback_eligible + sync_queue_depth + drEnabled;
//   2. feed partner_local_url through the SAME strict cold-start-style
//      validation (isLocalUrlSafeForCache) before committing it as the Direct
//      failover target (drState.cachedLocalUrl). A url that fails validation is
//      NOT cached — the cascade then has no NAS target and fails closed.
//
// Cadence: every 30s while authenticated. Skipped when logged out (the seam is
// authenticated user-traffic). The continuous reachability of the committed
// target is the SEPARATE job of nasHealthProbe.

const POLL_INTERVAL_MS = 30_000;
// Non-DR deployments stay near-silent: after a discovery probe 404s we drop to
// a slow re-discovery cadence instead of emitting a 30s fleet-wide 404. If DR
// is later enabled (a deploy event), the slow probe promotes to the fast loop.
const REDISCOVER_INTERVAL_MS = 15 * 60_000;

let fastTimer: ReturnType<typeof setInterval> | null = null;
let slowTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

// Returns true iff this deployment served a DR routing payload (DR active here).
async function pollOnce(): Promise<boolean> {
  if (inFlight) return false;
  // Authenticated user-traffic only — no point hitting the seam logged out.
  if (!getAuthState().isAuthenticated) return false;

  inFlight = true;
  try {
    const payload = await getDrRouting();
    if (!payload) {
      // No DR routing for this client (404 / NOT_FOUND / dr_enabled=false) →
      // dormant. M2 manual path. Clears any prior target so a deployment that
      // turned DR off can't leave a stale failover target armed.
      drState.reset();
      return false;
    }

    drState.ingestRouting({
      drEnabled: payload.dr_enabled,
      directive: payload.routing_target,
      failbackEligible: payload.failback_eligible,
      syncQueueDepth: payload.sync_queue_depth,
    });

    // Validate the served NAS LAN address BEFORE committing it as the failover
    // target. A non-DR / cloud-only payload has partner_local_url=null → no
    // target. A poisoned/invalid address fails the strict gate → not cached.
    const lan = payload.partner_local_url;
    if (lan && isLocalUrlSafeForCache(lan.trim())) {
      // certTrust stays 'unverified' (best-effort; SPKI pinning is out of M3
      // scope — fail-closed-on-mismatch is wired in the cascade). The health
      // probe re-confirms reachability continuously.
      const prior = drState.get();
      const certTrust = prior.certTrust === 'mismatch' ? 'mismatch' : 'unverified';
      drState.setCachedLocalUrl(lan.trim(), certTrust);
    } else {
      // No usable LAN target served — clear any stale one.
      drState.setCachedLocalUrl(null, 'unknown');
    }
    return true;
  } catch (e) {
    // getDrRouting only throws on a NON-404 error (auth/timeout/malformed). A
    // broken deployment must not be silently masked as "no DR" — but we also
    // must not crash the poll loop. Log + leave last-known-good in place.
    logger.warn('[drRoutingPoll] dr.routing poll failed (keeping last-known)', e);
    return false;
  } finally {
    inFlight = false;
  }
}

// Promote to the fast steady-state loop once we know this deployment serves DR.
function promoteToFast(): void {
  if (fastTimer) return;
  if (slowTimer) {
    clearInterval(slowTimer);
    slowTimer = null;
  }
  fastTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
}

export const drRoutingPoll = {
  // Start the post-login poll loop (idempotent). Mounted once at app ready;
  // pollOnce() self-gates on isAuthenticated so it's safe to run before login.
  //
  // A discovery probe decides the cadence: a DR deployment polls every 30s; a
  // non-DR / cloud-only deployment drops to a slow 15-min re-discovery so the
  // fleet doesn't emit a 30s 404 from every till (M1 — keep non-DR silent).
  start(): void {
    if (fastTimer || slowTimer) return;
    void pollOnce().then(drServed => {
      if (drServed) {
        promoteToFast();
      } else {
        slowTimer = setInterval(() => {
          void pollOnce().then(served => {
            if (served) promoteToFast();
          });
        }, REDISCOVER_INTERVAL_MS);
      }
    });
    logger.info('[drRoutingPoll] started');
  },

  stop(): void {
    if (fastTimer) {
      clearInterval(fastTimer);
      fastTimer = null;
    }
    if (slowTimer) {
      clearInterval(slowTimer);
      slowTimer = null;
    }
  },

  // Test hook — run a single poll tick. Resolves to whether DR was served.
  _pollForTests(): Promise<boolean> {
    return pollOnce();
  },
};
