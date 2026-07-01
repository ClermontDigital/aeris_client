export {RELAY_ACTIONS} from '@aeris/shared';

export const API_ENDPOINTS = {
  AUTH_LOGIN: '/api/v1/auth/login',
  AUTH_LOGOUT: '/api/v1/auth/logout',
  AUTH_USER: '/api/v1/auth/user',
  POS_PRODUCTS: '/api/v1/pos/products',
  POS_DAILY_SUMMARY: '/api/v1/pos/daily-summary',
  POS_PAYMENT_METHODS: '/api/v1/pos/payment-methods',
  POS_SALES: '/api/v1/pos/sales',
  PRODUCTS_SEARCH: '/api/v1/products/search',
  PRODUCTS_BARCODE: '/api/v1/products/barcode',
  PRODUCTS_CATEGORIES: '/api/v1/products/categories',
  // Aeris2's suppliers list (routes/api.php:97 → ProductController::getSuppliers).
  // DirectClient talks straight to the deployment, so this always works when
  // available; the relay path (RelayClient.getSuppliers) swallows NOT_FOUND
  // when the marketplace dispatcher hasn't wired the action yet.
  PRODUCTS_SUPPLIERS: '/api/v1/products/suppliers',
  SALES_LIST: '/api/v1/sales',
  CUSTOMERS_LIST: '/api/v1/customers',
  CUSTOMERS_SEARCH: '/api/v1/customers/search',
  // Write surface — CustomerController / ProductController / InventoryController.
  // Parameterised URLs are exposed as functions below.
  CUSTOMERS: '/api/v1/customers',
  PRODUCTS: '/api/v1/products',
  INVENTORY_ADJUST_STOCK: '/api/v1/inventory/adjust-stock',
} as const;

// Parameterised endpoint builders. Kept separate from the const map so the
// map stays a simple string lookup table for grep-ability.
export const CUSTOMER_BY_ID = (id: number | string): string =>
  `/api/v1/customers/${encodeURIComponent(String(id))}`;

export const PRODUCT_BY_ID = (id: number | string): string =>
  `/api/v1/products/${encodeURIComponent(String(id))}`;
