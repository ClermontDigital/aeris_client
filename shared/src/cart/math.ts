import type {CartItem} from '../types/api.types';

// unit_price_cents is GST-inclusive (Product.price_cents is inc-GST), so
// each line total is inc-GST. To match the server (SaleDetailScreen +
// ProcessSaleRequest), the cart exposes the same shape: subtotal is the
// ex-GST split, tax is the embedded GST, total = subtotal + tax - cart
// discount. Computing tax as (lineTotalInc - subtotal) mirrors the
// server's single-round `tax = totalInc - round(totalInc/1.1)` exactly,
// so subtotal + tax === lineTotalInc with no per-line drift.
export function getSubtotalCents(items: CartItem[]): number {
  const subtotalFloat = items.reduce((sum, item) => {
    const lineInc =
      item.unit_price_cents * item.quantity - item.discount_cents;
    const rate = item.product.tax_rate;
    if (!rate || !Number.isFinite(rate)) return sum + lineInc;
    return sum + lineInc / (1 + rate / 100);
  }, 0);
  return Math.round(subtotalFloat);
}

export function getLineTotalIncCents(items: CartItem[]): number {
  return items.reduce(
    (sum, item) =>
      sum + item.unit_price_cents * item.quantity - item.discount_cents,
    0,
  );
}

export function getTaxCents(items: CartItem[]): number {
  return getLineTotalIncCents(items) - getSubtotalCents(items);
}

export function getTotalCents(items: CartItem[], discountCents: number): number {
  return getLineTotalIncCents(items) - discountCents;
}

// Discount is taken off the inc-GST grand total (subtotal_ex + tax = line
// total inc), so the cap is the sum of the line totals before discount.
// Clamping there floors the final total at $0.
export function clampDiscountCents(items: CartItem[], cents: number): number {
  const safeMax = Math.max(0, getLineTotalIncCents(items));
  const numeric = Number.isFinite(cents) ? cents : 0;
  return Math.max(0, Math.min(numeric, safeMax));
}

export function getItemCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
