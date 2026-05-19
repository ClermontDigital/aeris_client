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

import {BulkStorage} from '../../services/StorageService';
import {useProductCacheStore} from '../productCacheStore';

const PRODUCT_CACHE_KEY = 'aeris_product_cache';
const CATEGORY_CACHE_KEY = 'aeris_category_cache';
const CACHE_TIMESTAMP_KEY = 'aeris_cache_timestamp';
const CACHE_VERSION_KEY = 'aeris_product_cache_version';
const CACHE_SCHEMA_VERSION = 1;

function resetStore() {
  useProductCacheStore.setState({
    products: [],
    categories: [],
    lastSynced: null,
    isSyncing: false,
    lastSyncError: null,
  });
}

async function seedRaw(products: unknown, categories: unknown, version: unknown = CACHE_SCHEMA_VERSION) {
  await BulkStorage.setItem(PRODUCT_CACHE_KEY, products);
  await BulkStorage.setItem(CATEGORY_CACHE_KEY, categories);
  await BulkStorage.setItem(CACHE_TIMESTAMP_KEY, '2026-01-01T00:00:00.000Z');
  await BulkStorage.setItem(CACHE_VERSION_KEY, version);
}

describe('productCacheStore stale-shape resilience', () => {
  beforeEach(() => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
    resetStore();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a) drops a product missing `name` but keeps the valid one; searchLocal does not throw', async () => {
    const goodProduct = {
      id: 1, name: 'Widget', sku: 'WID-1', barcode: null,
      price_cents: 1000, tax_rate: 10, stock_on_hand: 5,
      category_id: null, category_name: null, image_url: null, is_active: true,
    };
    const badProduct = {
      id: 2, /* no name */ sku: 'BAD-1', barcode: null,
      price_cents: 500, tax_rate: 10, stock_on_hand: 1,
      category_id: null, category_name: null, image_url: null, is_active: true,
    };
    const goodCategory = {id: 10, name: 'Widgets'};

    await seedRaw([goodProduct, badProduct], [goodCategory]);

    await useProductCacheStore.getState().restoreCache();

    const state = useProductCacheStore.getState();
    expect(state.products).toHaveLength(1);
    expect(state.products[0].id).toBe(1);

    // searchLocal must not throw on the valid set
    expect(() => useProductCacheStore.getState().searchLocal('wid')).not.toThrow();
    expect(useProductCacheStore.getState().searchLocal('wid').map(p => p.id)).toEqual([1]);
  });

  test('b) treats cache as poisoned when >50% of products are malformed; wipes storage', async () => {
    const valid = {
      id: 1, name: 'Widget', sku: 'WID-1', barcode: null,
      price_cents: 1000, tax_rate: 10, stock_on_hand: 5,
      category_id: null, category_name: null, image_url: null, is_active: true,
    };
    // Three bad rows (no name) + one valid = 75% drop → poisoned threshold.
    const bad = {id: 99, sku: 'X', price_cents: 0};
    await seedRaw([bad, bad, bad, valid], [{id: 1, name: 'cat'}]);

    await useProductCacheStore.getState().restoreCache();

    const state = useProductCacheStore.getState();
    expect(state.products).toEqual([]);
    expect(state.categories).toEqual([]);

    // Cache wiped — keys should be gone.
    expect(await BulkStorage.getItem(PRODUCT_CACHE_KEY)).toBeNull();
    expect(await BulkStorage.getItem(CATEGORY_CACHE_KEY)).toBeNull();
    expect(await BulkStorage.getItem(CACHE_TIMESTAMP_KEY)).toBeNull();
    expect(await BulkStorage.getItem(CACHE_VERSION_KEY)).toBeNull();
  });

  test('c) wipes the cache when stored schema version is older (0)', async () => {
    const valid = {
      id: 1, name: 'Widget', sku: 'WID-1', barcode: null,
      price_cents: 1000, tax_rate: 10, stock_on_hand: 5,
      category_id: null, category_name: null, image_url: null, is_active: true,
    };
    await seedRaw([valid], [{id: 1, name: 'cat'}], 0);

    await useProductCacheStore.getState().restoreCache();

    const state = useProductCacheStore.getState();
    expect(state.products).toEqual([]);
    expect(state.categories).toEqual([]);

    // All cache keys wiped.
    expect(await BulkStorage.getItem(PRODUCT_CACHE_KEY)).toBeNull();
    expect(await BulkStorage.getItem(CATEGORY_CACHE_KEY)).toBeNull();
    expect(await BulkStorage.getItem(CACHE_TIMESTAMP_KEY)).toBeNull();
    expect(await BulkStorage.getItem(CACHE_VERSION_KEY)).toBeNull();
  });

  test('d) searchLocal is null-safe when an in-memory product lacks name/sku (regression guard)', () => {
    // Skip restoreCache entirely; inject a malformed product directly to simulate
    // a server-returned row that bypassed validation via syncProducts.
    useProductCacheStore.setState({
      products: [
        {id: 1, name: undefined as unknown as string, sku: undefined as unknown as string} as any,
      ],
    });

    expect(() => useProductCacheStore.getState().searchLocal('anything')).not.toThrow();
    expect(useProductCacheStore.getState().searchLocal('anything')).toEqual([]);
    expect(useProductCacheStore.getState().searchLocal('')).toHaveLength(1);
    // getByBarcode + getByCategory must also be null-safe.
    expect(() => useProductCacheStore.getState().getByBarcode('123')).not.toThrow();
    expect(useProductCacheStore.getState().getByBarcode('123')).toBeNull();
    expect(() => useProductCacheStore.getState().getByCategory(5)).not.toThrow();
  });
});
