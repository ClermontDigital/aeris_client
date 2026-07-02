import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
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
// under jest-expo + RTL. Split into two exposed setters (mockState / setup)
// so tests can flip cart contents / repair link before each render.
const mockCartState: {
  items: any[];
  customerId: number | null;
  customerName: string | null;
  discountCents: number;
  notes: string;
  repairId: number | null;
  repairNumber: string | null;
  addItem: jest.Mock;
  removeItem: jest.Mock;
  updateQuantity: jest.Mock;
  setCustomer: jest.Mock;
  setDiscount: jest.Mock;
  setNotes: jest.Mock;
  setRepairId: jest.Mock;
  setRepairNumber: jest.Mock;
  clear: jest.Mock;
  markSaleCompleted: jest.Mock;
  getSubtotalCents: () => number;
  getTaxCents: () => number;
  getTotalCents: () => number;
  getItemCount: () => number;
} = {
  items: [],
  customerId: null,
  customerName: null,
  discountCents: 0,
  notes: '',
  repairId: null,
  repairNumber: null,
  addItem: jest.fn(),
  removeItem: jest.fn(),
  updateQuantity: jest.fn(),
  setCustomer: jest.fn(),
  setDiscount: jest.fn(),
  setNotes: jest.fn(),
  setRepairId: jest.fn(),
  setRepairNumber: jest.fn(),
  clear: jest.fn(),
  markSaleCompleted: jest.fn(),
  getSubtotalCents: () => 1000,
  getTaxCents: () => 100,
  getTotalCents: () => 1100,
  getItemCount: () => 1,
};
jest.mock('../../stores/cartStore', () => {
  const useCartStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(mockCartState) : mockCartState;
  useCartStore.getState = () => mockCartState;
  useCartStore.setState = jest.fn();
  useCartStore.subscribe = () => () => undefined;
  return {useCartStore};
});

// Failover abort store — writes never blocked in tests.
const mockFailoverAbortState = {
  isWriteActionBlocked: () => false,
};
jest.mock('../../stores/failoverAbortStore', () => {
  const useFailoverAbortStore: any = (selector?: any) =>
    typeof selector === 'function'
      ? selector(mockFailoverAbortState)
      : mockFailoverAbortState;
  useFailoverAbortStore.getState = () => mockFailoverAbortState;
  return {useFailoverAbortStore};
});

// Transaction activity store
const mockTransactionActivityState = {
  activeScreen: null,
  saleInFlight: false,
  setSaleInFlight: jest.fn(),
  setActiveScreen: jest.fn(),
};
jest.mock('../../stores/transactionActivityStore', () => {
  const useTransactionActivityStore: any = (selector?: any) =>
    typeof selector === 'function'
      ? selector(mockTransactionActivityState)
      : mockTransactionActivityState;
  useTransactionActivityStore.getState = () => mockTransactionActivityState;
  return {useTransactionActivityStore};
});

// Routing hook — always cloud so failover tender gate is off.
jest.mock('../../hooks/useRoutingDecision', () => ({
  useRoutingDecision: () => ({currentMode: 'cloud'}),
}));

// Include an "on account" (non-cash) tender so tests can pick one without
// filling in an amount-tendered field. The failover tender-gate is off in
// tests (currentMode = 'cloud') so a non-cash method is selectable.
const mockGetPaymentMethods = jest.fn().mockResolvedValue([
  {code: 'cash', name: 'Cash', requires_reference: false},
  {code: 'other', name: 'Other', requires_reference: false},
]);
const mockCreateSale = jest.fn().mockResolvedValue({
  sale_id: 42,
  sale_number: 'S-42',
  total_cents: 1100,
});
const mockGetRepairDetail = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getPaymentMethods: (...args: unknown[]) => mockGetPaymentMethods(...args),
    createSale: (...args: unknown[]) => mockCreateSale(...args),
    getReceipt: jest.fn(),
    getRepairDetail: (...args: unknown[]) => mockGetRepairDetail(...args),
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
  useFocusEffect: () => undefined,
}));

import CheckoutScreen from '../CheckoutScreen';

function resetCart() {
  mockCartState.items = [];
  mockCartState.customerId = null;
  mockCartState.customerName = null;
  mockCartState.discountCents = 0;
  mockCartState.notes = '';
  mockCartState.repairId = null;
  mockCartState.repairNumber = null;
}

describe('CheckoutScreen', () => {
  beforeEach(() => {
    resetCart();
    mockCreateSale.mockClear().mockResolvedValue({
      sale_id: 42,
      sale_number: 'S-42',
      total_cents: 1100,
    });
    mockGetRepairDetail.mockReset();
    mockGetPaymentMethods.mockClear().mockResolvedValue([
      {code: 'cash', name: 'Cash', requires_reference: false},
      {code: 'other', name: 'Other', requires_reference: false},
    ]);
  });

  it('renders inside a KeyboardAvoidingView so the cash-tendered input is not occluded', () => {
    const {UNSAFE_getAllByType} = render(<CheckoutScreen />);
    const kavs = UNSAFE_getAllByType(KeyboardAvoidingView);
    expect(kavs.length).toBeGreaterThanOrEqual(1);
  });

  // T8 — repairId in the cart threads through to sale.create at the top
  // level, and the pre-flight guard blocks a submit when the repair has
  // drifted from 'ready'. Both paths tested here.
  it('T8 — when repairId is set, sale.create fires with repair_id at the top level', async () => {
    mockCartState.items = [
      {
        product: {
          id: 1,
          name: 'Screen',
          sku: 'S1',
          barcode: null,
          price_cents: 1100,
          tax_rate: 10,
          stock_on_hand: 0,
          category_id: null,
          category_name: null,
          image_url: null,
          is_active: true,
        },
        quantity: 1,
        unit_price_cents: 1100,
        discount_cents: 0,
      },
    ];
    mockCartState.customerId = 42;
    mockCartState.repairId = 7;
    mockCartState.repairNumber = '0001';
    mockGetRepairDetail.mockResolvedValueOnce({
      id: 7,
      status: 'ready',
    });

    const {findByLabelText} = render(<CheckoutScreen />);

    // Live payment methods have loaded.
    await waitFor(() => {
      expect(mockGetPaymentMethods).toHaveBeenCalled();
    });

    // Pick a non-cash tender so canComplete becomes true without needing
    // an amount-tendered value.
    const otherBtn = await findByLabelText(/Payment method Other/);
    await act(async () => {
      fireEvent.press(otherBtn);
    });

    const completeBtn = await findByLabelText('Complete sale');
    await act(async () => {
      fireEvent.press(completeBtn);
    });

    await waitFor(() => {
      expect(mockCreateSale).toHaveBeenCalledTimes(1);
    });
    // Pre-flight guard fired first.
    expect(mockGetRepairDetail).toHaveBeenCalledWith(7);
    // sale.create carries repair_id at the top level.
    const payload = mockCreateSale.mock.calls[0][0];
    expect(payload.repair_id).toBe(7);
    expect(payload.customer_id).toBe(42);
    // T8-COV-04 remediation: successful sale.create must eventually clear
    // the cart, which also unlinks repairId (via cartStore.clear extension).
    // The success view exposes "Start a new sale" which routes through clear().
    const startNewSale = await findByLabelText('Start a new sale');
    await act(async () => {
      fireEvent.press(startNewSale);
    });
    expect(mockCartState.clear).toHaveBeenCalled();
  });

  it('T8 — blocks the submit with an ErrorBanner when the repair is no longer ready', async () => {
    mockCartState.items = [
      {
        product: {
          id: 1,
          name: 'Screen',
          sku: 'S1',
          barcode: null,
          price_cents: 1100,
          tax_rate: 10,
          stock_on_hand: 0,
          category_id: null,
          category_name: null,
          image_url: null,
          is_active: true,
        },
        quantity: 1,
        unit_price_cents: 1100,
        discount_cents: 0,
      },
    ];
    mockCartState.customerId = 42;
    mockCartState.repairId = 7;
    mockCartState.repairNumber = '0001';
    // Status drifted since the page rendered — no longer 'ready'.
    mockGetRepairDetail.mockResolvedValueOnce({
      id: 7,
      status: 'completed',
    });

    const {findByLabelText, findByText} = render(<CheckoutScreen />);

    await waitFor(() => {
      expect(mockGetPaymentMethods).toHaveBeenCalled();
    });

    const otherBtn = await findByLabelText(/Payment method Other/);
    await act(async () => {
      fireEvent.press(otherBtn);
    });

    const completeBtn = await findByLabelText('Complete sale');
    await act(async () => {
      fireEvent.press(completeBtn);
    });

    // The ErrorBanner surfaces the guard message; sale.create never fires.
    await findByText(/no longer ready for checkout/);
    expect(mockCreateSale).not.toHaveBeenCalled();
  });
});
