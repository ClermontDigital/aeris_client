/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CustomerEditScreen } from '../screens/CustomerEditScreen';

const relayCallMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
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
      settings: {
        get: jest.fn(),
        set: jest.fn(),
        onChanged: jest.fn().mockReturnValue(() => undefined),
      },
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/customers" element={<div>List sentinel</div>} />
        <Route path="/customers/new" element={<CustomerEditScreen />} />
        <Route path="/customers/:id/edit" element={<CustomerEditScreen />} />
        <Route path="/customers/:id" element={<div>Detail sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CustomerEditScreen — create mode', () => {
  test('fills the form, submits, calls relayCall with the right action + payload, navigates to detail', async () => {
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'customers.create') {
        return Promise.resolve({
          ok: true,
          data: {
            id: 99,
            name: 'Pat Person',
            first_name: 'Pat',
            last_name: 'Person',
            company: null,
            email: 'pat@example.com',
            phone: '0400000000',
            mobile: null,
            customer_number: 'C-99',
            account_balance_cents: 0,
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
          },
        });
      }
      // customers.detail (fired by the form's read query) — unused in create mode.
      return Promise.resolve({ ok: true, data: null });
    });

    renderAt('/customers/new');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /New customer/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/^First name$/i), { target: { value: 'Pat' } });
    fireEvent.change(screen.getByLabelText(/^Last name$/i), { target: { value: 'Person' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'pat@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Phone$/i), { target: { value: '0400000000' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Brisbane' } });

    fireEvent.click(screen.getByRole('button', { name: /Create customer/i }));

    await waitFor(() => {
      expect(relayCallMock).toHaveBeenCalledWith(
        'customers.create',
        expect.objectContaining({
          first_name: 'Pat',
          last_name: 'Person',
          email: 'pat@example.com',
          phone: '0400000000',
          city: 'Brisbane',
        }),
        undefined,
      );
    });

    await waitFor(() =>
      expect(screen.getByText(/Detail sentinel/)).toBeInTheDocument(),
    );
  });

  test('shows validation error when neither first name nor company is set', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: null });
    renderAt('/customers/new');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /New customer/i })).toBeInTheDocument(),
    );

    // The first_name input is `required`; bypass HTML5 validation by submitting
    // through the form rather than clicking the button (which the browser would
    // intercept). With no name and no company, our explicit JS check fires.
    const form = document.querySelector('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(
        screen.getByRole('alert'),
      ).toHaveTextContent(/Either first name or company is required/i),
    );
    // No relay call was attempted for create.
    const createCalls = relayCallMock.mock.calls.filter((c) => c[0] === 'customers.create');
    expect(createCalls.length).toBe(0);
  });

  test('blocks submit when no contact channel is provided (mirrors server 422)', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: null });
    renderAt('/customers/new');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /New customer/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/^First name$/i), { target: { value: 'Pat' } });
    // Leave email/phone/mobile empty.
    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /at least one contact method/i,
      ),
    );
    const createCalls = relayCallMock.mock.calls.filter((c) => c[0] === 'customers.create');
    expect(createCalls.length).toBe(0);
  });
});
