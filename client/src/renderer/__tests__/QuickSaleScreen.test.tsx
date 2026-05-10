/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QuickSaleScreen } from '../screens/QuickSaleScreen';
import { useCartStore } from '../stores/cartStore';

const relayCallMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
  jest.useFakeTimers();
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
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
  useCartStore.getState().clear();
});

const sampleProduct = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  name: 'Widget',
  sku: 'W-001',
  barcode: null,
  price_cents: 1500,
  tax_rate: 10,
  stock_on_hand: 12,
  category_id: null,
  category_name: null,
  image_url: null,
  is_active: true,
  ...over,
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/pos']}>
      <QuickSaleScreen />
    </MemoryRouter>,
  );
}

describe('QuickSaleScreen', () => {
  test('initial fetch hits products.list', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 50, total: 0 } },
    });
    renderScreen();
    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith('products.list', { page: 1, per_page: 50 }, undefined),
    );
  });

  test('debounced search switches to products.search after the delay', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 50, total: 0 } },
    });
    renderScreen();
    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith('products.list', { page: 1, per_page: 50 }, undefined),
    );

    const input = screen.getByLabelText(/Search products/i);
    fireEvent.change(input, { target: { value: 'gizmo' } });
    expect(relayCallMock).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(350);
    });

    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith(
        'products.search',
        { query: 'gizmo', page: 1, per_page: 50 },
        undefined,
      ),
    );
  });

  test('clicking a product tile adds it to the cart', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [sampleProduct({ id: 99, name: 'Doohickey', price_cents: 2500 })],
        meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
      },
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Doohickey')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/Add Doohickey to cart/i));

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].product.id).toBe(99);
    expect(useCartStore.getState().getItemCount()).toBe(1);
  });

  test('out-of-stock click is suppressed and surfaces an inline notice', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          sampleProduct({ id: 200, name: 'Empty Bin', stock_on_hand: 0 }),
        ],
        meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
      },
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Empty Bin')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/Add Empty Bin to cart/i));

    expect(useCartStore.getState().items).toHaveLength(0);
    expect(useCartStore.getState().getItemCount()).toBe(0);
    expect(screen.getByText(/Empty Bin is out of stock/i)).toBeInTheDocument();
  });

  test('non-stock-tracked products bypass the gate even at zero on-hand', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          sampleProduct({
            id: 300,
            name: 'Service Item',
            stock_on_hand: 0,
            track_stock: false,
          }),
        ],
        meta: { current_page: 1, last_page: 1, per_page: 50, total: 1 },
      },
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Service Item')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/Add Service Item to cart/i));

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0].product.id).toBe(300);
  });
});
