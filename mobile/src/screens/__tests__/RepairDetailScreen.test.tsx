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
const mockSendRepairNotification = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getRepairDetail: (...args: unknown[]) => mockGetRepairDetail(...args),
    sendRepairNotification: (...args: unknown[]) =>
      mockSendRepairNotification(...args),
  },
}));

// Cart store stub — the T8 Checkout button materialises the cart via
// these setters. Test-controllable so we can assert the calls fire in the
// expected order + shape.
const mockCartState: any = {
  clear: jest.fn(),
  setCustomer: jest.fn(),
  addItem: jest.fn(),
  setRepairId: jest.fn(),
  setRepairNumber: jest.fn(),
};
jest.mock('../../stores/cartStore', () => {
  const useCartStore: any = () => mockCartState;
  useCartStore.getState = () => mockCartState;
  useCartStore.setState = jest.fn();
  useCartStore.subscribe = () => () => undefined;
  return {useCartStore};
});

// Stable haptics ref - a fresh object per render would reset useCallback
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

// Auth store stub - ErrorBanner reads it via subscribe + getState, and
// the T7 action row reads `user.permissions` to gate "Notify customer".
// `mockAuthState.user.permissions` is mutable so tests can flip the
// send-manual-notification ability on/off.
const mockAuthState: {
  user: {name: string; permissions: string[]} | null;
  isAuthenticated: boolean;
  errorKind: null;
} = {
  user: {name: 'Tester', permissions: []},
  isAuthenticated: true,
  errorKind: null,
};
jest.mock('../../stores/authStore', () => {
  const useAuthStore: any = (selector: (s: typeof mockAuthState) => unknown) =>
    selector(mockAuthState);
  useAuthStore.getState = () => mockAuthState;
  useAuthStore.subscribe = () => () => undefined;
  return {useAuthStore};
});

// navHistoryStore mock - track push calls to assert the breadcrumb was
// pushed on cross-tab navigation.
const mockPush = jest.fn();
const mockPopPrev = jest.fn(() => null);
jest.mock('../../stores/navHistoryStore', () => ({
  useNavHistoryStore: (selector: (s: unknown) => unknown) =>
    selector({push: mockPush, popPrev: mockPopPrev}),
}));

// headerBackStore mock - the screen only wires setOnBack / clearIf, no
// assertion needed on the store side. Returning stable jest.fns via a
// selector-shaped mock keeps the hook signature happy.
const mockSetOnBack = jest.fn();
const mockClearIf = jest.fn();
jest.mock('../../stores/headerBackStore', () => ({
  useHeaderBackStore: (selector: (s: unknown) => unknown) =>
    selector({setOnBack: mockSetOnBack, clearIf: mockClearIf}),
}));

// workspaceFeaturesStore - the mount-guard checks getState().repairs_enabled.
// Default true so most tests mount cleanly; the bounce test flips it false.
const mockWorkspaceState = {repairs_enabled: true};
jest.mock('../../stores/workspaceFeaturesStore', () => {
  const useWorkspaceFeaturesStore: any = (selector?: any) =>
    typeof selector === 'function'
      ? selector(mockWorkspaceState)
      : mockWorkspaceState;
  useWorkspaceFeaturesStore.getState = () => mockWorkspaceState;
  return {useWorkspaceFeaturesStore};
});

// Navigation mock. useRoute always returns {id: 1}. useFocusEffect is
// controllable so tests can simulate a tab-return via triggerFocus().
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockGetParent = jest.fn();
const mockAddListener = jest.fn(() => () => undefined);

// Prefix with `mock` so jest.mock() hoisting is permitted to reference it.
//
// The screen registers TWO useFocusEffect calls per render - the fetch
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
    mockSendRepairNotification.mockReset();
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
    // Reset the permissions gate - most tests want the send-manual-
    // notification ability absent so the hidden-by-default posture is
    // exercised. The two "Notify customer" tests flip it on explicitly.
    mockAuthState.user = {name: 'Tester', permissions: []};
    mockCartState.clear.mockClear();
    mockCartState.setCustomer.mockClear();
    mockCartState.addItem.mockClear();
    mockCartState.setRepairId.mockClear();
    mockCartState.setRepairNumber.mockClear();
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
    // Device card - note 'Phone' is both a device_type value AND the
    // customer field label, so we assert on device-only strings here.
    expect(getByText('Apple')).toBeTruthy();
    expect(getByText('iPhone 13')).toBeTruthy();
    expect(getByText('SN-XYZ-123')).toBeTruthy();
    // Issue block
    expect(
      getByText('Cracked screen, needs full replacement'),
    ).toBeTruthy();
    // Items subtotal - 130 + 70 = $200.00, distinct from estimated_cost
    // ($199.00) so we're asserting on the subtotal-specific string.
    expect(getByText('$200.00')).toBeTruthy();
    // Costs card renders the estimate.
    expect(getByText('$199.00')).toBeTruthy();
    // Item names + type chips render.
    expect(getByText('iPhone 13 Screen Assembly')).toBeTruthy();
    expect(getByText('Screen replacement labour')).toBeTruthy();
    // History entries - "Unknown user" fallback surfaces in the second row.
    expect(getByText(/Unknown user/)).toBeTruthy();
  });

  // T6-COV-06 - empty state coverage. Screen has 3 empty-state branches:
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
    // No history rows render - the Unknown user placeholder shouldn't appear.
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

    // First focus fire - didInitialFetchRef flips true, no refetch. The
    // header-back useFocusEffect ALSO fires here (it's harmless side
    // effects only) but the didInitialFetchRef branch guards the fetch.
    triggerFocus();
    await new Promise(r => setImmediate(r));
    expect(mockGetRepairDetail).toHaveBeenCalledTimes(1);

    // Second focus fire - user returned to the tab, refetch triggers.
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

  // ---------------- T7 part C - action row ----------------
  // Three new tests below cover the action row appended between the
  // History timeline and the bottom padding: Change status, Edit, and
  // (optionally) Notify customer. The existing T6 tests still pass
  // because the row is purely additive - nothing above History changed.

  it('T7C - "Edit" navigates to RepairEdit with the current repair id', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());

    const {findByLabelText} = render(<RepairDetailScreen />);

    const editBtn = await findByLabelText('Edit repair');
    fireEvent.press(editBtn);

    expect(mockNavigate).toHaveBeenCalledWith('RepairEdit', {id: 1});
  });

  it('T7C - "Change status" navigates to RepairStatusChange with the current repair id', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());

    const {findByLabelText} = render(<RepairDetailScreen />);

    const statusBtn = await findByLabelText('Change status');
    fireEvent.press(statusBtn);

    expect(mockNavigate).toHaveBeenCalledWith('RepairStatusChange', {id: 1});
  });

  it('T7C - "Notify customer" is hidden when the send-manual-notification permission is absent', async () => {
    // beforeEach defaults permissions to []. This test asserts the
    // hidden-by-default posture.
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());

    const {findByText, queryByLabelText} = render(<RepairDetailScreen />);

    // Wait for the detail to hydrate so we know the action row is mounted.
    await findByText('Repair REP-0001');
    // The other two action buttons ARE visible.
    expect(queryByLabelText('Change status')).not.toBeNull();
    expect(queryByLabelText('Edit repair')).not.toBeNull();
    // The gated button is not rendered.
    expect(queryByLabelText('Notify customer')).toBeNull();
  });

  // WSA-4 — Notify customer now issues a real send with the repair_status
  // template. Confirm-then-send: the button opens a confirm Alert; Send
  // fires ApiClient.sendRepairNotification({template: 'repair_status'});
  // Cancel is a pure no-op.
  it('WSA-4 - "Notify customer" opens a confirm Alert naming the customer + status', async () => {
    mockAuthState.user = {
      name: 'Tester',
      permissions: ['send-manual-notification'],
    };
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    const {findByLabelText} = render(<RepairDetailScreen />);

    const notifyBtn = await findByLabelText('Notify customer');
    fireEvent.press(notifyBtn);

    // Title names the customer; body names the current status label.
    expect(alertSpy).toHaveBeenCalledWith(
      'Notify Ada Lovelace?',
      expect.stringContaining('In progress'),
      expect.any(Array),
    );
    // No network hit until Send is pressed.
    expect(mockSendRepairNotification).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('WSA-4 - Send button fires sendRepairNotification with repair_status template and toasts on success', async () => {
    mockAuthState.user = {
      name: 'Tester',
      permissions: ['send-manual-notification'],
    };
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);
    mockSendRepairNotification.mockResolvedValueOnce(undefined);

    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    const {findByLabelText} = render(<RepairDetailScreen />);
    fireEvent.press(await findByLabelText('Notify customer'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void | Promise<void>;
    }>;
    const send = buttons.find(b => b.text === 'Send');
    await send?.onPress?.();

    expect(mockSendRepairNotification).toHaveBeenCalledWith(1, {
      template: 'repair_status',
    });
    // Success toast (single-arg Alert.alert call). The confirm dialog
    // ran call #0; the success toast is call #1.
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Notification sent');
    });

    alertSpy.mockRestore();
  });

  it('WSA-4 - Cancel button leaves sendRepairNotification untouched', async () => {
    mockAuthState.user = {
      name: 'Tester',
      permissions: ['send-manual-notification'],
    };
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    const {findByLabelText} = render(<RepairDetailScreen />);
    fireEvent.press(await findByLabelText('Notify customer'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const cancel = buttons.find(b => b.text === 'Cancel');
    cancel?.onPress?.();

    expect(mockSendRepairNotification).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('WSA-4 - Send failure surfaces the server error in a failure Alert', async () => {
    mockAuthState.user = {
      name: 'Tester',
      permissions: ['send-manual-notification'],
    };
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);
    mockSendRepairNotification.mockRejectedValueOnce(
      new Error('SMS provider unavailable'),
    );

    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    const {findByLabelText} = render(<RepairDetailScreen />);
    fireEvent.press(await findByLabelText('Notify customer'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void | Promise<void>;
    }>;
    const send = buttons.find(b => b.text === 'Send');
    await send?.onPress?.();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Could not send notification',
        'SMS provider unavailable',
      );
    });

    alertSpy.mockRestore();
  });

  // ---------------- T8 - Checkout button + hand-off ----------------
  // The Checkout PillButton lives at the tail of the action row and
  // renders ONLY when repair.status === 'ready' AND repairs_enabled.
  // Confirm copy is "Parts reserved at intake" per the DR-M3 sitrep -
  // stock is NOT decremented on this checkout, so the operator-facing
  // wording MUST NOT say anything about stock adjustments.

  it('T8 - Checkout button is hidden when status is not "ready"', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(
      makeDetail({status: 'in_progress'}),
    );
    const {findByText, queryByLabelText} = render(<RepairDetailScreen />);
    await findByText('Repair REP-0001');
    expect(queryByLabelText('Checkout repair')).toBeNull();
  });

  it('T8 - Checkout button is hidden when workspace repairs flag is off', async () => {
    // Mount-guard bounces immediately if the flag is off, but this is
    // belt-and-braces: even if we somehow render past it, the button
    // itself must be gated by the same flag.
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail({status: 'ready'}));
    // Flag off — the screen bounces via Alert + goBack. We don't need
    // the button to appear.
    mockWorkspaceState.repairs_enabled = false;
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);
    const {queryByLabelText} = render(<RepairDetailScreen />);
    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalled();
    });
    expect(queryByLabelText('Checkout repair')).toBeNull();
    alertSpy.mockRestore();
  });

  it('T8 - Checkout button renders when status is "ready" and shows the confirm alert', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail({status: 'ready'}));
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    const {findByLabelText} = render(<RepairDetailScreen />);
    const btn = await findByLabelText('Checkout repair');
    fireEvent.press(btn);

    // Confirm dialog copy MUST match the DR-M3 sitrep wording - parts
    // reserved at intake, no "stock will be adjusted" language.
    expect(alertSpy).toHaveBeenCalledWith(
      'Take payment for repair',
      'Parts reserved at intake. Ready to take payment?',
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });

  // T8-COV-01/02 remediation: exercise BOTH branches of the confirm dialog.
  // Cancel should leave cart untouched and skip the cross-tab navigation;
  // Confirm should clear + populate the cart and cross-tab navigate.
  it('T8 - Cancel branch of confirm leaves cart untouched and does NOT navigate', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail({status: 'ready'}));
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    const {findByLabelText} = render(<RepairDetailScreen />);
    fireEvent.press(await findByLabelText('Checkout repair'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const cancel = buttons.find(b => b.text === 'Cancel');
    // Cancel is either onPress: undefined (dismiss only) or a no-op.
    cancel?.onPress?.();

    expect(mockCartState.clear).not.toHaveBeenCalled();
    expect(mockCartState.addItem).not.toHaveBeenCalled();
    expect(mockCartState.setRepairId).not.toHaveBeenCalled();
    expect(mockGetParent).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('T8 - Confirm branch on a parts+labour repair clears cart, synthesises BOTH lines (parts=real product_id, labour=-600000-id), tax_rate 10 on all lines, cross-tab navigates', async () => {
    // Two getRepairDetail calls: one for the initial screen render,
    // one for the belt-and-braces re-fetch inside the Confirm handler.
    // makeDetail's default items include a labour row (id 11, product_id
    // null). Per the deployment-team labour contract, labour synths to
    // `product_id: -600000 - ri.id` = -600011, and both parts + labour
    // set tax_rate: 10 so the wire encoder emits gst_applicable: true.
    const readyDetail = makeDetail({status: 'ready'});
    mockGetRepairDetail
      .mockResolvedValueOnce(readyDetail)
      .mockResolvedValueOnce(readyDetail);
    const parent = {navigate: jest.fn()};
    mockGetParent.mockReturnValue(parent);
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    const {findByLabelText} = render(<RepairDetailScreen />);
    fireEvent.press(await findByLabelText('Checkout repair'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const confirm = buttons.find(b => b.text === 'Confirm');
    await confirm?.onPress?.();
    await waitFor(() => expect(mockGetRepairDetail).toHaveBeenCalledTimes(2));

    expect(mockCartState.clear).toHaveBeenCalled();
    expect(mockCartState.addItem).toHaveBeenCalledTimes(2);
    // Parts row: REAL product_id (900), tax_rate 10.
    const partsCall = mockCartState.addItem.mock.calls[0][0];
    expect(partsCall.id).toBe(900);
    expect(partsCall.tax_rate).toBe(10);
    expect(partsCall.price_cents).toBe(13000);
    // Labour row: synthetic id -600000 - 11 = -600011, tax_rate 10.
    const labourCall = mockCartState.addItem.mock.calls[1][0];
    expect(labourCall.id).toBe(-600011);
    expect(labourCall.tax_rate).toBe(10);
    expect(labourCall.price_cents).toBe(7000);
    expect(mockCartState.setRepairId).toHaveBeenCalledWith(readyDetail.id);
    expect(parent.navigate).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
