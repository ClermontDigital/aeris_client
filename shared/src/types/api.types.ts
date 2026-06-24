export type ConnectionMode = 'direct' | 'relay';

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
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
  location_id: number | null;
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
  is_active: boolean;
}

export interface ProductDetail extends Product {
  description: string | null;
  cost_cents: number | null;
  stock_levels: StockLevel[];
  variants: ProductVariant[];
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
