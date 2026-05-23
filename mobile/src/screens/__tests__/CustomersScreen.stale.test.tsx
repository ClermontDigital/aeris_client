import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {Customer} from '../../types/api.types';

// Regression tests for stale/partial Customer payloads where the `name`
// field is null or undefined. The localFilter previously called
// `c.name.toLowerCase()` unconditionally, crashing the Customers screen
// with "undefined is not a function" the moment the user typed into the
// search box. See CustomerPickerScreen — same guard applies there.

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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn()}),
  // CustomersScreen calls useFocusEffect (v1.3.29) to refresh the list
  // after CustomerEdit. No-op the stub — focus events don't fire in jest.
  useFocusEffect: () => undefined,
}));

import CustomersScreen from '../CustomersScreen';

// Base Customer factory. The real Customer.name is typed `string`, but
// the wire payload can legitimately deliver null/undefined when an
// upstream record is partial or a cached envelope predates a schema
// tightening — that's exactly the crash we're guarding against.
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

describe('CustomersScreen stale-state guard', () => {
  beforeEach(() => {
    mockListCustomers.mockReset();
  });

  it('does not crash when filtering a customer with name=null', async () => {
    mockListCustomers.mockResolvedValue(
      okPage([
        // Cast: real-world stale payload can deliver null even though
        // the type says string. That's the bug we're guarding.
        makeCustomer({id: 1, name: null as unknown as string}),
      ]),
    );

    const {getByPlaceholderText, queryByText} = render(<CustomersScreen />);

    // Wait for the initial fetch to settle so localFilter has data to scan.
    await waitFor(() => {
      expect(mockListCustomers).toHaveBeenCalled();
    });

    const input = getByPlaceholderText(
      'Search customers by name, email, or phone',
    );

    // Typing must not throw. Pre-fix this synchronously raised
    // "undefined is not a function" inside the FlatList render.
    expect(() => {
      fireEvent.changeText(input, 'x');
    }).not.toThrow();

    // Either the empty state renders (no match) or the row renders —
    // we don't care which, only that no exception escaped.
    await waitFor(() => {
      expect(
        queryByText('No customers match your search') ||
          queryByText('(unnamed)'),
      ).toBeTruthy();
    });
  });

  it('does not crash when filtering a customer with name=undefined', async () => {
    // Omit name entirely by overriding to undefined, then casting.
    const partial = makeCustomer({id: 2});
    delete (partial as any).name;

    mockListCustomers.mockResolvedValue(okPage([partial]));

    const {getByPlaceholderText, queryByText} = render(<CustomersScreen />);

    await waitFor(() => {
      expect(mockListCustomers).toHaveBeenCalled();
    });

    const input = getByPlaceholderText(
      'Search customers by name, email, or phone',
    );

    expect(() => {
      fireEvent.changeText(input, 'x');
    }).not.toThrow();

    await waitFor(() => {
      expect(
        queryByText('No customers match your search') ||
          queryByText('(unnamed)'),
      ).toBeTruthy();
    });
  });

  it('still matches the happy path: valid name "Alice", null email/phone, search "ali"', async () => {
    mockListCustomers.mockResolvedValue(
      okPage([
        makeCustomer({id: 3, name: 'Alice', email: null, phone: null}),
        makeCustomer({id: 4, name: 'Bob', email: null, phone: null}),
      ]),
    );

    const {getByPlaceholderText, findByText, queryByText} = render(
      <CustomersScreen />,
    );

    // Wait for the rows to land before filtering.
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
