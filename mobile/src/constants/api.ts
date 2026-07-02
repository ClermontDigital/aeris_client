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
  // --- Repairs ---
  // Root collection + bulk-status. Per-repair / per-item routes are exposed
  // as parameterised builders below (matching the CUSTOMER_BY_ID pattern) so
  // the map stays a pure string lookup.
  REPAIRS: '/api/v1/repairs',
  REPAIR_BULK_STATUS: '/api/v1/repairs/bulk-status',
} as const;

// Parameterised endpoint builders. Kept separate from the const map so the
// map stays a simple string lookup table for grep-ability.
export const CUSTOMER_BY_ID = (id: number | string): string =>
  `/api/v1/customers/${encodeURIComponent(String(id))}`;

export const PRODUCT_BY_ID = (id: number | string): string =>
  `/api/v1/products/${encodeURIComponent(String(id))}`;

// --- Repair builders ---
// Repair detail + status POST + status-history GET + items subresource.
// Every id is URL-encoded via encodeURIComponent(String(id)) to match the
// customer/product builders, even though repair ids are typed `number` at
// call sites — belt-and-braces against a typo pushing a string through.
export const REPAIR_BY_ID = (id: number | string): string =>
  `/api/v1/repairs/${encodeURIComponent(String(id))}`;

export const REPAIR_ITEMS = (id: number | string): string =>
  `/api/v1/repairs/${encodeURIComponent(String(id))}/items`;

export const REPAIR_ITEM_BY_ID = (
  id: number | string,
  itemId: number | string,
): string =>
  `/api/v1/repairs/${encodeURIComponent(String(id))}/items/${encodeURIComponent(String(itemId))}`;

export const REPAIR_STATUS = (id: number | string): string =>
  `/api/v1/repairs/${encodeURIComponent(String(id))}/status`;

export const REPAIR_STATUS_HISTORY = (id: number | string): string =>
  `/api/v1/repairs/${encodeURIComponent(String(id))}/status-history`;

// POS-scoped pending-repairs picker; the endpoint applies the sale_id IS NULL
// guard so it's the correct source for "which open repairs can I check out?".
export const POS_PENDING_REPAIRS_BY_CUSTOMER = (
  customerId: number | string,
): string =>
  `/api/v1/pos/customers/${encodeURIComponent(String(customerId))}/pending-repairs`;

// Re-export the constant here so DirectClient can import it via the same
// module surface it uses for the parameterised builders.
export const REPAIR_BULK_STATUS = '/api/v1/repairs/bulk-status';
