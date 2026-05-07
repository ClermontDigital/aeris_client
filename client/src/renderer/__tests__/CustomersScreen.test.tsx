/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { CustomersScreen } from '../screens/CustomersScreen';

const relayCallMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
  jest.useFakeTimers();
  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      app: { version: jest.fn() },
      relay: { call: relayCallMock },
      auth: {
        getState: jest.fn(),
        login: jest.fn(),
        logout: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      settings: { get: jest.fn(), set: jest.fn(), onChanged: jest.fn().mockReturnValue(() => undefined) },
      lock: {
        getState: jest.fn(),
        setPin: jest.fn(),
        verifyPin: jest.fn(),
        clearPin: jest.fn(),
        lockNow: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: { getRecentLogs: jest.fn() },
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function renderAt(path = '/customers') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/customers" element={<CustomersScreen />} />
        <Route path="/customers/:id" element={<div>CustomerDetail sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const sampleCustomer = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  name: 'Jane Smith',
  first_name: 'Jane',
  last_name: 'Smith',
  company: null,
  email: 'jane@example.com',
  phone: '0400 000 000',
  mobile: null,
  customer_number: 'C-1',
  account_balance_cents: 0,
  payment_terms: null,
  credit_limit_cents: null,
  loyalty_points: 0,
  total_orders: 1,
  total_spent_cents: 5000,
  last_purchase_date: null,
  recent_sales: [],
  addresses: [],
  default_address: null,
  notes: null,
  created_at: null,
  ...over,
});

describe('CustomersScreen', () => {
  test('renders empty state when there are no customers', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/No customers/i)).toBeInTheDocument());
  });

  test('renders rows and a clickable row navigates to /customers/:id', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [sampleCustomer({ id: 99, name: 'Acme Co.' })],
        meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
      },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('Acme Co.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Acme Co.'));
    await waitFor(() => expect(screen.getByText(/CustomerDetail sentinel/)).toBeInTheDocument());
  });

  test('debounced search switches to customers.search', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } },
    });
    renderAt();
    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith('customers.list', { page: 1, per_page: 20 }, undefined),
    );

    const input = screen.getByPlaceholderText(/Name, email, phone/i);
    fireEvent.change(input, { target: { value: 'jane' } });

    act(() => {
      jest.advanceTimersByTime(350);
    });

    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith(
        'customers.search',
        { query: 'jane', term: 'jane', page: 1 },
        undefined,
      ),
    );
  });
});
