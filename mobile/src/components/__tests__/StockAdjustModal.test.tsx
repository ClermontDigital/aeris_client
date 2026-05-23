import React from 'react';
import {render, fireEvent, waitFor, act} from '@testing-library/react-native';

// React 19's reportGlobalError uses window.dispatchEvent — stub it.
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

const mockAdjustStock = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    adjustStock: (...args: unknown[]) => mockAdjustStock(...args),
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

// Auth store mock — ErrorBanner reads it via getState() + subscribe().
jest.mock('../../stores/authStore', () => {
  const state = {user: null, isAuthenticated: true, errorKind: null};
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  (useAuthStore as unknown as {getState: () => typeof state}).getState = () =>
    state;
  (useAuthStore as unknown as {subscribe: (l: () => void) => () => void}).subscribe =
    () => () => undefined;
  return {useAuthStore};
});

jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (
    selector: (s: {settings: {hapticsEnabled: boolean}}) => unknown,
  ) => selector({settings: {hapticsEnabled: true}}),
}));

// react-native-modal's animation backdrop relies on the host's window
// dimensions. Replace it with an isVisible-gated passthrough so children
// render synchronously in RTL — matches the SettingsModal test approach.
jest.mock('react-native-modal', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: ({
      isVisible,
      children,
    }: {
      isVisible: boolean;
      children: React.ReactNode;
    }) => (isVisible ? <View testID="rn-modal">{children}</View> : null),
  };
});

import StockAdjustModal from '../StockAdjustModal';

describe('StockAdjustModal', () => {
  const baseProps = {
    productId: 7,
    productName: 'Flat white',
    currentStock: 10,
  };

  beforeEach(() => {
    mockAdjustStock.mockReset();
  });

  it('renders nothing when not visible', () => {
    const {queryByText} = render(
      <StockAdjustModal
        {...baseProps}
        visible={false}
        onClose={jest.fn()}
        onAdjusted={jest.fn()}
      />,
    );
    expect(queryByText('Flat white')).toBeNull();
  });

  it('renders when visible with the product name + current stock', () => {
    const {getByText, getAllByText} = render(
      <StockAdjustModal
        {...baseProps}
        visible={true}
        onClose={jest.fn()}
        onAdjusted={jest.fn()}
      />,
    );
    expect(getByText('Flat white')).toBeTruthy();
    expect(getByText('Current on hand')).toBeTruthy();
    // currentStock=10 appears twice: the "Current on hand" row + the
    // "New on hand" projected row (which mirrors current until a delta is
    // entered). Both occurrences are valid.
    expect(getAllByText('10').length).toBeGreaterThanOrEqual(1);
  });

  it('accepts a negative delta, calls adjustStock with the right shape, fires onAdjusted + onClose', async () => {
    mockAdjustStock.mockResolvedValue({
      product_id: 7,
      previous_quantity: 10,
      new_quantity: 8,
      adjustment: -2,
      reason: 'damaged_goods',
    });
    const onClose = jest.fn();
    const onAdjusted = jest.fn();

    const {getByLabelText} = render(
      <StockAdjustModal
        {...baseProps}
        visible={true}
        onClose={onClose}
        onAdjusted={onAdjusted}
      />,
    );

    fireEvent.changeText(getByLabelText('Stock change amount'), '-2');
    fireEvent.press(getByLabelText('Reason: Damaged'));

    await act(async () => {
      fireEvent.press(getByLabelText('Confirm stock adjustment'));
    });

    await waitFor(() => expect(mockAdjustStock).toHaveBeenCalledTimes(1));
    expect(mockAdjustStock).toHaveBeenCalledWith({
      product_id: 7,
      adjustment: -2,
      reason: 'damaged_goods',
    });
    expect(onAdjusted).toHaveBeenCalledWith(8);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the submit button disabled until both delta and reason are set', () => {
    const {getByLabelText} = render(
      <StockAdjustModal
        {...baseProps}
        visible={true}
        onClose={jest.fn()}
        onAdjusted={jest.fn()}
      />,
    );
    const submit = getByLabelText('Confirm stock adjustment');
    expect(submit.props.accessibilityState?.disabled).toBe(true);

    // Just a delta: still missing reason.
    fireEvent.changeText(getByLabelText('Stock change amount'), '5');
    expect(submit.props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(getByLabelText('Reason: Stocktake'));
    expect(submit.props.accessibilityState?.disabled).toBe(false);
  });

  it('switches to absolute mode and translates to a signed adjustment', async () => {
    mockAdjustStock.mockResolvedValue({
      product_id: 7,
      previous_quantity: 10,
      new_quantity: 25,
      adjustment: 15,
      reason: 'count_correction',
    });

    const {getByLabelText} = render(
      <StockAdjustModal
        {...baseProps}
        visible={true}
        onClose={jest.fn()}
        onAdjusted={jest.fn()}
      />,
    );

    fireEvent.press(getByLabelText('Set absolute amount'));
    fireEvent.changeText(getByLabelText('New on-hand quantity'), '25');
    fireEvent.press(getByLabelText('Reason: Stocktake'));

    await act(async () => {
      fireEvent.press(getByLabelText('Confirm stock adjustment'));
    });

    await waitFor(() => expect(mockAdjustStock).toHaveBeenCalled());
    // currentStock=10, target=25 → adjustment 15
    expect(mockAdjustStock).toHaveBeenCalledWith({
      product_id: 7,
      adjustment: 15,
      reason: 'count_correction',
    });
  });
});
