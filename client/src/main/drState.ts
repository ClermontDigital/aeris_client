// drState (Electron main) — the in-memory DR routing state the failover
// orchestrator reads. M3-E port of the decision-bearing fields of mobile's
// drStore. Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-0/§M3-A/§M3-B.
//
// Holds ONLY what the cascade + orchestrator need (no React/zustand):
//   - drEnabled         : the dr.routing seam said this deployment runs DR.
//   - directive         : the §19.1 routing_target ('cloud'|'local').
//   - cachedLocalUrl    : the validated + LAN-probed NAS baseUrl (last-known-good).
//   - certTrust         : cert posture of cachedLocalUrl ('mismatch' ⇒ fail-closed).
//   - failbackEligible  : the server-side drained-&&-no-open-conflicts signal
//                          (M3-B consumes this; never failback while false).
//   - syncQueueDepth    : NAS→cloud outbox depth (observability; persisted).
//   - nasProbeReachable : live verdict from the continuous NAS health probe
//                          (null = unknown/cold-start, false = positively down).
//
// All fields reset to dormant defaults; a non-DR deployment (dr.routing 404)
// leaves them at defaults so the cascade behaves exactly as M2 (cloud-only).

import type { RoutingDirective, CertTrust } from './routingDecision';
import { logger } from './logger';

interface DrStateShape {
  drEnabled: boolean;
  directive: RoutingDirective;
  cachedLocalUrl: string | null;
  certTrust: CertTrust;
  failbackEligible: boolean;
  syncQueueDepth: number;
  nasProbeReachable: boolean | null;
}

const DEFAULTS: DrStateShape = {
  drEnabled: false,
  directive: 'cloud',
  cachedLocalUrl: null,
  certTrust: 'unknown',
  failbackEligible: false,
  syncQueueDepth: 0,
  nasProbeReachable: null,
};

let state: DrStateShape = { ...DEFAULTS };

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      logger.warn('[drState] listener threw', e);
    }
  }
}

export const drState = {
  onChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  get(): Readonly<DrStateShape> {
    return state;
  },

  // Ingest the dr.routing seam payload (M3-0). Persists directive +
  // failback_eligible + sync_queue_depth + drEnabled. The cachedLocalUrl is
  // committed SEPARATELY (setCachedLocalUrl) only AFTER the cold-start-style
  // validate→probe pipeline accepts partner_local_url, so a bad/poisoned LAN
  // address never becomes the failover target.
  ingestRouting(payload: {
    drEnabled: boolean;
    directive: RoutingDirective;
    failbackEligible: boolean;
    syncQueueDepth: number;
  }): void {
    state = {
      ...state,
      drEnabled: payload.drEnabled,
      directive: payload.directive,
      failbackEligible: payload.failbackEligible,
      syncQueueDepth: payload.syncQueueDepth,
    };
    notify();
  },

  // Commit (or clear) the validated NAS target. Setting it to null (e.g. the
  // seam stopped serving a partner_local_url, or validation failed) drops the
  // failover target so the cascade fails to offline rather than to a stale host.
  setCachedLocalUrl(url: string | null, certTrust: CertTrust): void {
    if (state.cachedLocalUrl === url && state.certTrust === certTrust) return;
    state = { ...state, cachedLocalUrl: url, certTrust };
    notify();
  },

  setCertTrust(certTrust: CertTrust): void {
    if (state.certTrust === certTrust) return;
    state = { ...state, certTrust };
    notify();
  },

  // Live NAS health-probe verdict (M3-A producer). null on no-target/cold start.
  setNasProbeReachable(reachable: boolean | null): void {
    if (state.nasProbeReachable === reachable) return;
    state = { ...state, nasProbeReachable: reachable };
    notify();
  },

  // Reset to dormant defaults — called on logout / re-pair so a stale NAS
  // target or drained signal from a prior deployment can't leak across.
  reset(): void {
    state = { ...DEFAULTS };
    notify();
  },
};
