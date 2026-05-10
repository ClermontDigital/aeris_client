/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { Product } from '@aeris/shared';
import { CartScreen } from '../screens/CartScreen';
import { useCartStore } from '../stores/cartStore';

const relayCallMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
  // Persist middleware (added to cartStore in v2.1) survives across tests in the
  // same module — clear it before every render so seeded state is deterministic.
  useCartStore.getState().clear();
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

function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Widget',
    sku: 'W-001',
    barcode: null,
    price_cents: 1100,
    tax_rate: 10,
    stock_on_hand: 50,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
    ...over,
  };
}

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/pos/cart']}>
      <CartScreen />
    </MemoryRouter>,
  );
}

describe('CartScreen', () => {
  test('renders the empty state when the cart has no items', () => {
    renderScreen();
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear cart/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue to checkout/i })).not.toBeInTheDocument();
  });

  test('seeded items render with per-line subtotal and the cart total', () => {
    useCartStore.getState().addItem(makeProduct({ id: 1, name: 'Widget', price_cents: 1100 }));
    useCartStore.getState().addItem(
      makeProduct({ id: 2, name: 'Gizmo', sku: 'G-002', price_cents: 500 }),
      2,
    );
    renderScreen();

    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('Gizmo')).toBeInTheDocument();
    // 1*$11 + 2*$5 = $21 inc-GST grand total. Intl AUD formatter prefixes "A$".
    expect(screen.getByText(/21\.00/)).toBeInTheDocument();
    // Per-line subtotal for Gizmo: $5.00 × 2 = $10.00.
    expect(screen.getByText(/5\.00 × 2 = .*10\.00/)).toBeInTheDocument();
    expect(screen.getByText(/3 items/i)).toBeInTheDocument();
  });

  test('discount input clamps to no more than the cart total', () => {
    useCartStore.getState().addItem(makeProduct({ id: 1, price_cents: 1000 }));
    renderScreen();

    const discountInput = screen.getByLabelText(/cart discount/i) as HTMLInputElement;
    // Try to overshoot the $10 total with a $50 discount — clampDiscountCents
    // floors the grand total at $0, so the store keeps 1000 cents.
    fireEvent.change(discountInput, { target: { value: '50' } });
    fireEvent.blur(discountInput);

    expect(useCartStore.getState().discountCents).toBe(1000);
  });

  test('clear-cart confirmation only fires the store clear after the destructive button', () => {
    useCartStore.getState().addItem(makeProduct({ id: 1 }));
    useCartStore.getState().addItem(makeProduct({ id: 2 }));
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }));
    // Modal open: Cancel must be a no-op against the store.
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useCartStore.getState().items).toHaveLength(2);

    // Re-open and confirm the destructive Clear button.
    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }));
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  test('barcode form Enter triggers a products.barcode relay call', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { ...makeProduct({ id: 7, name: 'Scanned' }), description: null, additional_skus: [] },
    });
    renderScreen();

    const input = screen.getByLabelText(/^barcode$/i);
    fireEvent.change(input, { target: { value: '12345' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith(
        'products.barcode',
        { barcode: '12345' },
        undefined,
      ),
    );
    await waitFor(() => expect(useCartStore.getState().items).toHaveLength(1));
    expect(useCartStore.getState().items[0].product.id).toBe(7);
  });
});
