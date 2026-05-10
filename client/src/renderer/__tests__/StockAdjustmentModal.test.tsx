/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { StockAdjustmentModal } from '../components/StockAdjustmentModal';

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

describe('StockAdjustmentModal', () => {
  test('submits delta + reason to inventory.adjust-stock and fires onComplete', async () => {
    relayCallMock.mockResolvedValueOnce({
      ok: true,
      data: {
        product_id: 7,
        previous_quantity: 10,
        new_quantity: 13,
        adjustment: 3,
        reason: 'count_correction',
      },
    });

    const onClose = jest.fn();
    const onComplete = jest.fn();
    render(
      <StockAdjustmentModal
        open
        onClose={onClose}
        productId={7}
        currentStock={10}
        onComplete={onComplete}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Adjustment/i), { target: { value: '3' } });
    expect(screen.getByText(/^13$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Save adjustment/i }));

    await waitFor(() => {
      expect(relayCallMock).toHaveBeenCalledWith(
        'inventory.adjust-stock',
        expect.objectContaining({
          product_id: 7,
          adjustment: 3,
          reason: 'count_correction',
        }),
        undefined,
      );
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('rejects a zero delta with a validation error', async () => {
    const onComplete = jest.fn();
    render(
      <StockAdjustmentModal
        open
        onClose={jest.fn()}
        productId={1}
        currentStock={5}
        onComplete={onComplete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Save adjustment/i }));
    await waitFor(() =>
      expect(screen.getByText(/Enter a non-zero adjustment/i)).toBeInTheDocument(),
    );
    expect(relayCallMock).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('blocks adjustments that would drive stock below zero', async () => {
    render(
      <StockAdjustmentModal
        open
        onClose={jest.fn()}
        productId={1}
        currentStock={5}
        onComplete={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Adjustment/i), { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: /Save adjustment/i }));

    await waitFor(() =>
      expect(screen.getByText(/below zero/i)).toBeInTheDocument(),
    );
    expect(relayCallMock).not.toHaveBeenCalled();
  });
});
