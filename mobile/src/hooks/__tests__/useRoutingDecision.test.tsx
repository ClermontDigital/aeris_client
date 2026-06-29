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
