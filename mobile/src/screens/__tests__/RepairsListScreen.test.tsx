import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {Repair} from '../../types/api.types';

// React 19's reportGlobalError uses window.dispatchEvent to surface caught
// errors. jest-expo's environment doesn't provide it — without a stub the
// real failure stack gets masked behind "window.dispatchEvent is not a
// function". Mirrors the TransactionListScreen / ItemsScreen setups.
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
const mockListRepairs = jest.fn();
const mockGetCustomerDetail = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    listRepairs: (...args: unknown[]) => mockListRepairs(...args),
    getCustomerDetail: (...args: unknown[]) => mockGetCustomerDetail(...args),
  },
}));

// Stable haptics ref — a fresh object per render would reset useCallback
// dep arrays inside the screen and trigger an unrelated effect→fetch loop.
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

// Navigation mock — allow individual tests to inspect calls via the
// module-level ref. `useRoute` is overridden per-test via `mockRouteParams`.
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRouteParams: {current: Record<string, unknown>} = {current: {}};
// Controllable useFocusEffect stub — captures the LAST callback so tests
// can simulate a tab-return focus event via `triggerFocus()`. Does NOT fire
// on invocation (calling cb() every render would infinite-loop the state
// updates inside the screen's own focus effects). The initial fetch runs
// via the debounced useEffect that watches search/statusFilter/customerId.
let capturedFocusCallback: (() => void) | null = null;
const triggerFocus = () => {
  if (capturedFocusCallback) capturedFocusCallback();
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => ({params: mockRouteParams.current}),
  useFocusEffect: (cb: () => void) => {
    capturedFocusCallback = cb;
  },
}));

// workspaceFeaturesStore is queried on mount as a belt-and-braces guard
// against the deep-link race where the flag flipped off mid-session. The
// tests default the flag to `true` so the screen mounts; the
// mount-guard test flips it to false and asserts the goBack().
const mockWorkspaceState = {repairs_enabled: true};
jest.mock('../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: {
    getState: () => mockWorkspaceState,
  },
}));

// The header-back store is only touched via getState().clearOnBack() and
// its side effect is irrelevant to these assertions.
jest.mock('../../stores/headerBackStore', () => ({
  useHeaderBackStore: {
    getState: () => ({clearOnBack: jest.fn()}),
  },
}));

import RepairsListScreen from '../RepairsListScreen';

// ---------------- fixtures ----------------
function makeRepair(over: Partial<Repair> & Pick<Repair, 'id'>): Repair {
  return {
    repair_number: `REP-${String(over.id).padStart(4, '0')}`,
    customer_id: 100,
    customer_name: 'Jane Doe',
    location_id: null,
    sale_id: null,
    created_by: null,
    assigned_to: null,
    assigned_to_name: null,
    device_type: 'Phone',
    brand: 'Apple',
    model: 'iPhone 13',
    serial_number: null,
    issue_description: 'Cracked screen',
    diagnosis: null,
    notes: null,
    estimated_cost: 199.0,
    final_cost: null,
    status: 'pending',
    priority: 'normal',
    received_at: new Date().toISOString(),
    estimated_completion: null,
    completed_at: null,
    picked_up_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

const okPage = (data: Repair[]) => ({
  data,
  meta: {current_page: 1, last_page: 1, per_page: 20, total: data.length},
});

const multiPage = (data: Repair[], page: number, lastPage: number) => ({
  data,
  meta: {current_page: page, last_page: lastPage, per_page: 20, total: 100},
});

// ---------------- tests ----------------
describe('RepairsListScreen', () => {
  beforeEach(() => {
    mockListRepairs.mockReset();
    mockGetCustomerDetail.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockRouteParams.current = {};
    mockWorkspaceState.repairs_enabled = true;
  });

  it('applies status filter when a chip is tapped and refetches', async () => {
    mockListRepairs.mockResolvedValue(okPage([makeRepair({id: 1})]));

    const {getByLabelText} = render(<RepairsListScreen />);

    // Initial fetch — 'all' means no status filter is passed.
    await waitFor(() => {
      expect(mockListRepairs).toHaveBeenCalledTimes(1);
    });
    expect(mockListRepairs).toHaveBeenLastCalledWith(1, 20, {});

    // Tap the "In Progress" chip. Screen should refetch with the wire
    // enum value (`in_progress`, not the display label).
    fireEvent.press(getByLabelText('Filter In Progress'));

    await waitFor(() => {
      expect(mockListRepairs).toHaveBeenCalledTimes(2);
    });
    expect(mockListRepairs).toHaveBeenLastCalledWith(1, 20, {
      status: 'in_progress',
    });

    // Active chip flips its accessibility state so screen readers reflect
    // the current filter.
    const inProgressPill = getByLabelText('Filter In Progress');
    expect(inProgressPill.props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('renders the EmptyState with a "New repair" action when the list is empty', async () => {
    mockListRepairs.mockResolvedValue(okPage([]));

    const {findByText, getByLabelText} = render(<RepairsListScreen />);

    await findByText('No repairs match this filter');

    // EmptyState.action renders a TouchableOpacity with the label as
    // accessibilityLabel — tapping it should navigate to RepairEdit
    // (undefined id = create mode).
    fireEvent.press(getByLabelText('New repair'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('RepairEdit', {});
    });
  });

  it('surfaces ErrorBanner with a retry affordance on relay failure', async () => {
    mockListRepairs.mockRejectedValue(new Error('Repairs unavailable'));

    const {getByText, getByLabelText} = render(<RepairsListScreen />);

    await waitFor(() => {
      expect(getByText('Repairs unavailable')).toBeTruthy();
    });
    // The shared ErrorBanner exposes Retry by accessibilityLabel.
    expect(getByLabelText('Retry')).toBeTruthy();

    mockListRepairs.mockResolvedValue(okPage([makeRepair({id: 99})]));
    fireEvent.press(getByLabelText('Retry'));

    await waitFor(() => {
      expect(mockListRepairs).toHaveBeenCalledTimes(2);
    });
  });

  it('paginates to page 2 when the FlatList reaches its end threshold', async () => {
    // Seed a two-page response so page < lastPage and onEndReached fires.
    const page1 = Array.from({length: 20}, (_, i) => makeRepair({id: i + 1}));
    mockListRepairs
      .mockResolvedValueOnce(multiPage(page1, 1, 2))
      .mockResolvedValueOnce(
        multiPage(
          [makeRepair({id: 21}), makeRepair({id: 22})],
          2,
          2,
        ),
      );

    const {UNSAFE_getAllByType} = render(<RepairsListScreen />);

    await waitFor(() => {
      expect(mockListRepairs).toHaveBeenCalledTimes(1);
    });

    // Reach into the FlatList and invoke onEndReached directly — the RTL
    // renderer doesn't drive scroll, so the prop callback is the correct
    // integration point to exercise the pagination handler.
    const {FlatList} = require('react-native');
    const list = UNSAFE_getAllByType(FlatList)[0];
    list.props.onEndReached();

    await waitFor(() => {
      expect(mockListRepairs).toHaveBeenCalledTimes(2);
    });
    // Second call requests page 2 with the same filters (none active).
    expect(mockListRepairs).toHaveBeenLastCalledWith(2, 20, {});
  });

  it('pre-applies the customer_id filter when route.params.customer_id is set', async () => {
    mockRouteParams.current = {customer_id: 42};
    mockGetCustomerDetail.mockResolvedValue({id: 42, name: 'Ada Lovelace'});
    mockListRepairs.mockResolvedValue(okPage([makeRepair({id: 1})]));

    const {findByText} = render(<RepairsListScreen />);

    await waitFor(() => {
      expect(mockListRepairs).toHaveBeenCalled();
    });
    // First call already carries the seeded customer filter.
    expect(mockListRepairs).toHaveBeenCalledWith(1, 20, {customer_id: 42});

    // Customer detail lookup lands and the chip reflects the display name.
    await findByText(/Filtered to: Ada Lovelace/);
    expect(mockGetCustomerDetail).toHaveBeenCalledWith(42);
  });

  it('bounces out when repairs_enabled is false at mount', async () => {
    mockWorkspaceState.repairs_enabled = false;
    mockListRepairs.mockResolvedValue(okPage([]));

    render(<RepairsListScreen />);

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalled();
    });
  });

  // W2-2 remediation: race two overlapping fetchRepairs invocations and
  // assert the stale response is discarded so the UI never shows a stale
  // page. Deferred promises control resolve order; the newer fetch (from
  // the chip press) resolves first, the older mount fetch resolves second.
  it('discards stale responses when a newer fetch races the previous one', async () => {
    let resolveOld: ((v: unknown) => void) | undefined;
    let resolveNew: ((v: unknown) => void) | undefined;
    mockListRepairs
      .mockImplementationOnce(
        () => new Promise(r => (resolveOld = r as (v: unknown) => void)),
      )
      .mockImplementationOnce(
        () => new Promise(r => (resolveNew = r as (v: unknown) => void)),
      );

    const {getByLabelText, findByText, queryByText} = render(
      <RepairsListScreen />,
    );

    // Wait for the initial fetch to be queued (mockListRepairs called once).
    await waitFor(() => expect(mockListRepairs).toHaveBeenCalledTimes(1));

    // Tap chip → second fetch (300ms debounce, so wait for the second call).
    fireEvent.press(getByLabelText('Filter In Progress'));
    await waitFor(() => expect(mockListRepairs).toHaveBeenCalledTimes(2));

    // Resolve the SECOND (newer) fetch first — UI should land on this page.
    resolveNew!(okPage([makeRepair({id: 2, repair_number: 'R-NEW'})]));
    await findByText('R-NEW');

    // Now resolve the OLD one. Stale-guard should discard it.
    resolveOld!(okPage([makeRepair({id: 999, repair_number: 'R-STALE'})]));
    await new Promise(r => setImmediate(r));

    expect(queryByText('R-STALE')).toBeNull();
    expect(queryByText('R-NEW')).not.toBeNull();
  });

  // W2-3 remediation: verify tab-return refires the fetch via the
  // controllable useFocusEffect callback. The screen guards the FIRST
  // focus with `didInitialFetchRef` so the mount effect doesn't
  // double-fetch — we simulate the "user leaves and returns" path by
  // calling triggerFocus() twice.
  it('refetches when the tab regains focus after the first mount', async () => {
    mockListRepairs.mockResolvedValue(okPage([makeRepair({id: 1})]));
    render(<RepairsListScreen />);
    await waitFor(() => expect(mockListRepairs).toHaveBeenCalledTimes(1));

    // First focus fire — didInitialFetchRef flips true, no refetch.
    triggerFocus();
    await new Promise(r => setImmediate(r));
    expect(mockListRepairs).toHaveBeenCalledTimes(1);

    // Second focus fire — user returned to the tab, refetch triggers.
    triggerFocus();
    await waitFor(() => expect(mockListRepairs).toHaveBeenCalledTimes(2));
  });

});
