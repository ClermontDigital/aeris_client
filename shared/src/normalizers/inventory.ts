import type {StockAdjustment} from '../types/api.types';
import {asNumber, asString} from './shared';

// InventoryController::adjustStock returns plain {data: {...}} — no
// dollar/cents fields, so normalisation is a thin shape coercion.
export function normalizeStockAdjustment(input: unknown): StockAdjustment {
  const raw = (input || {}) as Record<string, unknown>;
  return {
    product_id: asNumber(raw.product_id),
    previous_quantity: asNumber(raw.previous_quantity),
    new_quantity: asNumber(raw.new_quantity),
    adjustment: asNumber(raw.adjustment),
    reason: asString(raw.reason),
  };
}
