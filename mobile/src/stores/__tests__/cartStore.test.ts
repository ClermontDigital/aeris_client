import {useCartStore} from '../cartStore';
import {useAuthStore} from '../authStore';
import type {Product} from '../../types/api.types';

function makeProduct(overrides: Partial<Product> = {}): Product {
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
    ...overrides,
  };
}

describe('cartStore auth subscription', () => {
  beforeEach(() => {
    useCartStore.getState().clear();
    // Start in an authenticated state so the next setState() flips the
    // boundary and triggers the subscriber.
    useAuthStore.setState({
      user: null,
      token: 'TOKEN',
      expiresAt: null,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      errorKind: null,
      refreshInFlight: null,
    } as any);
  });

  it('clears the cart on a true→false isAuthenticated transition (logout / 401)', () => {
    useCartStore.getState().addItem(makeProduct(), 2);
    useCartStore.getState().setDiscount(100);
    expect(useCartStore.getState().items.length).toBe(1);

    // Simulate logout: flip isAuthenticated false.
    useAuthStore.setState({isAuthenticated: false} as any);

    const state = useCartStore.getState();
    expect(state.items.length).toBe(0);
    expect(state.discountCents).toBe(0);
    expect(state.customerId).toBeNull();
  });

  it('does not clear the cart on a same-state auth update (e.g. user object refresh)', () => {
    useCartStore.getState().addItem(makeProduct(), 3);
    expect(useCartStore.getState().items.length).toBe(1);

    // Stay authenticated, change something else — cart must survive.
    useAuthStore.setState({
      isAuthenticated: true,
      user: {id: 2, name: 'New', email: 'n@e.com', role: 'cashier', location_id: null},
    } as any);

    expect(useCartStore.getState().items.length).toBe(1);
  });
});
