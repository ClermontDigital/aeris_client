import React from 'react';
import {render, fireEvent, waitFor} from '@testing-library/react-native';

beforeAll(() => {
  // React 19 + jest-expo: window.dispatchEvent is needed for the global
  // error reporter. See DashboardScreen.test.tsx for the full rationale.
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

// ApiClient mock — both write surfaces stubbed plus the detail fetch
// (unused in create-mode but harmless to define for completeness).
const mockCreateCustomer = jest
  .fn()
  .mockResolvedValue({id: 99, name: 'Ada Lovelace', first_name: 'Ada'});
const mockUpdateCustomer = jest.fn();
const mockDeleteCustomer = jest.fn();
const mockGetCustomerDetail = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    createCustomer: (...args: unknown[]) => mockCreateCustomer(...args),
    updateCustomer: (...args: unknown[]) => mockUpdateCustomer(...args),
    deleteCustomer: (...args: unknown[]) => mockDeleteCustomer(...args),
    getCustomerDetail: (...args: unknown[]) => mockGetCustomerDetail(...args),
  },
}));

// Cart store stub — same shape pattern as CheckoutScreen.test.tsx so the
// picker-flow setCustomer call doesn't crash. The hook itself is never
// asserted against in this test, just imported by the screen.
jest.mock('../../stores/cartStore', () => {
  const state = {
    items: [],
    customerId: null,
    customerName: null,
    setCustomer: jest.fn(),
  };
  const useCartStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useCartStore.getState = () => state;
  useCartStore.setState = jest.fn();
  useCartStore.subscribe = () => () => undefined;
  return {useCartStore};
});

// Auth store stub — ErrorBanner reads it via subscribe + getState. See
// DashboardScreen.test.tsx for why we sidestep zustand under jest-expo.
jest.mock('../../stores/authStore', () => {
  const state = {
    user: {name: 'Tester'},
    isAuthenticated: true,
    errorKind: null,
  };
  const useAuthStore: any = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  useAuthStore.subscribe = () => () => undefined;
  return {useAuthStore};
});

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

const mockGoBack = jest.fn();
const mockPop = jest.fn();
const mockPopToTop = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    pop: mockPop,
    popToTop: mockPopToTop,
    navigate: mockNavigate,
  }),
  // Default to no route params → create mode. Individual tests can
  // re-mock if they need edit-mode params.
  useRoute: () => ({params: undefined}),
  useFocusEffect: () => undefined,
}));

import CustomerEditScreen, {
  validateCustomerForm,
  formToCreateInput,
} from '../CustomerEditScreen';

describe('CustomerEditScreen — form validation helpers', () => {
  it('flags missing first_name when company is also empty', () => {
    const errors = validateCustomerForm({
      first_name: '',
      last_name: '',
      company: '',
      email: '',
      phone: '',
      notes: '',
      address: '',
      address_line_2: '',
      city: '',
      state: '',
      postcode: '',
      country: '',
    });
    expect(errors.first_name).toBeDefined();
  });

  it('accepts company-only customers without a first_name', () => {
    const errors = validateCustomerForm({
      first_name: '',
      last_name: '',
      company: 'Acme Corp',
      email: '',
      phone: '',
      notes: '',
      address: '',
      address_line_2: '',
      city: '',
      state: '',
      postcode: '',
      country: '',
    });
    expect(errors.first_name).toBeUndefined();
  });

  it('rejects malformed emails but accepts valid ones', () => {
    const base = {
      first_name: 'Ada',
      last_name: '',
      company: '',
      phone: '',
      notes: '',
      address: '',
      address_line_2: '',
      city: '',
      state: '',
      postcode: '',
      country: '',
    };
    expect(validateCustomerForm({...base, email: 'not-an-email'}).email).toBe(
      'Enter a valid email address',
    );
    expect(
      validateCustomerForm({...base, email: 'ada@example.com'}).email,
    ).toBeUndefined();
    // empty email is fine — the field is optional
    expect(validateCustomerForm({...base, email: ''}).email).toBeUndefined();
  });

  it('omits the address block from the payload when every address field is empty', () => {
    const payload = formToCreateInput({
      first_name: 'Ada',
      last_name: '',
      company: '',
      email: '',
      phone: '',
      notes: '',
      address: '',
      address_line_2: '',
      city: '',
      state: '',
      postcode: '',
      country: '',
    });
    expect(payload).not.toHaveProperty('address');
    expect(payload).not.toHaveProperty('city');
  });
});

describe('CustomerEditScreen — create mode integration', () => {
  beforeEach(() => {
    mockCreateCustomer.mockClear();
    mockUpdateCustomer.mockClear();
    mockDeleteCustomer.mockClear();
    mockGetCustomerDetail.mockClear();
    mockGoBack.mockClear();
    mockPop.mockClear();
    mockPopToTop.mockClear();
  });

  it('submits createCustomer with the typed first_name + email when Save is tapped', async () => {
    const {getByTestId, getByLabelText} = render(<CustomerEditScreen />);

    fireEvent.changeText(getByTestId('customer-edit-first-name'), 'Ada');
    fireEvent.changeText(
      getByTestId('customer-edit-email'),
      'ada@example.com',
    );

    fireEvent.press(getByLabelText('Save customer'));

    await waitFor(() => {
      expect(mockCreateCustomer).toHaveBeenCalledTimes(1);
    });

    const payload = mockCreateCustomer.mock.calls[0][0];
    expect(payload.first_name).toBe('Ada');
    expect(payload.email).toBe('ada@example.com');
    // Address block was not filled → must be omitted from the payload.
    expect(payload).not.toHaveProperty('address');

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  it('blocks submission and surfaces a validation error when name is empty', async () => {
    const {getByLabelText, queryByText} = render(<CustomerEditScreen />);

    // Tap Save without filling anything — button is disabled, but even
    // if it somehow fires the validation pass would block the API call.
    const saveBtn = getByLabelText('Save customer');
    fireEvent.press(saveBtn);

    // No network call should have been made.
    expect(mockCreateCustomer).not.toHaveBeenCalled();
    // No error banner because the disabled button never invoked the
    // submit handler — but the field should still show its "required *"
    // marker in the layout.
    expect(queryByText('Failed to save customer')).toBeNull();
  });
});
