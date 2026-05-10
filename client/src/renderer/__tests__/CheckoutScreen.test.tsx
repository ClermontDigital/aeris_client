/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { useCartStore } from '../stores/cartStore';
import type { Product } from '@aeris/shared';

const relayCallMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
  useCartStore.getState().clear();
  // jsdom 20+ exposes crypto.randomUUID; assert it for the idempotency key.
  if (!(globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'test-uuid-1234' },
    });
  }
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
      print: {
        receipt: jest.fn().mockResolvedValue({ ok: true }),
        testPage: jest.fn().mockResolvedValue({ ok: true }),
      },
    },
  });
});

afterEach(() => {
  useCartStore.getState().clear();
});

function makeProduct(): Product {
  return {
    id: 1,
    name: 'Widget',
    sku: 'WID-1',
    barcode: null,
    price_cents: 1100, // $11 inc-GST
    tax_rate: 10,
    stock_on_hand: 100,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
  };
}

function seedCart() {
  useCartStore.getState().addItem(makeProduct());
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/pos/checkout']}>
      <Routes>
        <Route path="/pos/checkout" element={<CheckoutScreen />} />
        <Route path="/transactions/:id" element={<div>Transaction sentinel</div>} />
        <Route path="/pos" element={<div>Quick Sale sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CheckoutScreen', () => {
  test('happy path: cash, tender, submit, success view', async () => {
    seedCart();
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'pos.payment-methods') {
        return Promise.resolve({
          ok: true,
          data: [
            { code: 'cash', name: 'Cash', requires_reference: false },
            { code: 'card', name: 'Card', requires_reference: false },
          ],
        });
      }
      if (action === 'sale.create') {
        return Promise.resolve({
          ok: true,
          data: { sale_id: 1234, sale_number: 'S-1234', total_cents: 1100 },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderScreen();

    await waitFor(() => expect(screen.getByRole('button', { name: /Cash/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Cash/ }));
    const tendered = await screen.findByLabelText(/Amount tendered/i);
    fireEvent.change(tendered, { target: { value: '20.00' } });

    fireEvent.click(screen.getByRole('button', { name: /Process sale/i }));

    await waitFor(() => {
      const call = relayCallMock.mock.calls.find((c) => c[0] === 'sale.create');
      expect(call).toBeTruthy();
      expect(call![1]).toEqual(
        expect.objectContaining({
          items: expect.any(Array),
          payments: expect.any(Array),
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Sale complete/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/#S-1234/)).toBeInTheDocument();
  });

  test('cart is cleared once the sale succeeds (no duplicate-submit window)', async () => {
    seedCart();
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'pos.payment-methods') {
        return Promise.resolve({
          ok: true,
          data: [{ code: 'cash', name: 'Cash', requires_reference: false }],
        });
      }
      if (action === 'sale.create') {
        return Promise.resolve({
          ok: true,
          data: { sale_id: 7, sale_number: 'S-7', total_cents: 1100 },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Cash/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Cash/ }));
    const tendered = await screen.findByLabelText(/Amount tendered/i);
    fireEvent.change(tendered, { target: { value: '11.00' } });
    fireEvent.click(screen.getByRole('button', { name: /Process sale/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Sale complete/i })).toBeInTheDocument(),
    );

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().getItemCount()).toBe(0);
  });

  test('fallback payment-method state still allows cash submit', async () => {
    seedCart();
    // pos.payment-methods returns ok:false → renderer flips to fallback.
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'pos.payment-methods') {
        return Promise.resolve({ ok: false, code: 'NETWORK', message: 'no net' });
      }
      if (action === 'sale.create') {
        return Promise.resolve({
          ok: true,
          data: { sale_id: 9, sale_number: 'S-9', total_cents: 1100 },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderScreen();
    await waitFor(() =>
      expect(screen.getByText(/Using offline defaults/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Cash/ }));
    const tendered = await screen.findByLabelText(/Amount tendered/i);
    fireEvent.change(tendered, { target: { value: '11.00' } });

    const submit = screen.getByRole('button', { name: /Process sale/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Sale complete/i })).toBeInTheDocument(),
    );
  });

  test('error path: NETWORK error keeps Process sale button enabled to retry', async () => {
    seedCart();
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'pos.payment-methods') {
        return Promise.resolve({
          ok: true,
          data: [{ code: 'cash', name: 'Cash', requires_reference: false }],
        });
      }
      if (action === 'sale.create') {
        return Promise.resolve({
          ok: false,
          code: 'NETWORK',
          message: 'Network error.',
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Cash/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Cash/ }));
    const tendered = await screen.findByLabelText(/Amount tendered/i);
    fireEvent.change(tendered, { target: { value: '20.00' } });

    const submit = screen.getByRole('button', { name: /Process sale/i });
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByText(/Network error/i)).toBeInTheDocument());

    // Button stays enabled so the operator can retry without losing the cart.
    expect(submit).not.toBeDisabled();
  });

  test('cash overpayment still sends amount_cents = totalCents (server reconciles vs total)', async () => {
    seedCart();
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'pos.payment-methods') {
        return Promise.resolve({
          ok: true,
          data: [{ code: 'cash', name: 'Cash', requires_reference: false }],
        });
      }
      if (action === 'sale.create') {
        return Promise.resolve({
          ok: true,
          data: { sale_id: 1, sale_number: 'S-1', total_cents: 1100 },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Cash/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Cash/ }));
    const tendered = await screen.findByLabelText(/Amount tendered/i);
    // Hand over a $20 note for an $11 sale — overpayment must NOT appear in
    // the payments[].amount_cents or the server's cross-field validator 422s.
    fireEvent.change(tendered, { target: { value: '20.00' } });
    fireEvent.click(screen.getByRole('button', { name: /Process sale/i }));

    await waitFor(() => {
      expect(relayCallMock.mock.calls.some((c) => c[0] === 'sale.create')).toBe(true);
    });
    const call = relayCallMock.mock.calls.find((c) => c[0] === 'sale.create');
    expect(call).toBeTruthy();
    const payload = call![1] as {
      items: Array<{ unit_price_cents: number; quantity: number }>;
      payments: Array<{ amount_cents: number; method: string }>;
    };
    expect(payload.items[0].unit_price_cents).toBe(1100);
    expect(payload.items[0].quantity).toBe(1);
    // Regression guard for C1 — must equal the cart total, NOT the tender.
    expect(payload.payments[0].amount_cents).toBe(1100);
    expect(payload.payments[0].method).toBe('cash');
  });

  test('card payment keeps amount_cents at the sale total', async () => {
    seedCart();
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'pos.payment-methods') {
        return Promise.resolve({
          ok: true,
          data: [{ code: 'card', name: 'Card', requires_reference: false }],
        });
      }
      if (action === 'sale.create') {
        return Promise.resolve({
          ok: true,
          data: { sale_id: 2, sale_number: 'S-2', total_cents: 1100 },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Card/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Card/ }));
    fireEvent.click(screen.getByRole('button', { name: /Process sale/i }));

    await waitFor(() => {
      expect(relayCallMock.mock.calls.some((c) => c[0] === 'sale.create')).toBe(true);
    });
    const call = relayCallMock.mock.calls.find((c) => c[0] === 'sale.create');
    const payload = call![1] as {
      payments: Array<{ amount_cents: number; method: string }>;
    };
    expect(payload.payments[0].amount_cents).toBe(1100);
    expect(payload.payments[0].method).toBe('card');
  });

  test('C1 regression: large cash overpayment never leaks tender into payments[].amount_cents', async () => {
    // Distinct from the $20-on-$11 case above: $100 on $11 ($89 change). The
    // server's cross-field validator (`subtotal + tax - discount == sum
    // payments`) would 422 if the renderer ever sends the tender instead of
    // the total.
    seedCart();
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'pos.payment-methods') {
        return Promise.resolve({
          ok: true,
          data: [{ code: 'cash', name: 'Cash', requires_reference: false }],
        });
      }
      if (action === 'sale.create') {
        return Promise.resolve({
          ok: true,
          data: { sale_id: 42, sale_number: 'S-42', total_cents: 1100 },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderScreen();
    await waitFor(() => expect(screen.getByRole('button', { name: /Cash/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Cash/ }));
    const tendered = await screen.findByLabelText(/Amount tendered/i);
    fireEvent.change(tendered, { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: /Process sale/i }));

    await waitFor(() =>
      expect(relayCallMock.mock.calls.some((c) => c[0] === 'sale.create')).toBe(true),
    );
    const call = relayCallMock.mock.calls.find((c) => c[0] === 'sale.create');
    const payload = call![1] as {
      payments: Array<{ amount_cents: number; method: string }>;
    };
    expect(payload.payments[0].amount_cents).toBe(1100);
    expect(payload.payments[0].amount_cents).not.toBe(10000);
  });
});
