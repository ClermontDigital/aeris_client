// Storage mocks — productCacheStore.syncProducts persists to BulkStorage
// (which goes through expo-secure-store + AsyncStorage under the hood) once
// the pagination walk completes.
const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(mockSecureStore[key] || null),
  ),
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
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockAsyncStorage[key] || null),
    ),
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

// ApiClient mock — controllable per test. listProducts is the one we care
// about for the dedupe assertion; getCategories just needs to resolve.
const mockListProducts = jest.fn();
const mockGetCategories = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    listProducts: (...args: unknown[]) => mockListProducts(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
  },
}));

import {useProductCacheStore} from '../productCacheStore';

function resetStore() {
  useProductCacheStore.setState({
    products: [],
    categories: [],
    lastSynced: null,
    isSyncing: false,
    lastSyncError: null,
    syncInFlight: null,
  });
}

describe('productCacheStore.syncProducts in-flight dedupe', () => {
  beforeEach(() => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
    mockListProducts.mockReset();
    mockGetCategories.mockReset();
    resetStore();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('two concurrent syncProducts() calls share a single underlying page-1 fetch', async () => {
    // Hold page 1 until we've fired the second call. Without dedupe, the
    // second caller would also enter the while-loop and queue its own
    // listProducts(1, 50). With dedupe, it should await the in-flight
    // promise and never call listProducts itself.
    let resolvePage1: ((v: unknown) => void) | undefined;
    const page1Gate = new Promise(resolve => {
      resolvePage1 = resolve;
    });

    mockListProducts.mockImplementation(async (page: number) => {
      if (page === 1) {
        await page1Gate;
        return {
          data: [
            {
              id: 1,
              name: 'Widget',
              sku: 'WID-1',
              barcode: null,
              price_cents: 1000,
              tax_rate: 10,
              stock_on_hand: 5,
              category_id: null,
              category_name: null,
              image_url: null,
              is_active: true,
            },
          ],
          meta: {last_page: 1},
        };
      }
      return {data: [], meta: {last_page: 1}};
    });
    mockGetCategories.mockResolvedValue([]);

    // Fire two concurrent callers (simulating ItemsScreen mount-time effect
    // and QuickSale pull-to-refresh racing).
    const p1 = useProductCacheStore.getState().syncProducts();
    const p2 = useProductCacheStore.getState().syncProducts();

    // Both callers got a Promise (signature preserved).
    expect(p1).toBeInstanceOf(Promise);
    expect(p2).toBeInstanceOf(Promise);

    // Let microtasks settle so the second call has a chance to enter
    // syncProducts and observe the in-flight promise.
    await Promise.resolve();
    await Promise.resolve();

    // Only the first caller's listProducts(1, 50) should be queued; the
    // second caller must have short-circuited on syncInFlight.
    expect(mockListProducts).toHaveBeenCalledTimes(1);
    expect(mockListProducts).toHaveBeenNthCalledWith(1, 1, 50);

    // Release page 1 and let both promises settle.
    resolvePage1!(undefined);
    await Promise.all([p1, p2]);

    // Still exactly one page-1 fetch across both callers.
    expect(mockListProducts).toHaveBeenCalledTimes(1);
    expect(useProductCacheStore.getState().products).toHaveLength(1);
    expect(useProductCacheStore.getState().isSyncing).toBe(false);
  });

  test('after the in-flight promise resolves, a subsequent call starts a fresh sync', async () => {
    mockListProducts.mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Widget',
          sku: 'WID-1',
          barcode: null,
          price_cents: 1000,
          tax_rate: 10,
          stock_on_hand: 5,
          category_id: null,
          category_name: null,
          image_url: null,
          is_active: true,
        },
      ],
      meta: {last_page: 1},
    });
    mockGetCategories.mockResolvedValue([]);

    // First two callers share one fetch.
    const p1 = useProductCacheStore.getState().syncProducts();
    const p2 = useProductCacheStore.getState().syncProducts();
    await Promise.all([p1, p2]);
    expect(mockListProducts).toHaveBeenCalledTimes(1);
    expect(useProductCacheStore.getState().syncInFlight).toBeNull();

    // Third call (after the previous sync resolved) should kick off a fresh
    // pagination walk — call count must go up, not stay at 1.
    await useProductCacheStore.getState().syncProducts();
    expect(mockListProducts).toHaveBeenCalledTimes(2);
  });
});
