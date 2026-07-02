import React from 'react';
import {render, waitFor, fireEvent, act} from '@testing-library/react-native';
import type {RepairDetail, RepairStatus} from '../../types/api.types';

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
const mockUpdateRepairStatus = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getRepairDetail: (...args: unknown[]) => mockGetRepairDetail(...args),
    updateRepairStatus: (...args: unknown[]) =>
      mockUpdateRepairStatus(...args),
  },
}));

// Stable haptics ref - a fresh object per render resets useCallback dep
// arrays and can trigger phantom effect loops.
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

// Auth store stub - ErrorBanner reads it via subscribe + getState.
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

// transactionActivityStore - the sheet toggles the in-flight flag around
// the write. Only the store's setter is exercised, so a plain jest.fn()
// works.
const mockSetSettlementOrPrintInFlight = jest.fn();
jest.mock('../../stores/transactionActivityStore', () => ({
  useTransactionActivityStore: {
    getState: () => ({
      setSettlementOrPrintInFlight: mockSetSettlementOrPrintInFlight,
    }),
  },
}));

// useResponsiveLayout - return isTablet: false so the tabletCap branch is
// off in the default runs. A separate test could flip it if we ever
// assert on the cap style.
jest.mock('../../hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({isTablet: false}),
}));

// workspaceFeaturesStore - T7-006 mount guard reads getState().repairs_enabled.
// Default true so tests mount cleanly; a dedicated bounce test can flip it.
const mockWorkspaceState = {repairs_enabled: true};
jest.mock('../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: {
    getState: () => mockWorkspaceState,
  },
}));

// Navigation mock. useRoute always returns {id: 1}.
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
  }),
  useRoute: () => ({params: {id: 1}}),
}));

import RepairStatusChangeSheet from '../RepairStatusChangeSheet';

// ---------------- fixtures ----------------
function makeDetail(
  status: RepairStatus = 'in_progress',
  over: Partial<RepairDetail> = {},
): RepairDetail {
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
    issue_description: 'Cracked screen',
    diagnosis: null,
    notes: null,
    estimated_cost: 199.0,
    final_cost: null,
    status,
    priority: 'normal',
    received_at: now,
    estimated_completion: null,
    completed_at: null,
    picked_up_at: null,
    created_at: now,
    updated_at: now,
    customer: {
      id: 42,
      name: 'Ada Lovelace',
      email: null,
      phone: null,
    },
    items: [],
    status_history: [],
    ...over,
  };
}

// The sheet fires updateRepairStatus and then does NOT await it - the
// optimistic-dismiss path calls goBack() before the promise resolves.
// Give a never-resolving promise so tests can assert the call shape
// without racing the finally block, or resolve it explicitly per-case.
function neverResolves<T>(): Promise<T> {
  return new Promise(() => {});
}

// ---------------- tests ----------------
describe('RepairStatusChangeSheet', () => {
  beforeEach(() => {
    mockGetRepairDetail.mockReset();
    mockUpdateRepairStatus.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockSetSettlementOrPrintInFlight.mockReset();
    mockWorkspaceState.repairs_enabled = true;
  });

  it('renders the current status as the default selection', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail('in_progress'));

    const {findByLabelText, findAllByText} = render(
      <RepairStatusChangeSheet />,
    );

    // The picker row for the current status is selected - accessibilityState
    // is our authoritative check because we can't easily inspect style
    // objects in RTL for React Native. Awaiting this also gates on the
    // fetch resolving (the row only mounts once repair has hydrated).
    const row = await findByLabelText('Status: In Progress (current)');
    expect(row.props.accessibilityState?.selected).toBe(true);
    // The current-status readout in the eyebrow section is rendered too;
    // the picker row uses the same label so we expect at least 2 matches.
    const matches = await findAllByText('In Progress');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps Save disabled when no status change and no notes were entered', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail('in_progress'));

    const {findByLabelText} = render(<RepairStatusChangeSheet />);

    const save = await findByLabelText('Save status change');
    expect(save.props.accessibilityState?.disabled).toBe(true);
  });

  it('enables Save on status change and fires updateRepairStatus with the correct payload', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail('in_progress'));
    // Never-resolving so goBack + call fire, and the sheet doesn't try to
    // finish its finally block during the assertion window.
    mockUpdateRepairStatus.mockImplementationOnce(() => neverResolves());

    const {findByLabelText} = render(<RepairStatusChangeSheet />);

    // Tap "Ready for Pickup" - a non-current, non-cancelled option so the
    // cancel-warning gate stays off the happy path.
    fireEvent.press(await findByLabelText(/Status: Ready for Pickup/));

    const save = await findByLabelText('Save status change');
    expect(save.props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(save);
    });

    expect(mockUpdateRepairStatus).toHaveBeenCalledTimes(1);
    // Notes omitted - the third argument is `undefined` because the
    // operator didn't type anything.
    expect(mockUpdateRepairStatus).toHaveBeenCalledWith(1, 'ready', undefined);
    // Optimistic dismiss: goBack fires immediately after the call.
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('fires updateRepairStatus with notes when only notes were entered on the same status', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail('in_progress'));
    mockUpdateRepairStatus.mockImplementationOnce(() => neverResolves());

    const {findByLabelText} = render(<RepairStatusChangeSheet />);

    const notes = await findByLabelText('Status change notes');
    fireEvent.changeText(notes, 'Waiting on operator handover');

    const save = await findByLabelText('Save status change');
    expect(save.props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(save);
    });

    expect(mockUpdateRepairStatus).toHaveBeenCalledWith(
      1,
      'in_progress',
      'Waiting on operator handover',
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('Cancel dismisses without firing an update', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail('in_progress'));

    const {findByLabelText} = render(<RepairStatusChangeSheet />);

    fireEvent.press(await findByLabelText('Cancel'));

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockUpdateRepairStatus).not.toHaveBeenCalled();
  });

  it('gates Save behind an in-sheet confirm when the new status is cancelled', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail('in_progress'));
    mockUpdateRepairStatus.mockImplementationOnce(() => neverResolves());

    const {findByLabelText, getByText, queryByText} = render(
      <RepairStatusChangeSheet />,
    );

    // Pick cancelled.
    fireEvent.press(await findByLabelText(/Status: Cancelled/));

    // Warning renders.
    expect(
      getByText(/Cancelling will release any stock reservations/),
    ).toBeTruthy();

    // Save is still disabled because the confirm hasn't been tapped yet.
    const save = await findByLabelText('Save status change');
    expect(save.props.accessibilityState?.disabled).toBe(true);

    // Update RPC must NOT have been called at this point.
    expect(mockUpdateRepairStatus).not.toHaveBeenCalled();

    // Tap Confirm cancellation.
    fireEvent.press(await findByLabelText('Confirm cancellation'));

    // The confirm button is replaced by the "Confirmed" affordance.
    expect(getByText(/Confirmed. Tap Save to apply./)).toBeTruthy();
    expect(queryByText('Confirm cancellation')).toBeNull();

    // Save is now enabled.
    expect(save.props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(save);
    });

    expect(mockUpdateRepairStatus).toHaveBeenCalledWith(
      1,
      'cancelled',
      undefined,
    );
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('keeps the sheet open with a retry action when the initial detail load fails', async () => {
    // Fetch fails, then succeeds on retry.
    mockGetRepairDetail.mockRejectedValueOnce(new Error('network down'));

    const {findByText, findByLabelText} = render(<RepairStatusChangeSheet />);

    // ErrorBanner renders with the retry affordance. The sheet header is
    // still visible so the operator can Cancel out - sheet is not
    // auto-dismissed on load failure.
    await findByText(/Could not load the current repair status/);
    const retry = await findByLabelText('Retry');

    // Successful retry lands the picker view.
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail('in_progress'));
    await act(async () => {
      fireEvent.press(retry);
    });

    await waitFor(() => {
      expect(mockGetRepairDetail).toHaveBeenCalledTimes(2);
    });
    // The picker for the current status renders - confirming the sheet
    // recovered without being dismissed. Query by accessibility label so
    // the "In Progress" duplication (readout + picker row) doesn't cause
    // ambiguity.
    await findByLabelText('Status: In Progress (current)');
    // No stray goBack fired during the error flow.
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
