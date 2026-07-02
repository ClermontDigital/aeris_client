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
  // Suppliers list — the mobile item-edit "supplier" picker feeds off this.
  // Aeris2 exposes GET /api/v1/products/suppliers (see routes/api.php:97).
  // Marketplace dispatcher may not route this yet — RelayClient.getSuppliers
  // returns [] on 404 / not_found so the picker gracefully degrades to
  // "supplier selection unavailable" until the gateway ships the mapping.
  PRODUCTS_SUPPLIERS: 'products.suppliers',
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
  // Repairs — deployment team wired the 9 actions on this branch (marketplace
  // gateway dispatcher entries pending). Workspace-level flag
  // `workspace.features.repairs_enabled` gates the whole surface client-side;
  // when the gateway hasn't shipped the dispatcher mapping yet these all come
  // back as NOT_FOUND envelopes, so RelayClient tolerates the miss.
  REPAIRS_LIST: 'repairs.list',
  REPAIRS_DETAIL: 'repairs.detail',
  REPAIRS_CREATE: 'repairs.create',
  REPAIRS_UPDATE: 'repairs.update',
  REPAIRS_UPDATE_STATUS: 'repairs.update-status',
  REPAIRS_ADD_ITEM: 'repairs.add-item',
  REPAIRS_UPDATE_ITEM: 'repairs.update-item',
  REPAIRS_REMOVE_ITEM: 'repairs.remove-item',
  REPAIRS_BULK_STATUS: 'repairs.bulk-status',
  // Status-history is a read-only slice served by the deployment's
  // /api/v1/repairs/{id}/status-history endpoint. Marketplace dispatcher
  // wiring pending — RelayClient tolerates NOT_FOUND by returning [].
  REPAIRS_STATUS_HISTORY: 'repairs.status-history',
  // Destroy — DELETE /api/v1/repairs/{id}. RepairController::destroy returns
  // 204 which the dispatcher converts to {data: null}; RelayClient.deleteRepair
  // therefore does NOT call assertWritePersisted (mirrors deleteCustomer).
  REPAIRS_DELETE: 'repairs.delete',
  // POS-scoped pending-repairs-for-customer picker. Uses the POS endpoint
  // /api/v1/pos/customers/{id}/pending-repairs (sale_id IS NULL guard). This
  // action is deployment-team-owned; dispatcher entry pending, so
  // RelayClient.getPendingRepairsForCustomer swallows NOT_FOUND and returns [].
  REPAIRS_PENDING_FOR_CUSTOMER: 'repairs.pending-for-customer',
  // WSA workshop-workflow additions — deployment team confirmed these are
  // ability-gated + location-scoped on the server. Dispatcher wiring is
  // rolling out; where the mapping is still pending the RelayClient
  // read-methods fall back to `null` / `[]` so the mobile UI degrades
  // gracefully (WSA-1 scanner falls back to listRepairs({search}) when
  // by-barcode isn't routed yet, technician picker hides when the list
  // returns []).
  REPAIRS_BY_BARCODE: 'repairs.by-barcode',
  REPAIRS_TECHNICIANS: 'repairs.technicians',
  // Notes are a distinct action from status-change: server appends a
  // status_history row where from_status === to_status (see the web
  // Show.tsx timeline model), so `addRepairNote` returns a full
  // RepairStatusHistory entry rather than a RepairDetail refresh.
  // Client validates note length <= 2000 before wiring so a paste of a
  // giant blob short-circuits before it hits the network.
  REPAIRS_ADD_NOTE: 'repairs.add-note',
  // WSA-4 — manual customer notification for a repair. Server routes
  // this through the existing multi-channel notification stack with the
  // `repair_status` template, ability-gated on `send-manual-notification`
  // and location-scoped. Marketplace dispatcher whitelist confirmation is
  // owned by the deployment team; while pending the client will surface
  // the server error (401/403/NOT_FOUND) directly through the Notify
  // customer flow rather than swallowing it — the operator needs to know
  // the notification didn't go out.
  REPAIRS_NOTIFY: 'repairs.notify',
} as const;
