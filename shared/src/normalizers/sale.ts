import type {Sale, SaleDetail, SaleItem, SalePayment} from '../types/api.types';
import {asNumber, asString, pickCents} from './shared';

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
  // customer_id comes from `raw.customer_id` (flat column) or the nested
  // `customer.id` when the server emits the relation object. Null on
  // walk-in sales so the type stays honest.
  const customerId =
    typeof raw.customer_id === 'number'
      ? (raw.customer_id as number)
      : customer && typeof customer.id === 'number'
      ? (customer.id as number)
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
    customer_id: customerId,
    customer_name: customerName,
    created_at: asString(raw.created_at),
  };
}

function normalizeSaleItem(input: unknown): SaleItem {
  const raw = (input || {}) as Record<string, unknown>;
  // Aeris2's SaleResource emits the nested `product` relation rather
  // than flat product_name/sku columns; fall through to product.{name,sku}
  // so detail screens don't render blank rows. Unit price uses the
  // server's `price` (dollars) when the cents mirror isn't present.
  const product = (raw.product || {}) as Record<string, unknown>;
  return {
    // SaleItemResource emits `id` as the sale_items.id PK; we need it for
    // per-item refunds. Falls through to `sale_item_id` for resources that
    // alias the column, and to 0 when neither is present (legacy receipt
    // shapes) — the refund UI filters those out.
    id:
      typeof raw.id === 'number'
        ? raw.id
        : typeof raw.sale_item_id === 'number'
        ? raw.sale_item_id
        : 0,
    product_id: asNumber(raw.product_id),
    product_name:
      asString(raw.product_name) || asString(product.name),
    sku: asString(raw.sku) || asString(product.sku),
    quantity: asNumber(raw.quantity),
    unit_price_cents: pickCents(raw, 'unit_price_cents', 'unit_price', 'price'),
    line_total_cents: pickCents(raw, 'line_total_cents', 'line_total', 'total'),
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
