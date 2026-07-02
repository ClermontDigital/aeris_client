import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {RepairDetail} from '../../types/api.types';

// React 19 + jest-expo: window.dispatchEvent is needed for the global
// error reporter. See DashboardScreen.test.tsx for the full rationale.
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

// ---------------- mocks ----------------
const mockGetRepairDetail = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getRepairDetail: (...args: unknown[]) => mockGetRepairDetail(...args),
  },
}));

// Stable haptics ref — a fresh object per render would reset useCallback
// dep arrays inside the screen and trigger an unrelated effect loop.
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

// Auth store stub — ErrorBanner reads it via subscribe + getState.
jest.mock('../../stores/authStore', () => {
  const state = {
    user: {name: 'Tester'},
    isAuthenticated: true,
    errorKind: null,
  };
  const useAuthStore: any = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  useAuthStore.subscribe = () => () => undefined;
  return {useAuthStore};
});

// navHistoryStore mock — track push calls to assert the breadcrumb was
// pushed on cross-tab navigation.
const mockPush = jest.fn();
const mockPopPrev = jest.fn(() => null);
jest.mock('../../stores/navHistoryStore', () => ({
  useNavHistoryStore: (selector: (s: unknown) => unknown) =>
    selector({push: mockPush, popPrev: mockPopPrev}),
}));

// headerBackStore mock — the screen only wires setOnBack / clearIf, no
// assertion needed on the store side. Returning stable jest.fns via a
// selector-shaped mock keeps the hook signature happy.
const mockSetOnBack = jest.fn();
const mockClearIf = jest.fn();
jest.mock('../../stores/headerBackStore', () => ({
  useHeaderBackStore: (selector: (s: unknown) => unknown) =>
    selector({setOnBack: mockSetOnBack, clearIf: mockClearIf}),
}));

// workspaceFeaturesStore — the mount-guard checks getState().repairs_enabled.
// Default true so most tests mount cleanly; the bounce test flips it false.
const mockWorkspaceState = {repairs_enabled: true};
jest.mock('../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: {
    getState: () => mockWorkspaceState,
  },
}));

// Navigation mock. useRoute always returns {id: 1}. useFocusEffect is
// controllable so tests can simulate a tab-return via triggerFocus().
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockGetParent = jest.fn();
const mockAddListener = jest.fn(() => () => undefined);

// Prefix with `mock` so jest.mock() hoisting is permitted to reference it.
//
// The screen registers TWO useFocusEffect calls per render — the fetch
// effect (guarded by didInitialFetchRef) and the header-back setup. Each
// render pushes a fresh copy of BOTH into the queue, so we track the last
// pair-per-render and only invoke the most recently registered pair. This
// mirrors how react-navigation only runs the LATEST callback per slot
// on focus events.
const mockFocusCallbacks: {list: Array<() => void>} = {list: []};
const triggerFocus = () => {
  const cbs = mockFocusCallbacks.list.slice(-2);
  cbs.forEach(cb => cb());
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    getParent: mockGetParent,
    addListener: mockAddListener,
  }),
  useRoute: () => ({params: {id: 1}}),
  useFocusEffect: (cb: () => void) => {
    mockFocusCallbacks.list.push(cb);
  },
}));

import RepairDetailScreen from '../RepairDetailScreen';

// ---------------- fixtures ----------------
function makeDetail(over: Partial<RepairDetail> = {}): RepairDetail {
  const now = new Date().toISOString();
  return {
    id: 1,
    repair_number: 'REP-0001',
    customer_id: 42,
    customer_name: 'Ada Lovelace',
    location_id: null,
    sale_id: null,
    created_by: null,
    assigned_to: 5,
    assigned_to_name: 'Grace Hopper',
    device_type: 'Phone',
    brand: 'Apple',
    model: 'iPhone 13',
    serial_number: 'SN-XYZ-123',
    issue_description: 'Cracked screen, needs full replacement',
    diagnosis: 'Digitizer intact; only glass damaged.',
    notes: 'Customer wants same-day pickup if possible.',
    estimated_cost: 199.0,
    final_cost: null,
    status: 'in_progress',
    priority: 'high',
    received_at: now,
    estimated_completion: null,
    completed_at: null,
    picked_up_at: null,
    created_at: now,
    updated_at: now,
    customer: {
      id: 42,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+61 400 000 000',
    },
    items: [
      {
        id: 10,
        repair_id: 1,
        product_id: 900,
        item_name: 'iPhone 13 Screen Assembly',
        item_sku: 'SCREEN-IP13',
        item_type: 'part',
        quantity: 1,
        unit_price: 130,
        line_total: 130,
        notes: null,
        status: 'reserved',
        created_at: now,
        updated_at: now,
      },
      {
        id: 11,
        repair_id: 1,
        product_id: null,
        item_name: 'Screen replacement labour',
        item_sku: null,
        item_type: 'labor',
        quantity: 1,
        unit_price: 70,
        line_total: 70,
        notes: null,
        status: 'reserved',
        created_at: now,
        updated_at: now,
      },
    ],
    status_history: [
      {
        id: 100,
        from_status: null,
        to_status: 'pending',
        notes: 'Repair intake.',
        changed_at: now,
        user: {id: 5, name: 'Grace Hopper'},
      },
      {
        id: 101,
        from_status: 'pending',
        to_status: 'in_progress',
        notes: null,
        changed_at: now,
        // Normalizer null-safes user → "Unknown user"; simulate that here.
        user: {id: 0, name: 'Unknown user'},
      },
    ],
    ...over,
  };
}

// ---------------- tests ----------------
describe('RepairDetailScreen', () => {
  beforeEach(() => {
    mockGetRepairDetail.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockGetParent.mockReset();
    mockPush.mockReset();
    mockPopPrev.mockReset().mockReturnValue(null);
    mockSetOnBack.mockReset();
    mockClearIf.mockReset();
    mockAddListener.mockReset().mockReturnValue(() => undefined);
    mockWorkspaceState.repairs_enabled = true;
    mockFocusCallbacks.list = [];
  });

  it('renders the loading spinner while the detail fetch is in flight', () => {
    // Return a Promise that never resolves so the loading state persists.
    mockGetRepairDetail.mockImplementation(() => new Promise(() => {}));

    const {getByText} = render(<RepairDetailScreen />);

    expect(getByText('Loading repair…')).toBeTruthy();
  });

  it('renders the error state with a retry action when the fetch rejects', async () => {
    mockGetRepairDetail.mockRejectedValueOnce(new Error('boom'));

    const {findByText, getByLabelText} = render(<RepairDetailScreen />);

    // ErrorBanner renders our message with a Retry button.
    await findByText(/not available right now/);
    expect(getByLabelText('Retry')).toBeTruthy();

    // Successful retry lands the detail view.
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    fireEvent.press(getByLabelText('Retry'));

    await waitFor(() => {
      expect(mockGetRepairDetail).toHaveBeenCalledTimes(2);
    });
    // Actually confirm the view transitioned from error → success.
    await findByText('Repair REP-0001');
  });

  it('renders the EmptyState when the detail fetch returns null', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(null);

    const {findByText, getByLabelText} = render(<RepairDetailScreen />);

    await findByText('Repair not found');
    await findByText('Repair not found or was deleted');

    fireEvent.press(getByLabelText('Back'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('renders the full detail on success including items subtotal and null-safed history user', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());

    const {findByText, getByText} = render(<RepairDetailScreen />);

    // Header
    await findByText('Repair REP-0001');
    // Customer card
    expect(getByText('Ada Lovelace')).toBeTruthy();
    expect(getByText('ada@example.com')).toBeTruthy();
    expect(getByText('+61 400 000 000')).toBeTruthy();
    // Device card — note 'Phone' is both a device_type value AND the
    // customer field label, so we assert on device-only strings here.
    expect(getByText('Apple')).toBeTruthy();
    expect(getByText('iPhone 13')).toBeTruthy();
    expect(getByText('SN-XYZ-123')).toBeTruthy();
    // Issue block
    expect(
      getByText('Cracked screen, needs full replacement'),
    ).toBeTruthy();
    // Items subtotal — 130 + 70 = $200.00, distinct from estimated_cost
    // ($199.00) so we're asserting on the subtotal-specific string.
    expect(getByText('$200.00')).toBeTruthy();
    // Costs card renders the estimate.
    expect(getByText('$199.00')).toBeTruthy();
    // Item names + type chips render.
    expect(getByText('iPhone 13 Screen Assembly')).toBeTruthy();
    expect(getByText('Screen replacement labour')).toBeTruthy();
    // History entries — "Unknown user" fallback surfaces in the second row.
    expect(getByText(/Unknown user/)).toBeTruthy();
  });

  // T6-COV-06 — empty state coverage. Screen has 3 empty-state branches:
  // 'No device details recorded', 'No quote yet', 'No items added yet',
  // plus an empty status_history array. None were previously exercised.
  it('renders the empty-state fallbacks when device/costs/items/history are all absent', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(
      makeDetail({
        device_type: null,
        brand: null,
        model: null,
        serial_number: null,
        estimated_cost: null,
        final_cost: null,
        items: [],
        status_history: [],
      }),
    );

    const {findByText, queryByText} = render(<RepairDetailScreen />);
    await findByText('Repair REP-0001');
    expect(await findByText('No device details recorded')).toBeTruthy();
    expect(await findByText('No quote yet')).toBeTruthy();
    expect(await findByText('No items added yet')).toBeTruthy();
    // No history rows render — the Unknown user placeholder shouldn't appear.
    expect(queryByText(/Unknown user/)).toBeNull();
  });

  it('pushes a cross-tab breadcrumb when the customer row is tapped from a foreign tab', async () => {
    // Simulate the screen being hosted under a non-Customers tab (Repairs).
    const parent = {
      navigate: jest.fn(),
      getState: () => ({
        index: 0,
        routes: [{name: 'Repairs'}],
      }),
    };
    mockGetParent.mockReturnValue(parent);
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());

    const {findByLabelText} = render(<RepairDetailScreen />);

    const row = await findByLabelText(/Customer Ada Lovelace/);
    fireEvent.press(row);

    // Breadcrumb captures the current tab + this screen's route params so
    // a later Back returns here from CustomerDetail.
    expect(mockPush).toHaveBeenCalledWith({
      tab: 'Repairs',
      screen: 'RepairDetail',
      params: {id: 1},
    });
    // Parent tab navigator receives an initial:false push onto the
    // Customers stack so tab-tap can still pop-to-root.
    expect(parent.navigate).toHaveBeenCalledWith('Customers', {
      initial: false,
      screen: 'CustomerDetail',
      params: {customerId: 42},
    });
  });

  it('refetches on focus after the initial mount', async () => {
    mockGetRepairDetail.mockResolvedValue(makeDetail());

    render(<RepairDetailScreen />);
    await waitFor(() => {
      expect(mockGetRepairDetail).toHaveBeenCalledTimes(1);
    });

    // First focus fire — didInitialFetchRef flips true, no refetch. The
    // header-back useFocusEffect ALSO fires here (it's harmless side
    // effects only) but the didInitialFetchRef branch guards the fetch.
    triggerFocus();
    await new Promise(r => setImmediate(r));
    expect(mockGetRepairDetail).toHaveBeenCalledTimes(1);

    // Second focus fire — user returned to the tab, refetch triggers.
    triggerFocus();
    await waitFor(() => {
      expect(mockGetRepairDetail).toHaveBeenCalledTimes(2);
    });
  });

  it('bounces out when repairs_enabled is false at mount without firing an orphan fetch', async () => {
    mockWorkspaceState.repairs_enabled = false;
    mockGetRepairDetail.mockResolvedValue(makeDetail());

    render(<RepairDetailScreen />);

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalled();
    });
    // T6-1 remediation: the mount guard AND the load() early-return both fire,
    // so no getRepairDetail call goes out for a disabled workspace. Without
    // both guards the fetch races the goBack and produces either a spurious
    // REPAIRS_DISABLED toast or a setState-on-unmounted warning.
    expect(mockGetRepairDetail).not.toHaveBeenCalled();
  });
});
