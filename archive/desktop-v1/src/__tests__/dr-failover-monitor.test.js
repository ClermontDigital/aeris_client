// DR M3 — health hysteresis + the single auto-swap decision site.
//
// Pure-module tests (no electron). These prove the M3 guardrails:
//   - hysteresis: a single failure does NOT flap the endpoint down;
//   - auto-swap fires ONLY when flag-on + cloud-down + NAS-up + valid localUrl;
//   - failback fires ONLY when cloud is reachable for the hold window;
//   - FLAG-OFF ⇒ no auto-swap (manual only, ≡ today).

const {
  ReachabilityTracker,
  decideAutoAction,
  UNREACHABLE_AFTER_FAILURES,
  FAILBACK_CLOUD_HOLD_MS,
  PROBE_INTERVAL_MS,
} = require('../dr-failover-monitor');

describe('ReachabilityTracker hysteresis', () => {
  test('starts unknown (null)', () => {
    const t = new ReachabilityTracker();
    expect(t.reachable).toBeNull();
    expect(t.reachableSustainedMs()).toBe(0);
  });

  test('a SINGLE transport failure does NOT flip the endpoint down (no flap)', () => {
    const t = new ReachabilityTracker();
    t.reportTransportFailure();
    expect(t.reachable).toBeNull(); // still unknown, NOT false
  });

  test('two failures (below threshold) still do not flip down', () => {
    const t = new ReachabilityTracker();
    t.reportTransportFailure();
    t.reportTransportFailure();
    expect(UNREACHABLE_AFTER_FAILURES).toBe(3);
    expect(t.reachable).toBeNull();
  });

  test('THREE consecutive transport failures flip the endpoint down', () => {
    const t = new ReachabilityTracker();
    t.reportTransportFailure();
    t.reportTransportFailure();
    t.reportTransportFailure();
    expect(t.reachable).toBe(false);
    expect(t.reachableSustainedMs()).toBe(0);
  });

  test('one success resets the failure run (single success heals)', () => {
    const t = new ReachabilityTracker();
    t.reportTransportFailure();
    t.reportTransportFailure(); // 2 failures, not yet down
    t.reportSuccess(); // heal
    expect(t.reachable).toBe(true);
    expect(t.consecutiveFailures).toBe(0);
    // A subsequent single failure must again NOT flip down immediately.
    t.reportTransportFailure();
    expect(t.reachable).toBe(true);
  });

  test('reachableSustainedMs grows from when it last became reachable', () => {
    let now = 1000;
    const t = new ReachabilityTracker(() => now);
    t.reportSuccess(); // reachableSince = 1000
    now = 1000 + FAILBACK_CLOUD_HOLD_MS;
    expect(t.reachableSustainedMs()).toBe(FAILBACK_CLOUD_HOLD_MS);
  });

  test('the sustained clock does NOT reset across consecutive successes', () => {
    let now = 1000;
    const t = new ReachabilityTracker(() => now);
    t.reportSuccess(); // since = 1000
    now = 5000;
    t.reportSuccess(); // already reachable → keep since = 1000
    now = 9000;
    expect(t.reachableSustainedMs()).toBe(8000);
  });

  test('going down then back up RESTARTS the sustained clock', () => {
    let now = 0;
    const t = new ReachabilityTracker(() => now);
    t.reportSuccess(); // since = 0
    now = 100;
    t.reportTransportFailure();
    t.reportTransportFailure();
    t.reportTransportFailure(); // down → since cleared
    expect(t.reachable).toBe(false);
    now = 200;
    t.reportSuccess(); // back up → since = 200
    now = 250;
    expect(t.reachableSustainedMs()).toBe(50);
  });

  test('reset() returns to the unknown state', () => {
    const t = new ReachabilityTracker();
    t.reportSuccess();
    t.reset();
    expect(t.reachable).toBeNull();
    expect(t.consecutiveFailures).toBe(0);
  });

  test('PROBE_INTERVAL_MS is exported and is the documented 15s cadence', () => {
    expect(PROBE_INTERVAL_MS).toBe(15000);
  });
});

describe('decideAutoAction — the single auto-swap decision site', () => {
  // A fully-armed failover snapshot (cloud down, NAS up, valid LAN, on cloud).
  const armedFailover = {
    enabled: true,
    currentMode: 'cloud',
    cloudReachable: false,
    nasReachable: true,
    localUrlValid: true,
    cloudSustainedMs: 0,
  };

  // A fully-armed failback snapshot (in-store, cloud reachable past hold window).
  const armedFailback = {
    enabled: true,
    currentMode: 'local',
    cloudReachable: true,
    nasReachable: true,
    localUrlValid: true,
    cloudSustainedMs: FAILBACK_CLOUD_HOLD_MS,
  };

  describe('FLAG OFF ⇒ no auto-swap (manual only, ≡ today)', () => {
    test('a fully-armed failover does NOTHING when the flag is off', () => {
      expect(decideAutoAction({ ...armedFailover, enabled: false }))
        .toEqual({ action: 'none' });
    });

    test('a fully-armed failback does NOTHING when the flag is off', () => {
      expect(decideAutoAction({ ...armedFailback, enabled: false }))
        .toEqual({ action: 'none' });
    });

    test('a missing flag (undefined) is treated as OFF', () => {
      const { enabled, ...noFlag } = armedFailover;
      expect(decideAutoAction(noFlag)).toEqual({ action: 'none' });
    });

    test('an empty/undefined snapshot is a safe no-op', () => {
      expect(decideAutoAction()).toEqual({ action: 'none' });
      expect(decideAutoAction({})).toEqual({ action: 'none' });
    });
  });

  describe('auto-FAILOVER fires ONLY on flag-on + cloud-down + NAS-up + valid localUrl', () => {
    test('fires when fully armed', () => {
      expect(decideAutoAction(armedFailover))
        .toEqual({ action: 'failover', mode: 'local' });
    });

    test('does NOT fire when cloud is still reachable', () => {
      expect(decideAutoAction({ ...armedFailover, cloudReachable: true }))
        .toEqual({ action: 'none' });
    });

    test('does NOT fire when cloud reachability is still unknown (null) — hysteresis', () => {
      expect(decideAutoAction({ ...armedFailover, cloudReachable: null }))
        .toEqual({ action: 'none' });
    });

    test('does NOT fire when the NAS is unreachable', () => {
      expect(decideAutoAction({ ...armedFailover, nasReachable: false }))
        .toEqual({ action: 'none' });
    });

    test('does NOT fire when the NAS reachability is unknown', () => {
      expect(decideAutoAction({ ...armedFailover, nasReachable: null }))
        .toEqual({ action: 'none' });
    });

    test('does NOT fire when localUrl is not valid (fail closed)', () => {
      expect(decideAutoAction({ ...armedFailover, localUrlValid: false }))
        .toEqual({ action: 'none' });
    });

    test('does NOT fire when already in local mode (no thrash)', () => {
      expect(decideAutoAction({ ...armedFailover, currentMode: 'local' }))
        .toEqual({ action: 'none' });
    });
  });

  describe('auto-FAILBACK fires ONLY when cloud is sustained-reachable for the hold window', () => {
    test('fires when cloud reachable past the hold window', () => {
      expect(decideAutoAction(armedFailback))
        .toEqual({ action: 'failback', mode: 'cloud' });
    });

    test('does NOT fire before the hold window elapses (anti-flap)', () => {
      expect(decideAutoAction({ ...armedFailback, cloudSustainedMs: FAILBACK_CLOUD_HOLD_MS - 1 }))
        .toEqual({ action: 'none' });
    });

    test('does NOT fire when cloud is not (yet) reachable', () => {
      expect(decideAutoAction({ ...armedFailback, cloudReachable: false, cloudSustainedMs: 0 }))
        .toEqual({ action: 'none' });
    });

    test('does NOT fire when already in cloud mode', () => {
      expect(decideAutoAction({ ...armedFailback, currentMode: 'cloud' }))
        .toEqual({ action: 'none' });
    });

    test('respects a custom failbackHoldMs', () => {
      expect(decideAutoAction({ ...armedFailback, failbackHoldMs: FAILBACK_CLOUD_HOLD_MS * 2, cloudSustainedMs: FAILBACK_CLOUD_HOLD_MS }))
        .toEqual({ action: 'none' });
    });
  });
});
