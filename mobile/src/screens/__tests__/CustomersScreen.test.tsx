import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {Customer} from '../../types/api.types';

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
}));

import CustomersScreen from '../CustomersScreen';

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

describe('CustomersScreen', () => {
  beforeEach(() => {
    mockListCustomers.mockReset();
  });

  it('renders list rows with accessibilityRole="button" and a contextual label', async () => {
    mockListCustomers.mockResolvedValue(
      okPage([
        makeCustomer({
          id: 1,
          name: 'Pat Buyer',
          email: 'pat@example.com',
          phone: '555-9876',
        }),
      ]),
    );

    const {findByLabelText} = render(<CustomersScreen />);

    const row = await findByLabelText(/Pat Buyer/);
    expect(row.props.accessibilityRole).toBe('button');
    expect(typeof row.props.accessibilityLabel).toBe('string');
    expect(row.props.accessibilityLabel.length).toBeGreaterThan(0);
    expect(row.props.accessibilityLabel).toContain('pat@example.com');
  });

  it('surfaces a relay error via ErrorBanner with a retry affordance', async () => {
    mockListCustomers.mockRejectedValue(new Error('Customers unavailable'));

    const {getByText, getByLabelText} = render(<CustomersScreen />);

    await waitFor(() => {
      expect(getByText('Customers unavailable')).toBeTruthy();
    });

    mockListCustomers.mockResolvedValue(
      okPage([makeCustomer({id: 99, name: 'Recovered Customer'})]),
    );
    fireEvent.press(getByLabelText('Retry'));

    await waitFor(() => {
      expect(getByText('Recovered Customer')).toBeTruthy();
    });
  });
});
