import {normalizeSale, normalizeSaleDetail} from '../services/ApiClient';

describe('normalizeSale', () => {
  it('prefers _cents fields when present', () => {
    const sale = normalizeSale({
      id: 1,
      sale_number: 'S-1',
      total_cents: 1234,
      tax_cents: 123,
      subtotal_cents: 1100,
      discount_cents: 0,
      status: 'completed',
      items_count: 3,
      customer_name: 'Alice',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(sale.total_cents).toBe(1234);
    expect(sale.tax_cents).toBe(123);
    expect(sale.subtotal_cents).toBe(1100);
    expect(sale.discount_cents).toBe(0);
    expect(sale.customer_name).toBe('Alice');
    expect(sale.status).toBe('completed');
    expect(sale.items_count).toBe(3);
  });

  it('derives _cents from dollar fields when cents are missing', () => {
    const sale = normalizeSale({
      id: 2,
      sale_number: 'S-2',
      total_amount: 12.34,
      tax_amount: 1.23,
      subtotal: 11.0,
      discount_amount: 0,
      sale_status: 'refunded',
      total_quantity: 5,
      customer: {id: 9, name: 'Bob', email: null, phone: null, account_balance_cents: 0},
      created_at: '2026-01-02T00:00:00Z',
    });
    expect(sale.total_cents).toBe(1234);
    expect(sale.tax_cents).toBe(123);
    expect(sale.subtotal_cents).toBe(1100);
    expect(sale.discount_cents).toBe(0);
    // status falls back to sale_status alias
    expect(sale.status).toBe('refunded');
    // items_count falls back through total_quantity
    expect(sale.items_count).toBe(5);
    // customer_name falls back to nested customer.name
    expect(sale.customer_name).toBe('Bob');
  });

  it('parses dollar amounts encoded as strings', () => {
    const sale = normalizeSale({
      id: 3,
      sale_number: 'S-3',
      total_amount: '99.95',
      created_at: '',
    });
    expect(sale.total_cents).toBe(9995);
  });

  it('returns 0 for missing numeric fields and null for missing customer', () => {
    const sale = normalizeSale({id: 4, sale_number: 'S-4', created_at: ''});
    expect(sale.total_cents).toBe(0);
    expect(sale.tax_cents).toBe(0);
    expect(sale.subtotal_cents).toBe(0);
    expect(sale.discount_cents).toBe(0);
    expect(sale.customer_name).toBeNull();
    expect(sale.items_count).toBe(0);
    // status defaults to 'completed' when neither field is provided
    expect(sale.status).toBe('completed');
  });

  it('falls back to items.length when items_count and total_quantity are absent', () => {
    const sale = normalizeSale({
      id: 5,
      sale_number: 'S-5',
      created_at: '',
      items: [{}, {}, {}, {}],
    });
    expect(sale.items_count).toBe(4);
  });

  it('handles undefined input defensively', () => {
    const sale = normalizeSale(undefined);
    expect(sale.total_cents).toBe(0);
    expect(sale.customer_name).toBeNull();
  });
});

describe('normalizeSaleDetail', () => {
  it('normalizes nested items and payments using cents fields', () => {
    const detail = normalizeSaleDetail({
      id: 1,
      sale_number: 'S-1',
      total_cents: 1100,
      created_at: '',
      items: [
        {
          product_id: 10,
          product_name: 'Widget',
          sku: 'WID-1',
          quantity: 2,
          unit_price_cents: 500,
          line_total_cents: 1000,
          discount_cents: 0,
        },
      ],
      payments: [{method: 'cash', amount_cents: 1100, reference: null}],
      customer: {
        id: 7,
        name: 'Carol',
        email: null,
        phone: null,
        account_balance_cents: 0,
      },
    });
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].unit_price_cents).toBe(500);
    expect(detail.items[0].line_total_cents).toBe(1000);
    expect(detail.payments[0].amount_cents).toBe(1100);
    expect(detail.customer?.name).toBe('Carol');
  });

  it('derives item/payment cents from dollar fields when cents are absent', () => {
    const detail = normalizeSaleDetail({
      id: 2,
      sale_number: 'S-2',
      total_amount: 11.0,
      created_at: '',
      items: [
        {
          product_id: 10,
          product_name: 'Widget',
          sku: 'WID-1',
          quantity: 2,
          unit_price: 5.0,
          line_total: 10.0,
          discount_amount: 0,
        },
      ],
      payments: [{method: 'cash', amount: 11.0}],
      customer: null,
    });
    expect(detail.total_cents).toBe(1100);
    expect(detail.items[0].unit_price_cents).toBe(500);
    expect(detail.items[0].line_total_cents).toBe(1000);
    expect(detail.payments[0].amount_cents).toBe(1100);
    expect(detail.customer).toBeNull();
  });

  it('handles missing items/payments arrays', () => {
    const detail = normalizeSaleDetail({
      id: 3,
      sale_number: 'S-3',
      total_amount: 0,
      created_at: '',
    });
    expect(detail.items).toEqual([]);
    expect(detail.payments).toEqual([]);
    expect(detail.customer).toBeNull();
  });

  it('preserves a legitimate zero line_total instead of falling through to price', () => {
    // Refund / promo line: line is genuinely $0 but the underlying product
    // has a non-zero price. The pre-fix `||` chain returned 500 cents here.
    const detail = normalizeSaleDetail({
      id: 4,
      sale_number: 'S-4',
      total_amount: 0,
      created_at: '',
      items: [
        {
          product_id: 11,
          product_name: 'Promo widget',
          sku: 'PROMO-1',
          quantity: 1,
          line_total: 0,
          price: 5.0,
        },
      ],
    });
    expect(detail.items[0].line_total_cents).toBe(0);
  });

  it('falls through to next dollar key when prior key is missing', () => {
    // No line_total key at all → falls back to total → 750 cents.
    const detail = normalizeSaleDetail({
      id: 5,
      sale_number: 'S-5',
      total_amount: 7.5,
      created_at: '',
      items: [
        {
          product_id: 12,
          product_name: 'Gadget',
          sku: 'GAD-1',
          quantity: 1,
          total: 7.5,
          price: 8.0,
        },
      ],
    });
    expect(detail.items[0].line_total_cents).toBe(750);
  });
});
