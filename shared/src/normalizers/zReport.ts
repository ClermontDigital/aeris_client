import type {DailyZReport} from '../types/api.types';
import {asNumber, asString} from './shared';

// payment_method_breakdown values are sums of payments[].amount (dollars);
// scale to cents so screens never deal in floating-point money.
function toCentsMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.round(v * 100);
    } else if (typeof v === 'string' && v.trim() !== '') {
      const parsed = parseFloat(v);
      if (Number.isFinite(parsed)) out[k] = Math.round(parsed * 100);
    }
  }
  return out;
}

// sales_by_staff / hourly_breakdown / sales_by_status are integer sale counts
// from groupBy(...)->map->count() — pass through as ints, never scale.
function toCountMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = asNumber(v, 0);
  }
  return out;
}

// SalesAPIController::dailySummary emits dollar-shaped scalar totals plus
// per-method dollar sums and per-staff/hour/status integer counts. Money
// fields are scaled to cents at the boundary; counts are passed through as is.
export function normalizeZReport(input: unknown): DailyZReport {
  const raw = (input || {}) as Record<string, unknown>;
  const totalRevenue = asNumber(raw.total_revenue, 0);
  const totalGst = asNumber(raw.total_gst, 0);
  const totalDiscount = asNumber(raw.total_discount, 0);
  const avgSale = asNumber(raw.average_sale_value, 0);
  return {
    date: asString(raw.date),
    user_id:
      raw.user_id === null || raw.user_id === undefined
        ? null
        : asNumber(raw.user_id),
    total_sales: asNumber(raw.total_sales, 0),
    completed_sales: asNumber(raw.completed_sales, 0),
    pending_sales: asNumber(raw.pending_sales, 0),
    total_revenue_cents: Math.round(totalRevenue * 100),
    total_gst_cents: Math.round(totalGst * 100),
    total_discount_cents: Math.round(totalDiscount * 100),
    unique_customers: asNumber(raw.unique_customers, 0),
    total_items_sold: asNumber(raw.total_items_sold, 0),
    average_sale_cents: Math.round(avgSale * 100),
    payment_method_breakdown: toCentsMap(raw.payment_method_breakdown),
    sales_by_staff: toCountMap(raw.sales_by_staff),
    hourly_breakdown: toCountMap(raw.hourly_breakdown),
    sales_by_status: toCountMap(raw.sales_by_status),
  };
}
