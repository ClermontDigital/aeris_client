import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AerisNavButton from '../AerisNavButton';

// Stable haptics.
jest.mock('../../../hooks/useHaptics', () => ({
  useHaptics: () => ({
    light: jest.fn(),
    medium: jest.fn(),
    selection: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  }),
}));

// Cart store selector — items flipped per test via this mutable holder.
const cart: {items: {quantity: number}[]} = {items: []};
jest.mock('../../../stores/cartStore', () => ({
  useCartStore: (sel: (s: {items: {quantity: number}[]}) => unknown) => sel(cart),
}));

// Workspace features — flag flipped per test via this mutable holder.
const workspace = {repairs_enabled: true};
jest.mock('../../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: (sel: (s: typeof workspace) => unknown) =>
    sel(workspace),
}));

const metrics = initialWindowMetrics ?? {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

function renderButton(
  opts: {onNavigate?: jest.Mock; activeTab?: string; showErp?: boolean} = {},
) {
  const onNavigate = opts.onNavigate ?? jest.fn();
  return {
    onNavigate,
    ...render(
      <SafeAreaProvider initialMetrics={metrics}>
        <AerisNavButton
          activeTab={opts.activeTab ?? 'QuickSale'}
          onNavigate={onNavigate}
          showErp={opts.showErp}
        />
      </SafeAreaProvider>,
    ),
  };
}

describe('AerisNavButton', () => {
  beforeEach(() => {
    workspace.repairs_enabled = true;
    cart.items = [];
    // Mark the first-run coach mark as already seen so its settle timer never
    // schedules — keeps these tests free of a leaked async timer.
    AsyncStorage.setItem('@aeris/nav-coach-seen-v1', '1');
  });

  it('is closed initially — the A button shows, the fan options do not', () => {
    const {queryByLabelText} = renderButton();
    expect(queryByLabelText('Open navigation menu')).toBeTruthy();
    // A fan destination is not rendered until the menu opens.
    expect(queryByLabelText('Items')).toBeNull();
  });

  it('opens the fan on press and navigates to the tapped destination', () => {
    const {getByLabelText, onNavigate} = renderButton();
    fireEvent.press(getByLabelText('Open navigation menu'));

    // Fan destinations are now rendered.
    expect(getByLabelText('Dashboard')).toBeTruthy();
    expect(getByLabelText('Sale')).toBeTruthy();
    expect(getByLabelText('Settings')).toBeTruthy();

    fireEvent.press(getByLabelText('Items'));
    expect(onNavigate).toHaveBeenCalledWith('Items');
  });

  it('routes Settings to the parent Settings screen', () => {
    const {getByLabelText, onNavigate} = renderButton();
    fireEvent.press(getByLabelText('Open navigation menu'));
    fireEvent.press(getByLabelText('Settings'));
    expect(onNavigate).toHaveBeenCalledWith('Settings');
  });

  it('hides Repairs when the workspace flag is off', () => {
    workspace.repairs_enabled = false;
    const {getByLabelText, queryByLabelText} = renderButton();
    fireEvent.press(getByLabelText('Open navigation menu'));
    expect(queryByLabelText('Repairs')).toBeNull();
    // The other destinations are still present.
    expect(getByLabelText('Customers')).toBeTruthy();
  });

  it('shows Repairs when the workspace flag is on', () => {
    const {getByLabelText} = renderButton();
    fireEvent.press(getByLabelText('Open navigation menu'));
    expect(getByLabelText('Repairs')).toBeTruthy();
  });

  it('hides the ERP (Aeris) destination by default and shows it when enabled', () => {
    const off = renderButton();
    fireEvent.press(off.getByLabelText('Open navigation menu'));
    expect(off.queryByLabelText('Aeris')).toBeNull();
    off.unmount();

    const on = renderButton({showErp: true});
    fireEvent.press(on.getByLabelText('Open navigation menu'));
    expect(on.getByLabelText('Aeris')).toBeTruthy();
  });

  it('shows the cart count on the docked A when the cart is non-empty', () => {
    cart.items = [{quantity: 2}, {quantity: 1}]; // getItemCount → 3
    const {getByLabelText} = renderButton();
    // The docked button's a11y label folds in the count (no fan open needed).
    expect(getByLabelText('Open navigation menu, 3 in cart')).toBeTruthy();
  });
});
