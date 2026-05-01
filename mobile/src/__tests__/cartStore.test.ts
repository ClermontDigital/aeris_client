import {useCartStore} from '../stores/cartStore';
import type {Product} from '../types/api.types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Widget',
    sku: 'WID-1',
    barcode: null,
    price_cents: 1000, // $10.00
    tax_rate: 10, // 10% — Aeris2 emits as a percentage, not a decimal
    stock_on_hand: 100,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
    ...overrides,
  };
}

describe('cartStore tax math', () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it('treats tax_rate as a percentage (10 = 10%), not a decimal multiplier', () => {
    // Regression for the bug where a $10 item with tax_rate=10 produced
    // $100 of tax instead of $1 because the cart math multiplied directly
    // without /100. Aeris2's ProductResource always emits tax_rate as a
    // percentage number; the cart was treating it as a decimal.
    useCartStore.getState().addItem(makeProduct({price_cents: 1000, tax_rate: 10}));
    expect(useCartStore.getState().getSubtotalCents()).toBe(1000);
    expect(useCartStore.getState().getTaxCents()).toBe(100); // 10% of $10 = $1.00
    expect(useCartStore.getState().getTotalCents()).toBe(1100); // $11.00
  });

  it('handles a 0% tax_rate without dividing-by-zero or NaN', () => {
    useCartStore.getState().addItem(makeProduct({price_cents: 500, tax_rate: 0}));
    expect(useCartStore.getState().getTaxCents()).toBe(0);
    expect(useCartStore.getState().getTotalCents()).toBe(500);
  });

  it('rounds tax to nearest cent (no float drift across line items)', () => {
    // $3.33 × 3 lines @ 10% = $9.99 subtotal × 10% = $0.999 -> 100 cents.
    // Matters because the prior code accumulated three rounded line-tax
    // values; with the percentage fix, each line is rounded once.
    useCartStore
      .getState()
      .addItem(makeProduct({id: 1, price_cents: 333, tax_rate: 10}), 3);
    expect(useCartStore.getState().getSubtotalCents()).toBe(999);
    // 999 * 10 / 100 = 99.9 -> rounds to 100
    expect(useCartStore.getState().getTaxCents()).toBe(100);
  });

  it('subtracts the cart-level discount from the total', () => {
    useCartStore
      .getState()
      .addItem(makeProduct({price_cents: 1000, tax_rate: 10}));
    useCartStore.getState().setDiscount(200); // $2.00 off the bill
    // Subtotal $10 + tax $1 - discount $2 = $9.00
    expect(useCartStore.getState().getTotalCents()).toBe(900);
  });

  it('counts items by quantity, not by distinct line', () => {
    useCartStore
      .getState()
      .addItem(makeProduct({id: 1, price_cents: 1000}), 2);
    useCartStore
      .getState()
      .addItem(makeProduct({id: 2, price_cents: 500}), 3);
    expect(useCartStore.getState().getItemCount()).toBe(5);
  });
});
