import {
  decideRouting,
  RoutingInputs,
  FAILBACK_HYSTERESIS_MS,
} from '../routingDecision';

// Faithful mirror of mobile's routingDecisionService tests — the §19.2 cascade
// + the M3-D flag-isolation guardrail (flag-off == M2 manual prompt).
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-A/§M3-D, §3 guardrail 1.

// A baseline "cloud is healthy, no NAS, on cloud" input. Tests override.
function base(overrides: Partial<RoutingInputs> = {}): RoutingInputs {
  return {
    cartItemCount: 0,
    activeScreen: null,
    saleInFlight: false,
    settlementOrPrintInFlight: false,
    accountWriteInFlight: false,
    directive: 'cloud',
    cloudReachable: true,
    nasReachable: false,
    nasCertTrust: 'unverified',
    currentMode: 'cloud',
    cloudReachableSustainedMs: 0,
    reconcileQueueDrained: true,
    autoFailoverEnabled: false,
    ...overrides,
  };
}

describe('routingDecision cascade', () => {
  test('Rule 1: mid-transaction defers any switch (cart non-empty)', () => {
    const d = decideRouting(
      base({ cartItemCount: 2, cloudReachable: false, nasReachable: true }),
    );
    expect(d.reason).toBe('mid-transaction-defer');
    expect(d.deferred).toBe(true);
  });

  test('Rule 1: Checkout screen defers', () => {
    const d = decideRouting(
      base({ activeScreen: 'Checkout', cloudReachable: false, nasReachable: true }),
    );
    expect(d.deferred).toBe(true);
  });

  test('Rule 1: an in-flight sale defers even with the flag ON', () => {
    const d = decideRouting(
      base({
        saleInFlight: true,
        cloudReachable: false,
        nasReachable: true,
        autoFailoverEnabled: true,
      }),
    );
    expect(d.reason).toBe('mid-transaction-defer');
    expect(d.deferred).toBe(true);
  });

  test('Rule 3: cloud reachable -> cloud-primary', () => {
    const d = decideRouting(base({ cloudReachable: true }));
    expect(d.mode).toBe('cloud');
    expect(d.reason).toBe('cloud-primary');
  });

  describe('Rule 4 — the M3-D flag gate', () => {
    test('flag OFF: cloud down + NAS usable -> M2 manual PROMPT (no auto-switch)', () => {
      const d = decideRouting(
        base({
          cloudReachable: false,
          nasReachable: true,
          autoFailoverEnabled: false,
        }),
      );
      expect(d.reason).toBe('outage-prompt');
      expect(d.promptFailover).toBe(true);
      expect(d.mode).toBe('cloud'); // stays on current mode — M2 behaviour
    });

    test('flag ON + cert VERIFIED ("trusted"): cloud down + NAS usable -> AUTO local', () => {
      const d = decideRouting(
        base({
          cloudReachable: false,
          nasReachable: true,
          nasCertTrust: 'trusted',
          autoFailoverEnabled: true,
        }),
      );
      expect(d.reason).toBe('outage-auto');
      expect(d.promptFailover).toBe(false);
      expect(d.mode).toBe('local');
    });

    // BLOCKER-1 parity: AUTO hard-gates on a verified cert. Until SPKI pinning
    // ships 'trusted' is unreachable ⇒ AUTO is inert, falling back to the M2
    // PROMPT (never silently re-auth a cached password onto a non-pinned NAS).
    test('flag ON but cert UNVERIFIED -> falls back to the M2 PROMPT, not auto (BLOCKER-1)', () => {
      const d = decideRouting(
        base({
          cloudReachable: false,
          nasReachable: true,
          nasCertTrust: 'unverified',
          autoFailoverEnabled: true,
        }),
      );
      expect(d.reason).toBe('outage-prompt');
      expect(d.promptFailover).toBe(true);
      expect(d.mode).toBe('cloud');
    });

    test('flag ON but cert UNKNOWN -> also falls back to the M2 PROMPT', () => {
      const d = decideRouting(
        base({
          cloudReachable: false,
          nasReachable: true,
          nasCertTrust: 'unknown',
          autoFailoverEnabled: true,
        }),
      );
      expect(d.reason).toBe('outage-prompt');
      expect(d.promptFailover).toBe(true);
    });

    test('fail-closed: NAS cert mismatch -> offline regardless of the flag', () => {
      for (const flag of [false, true]) {
        const d = decideRouting(
          base({
            cloudReachable: false,
            nasReachable: true,
            nasCertTrust: 'mismatch',
            autoFailoverEnabled: flag,
          }),
        );
        expect(d.mode).toBe('offline');
        expect(d.reason).toBe('degraded-fail-closed');
      }
    });

    test('NAS unreachable -> offline (no swap target)', () => {
      const d = decideRouting(
        base({
          cloudReachable: false,
          nasReachable: false,
          autoFailoverEnabled: true,
        }),
      );
      expect(d.mode).toBe('offline');
    });
  });

  describe('Rule 6 — failback (flag-independent in the cascade)', () => {
    test('hold while cloud not yet sustained', () => {
      const d = decideRouting(
        base({
          currentMode: 'local',
          cloudReachable: true,
          cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS - 1,
          reconcileQueueDrained: true,
        }),
      );
      expect(d.reason).toBe('failback-hold');
      expect(d.mode).toBe('local');
    });

    test('hold while the queue has NOT drained (real M3-B drain signal)', () => {
      const d = decideRouting(
        base({
          currentMode: 'local',
          cloudReachable: true,
          cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS + 1,
          reconcileQueueDrained: false,
        }),
      );
      expect(d.reason).toBe('failback-hold');
    });

    test('ready once sustained AND drained', () => {
      const d = decideRouting(
        base({
          currentMode: 'local',
          cloudReachable: true,
          cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS + 1,
          reconcileQueueDrained: true,
        }),
      );
      expect(d.reason).toBe('failback-ready');
      expect(d.mode).toBe('cloud');
    });
  });

  test('FLAG ISOLATION: the flag alters ONLY Rule 4 — every other branch is identical both ways', () => {
    const scenarios: Array<Partial<RoutingInputs>> = [
      { cloudReachable: true }, // cloud-primary
      { cartItemCount: 1, cloudReachable: false, nasReachable: true }, // defer
      { directive: 'local', nasReachable: true }, // directive-local
      {
        currentMode: 'local',
        cloudReachable: true,
        cloudReachableSustainedMs: FAILBACK_HYSTERESIS_MS + 1,
      }, // failback-ready
      { cloudReachable: false, nasReachable: false }, // offline
      {
        cloudReachable: false,
        nasReachable: true,
        nasCertTrust: 'mismatch',
      }, // fail-closed
    ];
    for (const s of scenarios) {
      const off = decideRouting(base({ ...s, autoFailoverEnabled: false }));
      const on = decideRouting(base({ ...s, autoFailoverEnabled: true }));
      // Same reason + mode + deferred regardless of the flag for non-Rule-4
      // branches — flag-off is provably == M2 everywhere except the gate.
      expect(on.reason).toBe(off.reason);
      expect(on.mode).toBe(off.mode);
      expect(on.deferred).toBe(off.deferred);
    }
  });
});
