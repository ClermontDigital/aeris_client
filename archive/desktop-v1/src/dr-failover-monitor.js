// DR M3 — automated failover monitor (desktop v1 thin-webview client).
//
// SHIPS DARK. Every code path here is gated on the `drAutoFailover` flag
// (electron-store, default FALSE). With the flag OFF this module does NOTHING:
// no probe traffic is emitted, no reachability is tracked, and the auto-swap
// decision site always returns `{ action: 'none' }`. Flag-off ≡ today's
// behaviour (manual routing-mode toggle only) — proven by test.
//
// v1 is a THIN WEBVIEW CONTAINER: it holds NO bearer token, has NO RelayClient,
// and all RPC/auth happen SERVER-SIDE inside the Laravel webview. So unlike
// mobile there is no dr.routing/dr.presence/shared-cascade to port. The only
// thing M3 can observe from the container is UNAUTHENTICATED endpoint
// reachability (cloud `baseUrl` + NAS `localUrl` against a no-auth health
// path), and the only lever it can pull is the EXISTING `set-routing-mode`
// path. This module is therefore pure orchestration:
//
//   1. ReachabilityTracker — hysteresis state machine (mirrors mobile's
//      cloudReachabilityStore semantics: N consecutive transport failures ⇒
//      down; one success resets + starts a reachable-since clock for the
//      failback hold window). No flap on a single blip.
//   2. decideAutoAction() — the SINGLE decision site for auto-swap / auto-
//      failback. Pure: takes a snapshot of flag + reachability + current mode +
//      localUrl validity and returns the action. The caller (main.js) is the
//      only place that invokes `set-routing-mode` — we never fork the switch.
//
// Everything below is dependency-free (no electron, no store) so it unit-tests
// in plain node, matching v1's "test pure exported helpers" pattern.

// --- tunables -------------------------------------------------------------

// Consecutive transport failures before an endpoint is declared DOWN. A small
// threshold avoids a single blip flipping state, while staying responsive.
// Mirrors mobile UNREACHABLE_AFTER_FAILURES.
const UNREACHABLE_AFTER_FAILURES = 3;

// How long the cloud must be CONTINUOUSLY reachable again before we auto-fail
// BACK from in-store → cloud. v1 has no auth token, so it CANNOT read the
// authed dr.readiness drain signal that mobile's M3-B consumes — failback here
// is HOLD-WINDOW-ONLY. This is acceptable for v1 because the till's webview URL
// does not affect the server-side NAS→cloud reconcile: the NAS drains its
// outbox independently and the cloud is canonical, so failing the *viewer* back
// to cloud a little early/late cannot corrupt data. The generous window simply
// avoids flapping the cashier's screen on a flaky WAN.
const FAILBACK_CLOUD_HOLD_MS = 60 * 1000;

// Default probe cadence. The orchestrator/timer lives in main.js; exported so
// it has a single source of truth and tests can assert it.
const PROBE_INTERVAL_MS = 15 * 1000;

// --- reachability hysteresis ---------------------------------------------

// A small state machine tracking one endpoint's reachability with hysteresis.
// `reachable` starts null (unknown). Construct one for cloud and one for NAS.
class ReachabilityTracker {
  constructor(now = () => Date.now()) {
    this._now = now;
    this.reachable = null; // null = unknown, true, or false
    this.consecutiveFailures = 0;
    this.reachableSinceMs = null; // when it last (re)became reachable
    this.lastFailureAt = null;
  }

  // Any HTTP answer (even 4xx/5xx) means the endpoint is REACHABLE — the box
  // answered. Resets the failure run and (re)starts the reachable-since clock.
  reportSuccess() {
    const wasReachable = this.reachable === true;
    this.reachable = true;
    this.consecutiveFailures = 0;
    // Keep the existing clock if already reachable, else start it now.
    this.reachableSinceMs = wasReachable
      ? this.reachableSinceMs ?? this._now()
      : this._now();
  }

  // A transport-class failure (DNS/connect/timeout/abort — NO HTTP response at
  // all). Counts toward "down". After UNREACHABLE_AFTER_FAILURES in a row we
  // flip `reachable` false and clear the reachable-since clock.
  reportTransportFailure() {
    this.consecutiveFailures += 1;
    this.lastFailureAt = this._now();
    if (this.consecutiveFailures >= UNREACHABLE_AFTER_FAILURES) {
      this.reachable = false;
      this.reachableSinceMs = null;
    }
  }

  // ms the endpoint has been CONTINUOUSLY reachable (0 if not reachable/unknown).
  reachableSustainedMs() {
    if (this.reachable !== true || this.reachableSinceMs == null) return 0;
    return Math.max(0, this._now() - this.reachableSinceMs);
  }

  reset() {
    this.reachable = null;
    this.consecutiveFailures = 0;
    this.reachableSinceMs = null;
    this.lastFailureAt = null;
  }
}

// --- the single auto-swap / failback decision site ------------------------

// Pure decision function. Returns one of:
//   { action: 'none' }                      — do nothing
//   { action: 'failover', mode: 'local' }   — auto-switch cloud → in-store
//   { action: 'failback', mode: 'cloud' }   — auto-switch in-store → cloud
//
// snapshot fields:
//   enabled            (bool)  — store.get('drAutoFailover'); flag OFF ⇒ always 'none'
//   currentMode        ('cloud'|'local')
//   cloudReachable     (bool|null)
//   nasReachable       (bool|null)
//   localUrlValid      (bool)  — dr-url-validator verdict on the stored localUrl
//   cloudSustainedMs   (number) — from the cloud tracker (for failback hold)
//   failbackHoldMs     (number) — defaults to FAILBACK_CLOUD_HOLD_MS
//
// Anti-flap is structural: failover requires the cloud tracker to already be in
// the SUSTAINED-down state (reachable === false, i.e. >= 3 consecutive transport
// failures) AND the NAS up; failback requires the cloud reachable continuously
// for the hold window. A single probe blip never crosses either threshold.
function decideAutoAction(snapshot) {
  const {
    enabled = false,
    currentMode = 'cloud',
    cloudReachable = null,
    nasReachable = null,
    localUrlValid = false,
    cloudSustainedMs = 0,
    failbackHoldMs = FAILBACK_CLOUD_HOLD_MS,
  } = snapshot || {};

  // FLAG OFF ⇒ zero behaviour change. Single, test-covered early return — this
  // is the guardrail that makes flag-off ≡ today.
  if (!enabled) {
    return { action: 'none' };
  }

  // Auto-FAILOVER: cloud sustained-unreachable AND NAS reachable AND a valid
  // LAN target configured AND we're currently on cloud.
  if (
    currentMode === 'cloud' &&
    cloudReachable === false &&
    nasReachable === true &&
    localUrlValid
  ) {
    return { action: 'failover', mode: 'local' };
  }

  // Auto-FAILBACK: in-store mode AND cloud reachable continuously for the hold
  // window. Hold-window-only (v1 cannot read the authed drain signal — see
  // FAILBACK_CLOUD_HOLD_MS rationale).
  if (
    currentMode === 'local' &&
    cloudReachable === true &&
    cloudSustainedMs >= failbackHoldMs
  ) {
    return { action: 'failback', mode: 'cloud' };
  }

  return { action: 'none' };
}

module.exports = {
  ReachabilityTracker,
  decideAutoAction,
  UNREACHABLE_AFTER_FAILURES,
  FAILBACK_CLOUD_HOLD_MS,
  PROBE_INTERVAL_MS,
};
