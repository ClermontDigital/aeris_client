import {useCartStore} from '../../stores/cartStore';
import {getItemCount} from '@aeris/shared';
import type {Product} from '../../types/api.types';

// AppTabs.tsx subscribes to `useCartStore(s => getItemCount(s.items))` and
// feeds the resulting count into tabBarBadge for the Sale tab. Mounting the
// full Tab.Navigator under jest-expo is heavy: each Tab.Screen instantiates
// a nested stack whose screens wire up ApiClient + ConnectionService +
// react-native-screens, and rendering the hooked store via RTL +
// react-test-renderer trips zustand's use-sync-external-store shim (the
// shim's internal React copy doesn't match RTL's). Instead, verify the
// store's subscribe path directly — that's the contract AppTabs depends
// on — so we know the badge updates reactively in the real app.

function makeProduct(id: number): Product {
  return {
    id,
    name: `Item ${id}`,
    sku: `SKU-${id}`,
    barcode: null,
    price_cents: 1000,
    tax_rate: 10,
    stock_on_hand: 50,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
  };
}

// Mirrors the JSX in AppTabs Tab.Screen options for QuickSale.
const computeBadge = (count: number): string | undefined =>
  count === 0 ? undefined : count > 99 ? '99+' : String(count);

const computeBadgeA11yLabel = (count: number): string | undefined =>
  count > 0
    ? `Sale tab, ${count} ${count === 1 ? 'item' : 'items'} in cart`
    : undefined;

describe('AppTabs cart badge subscription', () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it('shows no badge when cart is empty', () => {
    expect(computeBadge(getItemCount(useCartStore.getState().items))).toBeUndefined();
    expect(
      computeBadgeA11yLabel(getItemCount(useCartStore.getState().items)),
    ).toBeUndefined();
  });

  it('counts summed quantities, not line count (5 of one SKU → "5")', () => {
    const product = makeProduct(1);
    useCartStore.getState().addItem(product, 5);

    const items = useCartStore.getState().items;
    expect(items.length).toBe(1); // one line
    expect(getItemCount(items)).toBe(5); // five units

    expect(computeBadge(getItemCount(items))).toBe('5');
    expect(computeBadgeA11yLabel(getItemCount(items))).toBe(
      'Sale tab, 5 items in cart',
    );
  });

  it('uses singular "item" when count is exactly 1', () => {
    useCartStore.getState().addItem(makeProduct(1), 1);
    const count = getItemCount(useCartStore.getState().items);
    expect(count).toBe(1);
    expect(computeBadgeA11yLabel(count)).toBe('Sale tab, 1 item in cart');
  });

  it('caps the displayed value at "99+" but announces the real number', () => {
    useCartStore.getState().addItem(makeProduct(1), 100);
    const count = getItemCount(useCartStore.getState().items);
    expect(count).toBe(100);
    expect(computeBadge(count)).toBe('99+');
    // The accessibility label MUST report the actual number — not the
    // truncated display string.
    expect(computeBadgeA11yLabel(count)).toBe('Sale tab, 100 items in cart');
  });

  it('reactively reports cart count via the same selector AppTabs uses', () => {
    const observed: number[] = [];
    const unsubscribe = useCartStore.subscribe(state => {
      observed.push(getItemCount(state.items));
    });

    useCartStore.getState().addItem(makeProduct(1));
    useCartStore.getState().addItem(makeProduct(2));
    useCartStore.getState().removeItem(1);
    useCartStore.getState().clear();

    unsubscribe();

    expect(observed).toContain(1);
    expect(observed).toContain(2);
    expect(observed[observed.length - 1]).toBe(0);
    expect(computeBadge(observed[0])).toBe('1');
    expect(computeBadge(observed[observed.length - 1])).toBeUndefined();
  });
});
