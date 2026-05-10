import {normalizeStockAdjustment, normalizeZReport} from '../normalizers';

describe('normalizeStockAdjustment', () => {
  it('coerces the controller wire shape verbatim', () => {
    const result = normalizeStockAdjustment({
      product_id: 5,
      previous_quantity: 10,
      new_quantity: 7,
      adjustment: -3,
      reason: 'damaged_goods',
    });
    expect(result).toEqual({
      product_id: 5,
      previous_quantity: 10,
      new_quantity: 7,
      adjustment: -3,
      reason: 'damaged_goods',
    });
  });

  it('falls back gracefully for missing fields', () => {
    const result = normalizeStockAdjustment({});
    expect(result.product_id).toBe(0);
    expect(result.previous_quantity).toBe(0);
    expect(result.new_quantity).toBe(0);
    expect(result.adjustment).toBe(0);
    expect(result.reason).toBe('');
  });
});

describe('normalizeZReport', () => {
  it('converts dollar totals to cents and keeps count maps as integers', () => {
    const report = normalizeZReport({
      date: '2026-05-08',
      user_id: 7,
      total_sales: 12,
      completed_sales: 10,
      pending_sales: 2,
      total_revenue: 1500.5,
      total_gst: 136.41,
      total_discount: 5,
      unique_customers: 4,
      total_items_sold: 22,
      average_sale_value: 150.05,
      payment_method_breakdown: {cash: '1000.50', card: 500},
      sales_by_staff: {Alice: 6, Bob: 4},
      hourly_breakdown: {'09': 2, '15': 8},
      sales_by_status: {completed: 10, pending: 2},
    });
    expect(report.total_revenue_cents).toBe(150050);
    expect(report.total_gst_cents).toBe(13641);
    expect(report.total_discount_cents).toBe(500);
    expect(report.average_sale_cents).toBe(15005);
    expect(report.payment_method_breakdown).toEqual({cash: 100050, card: 50000});
    expect(report.sales_by_staff).toEqual({Alice: 6, Bob: 4});
    expect(report.hourly_breakdown).toEqual({'09': 2, '15': 8});
  });

  it('returns empty maps and zeros for an empty controller payload', () => {
    const report = normalizeZReport({});
    expect(report.total_sales).toBe(0);
    expect(report.payment_method_breakdown).toEqual({});
    expect(report.sales_by_staff).toEqual({});
    expect(report.user_id).toBeNull();
  });
});
