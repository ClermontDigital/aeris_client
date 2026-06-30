import { ipcMain } from 'electron';
import StoreMock from 'electron-store';
import { initRelayBridge } from '../relayBridge';
import { settingsStore } from '../settingsStore';
import { tokenStore } from '../tokenStore';
import * as authManager from '../authManager';
import { cloudReachability } from '../cloudReachability';
import { drState } from '../drState';
import { txnActivity } from '../txnActivity';
import { failoverOrchestrator, getDrState } from '../failoverOrchestrator';
import { FAILBACK_HYSTERESIS_MS } from '../routingDecision';

// The Electron failover decision-logic tests (the §M3-E deliverable):
//   - flag-off == M2 (NO auto-swap in either direction, only advisory chip);
//   - flag-on auto-swap ONLY when all conditions met;
//   - fail-closed on cert mismatch;
//   - failback only when the real drain signal says drained;
//   - never swap mid-transaction.
// We drive the orchestrator's evaluate() via its test hook after staging the
// live signals, and assert on whether the swap actuator (settingsStore.set +
// handleModeSwitch + silentReauth) fired.

const VALID_NAS = 'https://192.168.1.50:8822';

describe('failoverOrchestrator decision logic', () => {
  let modeSwitchSpy: jest.SpyInstance;
  let silentReauthSpy: jest.SpyInstance;
  let settingsSetSpy: jest.SpyInstance;

  beforeEach(async () => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
    tokenStore._resetCache();
    (ipcMain as unknown as { __reset: () => void }).__reset();
    authManager._resetForTests();
    await initRelayBridge();

    cloudReachability.reset();
    drState.reset();
    txnActivity.reset();
    failoverOrchestrator._resetForTests();

    // The swap actuator's three legs — spy so we can assert it (didn't) fire,
    // and so the test never actually mutates auth/relay.
    modeSwitchSpy = jest
      .spyOn(authManager, 'handleModeSwitch')
      .mockResolvedValue({} as never);
    silentReauthSpy = jest
      .spyOn(authManager, 'silentReauth')
      .mockResolvedValue('reauthed');
    settingsSetSpy = jest.spyOn(settingsStore, 'set');

    // Default: authenticated so the poll/presence gates are satisfied where
    // relevant (orchestrator only reads auth in the presence beat).
  });

  afterEach(() => {
    failoverOrchestrator._resetForTests();
    jest.restoreAllMocks();
  });

  // Stage a "cloud down + NAS healthy + on cloud, idle" world. cert='trusted'
  // (the verified target state) so the BLOCKER-1 cert hard-gate permits AUTO —
  // tests that exercise the gate override the cert below.
  function stageOutageWithHealthyNas(): void {
    drState.ingestRouting({
      drEnabled: true,
      directive: 'cloud',
      failbackEligible: false,
      syncQueueDepth: 5,
    });
    drState.setCachedLocalUrl(VALID_NAS, 'trusted');
    drState.setNasProbeReachable(true);
    // 3 transport failures -> cloud unreachable.
    cloudReachability.report(false);
    cloudReachability.report(false);
    cloudReachability.report(false);
  }

  function didSwap(): boolean {
    // A failover/failback swap calls settingsStore.set with connectionMode.
    return settingsSetSpy.mock.calls.some(
      (c) => (c[0] as { connectionMode?: string })?.connectionMode != null,
    );
  }

  test('FLAG OFF: cloud outage + healthy NAS -> NO auto-swap (M2 manual path)', () => {
    settingsStore.set({ autoFailoverEnabled: false });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();

    failoverOrchestrator._evaluateForTests();

    expect(didSwap()).toBe(false);
    expect(modeSwitchSpy).not.toHaveBeenCalled();
    expect(silentReauthSpy).not.toHaveBeenCalled();
    // ...but the advisory chip reflects the prompt for the cashier.
    const dr = getDrState();
    expect(dr.promptFailover).toBe(true);
    expect(dr.mode).toBe('cloud');
  });

  test('FLAG ON: cloud outage + healthy NAS + idle -> auto-swap cloud->NAS', () => {
    settingsStore.set({ autoFailoverEnabled: true });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();

    failoverOrchestrator._evaluateForTests();

    expect(didSwap()).toBe(true);
    const swapCall = settingsSetSpy.mock.calls.find(
      (c) => (c[0] as { connectionMode?: string })?.connectionMode === 'direct',
    );
    expect(swapCall?.[0]).toMatchObject({
      connectionMode: 'direct',
      baseUrl: VALID_NAS,
    });
    expect(modeSwitchSpy).toHaveBeenCalled();
  });

  test('FLAG ON: fail-closed — cert mismatch never swaps even on a cloud outage', () => {
    settingsStore.set({ autoFailoverEnabled: true });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();
    drState.setCertTrust('mismatch'); // poison the NAS identity

    failoverOrchestrator._evaluateForTests();

    expect(didSwap()).toBe(false);
    expect(getDrState().mode).toBe('offline');
  });

  test('FLAG ON but cert UNVERIFIED: no auto-swap, no silent re-auth (BLOCKER-1)', () => {
    settingsStore.set({ autoFailoverEnabled: true });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();
    drState.setCertTrust('unverified'); // pinning not yet verified

    failoverOrchestrator._evaluateForTests();

    // Falls back to the M2 PROMPT — never silently re-auths onto a non-pinned NAS.
    expect(didSwap()).toBe(false);
    expect(silentReauthSpy).not.toHaveBeenCalled();
    expect(getDrState().promptFailover).toBe(true);
    expect(getDrState().mode).toBe('cloud');
  });

  test('FLAG ON: NAS unreachable -> no swap (no target)', () => {
    settingsStore.set({ autoFailoverEnabled: true });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();
    drState.setNasProbeReachable(false); // NAS went away

    failoverOrchestrator._evaluateForTests();

    expect(didSwap()).toBe(false);
  });

  test('FLAG ON: never swaps mid-transaction (in-flight sale defers)', () => {
    settingsStore.set({ autoFailoverEnabled: true });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();
    txnActivity.beginSale(); // a sale is in flight

    failoverOrchestrator._evaluateForTests();

    expect(didSwap()).toBe(false);
  });

  test('FLAG ON: never swaps with a non-empty cart', () => {
    settingsStore.set({ autoFailoverEnabled: true });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();
    txnActivity.report({ cartItemCount: 1, activeScreen: '/pos/cart' });

    failoverOrchestrator._evaluateForTests();

    expect(didSwap()).toBe(false);
  });

  describe('auto-failback (NAS -> cloud)', () => {
    // Stage: in Direct mode, cloud back + sustained, on the NAS.
    function stageRecovered(opts: { drained: boolean; flag: boolean }): void {
      settingsStore.set({ autoFailoverEnabled: opts.flag });
      // Enter direct mode (bypass the validation gate by setting baseUrl first).
      settingsStore.set({ baseUrl: VALID_NAS });
      settingsStore.set({ connectionMode: 'direct' });
      settingsSetSpy.mockClear();

      drState.ingestRouting({
        drEnabled: true,
        directive: 'cloud',
        failbackEligible: opts.drained,
        syncQueueDepth: opts.drained ? 0 : 3,
      });
      drState.setCachedLocalUrl(VALID_NAS, 'unverified');
      drState.setNasProbeReachable(true);

      // Cloud reachable + sustained past the hold window.
      cloudReachability.report(true);
      jest
        .spyOn(cloudReachability, 'reachableSustainedMs')
        .mockReturnValue(FAILBACK_HYSTERESIS_MS + 1_000);
    }

    test('FLAG ON + drained + sustained -> auto failback to cloud', () => {
      stageRecovered({ drained: true, flag: true });
      failoverOrchestrator._evaluateForTests();
      const back = settingsSetSpy.mock.calls.find(
        (c) => (c[0] as { connectionMode?: string })?.connectionMode === 'relay',
      );
      expect(back).toBeTruthy();
      expect(modeSwitchSpy).toHaveBeenCalled();
    });

    test('FLAG ON + sustained but NOT drained -> hold (no failback mid-drain)', () => {
      stageRecovered({ drained: false, flag: true });
      failoverOrchestrator._evaluateForTests();
      const back = settingsSetSpy.mock.calls.find(
        (c) => (c[0] as { connectionMode?: string })?.connectionMode === 'relay',
      );
      expect(back).toBeFalsy();
    });

    test('FLAG OFF: drained + sustained -> NO auto failback (M2 manual)', () => {
      stageRecovered({ drained: true, flag: false });
      failoverOrchestrator._evaluateForTests();
      const back = settingsSetSpy.mock.calls.find(
        (c) => (c[0] as { connectionMode?: string })?.connectionMode === 'relay',
      );
      expect(back).toBeFalsy();
      expect(modeSwitchSpy).not.toHaveBeenCalled();
    });
  });

  test('anti-flap: a second evaluate in the same outage does NOT double-swap', () => {
    settingsStore.set({ autoFailoverEnabled: true });
    settingsSetSpy.mockClear();
    stageOutageWithHealthyNas();

    failoverOrchestrator._evaluateForTests();
    const firstCount = settingsSetSpy.mock.calls.filter(
      (c) => (c[0] as { connectionMode?: string })?.connectionMode === 'direct',
    ).length;
    failoverOrchestrator._evaluateForTests();
    const secondCount = settingsSetSpy.mock.calls.filter(
      (c) => (c[0] as { connectionMode?: string })?.connectionMode === 'direct',
    ).length;
    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1); // latched — no second swap
  });
});
