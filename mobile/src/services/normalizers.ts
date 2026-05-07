import type {
  Address,
  Customer,
  PaginatedResponse,
  Product,
  ProductDetail,
  ProductVariant,
  ReceiptData,
  Sale,
  SaleDetail,
  SaleItem,
  SalePayment,
} from '../types/api.types';

// Aeris2's controllers wrap single-resource responses in `{data: {...}}` via
// Laravel's API Resource convention. The relay envelope unwraps to expose
// that body verbatim, so mobile sees `{data: {...}}` instead of the bare
// resource. Detail screens that read `raw.id`/`raw.name`/etc. would render
// empty fields without this. Lists are not affected — paginated bodies are
// `{data: [...], meta}` and the call sites already index into `.data`.
export function unwrapResource<T = unknown>(result: unknown): T {
  if (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'data' in result
  ) {
    const inner = (result as {data: unknown}).data;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as T;
    }
  }
  return result as T;
}

// Aeris2's controllers wrap list responses in `{data: [...]}` (Laravel
// convention). The relay envelope unwrap propagates the body as-is when no
// inner status is present, so mobile sees the wrapper. Unwrap defensively —
// accept either bare arrays (future / direct controllers) or the wrapper.
export function unwrapList<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'data' in result) {
    const data = (result as {data: unknown}).data;
    if (Array.isArray(data)) return data as T[];
  }
  return [];
}

export function emptyPage<T>(page: number, perPage: number): PaginatedResponse<T> {
  return {
    data: [],
    meta: {current_page: page, last_page: 1, per_page: perPage, total: 0},
  };
}

function formatCentsString(c: number | undefined): string {
  if (c === undefined || !Number.isFinite(c)) return '';
  return '$' + (c / 100).toFixed(2);
}

function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

function pickStringOrNull(
  source: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

function pickIntOrNull(
  source: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = parseInt(v, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

// Aeris2 may emit either dollars (`total_amount`) or cents (`total_cents`);
// prefer cents when present, else the first present-and-valid dollar key.
// Variadic dollarKeys: the previous shape used `pickCents(...) || pickCents(...)`
// chains at call sites which treated a legitimate $0 (refund / promo line) as
// "missing" and fell through to a wrong key. First-valid-wins preserves zero.
//
// pickCents defaults missing to 0; pickCentsOrNull defaults missing to null
// (used for permission-gated fields like cost_cents where absent ≠ free).
// Both delegate to findCents so the parsing logic stays in one place.
export function findCents(
  source: Record<string, unknown>,
  centsKey: string,
  ...dollarKeys: string[]
): number | undefined {
  const cents = source[centsKey];
  if (typeof cents === 'number' && Number.isFinite(cents)) {
    return Math.round(cents);
  }
  if (typeof cents === 'string' && cents.trim() !== '') {
    const parsed = parseFloat(cents);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  for (const key of dollarKeys) {
    const dollars = source[key];
    if (typeof dollars === 'number' && Number.isFinite(dollars)) {
      return Math.round(dollars * 100);
    }
    if (typeof dollars === 'string' && dollars.trim() !== '') {
      const parsed = parseFloat(dollars);
      if (Number.isFinite(parsed)) return Math.round(parsed * 100);
    }
  }
  return undefined;
}

function pickCents(
  source: Record<string, unknown>,
  centsKey: string,
  ...dollarKeys: string[]
): number {
  return findCents(source, centsKey, ...dollarKeys) ?? 0;
}

function pickCentsOrNull(
  source: Record<string, unknown>,
  centsKey: string,
  ...dollarKeys: string[]
): number | null {
  return findCents(source, centsKey, ...dollarKeys) ?? null;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// Receipt shape from Aeris2 has varied across deployments — controllers
// sometimes return pre-formatted display strings (`subtotal: "$10.00"`),
// other times return raw cents (`subtotal_cents: 1000`), and the business
// info is sometimes nested under `{business: {name, address}}`. This
// normalizer accepts every shape we've seen and falls back to numeric
// formatting so the screen always renders something readable. Empty
// strings on missing fields keep `.map()` calls crash-free even on
// partial server responses. Accepts `line_items` and nested `sale.items`
// as alternate items keys.
export function normalizeReceipt(input: unknown): ReceiptData {
  const raw = (input || {}) as Record<string, unknown>;
  // Some deployments wrap the actual receipt under a top-level `sale` or
  // `receipt` key. Drill in once if we see a familiar nested shape.
  const inner =
    raw.receipt && typeof raw.receipt === 'object'
      ? (raw.receipt as Record<string, unknown>)
      : raw.sale && typeof raw.sale === 'object'
      ? (raw.sale as Record<string, unknown>)
      : raw;

  const business = (inner.business && typeof inner.business === 'object'
    ? (inner.business as Record<string, unknown>)
    : null);

  const itemsSource =
    inner.items ??
    inner.line_items ??
    inner.products ??
    [];
  const items = unwrapList<unknown>(itemsSource).map(it => {
    const i = (it || {}) as Record<string, unknown>;
    const unitCents = findCents(i, 'unit_price_cents', 'unit_price', 'price');
    const lineCents = findCents(
      i,
      'line_total_cents',
      'line_total',
      'total',
      'price',
    );
    return {
      name: pickString(i, 'name', 'product_name', 'description', 'sku'),
      quantity: asNumber(i.quantity ?? i.qty, 0),
      unit_price:
        pickString(i, 'unit_price', 'unit_price_formatted', 'price_formatted') ||
        formatCentsString(unitCents),
      line_total:
        pickString(
          i,
          'line_total',
          'line_total_formatted',
          'total',
          'total_formatted',
        ) || formatCentsString(lineCents),
    };
  });

  const paymentsSource = inner.payments ?? inner.payment_methods ?? [];
  const payments = unwrapList<unknown>(paymentsSource).map(p => {
    const pp = (p || {}) as Record<string, unknown>;
    const amtCents = findCents(pp, 'amount_cents', 'amount');
    return {
      method: pickString(pp, 'method', 'payment_method', 'type', 'name'),
      amount:
        pickString(pp, 'amount', 'amount_formatted') ||
        formatCentsString(amtCents),
    };
  });

  // Aeris2 sometimes nests money fields under `totals: {...}`. Drill into
  // that wrapper if present and use it as a secondary source after the
  // top-level inner object — the top level wins when both are populated.
  const totalsObj = (inner.totals && typeof inner.totals === 'object'
    ? (inner.totals as Record<string, unknown>)
    : null);
  const findCentsAcross = (
    centsKey: string,
    ...dollarKeys: string[]
  ): number | undefined => {
    const a = findCents(inner, centsKey, ...dollarKeys);
    if (a !== undefined) return a;
    return totalsObj
      ? findCents(totalsObj, centsKey, ...dollarKeys)
      : undefined;
  };
  const subtotalCents = findCentsAcross(
    'subtotal_cents',
    'subtotal',
    'subtotal_amount',
  );
  const taxCents = findCentsAcross('tax_cents', 'tax', 'tax_amount');
  const totalCents = findCentsAcross('total_cents', 'total', 'total_amount');

  return {
    sale_number: pickString(inner, 'sale_number', 'number', 'reference', 'id'),
    business_name:
      pickString(inner, 'business_name') ||
      (business ? pickString(business, 'name', 'display_name') : ''),
    business_address:
      pickString(inner, 'business_address') ||
      (business ? pickString(business, 'address', 'address_line') : ''),
    items,
    subtotal:
      pickString(inner, 'subtotal', 'subtotal_formatted') ||
      (totalsObj
        ? pickString(totalsObj, 'subtotal', 'subtotal_formatted')
        : '') ||
      formatCentsString(subtotalCents),
    tax:
      pickString(inner, 'tax', 'tax_formatted', 'tax_amount_formatted') ||
      (totalsObj
        ? pickString(totalsObj, 'tax', 'tax_formatted', 'tax_amount_formatted')
        : '') ||
      formatCentsString(taxCents),
    total:
      pickString(inner, 'total', 'total_formatted') ||
      (totalsObj ? pickString(totalsObj, 'total', 'total_formatted') : '') ||
      formatCentsString(totalCents),
    payments,
    date: pickString(inner, 'date', 'created_at', 'completed_at', 'timestamp'),
    served_by:
      pickString(inner, 'served_by', 'cashier_name', 'staff_name') || null,
  };
}

export function normalizeSale(input: unknown): Sale {
  const raw = (input || {}) as Record<string, unknown>;
  const customer = raw.customer as Record<string, unknown> | undefined;
  const items =
    (Array.isArray(raw.items) && (raw.items as unknown[])) ||
    (Array.isArray(raw.line_items) && (raw.line_items as unknown[])) ||
    (Array.isArray(raw.sale_items) && (raw.sale_items as unknown[])) ||
    (Array.isArray(raw.lineItems) && (raw.lineItems as unknown[])) ||
    [];
  const customerName =
    typeof raw.customer_name === 'string'
      ? raw.customer_name
      : customer && typeof customer.name === 'string'
      ? (customer.name as string)
      : null;
  const status = (raw.status ?? raw.sale_status) as Sale['status'] | undefined;
  const itemsCount =
    typeof raw.items_count === 'number'
      ? raw.items_count
      : typeof raw.total_quantity === 'number'
      ? raw.total_quantity
      : items.length;
  return {
    id: asNumber(raw.id),
    sale_number: asString(raw.sale_number),
    total_cents: pickCents(raw, 'total_cents', 'total_amount'),
    tax_cents: pickCents(raw, 'tax_cents', 'tax_amount'),
    subtotal_cents: pickCents(raw, 'subtotal_cents', 'subtotal'),
    discount_cents: pickCents(raw, 'discount_cents', 'discount_amount'),
    status: (status as Sale['status']) ?? 'completed',
    items_count: itemsCount,
    customer_name: customerName,
    created_at: asString(raw.created_at),
  };
}

function normalizeSaleItem(input: unknown): SaleItem {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    product_id: asNumber(raw.product_id),
    product_name: asString(raw.product_name),
    sku: asString(raw.sku),
    quantity: asNumber(raw.quantity),
    unit_price_cents: pickCents(raw, 'unit_price_cents', 'unit_price'),
    line_total_cents: pickCents(raw, 'line_total_cents', 'line_total', 'total', 'price'),
    discount_cents: pickCents(raw, 'discount_cents', 'discount_amount'),
  };
}

function normalizeSalePayment(input: unknown): SalePayment {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    method: asString(raw.method),
    amount_cents: pickCents(raw, 'amount_cents', 'amount'),
    reference: typeof raw.reference === 'string' ? raw.reference : null,
  };
}

export function normalizeSaleDetail(input: unknown): SaleDetail {
  const base = normalizeSale(input);
  const raw = (input || {}) as Record<string, unknown>;
  // Aeris2 has emitted line items under several keys depending on the
  // resource shape (`items`, `line_items`, `sale_items`, occasionally
  // `lineItems`). Receipt normalization already tries the same set; mirror
  // it here so SaleDetail doesn't show an empty items list when the server
  // happens to use one of the alternates.
  const itemsRaw =
    (Array.isArray(raw.items) && raw.items) ||
    (Array.isArray(raw.line_items) && raw.line_items) ||
    (Array.isArray(raw.sale_items) && raw.sale_items) ||
    (Array.isArray(raw.lineItems) && raw.lineItems) ||
    [];
  const items = (itemsRaw as unknown[]).map(normalizeSaleItem);
  const paymentsRaw =
    (Array.isArray(raw.payments) && raw.payments) ||
    (Array.isArray(raw.payment_methods) && raw.payment_methods) ||
    [];
  const payments = (paymentsRaw as unknown[]).map(normalizeSalePayment);
  const customer = (raw.customer ?? null) as SaleDetail['customer'];
  return {
    ...base,
    items,
    payments,
    customer,
  };
}

export function normalizeProductVariant(input: unknown): ProductVariant {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    id: asNumber(raw.id),
    name: asString(raw.name),
    sku: asString(raw.sku),
    price_cents: pickCents(raw, 'price_cents', 'price'),
    stock_on_hand: asNumber(raw.stock_on_hand ?? raw.stock_quantity, 0),
  };
}

export function normalizeProduct(input: unknown): Product {
  const raw = (input || {}) as Record<string, unknown>;
  const category = (raw.category && typeof raw.category === 'object'
    ? (raw.category as Record<string, unknown>)
    : null);
  const categoryId =
    raw.category_id !== undefined && raw.category_id !== null
      ? asNumber(raw.category_id)
      : category && category.id !== undefined && category.id !== null
      ? asNumber(category.id)
      : null;
  const categoryName =
    typeof raw.category_name === 'string'
      ? raw.category_name
      : category && typeof category.name === 'string'
      ? (category.name as string)
      : null;
  // is_active defaults to true so unknown-shape items remain sellable.
  const isActive =
    raw.is_active === undefined ? true : Boolean(raw.is_active);
  return {
    id: asNumber(raw.id),
    name: asString(raw.name),
    sku: asString(raw.sku),
    barcode: typeof raw.barcode === 'string' ? raw.barcode : null,
    price_cents: pickCents(raw, 'price_cents', 'price'),
    tax_rate: asNumber(raw.tax_rate, 0),
    stock_on_hand: asNumber(raw.stock_on_hand ?? raw.stock_quantity, 0),
    category_id: categoryId,
    category_name: categoryName,
    image_url: typeof raw.image_url === 'string' ? raw.image_url : null,
    is_active: isActive,
  };
}

export function normalizeProductDetail(input: unknown): ProductDetail {
  const base = normalizeProduct(input);
  const raw = (input || {}) as Record<string, unknown>;
  const variants = Array.isArray(raw.variants)
    ? (raw.variants as unknown[]).map(normalizeProductVariant)
    : [];
  // Pass stock_levels through when the deployment provides them.
  // Dropping to [] silently broke multi-location stock UI that surfaces
  // this field on ProductDetail.
  const stockLevels = Array.isArray(raw.stock_levels)
    ? (raw.stock_levels as ProductDetail['stock_levels'])
    : [];
  return {
    ...base,
    description: typeof raw.description === 'string' ? raw.description : null,
    cost_cents: pickCentsOrNull(raw, 'cost_cents', 'cost_price'),
    stock_levels: stockLevels,
    variants,
  };
}

export function normalizeAddress(input: unknown): Address {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    id: raw.id !== undefined && raw.id !== null ? asNumber(raw.id) : null,
    label: pickStringOrNull(raw, 'label', 'type', 'name'),
    line_1: asString(
      raw.line_1 ?? raw.line1 ?? raw.address_line_1 ?? raw.street ?? '',
    ),
    line_2: pickStringOrNull(raw, 'line_2', 'line2', 'address_line_2'),
    city: asString(raw.city ?? raw.locality ?? ''),
    state: pickStringOrNull(raw, 'state', 'region', 'province'),
    postcode: asString(raw.postcode ?? raw.postal_code ?? raw.zip ?? ''),
    country: pickStringOrNull(raw, 'country', 'country_code'),
  };
}

// Aeris2's CustomerResource emits first_name/last_name + email/phone +
// account-balance fields, plus the richer fields surfaced once the
// detail endpoint returned. Mobile flattens to a single shape so screens
// don't need to know the wire details.
export function normalizeCustomer(input: unknown): Customer {
  const raw = (input || {}) as Record<string, unknown>;
  const firstName = pickStringOrNull(raw, 'first_name');
  const lastName = pickStringOrNull(raw, 'last_name');
  const fullName =
    typeof raw.name === 'string' && raw.name.trim() !== ''
      ? raw.name
      : [firstName, lastName].filter(Boolean).join(' ').trim();

  const recentSalesSource = (raw.recent_sales ?? raw.sales ?? []) as unknown;
  const recent_sales = unwrapList<unknown>(recentSalesSource).map(normalizeSale);

  const addressesSourceRaw = (raw.addresses ?? []) as unknown;
  const addressList = unwrapList<unknown>(addressesSourceRaw);
  const addresses = addressList.map(normalizeAddress);

  // default_address resolution priority:
  //   1. explicit `default_address` field on the wire
  //   2. an address in the list with is_default / default = true
  //   3. the first address in the list (if any)
  let default_address: Address | null = null;
  if (raw.default_address && typeof raw.default_address === 'object') {
    default_address = normalizeAddress(raw.default_address);
  } else if (addressList.length > 0) {
    const flaggedIdx = addressList.findIndex(a => {
      const ar = (a || {}) as Record<string, unknown>;
      return ar.is_default === true || ar.default === true;
    });
    default_address = addresses[flaggedIdx >= 0 ? flaggedIdx : 0];
  }

  return {
    id: asNumber(raw.id),
    name: fullName,
    first_name: firstName,
    last_name: lastName,
    company: pickStringOrNull(raw, 'company', 'company_name', 'business_name'),
    email: typeof raw.email === 'string' ? raw.email : null,
    phone: typeof raw.phone === 'string' ? raw.phone : null,
    mobile: pickStringOrNull(raw, 'mobile', 'mobile_phone', 'cell'),
    customer_number: pickStringOrNull(raw, 'customer_number', 'account_number'),
    account_balance_cents: pickCentsOrNull(
      raw,
      'account_balance_cents',
      'account_balance',
    ),
    payment_terms: pickStringOrNull(raw, 'payment_terms', 'terms'),
    credit_limit_cents: pickCentsOrNull(raw, 'credit_limit_cents', 'credit_limit'),
    loyalty_points: pickIntOrNull(raw, 'loyalty_points', 'points'),
    total_orders: pickIntOrNull(raw, 'total_orders', 'orders_count', 'sales_count'),
    total_spent_cents: pickCentsOrNull(
      raw,
      'total_spent_cents',
      'total_spent',
      'lifetime_value',
    ),
    last_purchase_date: pickStringOrNull(
      raw,
      'last_purchase_date',
      'last_sale_at',
      'last_order_at',
    ),
    recent_sales,
    addresses,
    default_address,
    notes: pickStringOrNull(raw, 'notes'),
    created_at: pickStringOrNull(raw, 'created_at'),
  };
}
