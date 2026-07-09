import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
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

// Cart store selector → empty cart (no badge).
jest.mock('../../../stores/cartStore', () => ({
  useCartStore: (sel: (s: {items: unknown[]}) => unknown) => sel({items: []}),
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

function renderButton(onNavigate = jest.fn(), activeTab = 'QuickSale') {
  return {
    onNavigate,
    ...render(
      <SafeAreaProvider initialMetrics={metrics}>
        <AerisNavButton activeTab={activeTab} onNavigate={onNavigate} />
      </SafeAreaProvider>,
    ),
  };
}

describe('AerisNavButton', () => {
  beforeEach(() => {
    workspace.repairs_enabled = true;
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
});
