import React from 'react';
import {render, waitFor, fireEvent, act} from '@testing-library/react-native';
import type {Category, ProductDetail} from '../../types/api.types';

// React 19's reportGlobalError uses window.dispatchEvent to surface caught
// errors. jest-expo's environment doesn't provide it; without a stub real
// failure stacks get masked.
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

const mockCreateProduct = jest.fn();
const mockUpdateProduct = jest.fn();
const mockGetCategories = jest.fn<Promise<Category[]>, []>();
const mockGetProductDetail = jest.fn<Promise<ProductDetail | null>, [number]>();

jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    createProduct: (...args: unknown[]) => mockCreateProduct(...args),
    updateProduct: (...args: unknown[]) => mockUpdateProduct(...args),
    getCategories: () => mockGetCategories(),
    getProductDetail: (id: number) => mockGetProductDetail(id),
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

// Auth store mock — ErrorBanner (transitively imported) reads it via
// getState() + subscribe(). Returning an authenticated state keeps the
// "expired session" suppression off so banners render normally in tests.
jest.mock('../../stores/authStore', () => {
  const state = {user: null, isAuthenticated: true, errorKind: null};
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  (useAuthStore as unknown as {getState: () => typeof state}).getState = () =>
    state;
  (useAuthStore as unknown as {subscribe: (l: () => void) => () => void}).subscribe =
    () => () => undefined;
  return {useAuthStore};
});

// Settings store mock — useHaptics is already stubbed, but PillButton imports
// useHaptics which expects useSettingsStore to exist. The stub here returns a
// haptics-enabled state; doesn't matter since useHaptics is mocked anyway.
jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (
    selector: (s: {settings: {hapticsEnabled: boolean}}) => unknown,
  ) => selector({settings: {hapticsEnabled: true}}),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
// Route params control create vs edit mode — set per test via mockRoute.
let mockRoute: {params?: {productId?: number}} = {params: undefined};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => mockRoute,
  useFocusEffect: () => undefined,
}));

import ProductEditScreen from '../ProductEditScreen';

const baseCategories: Category[] = [
  {id: 1, name: 'Coffee'},
  {id: 2, name: 'Pastry'},
];

const baseDetail: ProductDetail = {
  id: 42,
  name: 'Flat white',
  sku: 'FW-001',
  barcode: '9351234567890',
  price_cents: 525,
  tax_rate: 10,
  stock_on_hand: 12,
  category_id: 1,
  category_name: 'Coffee',
  image_url: null,
  is_active: true,
  description: null,
  cost_cents: 180,
  stock_levels: [],
  variants: [],
};

describe('ProductEditScreen', () => {
  beforeEach(() => {
    mockCreateProduct.mockReset();
    mockUpdateProduct.mockReset();
    mockGetCategories.mockReset().mockResolvedValue(baseCategories);
    mockGetProductDetail.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockRoute = {params: undefined};
  });

  describe('create mode', () => {
    it('renders the New item title and disables submit until required fields are valid', async () => {
      const {getByText, getByLabelText} = render(<ProductEditScreen />);
      await waitFor(() => expect(getByText('New item')).toBeTruthy());

      // Save button starts disabled (no name/sku/price/category). The PillButton
      // exposes its label via accessibilityLabel by default.
      const saveBtn = getByLabelText('Save item');
      expect(saveBtn.props.accessibilityState?.disabled).toBe(true);

      // Fill required fields. accessibilityLabel-keyed inputs make this
      // resilient to label-text changes.
      fireEvent.changeText(getByLabelText('Item name'), 'Flat white');
      fireEvent.changeText(getByLabelText('SKU'), 'FW-001');
      fireEvent.changeText(getByLabelText('Sell price in dollars'), '5.25');
      // category_id is required server-side (Rule::exists FK) — the form
      // mirrors that, so the picker must be opened + a category selected
      // before submit unblocks.
      fireEvent.press(getByLabelText(/Category:/));
      fireEvent.press(getByLabelText('Category Coffee'));

      await waitFor(() =>
        expect(saveBtn.props.accessibilityState?.disabled).toBe(false),
      );
    });

    it('blocks submit when price is zero', async () => {
      const {getByText, getByLabelText} = render(<ProductEditScreen />);
      await waitFor(() => expect(getByText('New item')).toBeTruthy());

      fireEvent.changeText(getByLabelText('Item name'), 'Free swag');
      fireEvent.changeText(getByLabelText('SKU'), 'FREE-1');
      fireEvent.changeText(getByLabelText('Sell price in dollars'), '0');

      const saveBtn = getByLabelText('Save item');
      expect(saveBtn.props.accessibilityState?.disabled).toBe(true);
    });

    it('calls createProduct with cents (facade input) — the relay-client converts to dollars on the wire', async () => {
      mockCreateProduct.mockResolvedValue({id: 99, name: 'Flat white'});
      const {getByText, getByLabelText} = render(<ProductEditScreen />);
      await waitFor(() => expect(getByText('New item')).toBeTruthy());

      fireEvent.changeText(getByLabelText('Item name'), 'Flat white');
      fireEvent.changeText(getByLabelText('SKU'), 'FW-001');
      fireEvent.changeText(getByLabelText('Sell price in dollars'), '5.25');
      fireEvent.changeText(getByLabelText('Cost price in dollars'), '1.80');
      fireEvent.press(getByLabelText(/Category:/));
      fireEvent.press(getByLabelText('Category Coffee'));

      const saveBtn = getByLabelText('Save item');
      await act(async () => {
        fireEvent.press(saveBtn);
      });

      await waitFor(() => expect(mockCreateProduct).toHaveBeenCalledTimes(1));
      const payload = mockCreateProduct.mock.calls[0][0];
      expect(payload.name).toBe('Flat white');
      expect(payload.sku).toBe('FW-001');
      // Facade-level input is cents; the relay-client (shared) converts to
      // dollar fields on the wire — see RelayClientWrites.test.ts.
      expect(payload.base_price_cents).toBe(525);
      expect(payload.cost_price_cents).toBe(180);
      expect(payload.tax_rate).toBe(10);
      expect(payload.track_stock).toBe(true);
      // Default 0 opening stock travels through stock_quantity.
      expect(payload.stock_quantity).toBe(0);
      expect(payload.category_id).toBe(1);
      expect(mockGoBack).toHaveBeenCalled();
    });

    it('omits cost_price_cents when the operator leaves it blank', async () => {
      mockCreateProduct.mockResolvedValue({id: 99});
      const {getByText, getByLabelText} = render(<ProductEditScreen />);
      await waitFor(() => expect(getByText('New item')).toBeTruthy());

      fireEvent.changeText(getByLabelText('Item name'), 'Widget');
      fireEvent.changeText(getByLabelText('SKU'), 'W-1');
      fireEvent.changeText(getByLabelText('Sell price in dollars'), '19.99');
      fireEvent.press(getByLabelText(/Category:/));
      fireEvent.press(getByLabelText('Category Pastry'));

      await act(async () => {
        fireEvent.press(getByLabelText('Save item'));
      });

      await waitFor(() => expect(mockCreateProduct).toHaveBeenCalled());
      const payload = mockCreateProduct.mock.calls[0][0];
      expect(payload.base_price_cents).toBe(1999);
      expect(payload.cost_price_cents).toBeUndefined();
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      mockRoute = {params: {productId: 42}};
      mockGetProductDetail.mockResolvedValue(baseDetail);
    });

    it('fetches the product, pre-populates fields, and uses updateProduct on submit (no stock_quantity)', async () => {
      mockUpdateProduct.mockResolvedValue({id: 42, name: 'Flat white v2'});
      const {getByText, getByLabelText, getByDisplayValue} = render(
        <ProductEditScreen />,
      );

      await waitFor(() => expect(getByText('Edit item')).toBeTruthy());
      // Pre-populated from the detail fetch.
      expect(getByDisplayValue('Flat white')).toBeTruthy();
      expect(getByDisplayValue('FW-001')).toBeTruthy();
      // 525 cents formatted as 5.25
      expect(getByDisplayValue('5.25')).toBeTruthy();

      // Edit the name.
      fireEvent.changeText(getByLabelText('Item name'), 'Flat white v2');

      await act(async () => {
        fireEvent.press(getByLabelText('Save changes'));
      });

      await waitFor(() => expect(mockUpdateProduct).toHaveBeenCalledTimes(1));
      const [id, patch] = mockUpdateProduct.mock.calls[0];
      expect(id).toBe(42);
      expect(patch.name).toBe('Flat white v2');
      // Stock is adjusted via the separate modal — never inline on edit.
      expect(patch.stock_quantity).toBeUndefined();
      expect(mockGoBack).toHaveBeenCalled();
    });
  });
});
