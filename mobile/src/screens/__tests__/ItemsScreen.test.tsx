import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {Product} from '../../types/api.types';

// React 19's reportGlobalError uses window.dispatchEvent to surface caught
// errors. jest-expo's environment doesn't provide it; without a stub the
// real failure stack gets masked behind "window.dispatchEvent is not a
// function".
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

import ItemsScreen from '../ItemsScreen';

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

const okPage = (data: Product[]) => ({
  data,
  meta: {current_page: 1, last_page: 1, per_page: 50, total: data.length},
});

describe('ItemsScreen', () => {
  beforeEach(() => {
    mockListProducts.mockReset();
    mockSearchProducts.mockReset();
  });

  it('renders the stat strip with total / low-stock / out counts', async () => {
    mockListProducts.mockResolvedValue(
      okPage([
        makeProduct({id: 1, stock_on_hand: 50}),
        makeProduct({id: 2, stock_on_hand: 5}), // low stock
        makeProduct({id: 3, stock_on_hand: 0}), // out
        makeProduct({id: 4, stock_on_hand: 0}), // out
      ]),
    );

    const {getByText, getAllByText, getByLabelText} = render(<ItemsScreen />);

    // Wait for the fetch to land — StatCard label is rendered immediately,
    // so assert on the resolved counts via accessibilityLabel.
    await waitFor(() => {
      expect(getByLabelText('Total: 4')).toBeTruthy();
    });

    expect(getByText('Low Stock')).toBeTruthy();
    expect(getByText('Out')).toBeTruthy();
    expect(getByLabelText('Low Stock: 1')).toBeTruthy();
    expect(getByLabelText('Out: 2')).toBeTruthy();
    // The value cells render numeric strings; sanity-check the digits also
    // appear in the rendered tree.
    expect(getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });

  it('renders list rows with accessibilityRole="button" and a contextual label', async () => {
    mockListProducts.mockResolvedValue(
      okPage([makeProduct({id: 42, name: 'Sample Product', stock_on_hand: 7})]),
    );

    const {findByLabelText} = render(<ItemsScreen />);

    const row = await findByLabelText(/Sample Product/);
    expect(row.props.accessibilityRole).toBe('button');
    expect(typeof row.props.accessibilityLabel).toBe('string');
    expect(row.props.accessibilityLabel.length).toBeGreaterThan(0);
    expect(row.props.accessibilityLabel).toContain('7 on hand');
  });

  it('surfaces a relay error via ErrorBanner with a retry affordance', async () => {
    mockListProducts.mockRejectedValue(new Error('Items unavailable'));

    const {getByText, getByLabelText} = render(<ItemsScreen />);

    await waitFor(() => {
      expect(getByText('Items unavailable')).toBeTruthy();
    });

    mockListProducts.mockResolvedValue(okPage([makeProduct({id: 99})]));
    fireEvent.press(getByLabelText('Retry'));

    await waitFor(() => {
      expect(getByText('Item 99')).toBeTruthy();
    });
  });
});
