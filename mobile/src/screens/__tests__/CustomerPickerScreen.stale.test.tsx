import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {Customer} from '../../types/api.types';

// Mirror of CustomersScreen.stale.test.tsx — the picker shares the exact
// same localFilter pattern (`(c.name ?? '').toLowerCase()`) so a regression
// in one is likely to land in both. Keeping a dedicated picker test means
// if someone refactors one filter site without the other, CI catches it.

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

const mockListCustomers = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    listCustomers: (...args: unknown[]) => mockListCustomers(...args),
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

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn(), goBack: mockGoBack}),
}));

// cartStore.setCustomer is called by the picker on row tap. Mock the
// module so the test doesn't reach into AsyncStorage.
jest.mock('../../stores/cartStore', () => ({
  useCartStore: (selector: (s: {setCustomer: jest.Mock}) => unknown) =>
    selector({setCustomer: jest.fn()}),
}));

import CustomerPickerScreen from '../CustomerPickerScreen';

function makeCustomer(over: Partial<Customer> & Pick<Customer, 'id'>): Customer {
  return {
    name: `Customer ${over.id}`,
    first_name: null,
    last_name: null,
    company: null,
    email: null,
    phone: null,
    mobile: null,
    customer_number: null,
    account_balance_cents: null,
    payment_terms: null,
    credit_limit_cents: null,
    loyalty_points: null,
    total_orders: null,
    total_spent_cents: null,
    last_purchase_date: null,
    recent_sales: [],
    addresses: [],
    default_address: null,
    notes: null,
    created_at: null,
    ...over,
  };
}

const okPage = (data: Customer[]) => ({
  data,
  meta: {current_page: 1, last_page: 1, per_page: 50, total: data.length},
});

describe('CustomerPickerScreen stale-state guard', () => {
  beforeEach(() => {
    mockListCustomers.mockReset();
    mockGoBack.mockReset();
  });

  it('does not crash when filtering a customer with name=null', async () => {
    mockListCustomers.mockResolvedValue(
      okPage([makeCustomer({id: 1, name: null as unknown as string})]),
    );

    const {getByPlaceholderText} = render(<CustomerPickerScreen />);

    await waitFor(() => {
      expect(mockListCustomers).toHaveBeenCalled();
    });

    const input = getByPlaceholderText(
      'Search customers by name, email, or phone',
    );

    expect(() => {
      fireEvent.changeText(input, 'x');
    }).not.toThrow();
  });

  it('still matches the happy path: valid name "Alice", search "ali"', async () => {
    mockListCustomers.mockResolvedValue(
      okPage([
        makeCustomer({id: 3, name: 'Alice'}),
        makeCustomer({id: 4, name: 'Bob'}),
      ]),
    );

    const {getByPlaceholderText, findByText, queryByText} = render(
      <CustomerPickerScreen />,
    );

    await findByText('Alice');

    const input = getByPlaceholderText(
      'Search customers by name, email, or phone',
    );
    fireEvent.changeText(input, 'ali');

    await waitFor(() => {
      expect(queryByText('Alice')).toBeTruthy();
      expect(queryByText('Bob')).toBeNull();
    });
  });
});
