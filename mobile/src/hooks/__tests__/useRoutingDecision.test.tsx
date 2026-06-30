import {renderHook} from '@testing-library/react-native';

// M-R4: tests for the useRoutingDecision hook — the only consumer of the pure
// §19.2 cascade in the app. Covers the store→RoutingInputs selector mappings
// and the cloud-reachable/connection-mode transitions, so a selector-wiring bug
// (reading the wrong field, mis-deriving currentMode) is caught.
//
// The hook reads from five zustand stores. We mock each store module so each
// `useXStore(selector)` call resolves the selector against a controllable state
// object — no native deps (StorageService / AsyncStorage) are pulled in, and we
// drive the inputs precisely without touching real persistence.

interface MockState {
  cart: {items: unknown[]};
  settings: {settings: {connectionMode?: 'direct' | 'relay'}};
  txn: {
    activeScreen: string | null;
    saleInFlight: boolean;
    settlementOrPrintInFlight: boolean;
    accountWriteInFlight: boolean;
  };
  dr: {
    routingDirective: 'cloud' | 'local';
    cacheStatus: string;
    certTrust: string;
    cachedLocalUrl: string | null;
    // M3-B — the real failback drain signal + DR-enabled flag.
    failbackEligible: boolean;
    drEnabled: boolean;
    nasProbeReachable: boolean | null;
  };
  cloud: {
    cloudReachable: boolean | null;
    reachableSinceMs: number | null;
  };
}

const state: MockState = {
  cart: {items: []},
  settings: {settings: {connectionMode: 'relay'}},
  txn: {
    activeScreen: 'Dashboard',
    saleInFlight: false,
    settlementOrPrintInFlight: false,
    accountWriteInFlight: false,
  },
  dr: {
    routingDirective: 'cloud',
    cacheStatus: 'pending',
    certTrust: 'unknown',
    cachedLocalUrl: null,
    failbackEligible: false,
    drEnabled: false,
    nasProbeReachable: null,
  },
  cloud: {cloudReachable: null, reachableSinceMs: null},
};

jest.mock('../../stores/cartStore', () => ({
  useCartStore: (sel: (s: MockState['cart']) => unknown) => sel(state.cart),
}));
jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: MockState['settings']) => unknown) =>
    sel(state.settings),
}));
jest.mock('../../stores/transactionActivityStore', () => ({
  useTransactionActivityStore: (sel: (s: MockState['txn']) => unknown) =>
    sel(state.txn),
}));
jest.mock('../../stores/drStore', () => ({
  useDrStore: (sel: (s: MockState['dr']) => unknown) => sel(state.dr),
}));
jest.mock('../../stores/cloudReachabilityStore', () => ({
  useCloudReachabilityStore: (sel: (s: MockState['cloud']) => unknown) =>
    sel(state.cloud),
}));

import {useRoutingDecision} from '../useRoutingDecision';
import {FAILBACK_HYSTERESIS_MS} from '../../services/routingDecisionService';

function reset(): void {
  state.cart = {items: []};
  state.settings = {settings: {connectionMode: 'relay'}};
  state.txn = {
    activeScreen: 'Dashboard',
    saleInFlight: false,
    settlementOrPrintInFlight: false,
    accountWriteInFlight: false,
  };
  state.dr = {
    routingDirective: 'cloud',
    cacheStatus: 'pending',
    certTrust: 'unknown',
    cachedLocalUrl: null,
    failbackEligible: false,
    drEnabled: false,
    nasProbeReachable: null,
  };
  state.cloud = {cloudReachable: null, reachableSinceMs: null};
}

beforeEach(reset);

describe('useRoutingDecision — selector mappings (M-R4)', () => {
  it('maps cart length → mid-transaction defer (rule 1)', () => {
    state.cart = {items: [{}, {}]};
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.deferred).toBe(true);
    expect(result.current.reason).toBe('mid-transaction-defer');
  });

  it('maps a cached+ok NAS target → nasAvailable true', () => {
    state.dr.cachedLocalUrl = 'https://aeris.shop.local';
    state.dr.cacheStatus = 'ok';
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.nasAvailable).toBe(true);
  });

  it('maps connectionMode=direct → currentMode local', () => {
    state.settings.settings.connectionMode = 'direct';
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.currentMode).toBe('local');
  });
});

describe('useRoutingDecision — transitions (M-R4)', () => {
  it('cloudReachable=false (relay) → operating mode offline + outage prompt when NAS usable', () => {
    state.cloud.cloudReachable = false;
    state.dr.cachedLocalUrl = 'https://aeris.shop.local';
    state.dr.cacheStatus = 'ok';
    state.dr.certTrust = 'unverified';
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.currentMode).toBe('offline');
    expect(result.current.promptFailover).toBe(true);
    expect(result.current.reason).toBe('outage-prompt');
  });

  it('local mode + cloud back + sustained window → recommends failback to cloud', () => {
    state.settings.settings.connectionMode = 'direct'; // operating local
    state.cloud.cloudReachable = true;
    state.cloud.reachableSinceMs = Date.now() - (FAILBACK_HYSTERESIS_MS + 5_000);
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.currentMode).toBe('local');
    expect(result.current.mode).toBe('cloud');
    expect(result.current.reason).toBe('failback-ready');
  });
});

// M3-B — the REAL drain signal: useRoutingDecision must source the cascade's
// reconcileQueueDrained from drStore.failbackEligible (gated by drEnabled), NOT
// the Wave-1 hardcoded `true`. These prove the selector wiring of the drain
// signal end-to-end through the hook.
describe('useRoutingDecision — M3-B real drain signal', () => {
  function sustainedLocalCloudBack(): void {
    state.settings.settings.connectionMode = 'direct'; // operating local
    state.cloud.cloudReachable = true;
    state.cloud.reachableSinceMs = Date.now() - (FAILBACK_HYSTERESIS_MS + 5_000);
  }

  it('DR enabled + failbackEligible=false → HOLDS local (never failback mid-drain)', () => {
    sustainedLocalCloudBack();
    state.dr.drEnabled = true;
    state.dr.failbackEligible = false; // outbox draining / open conflict
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.reason).toBe('failback-hold');
    expect(result.current.mode).toBe('local');
  });

  it('DR enabled + failbackEligible=true → failback-ready (drain complete)', () => {
    sustainedLocalCloudBack();
    state.dr.drEnabled = true;
    state.dr.failbackEligible = true; // server says drained, no open conflicts
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.reason).toBe('failback-ready');
    expect(result.current.mode).toBe('cloud');
  });

  it('DR NOT served (drEnabled=false) → M1 behaviour: hysteresis alone (failback-ready)', () => {
    // No DR surface / pre-seam deployment: there is no NAS outbox, so the
    // hardcoded-drained M1 behaviour stands (failbackEligible is ignored).
    sustainedLocalCloudBack();
    state.dr.drEnabled = false;
    state.dr.failbackEligible = false;
    const {result} = renderHook(() => useRoutingDecision());
    expect(result.current.reason).toBe('failback-ready');
  });
});
