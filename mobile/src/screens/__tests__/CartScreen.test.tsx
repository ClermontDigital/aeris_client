import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
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
const mockCartState: any = {
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
  getSubtotalCents: () => 0,
  getTaxCents: () => 0,
  getTotalCents: () => 0,
  getItemCount: () => 0,
};
jest.mock('../../stores/cartStore', () => {
  const useCartStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(mockCartState) : mockCartState;
  useCartStore.getState = () => mockCartState;
  useCartStore.setState = jest.fn();
  useCartStore.subscribe = () => () => undefined;
  return {useCartStore};
});

// Workspace features store — controllable per-test.
const mockWorkspaceState = {repairs_enabled: false};
jest.mock('../../stores/workspaceFeaturesStore', () => {
  const useWorkspaceFeaturesStore: any = (selector?: any) =>
    typeof selector === 'function'
      ? selector(mockWorkspaceState)
      : mockWorkspaceState;
  useWorkspaceFeaturesStore.getState = () => mockWorkspaceState;
  return {useWorkspaceFeaturesStore};
});

const mockGetPendingRepairsForCustomer = jest.fn();
const mockGetRepairDetail = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getPendingRepairsForCustomer: (...args: unknown[]) =>
      mockGetPendingRepairsForCustomer(...args),
    getRepairDetail: (...args: unknown[]) => mockGetRepairDetail(...args),
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

jest.mock('../../stores/headerBackStore', () => ({
  useHeaderBackStore: (selector: (s: unknown) => unknown) =>
    selector({setOnBack: jest.fn(), clearIf: jest.fn()}),
}));

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

function resetCart() {
  mockCartState.items = [];
  mockCartState.customerId = null;
  mockCartState.customerName = null;
  mockCartState.discountCents = 0;
  mockCartState.notes = '';
  mockCartState.repairId = null;
  mockCartState.repairNumber = null;
  mockCartState.addItem.mockClear();
  mockCartState.setRepairId.mockClear();
  mockCartState.setRepairNumber.mockClear();
  mockCartState.clear.mockClear();
  mockWorkspaceState.repairs_enabled = false;
  mockGetPendingRepairsForCustomer.mockReset();
  mockGetRepairDetail.mockReset();
}

describe('CartScreen', () => {
  beforeEach(resetCart);

  it('renders inside a KeyboardAvoidingView so iOS keyboard does not occlude inputs', () => {
    const {UNSAFE_getAllByType} = render(<CartScreen />);
    const kavs = UNSAFE_getAllByType(KeyboardAvoidingView);
    expect(kavs.length).toBeGreaterThanOrEqual(1);
  });

  // T8 — "Take payment for repair" affordance is gated on:
  //   customerId != null  AND  workspaceFeaturesStore.repairs_enabled
  //   AND repairId == null (once linked, the chip is the source of truth).
  it('T8 — "Take payment for repair" affordance appears when customer set + flag on', () => {
    mockCartState.customerId = 42;
    mockCartState.customerName = 'Ada Lovelace';
    mockWorkspaceState.repairs_enabled = true;
    const {queryByLabelText} = render(<CartScreen />);
    expect(queryByLabelText('Take payment for repair')).not.toBeNull();
  });

  it('T8 — "Take payment for repair" affordance is hidden when the workspace flag is off', () => {
    mockCartState.customerId = 42;
    mockCartState.customerName = 'Ada Lovelace';
    mockWorkspaceState.repairs_enabled = false;
    const {queryByLabelText} = render(<CartScreen />);
    expect(queryByLabelText('Take payment for repair')).toBeNull();
  });

  it('T8 — "Take payment for repair" affordance is hidden when no customer is set', () => {
    mockCartState.customerId = null;
    mockWorkspaceState.repairs_enabled = true;
    const {queryByLabelText} = render(<CartScreen />);
    expect(queryByLabelText('Take payment for repair')).toBeNull();
  });

  it('T8 — picker fetches pending repairs for the current customer on open', async () => {
    mockCartState.customerId = 42;
    mockCartState.customerName = 'Ada Lovelace';
    mockWorkspaceState.repairs_enabled = true;
    mockGetPendingRepairsForCustomer.mockResolvedValueOnce([
      {
        id: 7,
        repair_number: '0001',
        issue_description: 'Cracked screen',
        device_type: null,
        brand: null,
        model: null,
        estimated_cost: 199,
        final_cost: null,
        received_at: null,
      },
    ]);
    const {getByLabelText, findByText} = render(<CartScreen />);

    await act(async () => {
      fireEvent.press(getByLabelText('Take payment for repair'));
    });

    await waitFor(() => {
      expect(mockGetPendingRepairsForCustomer).toHaveBeenCalledWith(42);
    });
    await findByText('REP-0001');
  });

  // T8-COV-03 remediation: verify the empty-state copy renders when the
  // POS-scoped pending-repairs endpoint returns []. Without this the empty
  // branch is only implicitly covered by the "no test asserts empty".
  it('T8 - picker empty-state renders when there are no pending repairs', async () => {
    mockCartState.customerId = 42;
    mockCartState.customerName = 'Ada Lovelace';
    mockWorkspaceState.repairs_enabled = true;
    mockGetPendingRepairsForCustomer.mockResolvedValueOnce([]);

    const {getByLabelText, findByText} = render(<CartScreen />);
    fireEvent.press(getByLabelText('Take payment for repair'));

    await findByText(/No repairs ready for pickup for this customer/i);
  });

  it('T8 — picking a parts-only repair populates the cart with REAL product_ids and sets repairId + repairNumber', async () => {
    mockCartState.customerId = 42;
    mockCartState.customerName = 'Ada Lovelace';
    mockWorkspaceState.repairs_enabled = true;
    mockGetPendingRepairsForCustomer.mockResolvedValueOnce([
      {
        id: 7,
        repair_number: '0001',
        issue_description: 'Cracked screen',
        device_type: null,
        brand: null,
        model: null,
        estimated_cost: 199,
        final_cost: null,
        received_at: null,
      },
    ]);
    // T8 STOCK CONTRACT: parts must land on the sale with the REAL
    // product_id from ri.product_id (POSController::processSale runs
    // Product::findOrFail on it; a synthetic negative id would 422).
    mockGetRepairDetail.mockResolvedValueOnce({
      id: 7,
      repair_number: '0001',
      status: 'ready',
      items: [
        {
          id: 10,
          repair_id: 7,
          product_id: 900,
          item_name: 'iPhone screen',
          item_sku: 'SCR-1',
          item_type: 'part',
          quantity: 1,
          unit_price: 130,
          line_total: 130,
        },
        {
          id: 11,
          repair_id: 7,
          product_id: 901,
          item_name: 'Adhesive kit',
          item_sku: 'ADH-1',
          item_type: 'part',
          quantity: 2,
          unit_price: 30,
          line_total: 60,
        },
      ],
    });

    const {getByLabelText, findByLabelText} = render(<CartScreen />);
    await act(async () => {
      fireEvent.press(getByLabelText('Take payment for repair'));
    });

    const pickRow = await findByLabelText('Pick repair 0001');
    await act(async () => {
      fireEvent.press(pickRow);
    });

    await waitFor(() => {
      expect(mockCartState.addItem).toHaveBeenCalledTimes(2);
    });
    // Money on the repair wire is DOLLARS — the screen converts to cents
    // at the boundary via Math.round(unit_price * 100).
    const firstAdd = mockCartState.addItem.mock.calls[0][0];
    expect(firstAdd.price_cents).toBe(13000);
    // T8: id is the REAL Product PK, NOT -ri.id.
    expect(firstAdd.id).toBe(900);
    // tax_rate 10 — labour contract: BOTH parts and labour set tax_rate 10
    // so the wire encoder emits gst_applicable: true per line (T8-C1 per-
    // line GST math). Repair items are quoted GST-inclusive, so this
    // extracts the embedded GST — no double-tax.
    expect(firstAdd.tax_rate).toBe(10);

    const secondAdd = mockCartState.addItem.mock.calls[1][0];
    expect(secondAdd.id).toBe(901);
    expect(secondAdd.tax_rate).toBe(10);

    expect(mockCartState.setRepairId).toHaveBeenCalledWith(7);
    expect(mockCartState.setRepairNumber).toHaveBeenCalledWith('0001');
  });

  it('T8 - picking a repair with parts + labour synthesises BOTH lines (parts use real product_id, labour uses -600000-id, both tax_rate 10)', async () => {
    mockCartState.customerId = 42;
    mockCartState.customerName = 'Ada Lovelace';
    mockWorkspaceState.repairs_enabled = true;
    mockGetPendingRepairsForCustomer.mockResolvedValueOnce([
      {
        id: 7,
        repair_number: '0001',
        issue_description: 'Cracked screen',
        device_type: null,
        brand: null,
        model: null,
        estimated_cost: 199,
        final_cost: null,
        received_at: null,
      },
    ]);
    mockGetRepairDetail.mockResolvedValueOnce({
      id: 7,
      repair_number: '0001',
      status: 'ready',
      items: [
        {
          id: 10,
          repair_id: 7,
          product_id: 900,
          item_name: 'iPhone screen',
          item_sku: 'SCR-1',
          item_type: 'part',
          quantity: 1,
          unit_price: 130,
          line_total: 130,
        },
        {
          id: 11,
          repair_id: 7,
          product_id: null,
          item_name: 'Labour',
          item_sku: null,
          item_type: 'labor',
          quantity: 1,
          unit_price: 70,
          line_total: 70,
        },
      ],
    });

    const {getByLabelText, findByLabelText} = render(<CartScreen />);
    await act(async () => {
      fireEvent.press(getByLabelText('Take payment for repair'));
    });

    const pickRow = await findByLabelText('Pick repair 0001');
    await act(async () => {
      fireEvent.press(pickRow);
    });

    await waitFor(() => {
      expect(mockCartState.setRepairId).toHaveBeenCalledWith(7);
    });
    expect(mockCartState.clear).toHaveBeenCalled();
    expect(mockCartState.setRepairNumber).toHaveBeenCalledWith('0001');
    expect(mockCartState.addItem).toHaveBeenCalledTimes(2);
    // Parts row: REAL product_id, tax_rate 10.
    expect(mockCartState.addItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 900,
        price_cents: 13000,
        tax_rate: 10,
      }),
      1,
    );
    // Labour row: synthetic id -600000 - ri.id (= -600011), tax_rate 10.
    expect(mockCartState.addItem).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: -600011,
        price_cents: 7000,
        tax_rate: 10,
      }),
      1,
    );
  });

  it('T8 — "Checking out repair REP-…" chip renders when the cart is linked to a repair', () => {
    mockCartState.repairId = 7;
    mockCartState.repairNumber = '0001';
    const {getByText, getByLabelText} = render(<CartScreen />);
    expect(getByText(/Checking out repair REP-0001/)).toBeTruthy();
    // Tap-to-clear affordance.
    expect(getByLabelText('Clear repair link')).toBeTruthy();
  });
});
