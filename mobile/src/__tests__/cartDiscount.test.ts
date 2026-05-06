import {useCartStore} from '../stores/cartStore';
import type {Product} from '../types/api.types';

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

describe('cartStore setDiscount clamping', () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it('clamps to [0, subtotal+tax]: a request equal to the cap commits as-is', () => {
    // Product.price_cents is inc-GST, so subtotal+tax = lineTotalInc = 1000.
    useCartStore.getState().addItem(makeProduct({price_cents: 1000, tax_rate: 10}));
    useCartStore.getState().setDiscount(1000);
    expect(useCartStore.getState().discountCents).toBe(1000);
    // Total should clamp to $0 once the full discount lands.
    expect(useCartStore.getState().getTotalCents()).toBe(0);
  });

  it('clamps a negative request to 0', () => {
    useCartStore.getState().addItem(makeProduct({price_cents: 1000, tax_rate: 10}));
    useCartStore.getState().setDiscount(-100);
    expect(useCartStore.getState().discountCents).toBe(0);
  });

  it('clamps a wildly large request down to subtotal+tax', () => {
    // lineTotalInc = 1000; 99,999,999 cents far exceeds it.
    useCartStore.getState().addItem(makeProduct({price_cents: 1000, tax_rate: 10}));
    useCartStore.getState().setDiscount(99_999_999);
    expect(useCartStore.getState().discountCents).toBe(1000);
  });

  it('caps at 0 when the cart is empty (subtotal+tax = 0)', () => {
    useCartStore.getState().setDiscount(500);
    expect(useCartStore.getState().discountCents).toBe(0);
    useCartStore.getState().setDiscount(-500);
    expect(useCartStore.getState().discountCents).toBe(0);
    useCartStore.getState().setDiscount(0);
    expect(useCartStore.getState().discountCents).toBe(0);
  });

  it('handles non-finite numeric input by treating it as 0', () => {
    useCartStore.getState().addItem(makeProduct({price_cents: 1000, tax_rate: 10}));
    useCartStore.getState().setDiscount(Number.NaN);
    expect(useCartStore.getState().discountCents).toBe(0);
  });
});
