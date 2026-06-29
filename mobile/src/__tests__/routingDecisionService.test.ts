import {
  decideRouting,
  isMidTransaction,
  FAILBACK_HYSTERESIS_MS,
  type RoutingInputs,
} from '../services/routingDecisionService';

// Base = a clean cloud-primary state with no transaction in flight.
function base(overrides: Partial<RoutingInputs> = {}): RoutingInputs {
  return {
    cartItemCount: 0,
    activeScreen: 'Dashboard',
    saleInFlight: false,
    settlementOrPrintInFlight: false,
    accountWriteInFlight: false,
    directive: 'cloud',
    cloudReachable: true,
    nasReachable: true,
    nasCertTrust: 'unverified',
    currentMode: 'cloud',
    cloudReachableSustainedMs: 0,
    reconcileQueueDrained: true,
    ...overrides,
  };
}

describe('isMidTransaction (§22.5 Q1)', () => {
  it('is true for any of: cart, Checkout, sale/settlement/account in flight', () => {
    expect(isMidTransaction(base({cartItemCount: 1}))).toBe(true);
    expect(isMidTransaction(base({activeScreen: 'Checkout'}))).toBe(true);
    expect(isMidTransaction(base({saleInFlight: true}))).toBe(true);
    expect(isMidTransaction(base({settlementOrPrintInFlight: true}))).toBe(true);
    expect(isMidTransaction(base({accountWriteInFlight: true}))).toBe(true);
  });
  it('is false on an idle screen with an empty cart', () => {
    expect(isMidTransaction(base())).toBe(false);
  });
});

describe('decideRouting — §19.2 cascade (first match wins)', () => {
  it('rule 1 — defers any switch mid-transaction, even on an outage', () => {
    const d = decideRouting(
      base({cartItemCount: 2, cloudReachable: false, currentMode: 'cloud'}),
    );
    expect(d.deferred).toBe(true);
    expect(d.mode).toBe('cloud'); // holds current
    expect(d.promptFailover).toBe(false);
    expect(d.reason).toBe('mid-transaction-defer');
  });

  it('rule 2 — directive=local + NAS usable → routes LOCAL (auto)', () => {
    const d = decideRouting(base({directive: 'local'}));
    expect(d.mode).toBe('local');
    expect(d.reason).toBe('directive-local');
    expect(d.promptFailover).toBe(false);
  });

  it('rule 2 — directive=local but NAS cert mismatch → does NOT route local', () => {
    const d = decideRouting(
      base({directive: 'local', nasCertTrust: 'mismatch', cloudReachable: false}),
    );
    // Falls through to fail-closed since cloud is also down.
    expect(d.mode).toBe('offline');
    expect(d.reason).toBe('degraded-fail-closed');
  });

  it('rule 3 — cloud reachable keeps a 4G handheld on cloud (G3)', () => {
    const d = decideRouting(base({cloudReachable: true, nasReachable: true}));
    expect(d.mode).toBe('cloud');
    expect(d.reason).toBe('cloud-primary');
  });

  it('rule 4 — cloud down + NAS usable → PROMPT (Phase 1), no auto-switch', () => {
    const d = decideRouting(
      base({cloudReachable: false, nasReachable: true, currentMode: 'cloud'}),
    );
    expect(d.promptFailover).toBe(true);
    expect(d.mode).toBe('cloud'); // holds current until cashier confirms
    expect(d.reason).toBe('outage-prompt');
  });

  it('rule 5 — neither reachable → DEGRADED/OFFLINE, fail closed', () => {
    const d = decideRouting(
      base({cloudReachable: false, nasReachable: false}),
    );
    expect(d.mode).toBe('offline');
    expect(d.reason).toBe('degraded-fail-closed');
  });

  it('rule 5 — NAS cert mismatch is NEVER connected to (anti-spoof, §18)', () => {
    const d = decideRouting(
      base({
        cloudReachable: false,
        nasReachable: true,
        nasCertTrust: 'mismatch',
      }),
    );
    expect(d.mode).toBe('offline');
    expect(d.promptFailover).toBe(false);
    expect(d.reason).toBe('degraded-fail-closed');
  });
});

describe('decideRouting — rule 6 failback hysteresis (no flap)', () => {
  it('holds in local while cloud is freshly back but not yet sustained', () => {
    const d = decideRouting(
      base({
        currentMode: 'local',
        cloudReachable: true,
        cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS - 1,
        reconcileQueueDrained: true,
      }),
    );
    expect(d.mode).toBe('local');
    expect(d.reason).toBe('failback-hold');
  });

  it('fails back once cloud is sustained AND the reconcile queue drained', () => {
    const d = decideRouting(
      base({
        currentMode: 'local',
        cloudReachable: true,
        cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS,
        reconcileQueueDrained: true,
      }),
    );
    expect(d.mode).toBe('cloud');
    expect(d.reason).toBe('failback-ready');
  });

  it('holds in local if cloud is sustained but the queue has NOT drained', () => {
    const d = decideRouting(
      base({
        currentMode: 'local',
        cloudReachable: true,
        cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS + 5_000,
        reconcileQueueDrained: false,
      }),
    );
    expect(d.mode).toBe('local');
    expect(d.reason).toBe('failback-hold');
  });

  it('mid-transaction still defers a ready failback', () => {
    const d = decideRouting(
      base({
        currentMode: 'local',
        cartItemCount: 1,
        cloudReachable: true,
        cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS,
      }),
    );
    expect(d.deferred).toBe(true);
    expect(d.mode).toBe('local');
  });
});

// §25.5 — the edge cases the SITREP "17 tests" count implied but the file was
// missing. Each pins a precedence/transition the cascade must honour.
describe('decideRouting — §25.5 edge cases', () => {
  it('directive=local takes precedence even when the cloud is reachable', () => {
    // An operator planned-cutover (directive=local) wins over plain
    // cloud-primary (rule 2 is evaluated before rule 3). A 4G-reachable device
    // still routes LOCAL when the operator has declared the cutover.
    const d = decideRouting(
      base({directive: 'local', cloudReachable: true, currentMode: 'cloud'}),
    );
    expect(d.mode).toBe('local');
    expect(d.reason).toBe('directive-local');
  });

  it('directive=local + cert-trust=unverified still routes local in M1', () => {
    // Pinning is M2 — until it lands, 'unverified' is permitted (nasUsable only
    // hard-fails on an explicit 'mismatch'). DOCUMENTED EXPECTATION: once SPKI
    // pinning ships, 'unverified' must be treated as non-usable and this case
    // must FALL THROUGH to fail-closed instead. Tracked as the §22.2 / M2 gate.
    const d = decideRouting(
      base({directive: 'local', nasCertTrust: 'unverified', cloudReachable: true}),
    );
    expect(d.mode).toBe('local');
    expect(d.reason).toBe('directive-local');
  });

  it('offline→cloud: an offline device recovers straight to cloud-primary', () => {
    // currentMode 'offline' is NOT 'local', so rule 6 hysteresis does NOT apply
    // (no failback hold) — the device returns to the cloud immediately when it
    // becomes reachable again.
    const d = decideRouting(
      base({currentMode: 'offline', cloudReachable: true}),
    );
    expect(d.mode).toBe('cloud');
    expect(d.reason).toBe('cloud-primary');
  });

  it('failback re-flap: sustained-ms reset to 0 holds local (no premature flap)', () => {
    // The cloud flickered back then dropped → cloudReachableSustainedMs resets
    // to 0. Even reachable, we must HOLD in local until the window rebuilds.
    const d = decideRouting(
      base({
        currentMode: 'local',
        cloudReachable: true,
        cloudReachableSustainedMs: 0,
        reconcileQueueDrained: true,
      }),
    );
    expect(d.mode).toBe('local');
    expect(d.reason).toBe('failback-hold');
  });

  it('directive=local but NAS unreachable → does not route local', () => {
    // nasUsable requires reachability; with the cloud also down it fails closed.
    const d = decideRouting(
      base({directive: 'local', nasReachable: false, cloudReachable: false}),
    );
    expect(d.mode).toBe('offline');
    expect(d.reason).toBe('degraded-fail-closed');
  });

  it('directive=local + NAS unreachable but cloud up → stays on cloud', () => {
    const d = decideRouting(
      base({directive: 'local', nasReachable: false, cloudReachable: true}),
    );
    expect(d.mode).toBe('cloud');
    expect(d.reason).toBe('cloud-primary');
  });
});
