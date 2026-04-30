import {create} from 'zustand';
import ApiClient from '../services/ApiClient';
import {BulkStorage} from '../services/StorageService';
import type {Product, Category} from '../types/api.types';

const PRODUCT_CACHE_KEY = 'aeris_product_cache';
const CATEGORY_CACHE_KEY = 'aeris_category_cache';
const CACHE_TIMESTAMP_KEY = 'aeris_cache_timestamp';

interface ProductCacheState {
  products: Product[];
  categories: Category[];
  lastSynced: string | null;
  isSyncing: boolean;

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

  syncProducts: async () => {
    set({isSyncing: true});
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

      // Persist to encrypted AsyncStorage
      await BulkStorage.setItem(PRODUCT_CACHE_KEY, allProducts);
      await BulkStorage.setItem(CATEGORY_CACHE_KEY, categories);
      await BulkStorage.setItem(CACHE_TIMESTAMP_KEY, timestamp);

      set({
        products: allProducts,
        categories,
        lastSynced: timestamp,
        isSyncing: false,
      });
    } catch {
      set({isSyncing: false});
    }
  },

  restoreCache: async () => {
    try {
      const products =
        await BulkStorage.getItem<Product[]>(PRODUCT_CACHE_KEY);
      const categories =
        await BulkStorage.getItem<Category[]>(CATEGORY_CACHE_KEY);
      const timestamp =
        await BulkStorage.getItem<string>(CACHE_TIMESTAMP_KEY);

      if (products && categories) {
        set({products, categories, lastSynced: timestamp});
      }
    } catch {
      // Cache restoration is best-effort
    }
  },

  searchLocal: (query: string) => {
    const q = query.toLowerCase();
    return get().products.filter(
      p =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q)),
    );
  },

  getByBarcode: (barcode: string) => {
    return get().products.find(p => p.barcode === barcode) || null;
  },

  getByCategory: (categoryId: number) => {
    return get().products.filter(p => p.category_id === categoryId);
  },
}));
