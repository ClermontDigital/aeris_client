import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';
import type {Product} from '../../types/api.types';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
  if (typeof (globalThis as any).window.dispatchEvent !== 'function') {
    (globalThis as any).window.dispatchEvent = () => true;
    (globalThis as any).window.addEventListener = () => undefined;
    (globalThis as any).window.removeEventListener = () => undefined;
    (globalThis as any).window.ErrorEvent = class {};
  }
});

// Direct cart-store stub — addItem is a jest.fn so we can assert on
// non-call for out-of-stock taps. Exposed via getState() in tests.
jest.mock('../../stores/cartStore', () => {
  const state = {
    items: [],
    customerId: null,
    customerName: null,
    discountCents: 0,
    notes: '',
    addItem: jest.fn(),
    removeItem: jest.fn(),
    updateQuantity: jest.fn(),
    setCustomer: jest.fn(),
    setDiscount: jest.fn(),
    setNotes: jest.fn(),
    clear: jest.fn(),
    getSubtotalCents: () => 0,
    getTaxCents: () => 0,
    getTotalCents: () => 0,
    getItemCount: () => 0,
  };
  const useCartStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useCartStore.getState = () => state;
  useCartStore.setState = jest.fn();
  useCartStore.subscribe = () => () => undefined;
  return {useCartStore};
});

const mockSyncProducts = jest.fn();
jest.mock('../../stores/productCacheStore', () => {
  const state: any = {
    products: [],
    categories: [],
    lastSynced: null,
    isSyncing: false,
    lastSyncError: null,
    syncProducts: mockSyncProducts,
    searchLocal: (_q: string) => [],
    getByBarcode: () => null,
    getByCategory: () => [],
  };
  const useProductCacheStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useProductCacheStore.getState = () => state;
  useProductCacheStore.setState = (patch: any) => Object.assign(state, patch);
  useProductCacheStore.subscribe = () => () => undefined;
  // Test-only helper to seed cached products without going through the real
  // sync path.
  useProductCacheStore.__seedProducts = (products: Product[]) => {
    state.products = products;
  };
  return {useProductCacheStore};
});

const mockListProducts = jest.fn();
const mockSearchProducts = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    listProducts: (...args: unknown[]) => mockListProducts(...args),
    searchProducts: (...args: unknown[]) => mockSearchProducts(...args),
  },
}));

jest.mock('../../hooks/useHaptics', () => {
  const stable = {
    light: jest.fn(),
    medium: jest.fn(),
    selection: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  };
  return {useHaptics: () => stable};
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn()}),
}));

import QuickSaleScreen from '../QuickSaleScreen';
import {useProductCacheStore} from '../../stores/productCacheStore';
import {useCartStore} from '../../stores/cartStore';

const getMockAddItem = () => useCartStore.getState().addItem as jest.Mock;

function makeProduct(over: Partial<Product> & Pick<Product, 'id'>): Product {
  return {
    name: `Item ${over.id}`,
    sku: `SKU-${over.id}`,
    barcode: null,
    price_cents: 1000,
    tax_rate: 10,
    stock_on_hand: 25,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
    ...over,
  };
}

describe('QuickSaleScreen out-of-stock gating', () => {
  beforeEach(() => {
    getMockAddItem().mockReset();
    mockListProducts.mockReset();
    mockSearchProducts.mockReset();
  });

  it('does NOT add a tracked product with stock_on_hand=0 to the cart', async () => {
    (useProductCacheStore as any).__seedProducts([
      makeProduct({id: 1, name: 'Sold Out', stock_on_hand: 0}),
    ]);

    const {findByText} = render(<QuickSaleScreen />);
    const tile = await findByText('Sold Out');

    fireEvent.press(tile);

    // 300ms debounce-load runs through but no addItem call should happen.
    await waitFor(() => {
      expect(getMockAddItem()).not.toHaveBeenCalled();
    });
  });

  it('adds a tracked product with positive stock to the cart', async () => {
    (useProductCacheStore as any).__seedProducts([
      makeProduct({id: 2, name: 'Available', stock_on_hand: 5}),
    ]);

    const {findByText} = render(<QuickSaleScreen />);
    const tile = await findByText('Available');

    fireEvent.press(tile);

    await waitFor(() => {
      expect(getMockAddItem()).toHaveBeenCalledTimes(1);
    });
  });

  it('adds an untracked product (track_stock=false) even when stock_on_hand=0', async () => {
    (useProductCacheStore as any).__seedProducts([
      Object.assign(
        makeProduct({id: 3, name: 'Untracked', stock_on_hand: 0}),
        {track_stock: false},
      ) as any,
    ]);

    const {findByText} = render(<QuickSaleScreen />);
    const tile = await findByText('Untracked');

    fireEvent.press(tile);

    await waitFor(() => {
      expect(getMockAddItem()).toHaveBeenCalledTimes(1);
    });
  });
});
