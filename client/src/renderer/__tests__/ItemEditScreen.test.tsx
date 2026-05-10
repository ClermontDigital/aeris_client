/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ItemEditScreen } from '../screens/ItemEditScreen';

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
        <Route path="/items" element={<div>List sentinel</div>} />
        <Route path="/items/new" element={<ItemEditScreen />} />
        <Route path="/items/:id/edit" element={<ItemEditScreen />} />
        <Route path="/items/:id" element={<div>Detail sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ItemEditScreen — create mode', () => {
  test('fills the form, submits, calls relayCall(products.create) with cents-shape payload, navigates to detail', async () => {
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'products.categories') {
        return Promise.resolve({
          ok: true,
          data: [
            { id: 1, name: 'Beverages' },
            { id: 2, name: 'Snacks' },
          ],
        });
      }
      if (action === 'products.create') {
        return Promise.resolve({
          ok: true,
          data: {
            id: 555,
            name: 'New Widget',
            sku: 'NW-1',
            barcode: null,
            price_cents: 1500,
            tax_rate: 10,
            stock_on_hand: 5,
            category_id: 1,
            category_name: 'Beverages',
            image_url: null,
            is_active: true,
          },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderAt('/items/new');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /New item/i })).toBeInTheDocument(),
    );
    // Wait for categories to populate the select.
    await waitFor(() => expect(screen.getByText('Beverages')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'New Widget' } });
    fireEvent.change(screen.getByLabelText(/^SKU$/i), { target: { value: 'NW-1' } });
    fireEvent.change(screen.getByLabelText(/^Price/i), { target: { value: '15.00' } });
    fireEvent.change(screen.getByLabelText(/^Category/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Initial stock/i), { target: { value: '5' } });

    fireEvent.click(screen.getByRole('button', { name: /Create item/i }));

    await waitFor(() => {
      const create = relayCallMock.mock.calls.find((c) => c[0] === 'products.create');
      expect(create).toBeTruthy();
      expect(create![1]).toEqual(
        expect.objectContaining({
          name: 'New Widget',
          sku: 'NW-1',
          base_price_cents: 1500,
          category_id: 1,
          stock_quantity: 5,
          gst_applicable: true,
          tax_rate: 10,
          track_stock: true,
        }),
      );
    });

    await waitFor(() => expect(screen.getByText(/Detail sentinel/)).toBeInTheDocument());
  });

  test('disabling GST sends tax_rate: 0 alongside gst_applicable: false', async () => {
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'products.categories') {
        return Promise.resolve({ ok: true, data: [{ id: 1, name: 'Beverages' }] });
      }
      if (action === 'products.create') {
        return Promise.resolve({
          ok: true,
          data: {
            id: 1,
            name: 'X',
            sku: 'X-1',
            barcode: null,
            price_cents: 500,
            tax_rate: 0,
            stock_on_hand: 0,
            category_id: 1,
            category_name: 'Beverages',
            image_url: null,
            is_active: true,
          },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderAt('/items/new');

    await waitFor(() => expect(screen.getByText('Beverages')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^SKU$/i), { target: { value: 'X-1' } });
    fireEvent.change(screen.getByLabelText(/^Price/i), { target: { value: '5.00' } });
    fireEvent.change(screen.getByLabelText(/^Category/i), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText(/GST applicable/i));

    fireEvent.click(screen.getByRole('button', { name: /Create item/i }));

    await waitFor(() => {
      const create = relayCallMock.mock.calls.find((c) => c[0] === 'products.create');
      expect(create).toBeTruthy();
      expect(create![1]).toEqual(
        expect.objectContaining({
          gst_applicable: false,
          tax_rate: 0,
        }),
      );
    });
  });

  test('edit hydration preserves track_stock: false from the fetched product', async () => {
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'products.categories') {
        return Promise.resolve({ ok: true, data: [{ id: 1, name: 'Beverages' }] });
      }
      if (action === 'products.detail') {
        return Promise.resolve({
          ok: true,
          data: {
            id: 42,
            name: 'No-stock Service',
            sku: 'SVC-1',
            barcode: null,
            price_cents: 5000,
            tax_rate: 10,
            stock_on_hand: 0,
            category_id: 1,
            category_name: 'Beverages',
            image_url: null,
            is_active: true,
            description: null,
            cost_cents: null,
            stock_levels: [],
            variants: [],
            track_stock: false,
          },
        });
      }
      if (action === 'products.update') {
        return Promise.resolve({
          ok: true,
          data: {
            id: 42,
            name: 'No-stock Service',
            sku: 'SVC-1',
            barcode: null,
            price_cents: 5000,
            tax_rate: 10,
            stock_on_hand: 0,
            category_id: 1,
            category_name: 'Beverages',
            image_url: null,
            is_active: true,
          },
        });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderAt('/items/42/edit');

    await waitFor(() => expect(screen.getByDisplayValue('No-stock Service')).toBeInTheDocument());

    // The `Track inventory` checkbox should reflect the fetched value (false).
    const trackBox = screen.getByLabelText(/Track inventory/i) as HTMLInputElement;
    expect(trackBox.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    await waitFor(() => {
      const update = relayCallMock.mock.calls.find((c) => c[0] === 'products.update');
      expect(update).toBeTruthy();
      expect(update![1]).toEqual(
        expect.objectContaining({
          id: 42,
          track_stock: false,
        }),
      );
    });
  });

  test('shows error when category is missing', async () => {
    relayCallMock.mockImplementation((action: string) => {
      if (action === 'products.categories') {
        return Promise.resolve({ ok: true, data: [{ id: 1, name: 'Beverages' }] });
      }
      return Promise.resolve({ ok: true, data: null });
    });

    renderAt('/items/new');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /New item/i })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^SKU$/i), { target: { value: 'X-1' } });
    fireEvent.change(screen.getByLabelText(/^Price/i), { target: { value: '5.00' } });
    fireEvent.click(screen.getByRole('button', { name: /Create item/i }));

    await waitFor(() =>
      expect(screen.getByText(/Category is required/i)).toBeInTheDocument(),
    );
    const createCalls = relayCallMock.mock.calls.filter((c) => c[0] === 'products.create');
    expect(createCalls.length).toBe(0);
  });
});
