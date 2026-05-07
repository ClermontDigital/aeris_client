import type {ReceiptData} from '../types/api.types';
import {
  asNumber,
  findCents,
  formatCentsString,
  pickString,
  unwrapList,
} from './shared';

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
