import type {Address, Customer} from '../types/api.types';
import {
  asNumber,
  asString,
  pickCentsOrNull,
  pickIntOrNull,
  pickStringOrNull,
  unwrapList,
} from './shared';
import {normalizeSale} from './sale';

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
// detail endpoint returned. The normalizer flattens to a single shape so
// screens don't need to know the wire details.
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
