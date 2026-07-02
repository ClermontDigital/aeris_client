import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {Customer, Repair} from '../../types/api.types';

// React 19's reportGlobalError uses window.dispatchEvent to surface caught
// errors. jest-expo's environment doesn't provide it — mirrors the
// DashboardScreen / RepairsListScreen setups.
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
const mockGetCustomerDetail = jest.fn();
const mockListRepairs = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getCustomerDetail: (...args: unknown[]) => mockGetCustomerDetail(...args),
    listRepairs: (...args: unknown[]) => mockListRepairs(...args),
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

// Nav mocks — module-level refs so tests can assert calls. `getParent`
// returns `undefined` because CustomerDetail uses the composite nav shape
// directly for the goToRepair / goToRepairsList jumps.
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockAddListener = jest.fn(() => () => undefined);
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    getParent: () => undefined,
    addListener: mockAddListener,
  }),
  useRoute: () => ({params: {customerId: 42}}),
  useFocusEffect: () => undefined,
}));

// Responsive layout — stable phone-shape default.
jest.mock('../../hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({isTablet: false}),
}));

// Nav history + header back stores — the detail screen only calls
// getState() on both. No behaviour under test relies on their internals.
jest.mock('../../stores/navHistoryStore', () => ({
  useNavHistoryStore: {
    getState: () => ({
      push: jest.fn(),
      popPrev: jest.fn(),
    }),
  },
}));
jest.mock('../../stores/headerBackStore', () => ({
  useHeaderBackStore: (selector: (s: object) => unknown) =>
    selector({setOnBack: () => undefined, clearIf: () => undefined}),
}));

// Workspace features store — flag drives whether the Repairs section
// renders. Tests mutate `mockRepairsEnabled` before render().
let mockRepairsEnabled = false;
const setRepairsEnabled = (v: boolean) => {
  mockRepairsEnabled = v;
};
jest.mock('../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: (
    selector: (s: {repairs_enabled: boolean}) => unknown,
  ) => selector({repairs_enabled: mockRepairsEnabled}),
}));

import CustomerDetailScreen from '../CustomerDetailScreen';

// ---------------- fixtures ----------------
function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42,
    name: 'Jane Buyer',
    first_name: 'Jane',
    last_name: 'Buyer',
    company: null,
    email: 'jane@example.com',
    phone: '555-0100',
    mobile: null,
    customer_number: null,
    account_balance_cents: null,
    payment_terms: null,
    credit_limit_cents: null,
    loyalty_points: null,
    total_orders: null,
    total_spent_cents: null,
    last_purchase_date: null,
    recent_sales: [],
    addresses: [],
    default_address: null,
    notes: null,
    created_at: null,
    ...over,
  };
}

function makeRepair(over: Partial<Repair> & Pick<Repair, 'id'>): Repair {
  return {
    repair_number: `REP-${String(over.id).padStart(4, '0')}`,
    customer_id: 42,
    customer_name: 'Jane Buyer',
    location_id: null,
    sale_id: null,
    created_by: null,
    assigned_to: null,
    assigned_to_name: null,
    device_type: 'Phone',
    brand: 'Apple',
    model: 'iPhone 14',
    serial_number: null,
    issue_description: 'Cracked screen',
    diagnosis: null,
    notes: null,
    estimated_cost: null,
    final_cost: null,
    status: 'in_progress',
    priority: 'normal',
    received_at: null,
    estimated_completion: null,
    completed_at: null,
    picked_up_at: null,
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    ...over,
  };
}

const okRepairPage = (data: Repair[]) => ({
  data,
  meta: {current_page: 1, last_page: 1, per_page: 3, total: data.length},
});

describe('CustomerDetailScreen Repairs section', () => {
  beforeEach(() => {
    mockGetCustomerDetail.mockReset();
    mockListRepairs.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockAddListener.mockClear();
    setRepairsEnabled(false);
  });

  it('is hidden when the workspace flag is off', async () => {
    setRepairsEnabled(false);
    mockGetCustomerDetail.mockResolvedValue(makeCustomer());
    mockListRepairs.mockResolvedValue(okRepairPage([]));

    const {queryByText, findByText} = render(<CustomerDetailScreen />);

    // Wait for the customer to render (Activity is unconditional).
    await findByText('Activity');

    // Repairs section MUST NOT render (no label, no view-all link).
    expect(queryByText(/^Repairs/)).toBeNull();
    expect(queryByText('View all repairs')).toBeNull();
    // And the fetch should never fire when the flag is off.
    expect(mockListRepairs).not.toHaveBeenCalled();
  });

  it('renders up to 3 repair rows with status chip when flag is on', async () => {
    setRepairsEnabled(true);
    mockGetCustomerDetail.mockResolvedValue(makeCustomer());
    mockListRepairs.mockResolvedValue(
      okRepairPage([
        makeRepair({id: 1, repair_number: 'REP-0001', status: 'ready'}),
        makeRepair({id: 2, repair_number: 'REP-0002', status: 'in_progress'}),
        makeRepair({id: 3, repair_number: 'REP-0003', status: 'pending'}),
      ]),
    );

    const {getByText, findByText} = render(<CustomerDetailScreen />);

    await findByText('Repairs (3)');
    expect(getByText('REP-0001')).toBeTruthy();
    expect(getByText('REP-0002')).toBeTruthy();
    expect(getByText('REP-0003')).toBeTruthy();
    expect(getByText('Ready')).toBeTruthy();
    // Shared helper uses sentence case "In progress" (was "In Progress" in
    // the CustomerDetail-local copy pre-T9-2 extraction).
    expect(getByText('In progress')).toBeTruthy();
    // Verify the fetch was called with the customer_id filter.
    expect(mockListRepairs).toHaveBeenCalledWith(1, 3, {customer_id: 42});
  });

  it('renders the empty state when no repairs are on file', async () => {
    setRepairsEnabled(true);
    mockGetCustomerDetail.mockResolvedValue(makeCustomer());
    mockListRepairs.mockResolvedValue(okRepairPage([]));

    const {findByText} = render(<CustomerDetailScreen />);

    await findByText('Repairs (0)');
    await findByText('No repairs on file for this customer.');
  });

  it('renders an unavailable body when the repairs fetch errors', async () => {
    setRepairsEnabled(true);
    mockGetCustomerDetail.mockResolvedValue(makeCustomer());
    mockListRepairs.mockRejectedValue(new Error('boom'));

    const {findByText} = render(<CustomerDetailScreen />);

    await findByText('Repairs unavailable');
  });

  it('View all deep-links to the Repairs stack pre-filtered by customer', async () => {
    setRepairsEnabled(true);
    mockGetCustomerDetail.mockResolvedValue(makeCustomer());
    mockListRepairs.mockResolvedValue(
      okRepairPage([makeRepair({id: 9, status: 'ready'})]),
    );

    const {findByLabelText} = render(<CustomerDetailScreen />);

    const viewAll = await findByLabelText('View all repairs for Jane Buyer');
    fireEvent.press(viewAll);

    expect(mockNavigate).toHaveBeenCalledWith('Repairs', {
      screen: 'RepairsList',
      params: {customer_id: 42},
      initial: false,
    });
  });

  it('tapping a repair row deep-links to RepairDetail', async () => {
    setRepairsEnabled(true);
    mockGetCustomerDetail.mockResolvedValue(makeCustomer());
    mockListRepairs.mockResolvedValue(
      okRepairPage([makeRepair({id: 77, status: 'ready'})]),
    );

    const {findByLabelText} = render(<CustomerDetailScreen />);

    const row = await findByLabelText(/Repair REP-0077, Ready\. Tap to view\./);
    fireEvent.press(row);

    expect(mockNavigate).toHaveBeenCalledWith('Repairs', {
      screen: 'RepairDetail',
      params: {id: 77},
      initial: false,
    });
  });
});
