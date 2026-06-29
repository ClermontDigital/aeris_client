// Mock storage the same way settingsStore.test does (StorageService →
// BulkStorage → AsyncStorage + SecureStore for the enc key).
const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore[key] || null)),
  deleteItemAsync: jest.fn((key: string) => {
    delete mockSecureStore[key];
    return Promise.resolve();
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

const mockAsyncStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn((key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(mockAsyncStorage[key] || null)),
    removeItem: jest.fn((key: string) => {
      delete mockAsyncStorage[key];
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      keys.forEach(k => delete mockAsyncStorage[k]);
      return Promise.resolve();
    }),
  },
}));

import {useDrStore} from '../drStore';
import {useSettingsStore} from '../settingsStore';

describe('drStore — validate-on-cache (§15-M1)', () => {
  beforeEach(() => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
    useDrStore.setState({
      cachedLocalUrl: null,
      pairedWorkspaceCode: null,
      routingDirective: 'cloud',
      lastLocalUrlReportedAt: null,
      cacheStatus: 'pending',
      certTrust: 'unknown',
      lastSyncAt: null,
      isLoading: false,
    });
    useSettingsStore.setState(s => ({
      settings: {...s.settings, workspaceCode: 'shop-one'},
    }));
  });

  function mockProbe(result: boolean) {
    return jest
      .spyOn(useSettingsStore.getState(), 'testConnection')
      .mockResolvedValue(result);
  }

  it('caches a valid https LAN url after a successful probe', async () => {
    mockProbe(true);
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://192.168.1.50:8822'}, 'shop-one');
    const s = useDrStore.getState();
    expect(s.cachedLocalUrl).toBe('https://192.168.1.50:8822');
    expect(s.cacheStatus).toBe('ok');
    expect(s.pairedWorkspaceCode).toBe('shop-one');
    // Pinning not implemented yet → unverified, not trusted (§22.5 Q7 TODO).
    expect(s.certTrust).toBe('unverified');
  });

  it('rejects an unsafe (loopback) url without touching last-known-good', async () => {
    mockProbe(true);
    // Seed a prior good value.
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://192.168.1.50:8822'}, 'shop-one');
    // Now a poisoned localhost self-report arrives.
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://localhost:8822'}, 'shop-one');
    const s = useDrStore.getState();
    expect(s.cacheStatus).toBe('unsafe');
    // Last-known-good is preserved.
    expect(s.cachedLocalUrl).toBe('https://192.168.1.50:8822');
  });

  it('does not commit when the LAN probe fails', async () => {
    const probe = mockProbe(false);
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://192.168.1.50:8822'}, 'shop-one');
    expect(probe).toHaveBeenCalledWith('https://192.168.1.50:8822');
    const s = useDrStore.getState();
    expect(s.cacheStatus).toBe('unreachable');
    expect(s.cachedLocalUrl).toBeNull();
  });

  it('NEVER clears a cached value when local_url is absent (§15-B2)', async () => {
    mockProbe(true);
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://192.168.1.50:8822'}, 'shop-one');
    // A later heartbeat omits local_url entirely.
    await useDrStore.getState().ingestServedPayload({}, 'shop-one');
    const s = useDrStore.getState();
    expect(s.cachedLocalUrl).toBe('https://192.168.1.50:8822');
  });

  it('flushes the cache on re-pair to a different workspace (§15-E1)', async () => {
    mockProbe(true);
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://192.168.1.50:8822'}, 'shop-one');
    // Roam to a different shop — the served payload now carries shop-two.
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://10.0.5.5:8822'}, 'shop-two');
    const s = useDrStore.getState();
    // The shop-one NAS must not survive the re-pair; only shop-two's cached.
    expect(s.cachedLocalUrl).toBe('https://10.0.5.5:8822');
    expect(s.pairedWorkspaceCode).toBe('shop-two');
  });

  it('applies the §19.1 routing directive', async () => {
    mockProbe(true);
    await useDrStore
      .getState()
      .ingestServedPayload(
        {partner_local_url: 'https://192.168.1.50:8822', routing_target: 'local'},
        'shop-one',
      );
    expect(useDrStore.getState().routingDirective).toBe('local');
  });

  it('masks the cached address for the detail sheet', async () => {
    mockProbe(true);
    await useDrStore
      .getState()
      .ingestServedPayload({partner_local_url: 'https://aeris.local:8822'}, 'shop-one');
    const masked = useDrStore.getState().getMaskedLocalUrl();
    expect(masked).not.toBeNull();
    expect(masked).not.toContain('aeris.local');
    expect(masked).toContain('https:');
  });
});
