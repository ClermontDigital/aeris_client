import {
  clampDiscountCents,
  getItemCount,
  getSubtotalCents,
  getTaxCents,
  getTotalCents,
} from '../cart/math';
import type {CartItem, Product} from '../types/api.types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Widget',
    sku: 'WID-1',
    barcode: null,
    price_cents: 1000, // $10.00
    tax_rate: 10, // 10%
    stock_on_hand: 100,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
    ...overrides,
  };
}

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  const product = overrides.product ?? makeProduct();
  return {
    product,
    quantity: 1,
    unit_price_cents: product.price_cents,
    discount_cents: 0,
    ...overrides,
  };
}

describe('cart math: clampDiscountCents', () => {
  it('clamps to [0, lineTotalInc]: a request equal to the cap commits as-is', () => {
    const items = [makeItem()]; // lineTotalInc = 1000
    expect(clampDiscountCents(items, 1000)).toBe(1000);
  });

  it('clamps a negative request to 0', () => {
    const items = [makeItem()];
    expect(clampDiscountCents(items, -100)).toBe(0);
  });

  it('clamps a wildly large request down to lineTotalInc', () => {
    const items = [makeItem()]; // lineTotalInc = 1000
    expect(clampDiscountCents(items, 99_999_999)).toBe(1000);
  });

  it('caps at 0 when the cart is empty (lineTotalInc = 0)', () => {
    expect(clampDiscountCents([], 500)).toBe(0);
    expect(clampDiscountCents([], -500)).toBe(0);
    expect(clampDiscountCents([], 0)).toBe(0);
  });

  it('handles non-finite numeric input by treating it as 0', () => {
    const items = [makeItem()];
    expect(clampDiscountCents(items, Number.NaN)).toBe(0);
  });
});

describe('cart math: subtotal/tax/total', () => {
  it('splits an inc-GST line total into ex-GST subtotal + embedded tax', () => {
    // $11.00 inc-GST at 10% → $10.00 subtotal + $1.00 tax
    const items = [makeItem({unit_price_cents: 1100, product: makeProduct({tax_rate: 10})})];
    expect(getSubtotalCents(items)).toBe(1000);
    expect(getTaxCents(items)).toBe(100);
  });

  it('subtotal + tax === lineTotalInc with no per-line drift', () => {
    const items = [
      makeItem({unit_price_cents: 333, quantity: 7}),
      makeItem({unit_price_cents: 1234, quantity: 1}),
    ];
    expect(getSubtotalCents(items) + getTaxCents(items)).toBe(
      items.reduce(
        (s, i) => s + i.unit_price_cents * i.quantity - i.discount_cents,
        0,
      ),
    );
  });

  it('tax_rate=0 collapses tax to 0 and subtotal == lineTotalInc', () => {
    const items = [makeItem({product: makeProduct({tax_rate: 0})})];
    expect(getSubtotalCents(items)).toBe(1000);
    expect(getTaxCents(items)).toBe(0);
  });

  it('non-finite tax_rate is treated as 0', () => {
    const items = [
      makeItem({product: makeProduct({tax_rate: Number.NaN})}),
    ];
    expect(getSubtotalCents(items)).toBe(1000);
    expect(getTaxCents(items)).toBe(0);
  });

  it('total = lineTotalInc - discountCents', () => {
    const items = [makeItem()]; // lineTotalInc = 1000
    expect(getTotalCents(items, 200)).toBe(800);
  });

  it('item-level discount reduces both subtotal and tax', () => {
    // unit_price_cents=1000 - discount_cents=110 = 890 inc-GST.
    // 890 / 1.10 = 809.09… → round to 809; tax = 890 - 809 = 81.
    const items = [makeItem({discount_cents: 110})];
    expect(getSubtotalCents(items)).toBe(809);
    expect(getTaxCents(items)).toBe(81);
  });
});

describe('cart math: getItemCount', () => {
  it('sums quantities across line items', () => {
    expect(
      getItemCount([
        makeItem({quantity: 3}),
        makeItem({product: makeProduct({id: 2}), quantity: 2}),
      ]),
    ).toBe(5);
  });

  it('returns 0 for an empty cart', () => {
    expect(getItemCount([])).toBe(0);
  });
});
