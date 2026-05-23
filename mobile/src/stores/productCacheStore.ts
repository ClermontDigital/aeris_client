import {create} from 'zustand';
import ApiClient from '../services/ApiClient';
import {BulkStorage} from '../services/StorageService';
import type {Product, Category} from '../types/api.types';

// Shape-validating read for persisted cache slots. Resolves to null on
// absence/mismatch/error rather than throwing, so a stale payload after
// weeks idle can't poison restoreCache.
async function readWithSchema<T>(
  key: string,
  validate: (v: unknown) => v is T,
): Promise<T | null> {
  let raw: unknown;
  try {
    raw = await BulkStorage.getItem<unknown>(key);
  } catch {
    return null;
  }
  if (raw === null || raw === undefined) return null;
  try {
    return validate(raw) ? raw : null;
  } catch {
    return null;
  }
}

const PRODUCT_CACHE_KEY = 'aeris_product_cache';
const CATEGORY_CACHE_KEY = 'aeris_category_cache';
const CACHE_TIMESTAMP_KEY = 'aeris_cache_timestamp';
const CACHE_VERSION_KEY = 'aeris_product_cache_version';

// Bump this when the Product/Category shape evolves in a way that would
// break older persisted payloads. A mismatch on cold start wipes the cache
// and forces a fresh syncProducts — safer than parsing pre-shape rows that
// lack name/sku and crash deep in render code.
const CACHE_SCHEMA_VERSION = 1;

// If more than half of the restored entries are malformed, treat the cache
// as poisoned rather than partially-recoverable. Sub-50% drift suggests
// transient drift we can survive by dropping individual rows; >50% suggests
// a schema break that we shouldn't paper over.
const POISONED_THRESHOLD = 0.5;

function isProduct(v: unknown): v is Product {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'number' &&
    typeof p.name === 'string' &&
    typeof p.sku === 'string'
  );
}

function isCategory(v: unknown): v is Category {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c.id === 'number' && typeof c.name === 'string';
}

async function wipeCache(): Promise<void> {
  await BulkStorage.removeItem(PRODUCT_CACHE_KEY);
  await BulkStorage.removeItem(CATEGORY_CACHE_KEY);
  await BulkStorage.removeItem(CACHE_TIMESTAMP_KEY);
  await BulkStorage.removeItem(CACHE_VERSION_KEY);
}

interface ProductCacheState {
  products: Product[];
  categories: Category[];
  lastSynced: string | null;
  isSyncing: boolean;
  lastSyncError: string | null;
  // In-flight syncProducts() promise. Mirrors the refreshInFlight pattern in
  // authStore — concurrent callers (ItemsScreen mount effect + QuickSale
  // pull-to-refresh) share one underlying pagination walk instead of each
  // kicking off their own N-page fetch in parallel.
  syncInFlight: Promise<void> | null;

  syncProducts: () => Promise<void>;
  restoreCache: () => Promise<void>;
  searchLocal: (query: string) => Product[];
  getByBarcode: (barcode: string) => Product | null;
  getByCategory: (categoryId: number) => Product[];
}

export const useProductCacheStore = create<ProductCacheState>((set, get) => ({
  products: [],
  categories: [],
  lastSynced: null,
  isSyncing: false,
  lastSyncError: null,
  syncInFlight: null,

  // Dedupes concurrent syncs. ItemsScreen's mount-time refresh (v1.3.23+)
  // and QuickSaleScreen's pull-to-refresh can both fire while the catalog
  // is paginating. Without this, each caller would walk every page in
  // parallel — 2×N redundant requests. Now they share one promise; once it
  // settles, syncInFlight is nulled so the next call starts a fresh sync.
  syncProducts: async () => {
    const existing = get().syncInFlight;
    if (existing) {
      // Caller awaits the in-flight promise rather than firing a second
      // pagination walk. Swallow errors here — the original initiator
      // already recorded lastSyncError on failure.
      await existing.catch(() => {});
      return;
    }

    const run = async (): Promise<void> => {
      set({isSyncing: true, lastSyncError: null});
      try {
        // Fetch all POS products (paginated — fetch all pages)
        let allProducts: Product[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const result = await ApiClient.listProducts(page, 50);
          allProducts = [...allProducts, ...result.data];
          hasMore = page < result.meta.last_page;
          page++;
        }

        const categories = await ApiClient.getCategories();
        const timestamp = new Date().toISOString();

        // Persist to encrypted AsyncStorage. Always stamp the version so a
        // future restoreCache can decide whether the rows are compatible.
        await BulkStorage.setItem(PRODUCT_CACHE_KEY, allProducts);
        await BulkStorage.setItem(CATEGORY_CACHE_KEY, categories);
        await BulkStorage.setItem(CACHE_TIMESTAMP_KEY, timestamp);
        await BulkStorage.setItem(CACHE_VERSION_KEY, CACHE_SCHEMA_VERSION);

        set({
          products: allProducts,
          categories,
          lastSynced: timestamp,
          isSyncing: false,
          lastSyncError: null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Catalog sync failed';
        console.warn('productCacheStore.syncProducts failed:', msg);
        set({isSyncing: false, lastSyncError: msg});
      }
    };

    const promise = run();
    set({syncInFlight: promise});
    try {
      await promise;
    } finally {
      // Null out so a later call (e.g. user pulls-to-refresh again 10min
      // later) kicks off a fresh sync rather than no-oping on the resolved
      // promise.
      set({syncInFlight: null});
    }
  },

  restoreCache: async () => {
    try {
      // Schema-version gate. Anything older than the current version, or
      // missing entirely, is dropped wholesale — re-sync will fill the cache
      // with rows in the current shape.
      const version = await readWithSchema<number>(
        CACHE_VERSION_KEY,
        (v): v is number => typeof v === 'number',
      );
      if (version !== CACHE_SCHEMA_VERSION) {
        await wipeCache();
        return;
      }

      const rawProducts = await readWithSchema<unknown[]>(
        PRODUCT_CACHE_KEY,
        (v): v is unknown[] => Array.isArray(v),
      );
      const rawCategories = await readWithSchema<unknown[]>(
        CATEGORY_CACHE_KEY,
        (v): v is unknown[] => Array.isArray(v),
      );
      const timestamp = await readWithSchema<string>(
        CACHE_TIMESTAMP_KEY,
        (v): v is string => typeof v === 'string',
      );

      if (!rawProducts || !rawCategories) {
        return;
      }

      const products = rawProducts.filter(isProduct);
      const categories = rawCategories.filter(isCategory);

      const productDropRate =
        rawProducts.length === 0 ? 0 : 1 - products.length / rawProducts.length;
      const categoryDropRate =
        rawCategories.length === 0
          ? 0
          : 1 - categories.length / rawCategories.length;

      if (
        productDropRate > POISONED_THRESHOLD ||
        categoryDropRate > POISONED_THRESHOLD
      ) {
        console.warn(
          `productCacheStore.restoreCache: cache poisoned (products drop=${productDropRate.toFixed(2)}, categories drop=${categoryDropRate.toFixed(2)}); wiping`,
        );
        await wipeCache();
        return;
      }

      set({products, categories, lastSynced: timestamp});
    } catch {
      // Cache restoration is best-effort
    }
  },

  searchLocal: (query: string) => {
    const q = query.toLowerCase();
    return get().products.filter(p => {
      // Defensive: even with restoreCache validated, syncProducts persists
      // whatever the server returns. A malformed row would otherwise crash
      // on p.name.toLowerCase() and take the search screen down.
      const name = ((p?.name ?? '') as string).toLowerCase();
      const sku = ((p?.sku ?? '') as string).toLowerCase();
      return (
        name.includes(q) ||
        sku.includes(q) ||
        (typeof p?.barcode === 'string' && p.barcode.includes(q))
      );
    });
  },

  getByBarcode: (barcode: string) => {
    return (
      get().products.find(
        p => typeof p?.barcode === 'string' && p.barcode === barcode,
      ) || null
    );
  },

  getByCategory: (categoryId: number) => {
    return get().products.filter(p => p?.category_id === categoryId);
  },
}));
