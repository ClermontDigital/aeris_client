// cloudReachability (Electron main) — a thin, NON-authoritative signal of
// whether the cloud/relay is currently reachable, derived from RelayClient
// fetch outcomes. M3-E port of mobile's cloudReachabilityStore.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §14.7 Q9, §19.2 +
// docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-A.
//
// The RelayClient reports EVERY transport outcome here via its setOnResponse
// hook (wired in relayBridge): `reachable=true` means the server answered (HTTP
// 200 envelope, app-level 4xx, 401 — the cloud is up); `reachable=false` means
// a transport/gateway failure (502/503/504, timeout, network throw). After a
// run of UNREACHABLE_AFTER_FAILURES consecutive transport failures we flip
// `cloudReachable` false. This identical hysteresis (3 consecutive failures)
// matches mobile so a brief WAN blip never demotes a healthy cloud.
//
// This module is the cloud-reachability PRODUCER for the failover cascade. It
// is a plain singleton (no React/zustand — main process), with the same
// derived `reachableSustainedMs()` the failback hysteresis consumes.

import { logger } from './logger';

// Consecutive transport failures before we declare the cloud unreachable.
// Matches mobile's UNREACHABLE_AFTER_FAILURES exactly.
const UNREACHABLE_AFTER_FAILURES = 3;

interface CloudReachabilityState {
  cloudReachable: boolean | null;
  consecutiveFailures: number;
  reachableSinceMs: number | null;
  lastFailureAt: string | null;
}

let state: CloudReachabilityState = {
  cloudReachable: null,
  consecutiveFailures: 0,
  reachableSinceMs: null,
  lastFailureAt: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      logger.warn('[cloudReachability] listener threw', e);
    }
  }
}

export const cloudReachability = {
  // Subscribe to any change in the reachability verdict; returns an unsubscribe.
  onChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getCloudReachable(): boolean | null {
    return state.cloudReachable;
  },

  // Wired to RelayClient.setOnResponse — `reachable` is the transport's own
  // verdict (server answered vs transport/gateway failure), so the consumer
  // just forwards it. `true` ⇒ reportSuccess; `false` ⇒ reportFailure(true).
  report(reachable: boolean): void {
    if (reachable) this.reportSuccess();
    else this.reportFailure(true);
  },

  reportSuccess(): void {
    const wasReachable = state.cloudReachable;
    const next: CloudReachabilityState = {
      ...state,
      cloudReachable: true,
      consecutiveFailures: 0,
      reachableSinceMs:
        wasReachable === true ? state.reachableSinceMs ?? Date.now() : Date.now(),
    };
    const changed = wasReachable !== true;
    state = next;
    if (changed) notify();
  },

  // `isTransport` distinguishes a network/timeout/5xx failure (counts toward
  // unreachable) from an application 4xx (does NOT — the server answered).
  reportFailure(isTransport: boolean): void {
    if (!isTransport) return;
    const wasReachable = state.cloudReachable;
    const nextFailures = state.consecutiveFailures + 1;
    const nowUnreachable = nextFailures >= UNREACHABLE_AFTER_FAILURES;
    state = {
      ...state,
      consecutiveFailures: nextFailures,
      lastFailureAt: new Date().toISOString(),
      ...(nowUnreachable
        ? { cloudReachable: false, reachableSinceMs: null }
        : {}),
    };
    if (nowUnreachable && wasReachable !== false) notify();
  },

  // Derived: ms the cloud has been continuously reachable (0 when not). The
  // failback hysteresis window compares against this.
  reachableSustainedMs(): number {
    const since = state.reachableSinceMs;
    if (state.cloudReachable !== true || since == null) return 0;
    return Math.max(0, Date.now() - since);
  },

  reset(): void {
    state = {
      cloudReachable: null,
      consecutiveFailures: 0,
      reachableSinceMs: null,
      lastFailureAt: null,
    };
  },
};
