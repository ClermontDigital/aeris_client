import { useCartStore } from '../stores/cartStore';
import type { Product } from '@aeris/shared';

function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Widget',
    sku: 'WID-1',
    barcode: null,
    price_cents: 1000,
    tax_rate: 10,
    stock_on_hand: 100,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
    ...over,
  };
}

describe('cartStore', () => {
  beforeEach(() => {
    // Drop any state persist middleware rehydrated from a previous test.
    try {
      localStorage.removeItem('aeris-cart');
    } catch {
      // ignore (jsdom has localStorage but be defensive)
    }
    useCartStore.getState().clear();
  });

  test('addItem appends a new line and increments existing line on second add', () => {
    const store = useCartStore.getState();
    store.addItem(makeProduct({ id: 1 }));
    store.addItem(makeProduct({ id: 1 }), 2);
    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  test('updateQuantity removes the item when quantity drops to zero', () => {
    useCartStore.getState().addItem(makeProduct({ id: 5 }), 2);
    useCartStore.getState().updateQuantity(5, 0);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  test('removeItem drops the line', () => {
    useCartStore.getState().addItem(makeProduct({ id: 7 }));
    useCartStore.getState().removeItem(7);
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  test('setDiscount clamps to the inc-GST line total cap', () => {
    useCartStore.getState().addItem(makeProduct({ price_cents: 1000, tax_rate: 10 }));
    useCartStore.getState().setDiscount(99999);
    // Cap is the inc-GST line total = $10.00 = 1000 cents.
    expect(useCartStore.getState().discountCents).toBe(1000);
  });

  test('setDiscount accepts a valid value in range', () => {
    useCartStore.getState().addItem(makeProduct({ price_cents: 1000, tax_rate: 10 }));
    useCartStore.getState().setDiscount(250);
    expect(useCartStore.getState().discountCents).toBe(250);
  });

  test('clear resets items, discount, customer, notes', () => {
    const s = useCartStore.getState();
    s.addItem(makeProduct({ id: 1 }));
    s.setDiscount(100);
    s.setCustomer(42, 'Alice');
    s.setNotes('hello');
    s.clear();
    const after = useCartStore.getState();
    expect(after.items).toHaveLength(0);
    expect(after.discountCents).toBe(0);
    expect(after.customerId).toBeNull();
    expect(after.customerName).toBeNull();
    expect(after.notes).toBe('');
  });

  test('totals: $10 inc-GST item @ 10% = subtotal 909 / tax 91 / total 1000', () => {
    useCartStore.getState().addItem(makeProduct({ price_cents: 1000, tax_rate: 10 }));
    expect(useCartStore.getState().getSubtotalCents()).toBe(909);
    expect(useCartStore.getState().getTaxCents()).toBe(91);
    expect(useCartStore.getState().getTotalCents()).toBe(1000);
  });

  test('cart-level discount subtracts from total', () => {
    useCartStore.getState().addItem(makeProduct({ price_cents: 1000, tax_rate: 10 }));
    useCartStore.getState().setDiscount(200);
    expect(useCartStore.getState().getTotalCents()).toBe(800);
  });

  test('getItemCount sums quantities, not lines', () => {
    useCartStore.getState().addItem(makeProduct({ id: 1 }), 2);
    useCartStore.getState().addItem(makeProduct({ id: 2 }), 3);
    expect(useCartStore.getState().getItemCount()).toBe(5);
  });

  test('persist writes only the whitelisted fields to localStorage', () => {
    const s = useCartStore.getState();
    s.addItem(makeProduct({ id: 1 }), 2);
    s.setCustomer(42, 'Alice');
    s.setDiscount(100);
    s.setNotes('hi');
    const raw = localStorage.getItem('aeris-cart');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state).toEqual(
      expect.objectContaining({
        items: expect.any(Array),
        customerId: 42,
        customerName: 'Alice',
        discountCents: 100,
        notes: 'hi',
      }),
    );
    // Computed selectors must NOT be persisted.
    expect(parsed.state.getTotalCents).toBeUndefined();
    expect(parsed.state.getItemCount).toBeUndefined();
  });
});
