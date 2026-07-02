import React from 'react';
import {render} from '@testing-library/react-native';
import {KeyboardAvoidingView} from 'react-native';

// React 19's reportGlobalError uses window.dispatchEvent to surface caught
// errors. jest-expo's environment doesn't provide that — without the stub
// the real failure stack hides behind "window.dispatchEvent is not a fn".
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

// zustand's use-sync-external-store shim hits a React-instance mismatch
// under jest-expo + RTL (see AppTabs test for the long story). Stub the
// store directly: a function that supports both `useCartStore()` (returns
// the whole state) and `useCartStore(selector)` (returns selector(state)).
jest.mock('../../stores/cartStore', () => {
  const state = {
    items: [],
    customerId: null,
    customerName: null,
    discountCents: 0,
    notes: '',
    addItem: jest.fn(),
    removeItem: jest.fn(),
    updateQuantity: jest.fn(),
    setCustomer: jest.fn(),
    setDiscount: jest.fn(),
    setNotes: jest.fn(),
    clear: jest.fn(),
    getSubtotalCents: () => 0,
    getTaxCents: () => 0,
    getTotalCents: () => 0,
    getItemCount: () => 0,
  };
  const useCartStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useCartStore.getState = () => state;
  useCartStore.setState = jest.fn();
  useCartStore.subscribe = () => () => undefined;
  return {useCartStore};
});

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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    canGoBack: () => false,
    goBack: jest.fn(),
    // CartScreen subscribes to `beforeRemove` to clear the shared
    // header-back handler when the screen unmounts (v1.3.78+); the
    // subscribe fn must return an unsubscribe fn.
    addListener: jest.fn(() => jest.fn()),
  }),
  // CartScreen registers a header-back reset via useFocusEffect; focus
  // events don't fire in RTL so a no-op stub is enough.
  useFocusEffect: () => undefined,
}));

import CartScreen from '../CartScreen';

describe('CartScreen', () => {
  it('renders inside a KeyboardAvoidingView so iOS keyboard does not occlude inputs', () => {
    const {UNSAFE_getAllByType} = render(<CartScreen />);
    const kavs = UNSAFE_getAllByType(KeyboardAvoidingView);
    expect(kavs.length).toBeGreaterThanOrEqual(1);
  });
});
