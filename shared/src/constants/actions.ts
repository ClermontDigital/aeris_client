export const RELAY_ACTIONS = {
  AUTH_LOGIN: 'auth.login',
  AUTH_BIOMETRIC: 'auth.biometric',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REFRESH: 'auth.refresh',
  DASHBOARD_SUMMARY: 'dashboard.summary',
  PRODUCTS_LIST: 'products.list',
  PRODUCTS_SEARCH: 'products.search',
  PRODUCTS_BARCODE: 'products.barcode',
  PRODUCTS_DETAIL: 'products.detail',
  PRODUCTS_CATEGORIES: 'products.categories',
  POS_PAYMENT_METHODS: 'pos.payment-methods',
  SALE_CREATE: 'sale.create',
  TRANSACTIONS_LIST: 'transactions.list',
  TRANSACTIONS_DETAIL: 'transactions.detail',
  TRANSACTIONS_RECEIPT: 'transactions.receipt',
  CUSTOMERS_LIST: 'customers.list',
  CUSTOMERS_SEARCH: 'customers.search',
  CUSTOMERS_DETAIL: 'customers.detail',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_UPDATE: 'customers.update',
  CUSTOMERS_DELETE: 'customers.delete',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  INVENTORY_STOCK: 'inventory.stock',
  INVENTORY_ADJUST_STOCK: 'inventory.adjust-stock',
  SALES_DAILY_SUMMARY: 'sales.daily-summary',
  SALES_INVOICE_PDF_URL: 'sales.invoice-pdf-url',
  SALES_REFUND: 'sales.refund',
  // M3-0 (DR NAS warm-failover): route-proxied, auth:sanctum action served by
  // the Aeris2 deployment exposing its cached DR routing state to its already
  // authenticated clients (option B — keeps the deployed gateway code
  // untouched, respects the §15 local_url boundary). A flag-off / non-DR
  // deployment has no `dr` relay_service_config (or the route is unregistered)
  // and the call comes back as a deployment-404 / NOT_FOUND envelope — clients
  // MUST treat that as "no DR routing available" and fall back to the M2 manual
  // path, never error (RelayClient.getDrRouting returns null for that case).
  DR_ROUTING: 'dr.routing',
  // M3 (DR NAS warm-failover): route-proxied, auth:sanctum presence beat. The
  // client POSTs {device_id, mode} over the relay; the Aeris2 deployment (which
  // holds the tenant API key the gateway's deployment-scoped /dr/presence beacon
  // requires) forwards it under its own tenant key so the deployment's live
  // dr_presence count is real. Best-effort, fire-and-forget: a flag-off / non-DR
  // deployment has no `dr` relay_service_config (deployment-404 / NOT_FOUND
  // envelope) — clients treat ANY non-2xx as a silent no-op.
  DR_PRESENCE: 'dr.presence',
} as const;
