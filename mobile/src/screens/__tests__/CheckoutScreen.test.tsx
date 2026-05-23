import React from 'react';
import {render} from '@testing-library/react-native';
import {KeyboardAvoidingView} from 'react-native';

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

// Direct store stub — see CartScreen.test.tsx for why we sidestep zustand
// under jest-expo + RTL.
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

const mockGetPaymentMethods = jest.fn().mockResolvedValue([]);
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getPaymentMethods: (...args: unknown[]) => mockGetPaymentMethods(...args),
    createSale: jest.fn(),
    getReceipt: jest.fn(),
  },
}));

jest.mock('../../services/PrintService', () => ({
  __esModule: true,
  default: {printHtml: jest.fn()},
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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn(), reset: jest.fn()}),
  // CheckoutScreen uses useFocusEffect (v1.3.28) to reset the QuickSale
  // stack on blur after a completed sale. In the test, focus events
  // don't fire — the cleanup callback never runs — so a no-op stub is
  // enough.
  useFocusEffect: () => undefined,
}));

import CheckoutScreen from '../CheckoutScreen';

describe('CheckoutScreen', () => {
  it('renders inside a KeyboardAvoidingView so the cash-tendered input is not occluded', () => {
    const {UNSAFE_getAllByType} = render(<CheckoutScreen />);
    const kavs = UNSAFE_getAllByType(KeyboardAvoidingView);
    expect(kavs.length).toBeGreaterThanOrEqual(1);
  });
});
