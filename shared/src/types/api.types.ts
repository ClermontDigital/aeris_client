export type ConnectionMode = 'direct' | 'relay';

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
  // Optional workspace/deployment context surfaced by AuthController::login
  // (Aeris2) and mirrored on the marketplace login response. Fields inside are
  // additive per-deployment feature flags. Missing / partial envelopes MUST
  // coerce to defaults at the boundary (see workspaceFeaturesStore hydration).
  workspace?: WorkspaceContext;
}

// Per-deployment feature flags surfaced at login and refreshed on every
// refreshToken. Missing fields MUST coerce to `false` client-side — a
// deployment that hasn't shipped the payload yet gets the safe default.
export interface WorkspaceContext {
  features?: {
    // Enables the Repairs tab + entry points + repairs.* RPC surface. Off by
    // default at every consumer so pure-retail deployments never see the tab.
    repairs_enabled?: boolean;
  };
}

export interface RelayEnvelope<T = unknown> {
  correlation_id: string;
  action: string;
  status: 'ok' | 'success' | 'error' | 'timeout';
  data?: T;
  error?: { code: string; message: string };
  duration_ms?: number;
}

export interface BiometricCredential {
  device_id: string;
  challenge: string;
  signature: string;
}

export interface StockSnapshot {
  product_id: number;
  on_hand: number;
  committed: number;
  available: number;
  levels: StockLevel[];
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  // The Aeris2 UserResource sends the assigned deployment site NESTED as
  // `location: {id, name, code}` (and only `whenLoaded`), NOT as a flat
  // `location_id`. Both shapes are declared here so a consumer can read
  // whichever the deployment actually surfaces; resolveUserLocationId()
  // below is the single source of truth for "which location is this user
  // assigned to". A deployment that eager-loads the relation populates
  // `location`; older/flat shapes may populate `location_id`. When neither
  // is present the user has no resolvable location (repairs create blocks).
  location_id?: number | null;
  location?: {id: number; name?: string | null; code?: string | null} | null;
}

/**
 * Resolve the user's assigned location id from whichever shape the
 * deployment surfaced: flat `location_id` OR nested `location.id`. Returns
 * null when neither is present. Used by the repair-create flow, which the
 * server requires a location for.
 */
export function resolveUserLocationId(
  user: {location_id?: number | null; location?: {id?: number} | null} | null | undefined,
): number | null {
  if (!user) return null;
  if (typeof user.location_id === 'number') return user.location_id;
  if (user.location && typeof user.location.id === 'number') {
    return user.location.id;
  }
  return null;
}

export interface Product {
  id: number;
  name: string;
  sku: string;
  barcode: string | null;
  price_cents: number;
  tax_rate: number;
  stock_on_hand: number;
  category_id: number | null;
  category_name: string | null;
  // image_url is the deployment-resolved primary image: featured_image, else
  // the first gallery/images entry, else null (see Aeris2 Product::imageUrl
  // accessor). It's an opaque images.aeris.team read-proxy URL once the
  // product-photo feature is live; treat it as an opaque string.
  image_url: string | null;
  // Raw image columns surfaced by ProductResource. featured_image is the
  // single primary photo; gallery_images is an ordered list (max ~20). Both
  // hold opaque proxy URLs. Optional so older/normalized shapes stay valid.
  featured_image?: string | null;
  gallery_images?: string[];
  // Supplier the product belongs to. Optional because older deployments +
  // ProductResource variants that don't eager-load the relation omit it;
  // ProductEditScreen's supplier picker falls back to "None" when null.
  supplier_id?: number | null;
  // Unit of measure (Aeris2 Product.unit_type: 'each' | 'kg' | 'g' | 'l' | 'm'
  // | 'hour' | 'box' | 'pack' | 'roll'). Dictates whether the item is metered:
  // anything other than 'each' may be sold/entered fractionally. Optional so
  // pre-M4 deployments (which don't surface it) coerce to the safe 'each'
  // default at the normalizer.
  unit_type?: string | null;
  // Server-computed capability flag mirroring Aeris2's
  // Product::allowsDecimalQuantity() (true for every unit_type except 'each').
  // Prefer this over deriving from unit_type — it's the same flag the server's
  // ProcessSaleRequest enforces (a fractional qty on an `each` item is
  // rejected), so gating the client input on it keeps the two in lockstep.
  // Optional: absent on older deployments; callers fall back to unit_type.
  allows_decimal_quantity?: boolean | null;
  is_active: boolean;
}

export interface ProductDetail extends Product {
  description: string | null;
  cost_cents: number | null;
  stock_levels: StockLevel[];
  variants: ProductVariant[];
  // Server-side track_stock flag (Aeris2 Product::track_stock column).
  // Optional because older server versions may not surface it on the read
  // payload; ProductEdit falls back to a stock-derived heuristic when
  // undefined. When present, this is the source of truth.
  track_stock?: boolean;
}

/**
 * Whether a product may be sold/entered in fractional (metered) quantities —
 * e.g. 1.3 m of hose. Prefers the server-computed `allows_decimal_quantity`
 * flag (which the Aeris2 checkout validator enforces), falling back to the
 * unit_type ('each' = whole numbers only; any other unit = fractional). A
 * product with neither field (older deployment, or a hand-typed off-catalogue
 * part) is treated as whole-number-only, the safe default.
 */
export function productAllowsDecimalQuantity(
  product:
    | {allows_decimal_quantity?: boolean | null; unit_type?: string | null}
    | null
    | undefined,
): boolean {
  if (!product) return false;
  if (typeof product.allows_decimal_quantity === 'boolean') {
    return product.allows_decimal_quantity;
  }
  return (
    typeof product.unit_type === 'string' &&
    product.unit_type !== '' &&
    product.unit_type !== 'each'
  );
}

export interface StockLevel {
  location_id: number;
  location_name: string;
  on_hand: number;
  committed: number;
  available: number;
}

export interface ProductVariant {
  id: number;
  name: string;
  sku: string;
  price_cents: number;
  stock_on_hand: number;
}

export interface Category {
  id: number;
  name: string;
}

// Aeris2 exposes suppliers via ProductController::getSuppliers, which returns
// `{id, name}` where `name` is aliased from the Supplier model's
// `company_name` server-side (ProductController.php:643-651). Keeping the
// wire shape tight — id + name — avoids drift the peer review flagged when
// the client typed a `company_name` field the server never sends.
export interface Supplier {
  id: number;
  name: string;
}

export interface Sale {
  id: number;
  sale_number: string;
  total_cents: number;
  tax_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  status: 'completed' | 'refunded' | 'voided';
  items_count: number;
  // customer_id lets list screens (e.g. Dashboard's recent customers)
  // navigate to CustomerDetail directly without needing a second lookup
  // by name. Null on walk-in sales.
  customer_id: number | null;
  customer_name: string | null;
  created_at: string;
}

export interface SaleDetail extends Sale {
  items: SaleItem[];
  payments: SalePayment[];
  customer: Customer | null;
}

export interface SaleItem {
  // sale_items.id — the per-line PK required by sales.refund's `items[]`
  // payload (RefundParams.items[].sale_item_id). May be 0 on legacy data
  // shapes that don't include the row id; callers MUST filter those out
  // before submitting a per-items refund.
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  discount_cents: number;
}

export interface SalePayment {
  method: string;
  amount_cents: number;
  reference: string | null;
}

export interface Address {
  id: number | null;
  label: string | null;
  line_1: string;
  line_2: string | null;
  city: string;
  state: string | null;
  postcode: string;
  country: string | null;
}

export interface Customer {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  customer_number: string | null;
  account_balance_cents: number | null;
  payment_terms: string | null;
  credit_limit_cents: number | null;
  loyalty_points: number | null;
  total_orders: number | null;
  total_spent_cents: number | null;
  last_purchase_date: string | null;
  recent_sales: Sale[];
  addresses: Address[];
  default_address: Address | null;
  notes: string | null;
  created_at: string | null;
}

export interface DailySummary {
  date: string;
  sales_count: number;
  revenue_cents: number;
  items_sold: number;
  average_sale_cents: number;
  top_products: Array<{
    id: number;
    name: string;
    quantity: number;
    revenue_cents: number;
  }>;
}

export interface PaymentMethod {
  code: string;
  name: string;
  requires_reference: boolean;
}

export interface ReceiptData {
  sale_number: string;
  business_name: string;
  business_address: string;
  items: Array<{
    name: string;
    quantity: number;
    unit_price: string;
    line_total: string;
  }>;
  subtotal: string;
  tax: string;
  total: string;
  payments: Array<{ method: string; amount: string }>;
  date: string;
  served_by: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
}

// Exported input shape for `ApiClient.createSale` / `RelayClient.createSale`.
// Previously the shape was inlined on both client methods; T8 hoists it so a
// caller (CheckoutScreen, the repair-checkout flow) can name the type when
// threading a repair through. The clients still accept the inline object
// literal — this is purely additive.
//
// repair_id (top-level, sibling to customer_id): when set, the server links
// the resulting sale to the repair and flips the repair's status to
// 'completed' as a side-effect of the sale.create call. Threaded through
// Aeris2's ProcessSaleRequest per the T3 plan.
//
// CAVEAT (deployment sitrep): the repair-completion side-effect is silently
// skipped server-side if the repair is NOT in status 'ready' when the sale
// lands. The sale is still created — the repair just doesn't flip. The
// client MUST guard: re-fetch the repair right before submitting and block
// the checkout if status has drifted. Never trust the server to reject.
export interface SaleCreateItemInput {
  product_id: number;
  quantity: number;
  unit_price_cents: number;
  discount_cents?: number;
  // tax_rate is a percent integer (10 = 10% GST). Defaults to 10 when
  // undefined to match Aeris2 StoreProductRequest::prepareForValidation.
  tax_rate?: number;
}

export interface SaleCreatePaymentInput {
  method: string;
  amount_cents: number;
  reference?: string;
}

export interface SaleCreateInput {
  items: SaleCreateItemInput[];
  payments: SaleCreatePaymentInput[];
  customer_id?: number;
  discount_cents?: number;
  notes?: string;
  // Repair being cashed out. When present, the server (a) attaches
  // sale.repair_id and (b) flips the repair to 'completed' — but ONLY if the
  // repair is currently in status 'ready'. Non-ready repairs still create
  // the sale but the completion is silently skipped; the client must
  // pre-flight-guard status === 'ready' before submitting.
  repair_id?: number;
}

// Inputs for the customer create/update endpoints. Mirror StoreCustomerRequest
// validation rules — first_name OR company is required, every other field is
// optional. Cents are converted to dollars at the boundary by RelayClient.
export interface CustomerCreateInput {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  date_of_birth?: string | null;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null;
  customer_group?: 'retail' | 'wholesale' | 'vip' | 'trade' | null;
  abn?: string | null;
  payment_terms?: string | null;
  credit_limit_cents?: number | null;
  notes?: string | null;
  is_active?: boolean;
  // Address fields land on the customer_addresses table on save.
  address?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
}

// Update input is a partial of create — server is fine with any subset.
export type CustomerUpdateInput = Partial<CustomerCreateInput>;

// StoreProductRequest fields. base_price/cost_price travel as dollars (numeric)
// on the wire; the typed input keeps cents and converts at the boundary so
// callers never deal in float dollars. category_id is required server-side.
export interface ProductCreateInput {
  name: string;
  sku: string;
  category_id: number;
  base_price_cents: number;
  barcode?: string | null;
  description?: string | null;
  short_description?: string | null;
  cost_price_cents?: number | null;
  supplier_id?: number | null;
  unit_type?: string | null;
  gst_applicable?: boolean;
  gst_category?: string | null;
  track_stock?: boolean;
  stock_quantity?: number;
  reorder_level?: number | null;
  reorder_point?: number | null;
  reorder_quantity?: number | null;
  maximum_level?: number | null;
  location_id?: number | null;
  is_active?: boolean;
  tax_rate?: number | null;
  weight?: number | null;
  dimensions?: string | null;
  image_url?: string | null;
  notes?: string | null;
}

// All fields optional; sku is unique server-side so include only when changing.
export type ProductUpdateInput = Partial<ProductCreateInput>;

// adjustment is signed (negative for shrinkage). reason is a closed enum
// matching AdjustStockRequest's Rule::in() list.
export type StockAdjustmentReason =
  | 'count_correction'
  | 'damaged_goods'
  | 'expired_goods'
  | 'theft_loss'
  | 'found_stock'
  | 'supplier_error'
  | 'manual_adjustment'
  | 'return_to_stock'
  | 'other';

export interface StockAdjustmentInput {
  product_id: number;
  adjustment: number;
  reason: StockAdjustmentReason;
  notes?: string | null;
  location_id?: number | null;
}

// InventoryController::adjustStock returns {data: {product_id, previous_quantity,
// new_quantity, adjustment, reason}}. We expose those fields verbatim.
export interface StockAdjustment {
  product_id: number;
  previous_quantity: number;
  new_quantity: number;
  adjustment: number;
  reason: string;
}

// SalesAPIController::dailySummary returns the rich Z-report payload (vs the
// lighter DashboardSummary surface). Money fields come back in dollars.
export interface DailyZReport {
  date: string;
  user_id: number | null;
  total_sales: number;
  completed_sales: number;
  pending_sales: number;
  total_revenue_cents: number;
  total_gst_cents: number;
  total_discount_cents: number;
  unique_customers: number;
  total_items_sold: number;
  average_sale_cents: number;
  payment_method_breakdown: Record<string, number>; // method → cents (money)
  sales_by_staff: Record<string, number>; // staff name → count of completed sales
  hourly_breakdown: Record<string, number>; // hour ('00'..'23') → count of completed sales
  sales_by_status: Record<string, number>; // status → count of sales
}

// SalesAPIController::refund response. The `refund` row is a negative-amount
// payment record persisted to the sale's payments list; `sale` is the full
// SaleResource post-refund (status flips to `refunded` once fully refunded);
// `idempotent_replay` is true when a same-key + same-body retry returns the
// cached prior response instead of processing a fresh refund.
export interface Refund {
  id: number;
  sale_id: number;
  amount: number; // negative (dollars, e.g. -47.50)
  payment_method: string; // post-coercion (e.g. 'eftpos' for 'card')
  reference: string;
  processed_at: string; // ISO 8601
}

export interface RefundParams {
  // Required dispatcher alias; goes into the URL on direct mode.
  sale_id: number;
  // Decimal dollars (e.g. 47.50). Optional — omit when refunding by items
  // or for a full refund. If both `amount` and `items` are sent, server
  // ignores `amount` and computes the refund from `items`.
  amount?: number;
  // Per-item refund. Server aggregates duplicate sale_item_ids before
  // processing and rejects (422) any line that would push cumulative
  // refunded qty above the original sold qty.
  items?: Array<{sale_item_id: number; quantity: number}>;
  // Optional; server enforces <= 500 chars.
  reason?: string;
  // Default 'cash'. 'card' is coerced to 'eftpos' in the persisted row.
  // 'original_method' looks up the most recent positive payment on this
  // sale and reuses its method.
  refund_method?: 'cash' | 'card' | 'original_method';
  // REQUIRED. UUID minted client-side (use expo-crypto.randomUUID on the
  // mobile UI layer). Reuse on retry to avoid double-refund; mint a fresh
  // key whenever the user changes anything in the refund sheet.
  idempotency_key: string;
}

export interface RefundResponse {
  success: true;
  message: string;
  data: {
    refund: Refund;
    sale: SaleDetail;
    idempotent_replay: boolean;
  };
}

export interface RefundErrorResponse {
  success: false;
  message: string; // human-readable error string from server
}

// --- Product image upload (dedicated HTTPS transport, NOT relayRpc) ---

// Which slot the image lands in on the deployment. 'featured' replaces the
// single primary photo; 'gallery' appends. Defaults to 'featured' server-side.
export type ProductImageType = 'featured' | 'gallery';

// Gateway response to POST /api/v1/products/image/request-upload. The phone
// then PUTs the JPEG bytes DIRECTLY to `upload_url` with exactly the headers
// listed in `required_headers` (which pin Content-Length + Content-Type).
export interface ProductImageUploadGrant {
  upload_url: string;
  // Header name → value the phone MUST send verbatim on the R2 PUT. The
  // presign pins these (notably Content-Length); sending different values
  // fails the PUT.
  required_headers: Record<string, string>;
  grant_id: string;
  expires_at: string;
}

// Distinct error code the gateway returns when the resolved deployment does
// not expose the products.authorize-image / products.set-image relay actions
// (older Aeris2 without the feature). Mobile uses this to permanently hide the
// photo affordance for that deployment rather than surfacing a hard error.
export const PRODUCT_IMAGE_UNSUPPORTED_CODE = 'deployment-unsupported';

// Thrown by the upload transport so the picker UI can branch: `unsupported`
// hides the button; everything else is a normal retriable failure.
export interface ProductImageUploadErrorShape {
  message: string;
  // 'unsupported' = deployment lacks the actions (hide button);
  // 'no-workspace' = no workspace code configured (feature unavailable in
  // direct-only setups); 'too-large' = client size guard; 'failed' = generic.
  kind: 'unsupported' | 'no-workspace' | 'too-large' | 'failed';
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

// M3-0 — the EXACT `dr.routing` relay-action contract (option B, §1). Served by
// the Aeris2 deployment to its authenticated clients. A flag-off / non-DR
// deployment 404s this action; RelayClient.getDrRouting() maps that to null
// (clients fall back to the M2 manual path — never error). This shape is shared
// (mobile + Electron); additive and backward-compatible.
export interface DrRoutingPayload {
  // Master gate from the deployment's side. false ⇒ no DR surface for this
  // client (treat like a 404 — fall back to manual).
  dr_enabled: boolean;
  // The §19.1 routing directive (cloud=normal, local=operator cutover).
  routing_target: 'cloud' | 'local';
  // The DR partner NAS LAN address (validated server-side); null when none.
  partner_local_url: string | null;
  partner_local_url_reported_at: string | null;
  // Whether the deployment currently considers itself the active writer.
  active_writer: boolean;
  // M3-B (auto-failback, next agent) consumes these two. Persisted by drStore;
  // NOT acted on here.
  failback_eligible: boolean;
  sync_queue_depth: number;
  served_at: string;
}

// --- Repairs ---
//
// Wire-shape mirrors Aeris2 RepairResource + RepairItemResource. Money fields
// travel as DOLLAR FLOATS (matches ` (float) $this->estimated_cost` in the PHP
// resource), NOT cents — this diverges from Product/Sale on purpose. Every
// consumer converts at the boundary if it wants cents.
//
// The `workspace.features.repairs_enabled` flag on AuthResponse gates every
// entry point that produces or consumes these types; when off, the tab, the
// dashboard card, and the customer-detail section all hide, and repair.* RPC
// calls are expected to 403 with REPAIRS_DISABLED as belt-and-braces.

// Closed union — must stay in sync with Aeris2 App\Enums\RepairStatus. Server
// enforces valid transitions on update-status (422 on invalid).
export type RepairStatus =
  | 'pending'
  | 'diagnosed'
  | 'in_progress'
  | 'waiting_parts'
  | 'ready'
  | 'completed'
  | 'cancelled';

// Priority is a free string on the wire today (no server-side enum), but
// Aeris2 UIs use 'low' | 'normal' | 'high' | 'urgent'. `(string & {})` keeps
// the literals visible in autocomplete instead of the union collapsing to
// just `string`, while still permitting an unknown value the server may
// ship later — the normalizer coerces at the boundary.
export type RepairPriority =
  | 'low'
  | 'normal'
  | 'high'
  | 'urgent'
  | (string & {});

// Repair item type — 'part' consumes stock (server creates a StockReservation
// when product_id is set), 'labor' is a time-based line with no product FK.
export type RepairItemType = 'part' | 'labor';

// Per-item install/reservation state used server-side. Only relevant for
// 'part' items; 'labor' rows leave this at 'reserved'.
export type RepairItemStatus = 'reserved' | 'installed' | 'returned';

// The list-shape (repairs.list). Whether the customer / assignedTo relations
// are populated depends on the endpoint — normalizer flattens the nested
// shape when present, else uses the flat *_id column.
export interface Repair {
  id: number;
  repair_number: string;
  customer_id: number | null;
  customer_name: string | null;
  location_id: number | null;
  // Non-null once the repair has been checked out via sale.create + repair_id.
  // Callers use this to distinguish "ready for pickup" (null) from "already
  // taken payment" (non-null) — mirrors the server-side scopeReadyForCheckout.
  sale_id: number | null;
  created_by: number | null;
  assigned_to: number | null;
  assigned_to_name: string | null;
  // Device information (all optional per the server model).
  device_type: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  // Issue description is the SOURCE OF TRUTH from the fresh Aeris2 release; the
  // normalizer keeps a `reported_issue` fallback for older deployments still
  // running the pre-fix version.
  issue_description: string;
  diagnosis: string | null;
  notes: string | null;
  // Dollars, floats. Null when unset server-side.
  estimated_cost: number | null;
  final_cost: number | null;
  status: RepairStatus;
  priority: RepairPriority;
  // ISO 8601 strings. `received_at` = intake; `estimated_completion` = ETA the
  // cashier promised; `completed_at`/`picked_up_at` fill in when applicable.
  received_at: string | null;
  estimated_completion: string | null;
  completed_at: string | null;
  picked_up_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepairItem {
  id: number;
  repair_id: number;
  product_id: number | null;
  // Snapshot fields — the server records the name/sku at add time so an
  // in-progress repair's item list doesn't drift if the product is renamed.
  item_name: string;
  item_sku: string | null;
  item_type: RepairItemType;
  quantity: number;
  // Dollars, floats. line_total is server-computed on save — callers MUST
  // NOT send it in add-item / update-item payloads.
  unit_price: number;
  line_total: number;
  notes: string | null;
  status: RepairItemStatus;
  created_at: string;
  updated_at: string;
}

export interface RepairStatusHistory {
  id: number;
  from_status: RepairStatus | null;
  to_status: RepairStatus;
  notes: string | null;
  changed_at: string | null;
  // RepairResource embeds `{id, name}` for the acting user. Belt-and-braces:
  // even though the FK is restrict-on-delete, the normalizer null-safes this
  // because the deployment team flagged a null-user edge case in a prior bug.
  user: {
    id: number;
    name: string;
  };
}

// Full detail — RepairResource with items + statusHistory + customer nested.
// customer is a subset of Customer (id/name/email/phone) — the detail
// endpoint doesn't hydrate the full CustomerResource inside. Kept as a small
// inline shape rather than reusing Customer to reflect the actual wire.
export interface RepairDetail extends Repair {
  items: RepairItem[];
  status_history: RepairStatusHistory[];
  customer: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
}

// StoreRepairRequest mirror. customer_id + issue_description + location_id
// required; the rest optional. Costs travel as dollars (numeric) to match
// the wire.
//
// location_id is REQUIRED because the Aeris2 StoreRepairRequest declares
// `location_id => required|exists:locations,id`. Prior to H1 the client
// omitted this field and the server returned 422 on every Direct-mode
// create-repair. The client MUST source location_id from
// `authStore.user.location_id` (the cashier's assigned deployment site);
// there is no user-selectable location picker at the repair-edit surface.
// A user whose account has no location_id assigned CANNOT create a repair
// and must contact their administrator.
export interface RepairCreateInput {
  customer_id: number;
  issue_description: string;
  location_id: number;
  device_type?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  priority?: RepairPriority;
  estimated_cost?: number | null;
  estimated_completion?: string | null;
  assigned_to?: number | null;
}

// UpdateRepairRequest is a full-partial. customer_id is intentionally read-
// only after create — the server ignores it in the update payload, but
// keeping it out of the type surfaces that at compile time.
export type RepairUpdateInput = Partial<Omit<RepairCreateInput, 'customer_id'>>;

// The `pending-for-checkout` picker uses the POS-scoped endpoint
// (/api/v1/pos/customers/{id}/pending-repairs) rather than the generic
// repairs.list, because only the POS endpoint applies the sale_id IS NULL
// guard. Response shape is intentionally leaner than RepairResource — just
// enough for the picker to render a row + hand off to the cart.
export interface PendingRepair {
  id: number;
  repair_number: string;
  issue_description: string;
  device_type: string | null;
  brand: string | null;
  model: string | null;
  estimated_cost: number | null;
  final_cost: number | null;
  received_at: string | null;
}

// Distinct error code the gateway is expected to return when the resolved
// deployment has repairs_enabled=false but the client still calls a repairs.*
// action (stale flag / race). Follows the same `deployment-*` namespace as
// PRODUCT_IMAGE_UNSUPPORTED_CODE — the T3 RelayClient consumer will (a) flip
// the workspaceFeaturesStore off + toast once so the tab yanks itself, and
// (b) also accept the generic `deployment-unsupported` code as a synonym so
// a gateway that reuses the older namespace still triggers the same branch.
export const REPAIRS_DISABLED_CODE = 'deployment-repairs-disabled';
