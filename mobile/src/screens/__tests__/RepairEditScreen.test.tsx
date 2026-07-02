import React from 'react';
import {render, fireEvent, waitFor, act} from '@testing-library/react-native';
import {Alert} from 'react-native';
import type {Customer, RepairDetail} from '../../types/api.types';

// React 19 + jest-expo: window.dispatchEvent is needed for the global
// error reporter. Same rationale as DashboardScreen.test.tsx.
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
const mockCreateRepair = jest.fn();
const mockUpdateRepair = jest.fn();
const mockSearchCustomers = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getRepairDetail: (...args: unknown[]) => mockGetRepairDetail(...args),
    createRepair: (...args: unknown[]) => mockCreateRepair(...args),
    updateRepair: (...args: unknown[]) => mockUpdateRepair(...args),
    searchCustomers: (...args: unknown[]) => mockSearchCustomers(...args),
  },
}));

// Stable haptics ref - a fresh object per render would reset useCallback
// dep arrays and trigger an unrelated effect loop.
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
// H1: RepairEditScreen now reads user.location_id (required by the server's
// StoreRepairRequest) so the mocked user MUST expose that field. Tests can
// mutate `mockAuthState.user.location_id` to null to exercise the guard.
const mockAuthState = {
  user: {
    id: 7 as number | null,
    name: 'Tester' as string | null,
    location_id: 1 as number | null,
  },
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

// workspaceFeaturesStore - the mount-guard checks getState().repairs_enabled.
// Default true so most tests mount cleanly; the bounce test flips it false.
const mockWorkspaceState = {repairs_enabled: true};
jest.mock('../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: {
    getState: () => mockWorkspaceState,
  },
}));

// Navigation mock - useRoute is per-test controlled via the mockRouteParamsRef
// so the same mock covers both create mode ({id: undefined}) and edit mode
// ({id: 1}). Keeping a single mock module avoids the jest hoisting foot-gun
// of trying to re-mock @react-navigation/native inside describe blocks.
const mockRouteParamsRef: {params: {id?: number} | undefined} = {params: undefined};
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockGetParent = jest.fn();
const mockAddListener = jest.fn(() => () => undefined);

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    replace: mockReplace,
    navigate: mockNavigate,
    getParent: mockGetParent,
    addListener: mockAddListener,
  }),
  useRoute: () => mockRouteParamsRef,
  useFocusEffect: () => undefined,
}));

import RepairEditScreen, {
  validateRepairForm,
  parseServerFieldErrors,
  buildCreatePayload,
  buildUpdatePayload,
} from '../RepairEditScreen';

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
    issue_description: 'Cracked screen',
    diagnosis: null,
    notes: null,
    estimated_cost: 199.0,
    final_cost: null,
    status: 'in_progress',
    priority: 'high',
    received_at: now,
    estimated_completion: '2026-08-01',
    completed_at: null,
    picked_up_at: null,
    created_at: now,
    updated_at: now,
    customer: {
      id: 42,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: null,
    },
    items: [],
    status_history: [],
    ...over,
  };
}

function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 42,
    name: 'Ada Lovelace',
    first_name: 'Ada',
    last_name: 'Lovelace',
    company: null,
    email: 'ada@example.com',
    phone: null,
    mobile: null,
    customer_number: 'C-42',
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

// ---------------- pure helpers ----------------
describe('RepairEditScreen - pure form helpers', () => {
  it('validateRepairForm flags missing customer + issue on create', () => {
    const errs = validateRepairForm(
      {
        customerId: null,
        customerLabel: '',
        device_type: '',
        brand: '',
        model: '',
        serial_number: '',
        issue_description: '',
        diagnosis: '',
        notes: '',
        priority: 'normal',
        estimated_cost: '',
        estimated_completion: '',
      },
      false,
    );
    expect(errs.customer_id).toBeDefined();
    expect(errs.issue_description).toBeDefined();
  });

  it('validateRepairForm skips customer check in edit mode', () => {
    const errs = validateRepairForm(
      {
        customerId: null,
        customerLabel: '',
        device_type: '',
        brand: '',
        model: '',
        serial_number: '',
        issue_description: 'Cracked screen',
        diagnosis: '',
        notes: '',
        priority: 'normal',
        estimated_cost: '',
        estimated_completion: '',
      },
      true,
    );
    expect(errs.customer_id).toBeUndefined();
    expect(errs.issue_description).toBeUndefined();
  });

  it('validateRepairForm rejects malformed cost + ETA', () => {
    const errs = validateRepairForm(
      {
        customerId: 1,
        customerLabel: 'A',
        device_type: '',
        brand: '',
        model: '',
        serial_number: '',
        issue_description: 'x',
        diagnosis: '',
        notes: '',
        priority: 'normal',
        estimated_cost: 'abc',
        estimated_completion: 'tomorrow',
      },
      false,
    );
    expect(errs.estimated_cost).toBeDefined();
    expect(errs.estimated_completion).toBeDefined();
  });

  it('buildCreatePayload includes customer_id + location_id + dollar-float cost', () => {
    const payload = buildCreatePayload(
      {
        customerId: 42,
        customerLabel: 'Ada',
        device_type: 'Phone',
        brand: 'Apple',
        model: 'iPhone 13',
        serial_number: 'SN-1',
        issue_description: 'Cracked screen',
        diagnosis: 'Digitizer OK',
        notes: 'Rush',
        priority: 'high',
        estimated_cost: '199.95',
        estimated_completion: '2026-08-01',
      },
      1,
    );
    expect(payload.customer_id).toBe(42);
    // H1: location_id is a required field on the wire (Aeris2
    // StoreRepairRequest declares required|exists:locations,id). The
    // client sources it from the signed-in user's assigned deployment
    // site (authStore.user.location_id).
    expect(payload.location_id).toBe(1);
    expect(payload.issue_description).toBe('Cracked screen');
    expect(payload.estimated_cost).toBeCloseTo(199.95);
    expect(payload.priority).toBe('high');
    expect(payload.estimated_completion).toBe('2026-08-01');
  });

  it('buildUpdatePayload omits customer_id (server-locked)', () => {
    const payload = buildUpdatePayload({
      customerId: 42,
      customerLabel: 'Ada',
      device_type: '',
      brand: '',
      model: '',
      serial_number: '',
      issue_description: 'Update',
      diagnosis: '',
      notes: '',
      priority: 'normal',
      estimated_cost: '',
      estimated_completion: '',
    });
    // customer_id is Omit'd from RepairUpdateInput at the type level; assert
    // at runtime that the payload builder honours that (server ignores it).
    expect((payload as Record<string, unknown>).customer_id).toBeUndefined();
    expect(payload.estimated_cost).toBeNull();
  });

  it('parseServerFieldErrors extracts field errors from a Laravel-style body', () => {
    const err = new Error(
      'Request failed (422): {"errors":{"issue_description":["The issue description field is required."],"customer_id":["The selected customer is invalid."]}}',
    );
    const errs = parseServerFieldErrors(err);
    expect(errs.issue_description).toContain('required');
    expect(errs.customer_id).toBeDefined();
  });

  it('parseServerFieldErrors falls back to substring scanning', () => {
    const err = new Error('The issue description field is required.');
    const errs = parseServerFieldErrors(err);
    expect(errs.issue_description).toBeDefined();
  });
});

// ---------------- component ----------------
describe('RepairEditScreen - create mode', () => {
  beforeEach(() => {
    mockRouteParamsRef.params = undefined; // create mode
    mockGetRepairDetail.mockReset();
    mockCreateRepair.mockReset();
    mockUpdateRepair.mockReset();
    mockSearchCustomers.mockReset();
    mockGoBack.mockReset();
    mockReplace.mockReset();
    mockNavigate.mockReset();
    mockGetParent.mockReset();
    mockAddListener.mockReset().mockReturnValue(() => undefined);
    mockWorkspaceState.repairs_enabled = true;
    // H1: default the signed-in user's location_id back to a valid value
    // between tests so the null-location guard test can flip it without
    // leaking to later specs.
    mockAuthState.user = {id: 7, name: 'Tester', location_id: 1};
  });

  it('renders "New repair" title and does NOT fetch getRepairDetail', () => {
    const {getByText} = render(<RepairEditScreen />);
    expect(getByText('New repair')).toBeTruthy();
    expect(mockGetRepairDetail).not.toHaveBeenCalled();
  });

  it('disables Save until required fields (customer + issue) are filled', async () => {
    mockCreateRepair.mockResolvedValue(makeDetail());
    const {getByLabelText, getByTestId} = render(<RepairEditScreen />);

    // Save is initially disabled (no customer, no issue).
    const saveBtn = getByLabelText('Save new repair');
    fireEvent.press(saveBtn);
    // No create call because press is disabled.
    expect(mockCreateRepair).not.toHaveBeenCalled();

    // Fill issue only - still no customer, still disabled.
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'Cracked screen',
    );
    fireEvent.press(saveBtn);
    expect(mockCreateRepair).not.toHaveBeenCalled();
  });

  it('customer typeahead calls searchCustomers and selecting a hit enables Save', async () => {
    mockSearchCustomers.mockResolvedValue({
      data: [makeCustomer()],
      current_page: 1,
      last_page: 1,
      per_page: 20,
      total: 1,
    });
    mockCreateRepair.mockResolvedValue(makeDetail());

    const {getByLabelText, getByTestId, findByLabelText} = render(
      <RepairEditScreen />,
    );

    // Open the customer picker.
    fireEvent.press(getByLabelText('Select customer'));
    // Type into the search box.
    const searchInput = getByTestId('repair-edit-customer-search');
    fireEvent.changeText(searchInput, 'Ada');
    // Wait past the 300ms debounce.
    await waitFor(
      () => {
        expect(mockSearchCustomers).toHaveBeenCalled();
      },
      {timeout: 1000},
    );
    // Select the customer.
    const row = await findByLabelText('Select customer Ada Lovelace');
    fireEvent.press(row);

    // Now fill the issue and press save.
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'Cracked screen',
    );
    fireEvent.press(getByLabelText('Save new repair'));

    await waitFor(() => {
      expect(mockCreateRepair).toHaveBeenCalledTimes(1);
    });
    const [payload] = mockCreateRepair.mock.calls[0];
    expect(payload.customer_id).toBe(42);
    expect(payload.issue_description).toBe('Cracked screen');
    // H1: the seeded user's location_id (1) is threaded into the
    // create payload so the server's required|exists rule passes.
    expect(payload.location_id).toBe(1);
  });

  it('successful create replaces navigation with RepairDetail id', async () => {
    mockCreateRepair.mockResolvedValue(makeDetail({id: 501}));
    mockSearchCustomers.mockResolvedValue({
      data: [makeCustomer()],
      current_page: 1,
      last_page: 1,
      per_page: 20,
      total: 1,
    });

    const {getByLabelText, getByTestId, findByLabelText} = render(
      <RepairEditScreen />,
    );
    fireEvent.press(getByLabelText('Select customer'));
    fireEvent.changeText(getByTestId('repair-edit-customer-search'), 'Ada');
    await waitFor(() => expect(mockSearchCustomers).toHaveBeenCalled(), {
      timeout: 1000,
    });
    fireEvent.press(await findByLabelText('Select customer Ada Lovelace'));
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'Cracked screen',
    );
    fireEvent.press(getByLabelText('Save new repair'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('RepairDetail', {id: 501});
    });
    // goBack must NOT fire - replace supersedes the create screen entirely.
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('server 422 populates fieldErrors and surfaces inline helper text', async () => {
    mockSearchCustomers.mockResolvedValue({
      data: [makeCustomer()],
      current_page: 1,
      last_page: 1,
      per_page: 20,
      total: 1,
    });
    mockCreateRepair.mockRejectedValue(
      new Error(
        'Request failed (422): {"errors":{"issue_description":["The issue description field is required."]}}',
      ),
    );

    const {getByLabelText, getByTestId, findByLabelText, findByText} = render(
      <RepairEditScreen />,
    );
    // Fill customer + a placeholder issue so client-side validation lets us
    // through - the server then rejects.
    fireEvent.press(getByLabelText('Select customer'));
    fireEvent.changeText(getByTestId('repair-edit-customer-search'), 'Ada');
    await waitFor(() => expect(mockSearchCustomers).toHaveBeenCalled(), {
      timeout: 1000,
    });
    fireEvent.press(await findByLabelText('Select customer Ada Lovelace'));
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'placeholder',
    );
    fireEvent.press(getByLabelText('Save new repair'));

    // Inline helper text renders under the issue field.
    await findByText(/issue description field is required/i);
  });

  it('blocks submit with a location banner when the signed-in user has no location_id', async () => {
    // H1: null user.location_id short-circuits handleSubmit BEFORE the RPC
    // fires (server would 422 with location_id required otherwise). The
    // banner text is copied verbatim from the fix.
    mockAuthState.user = {id: 7, name: 'Tester', location_id: null};
    mockSearchCustomers.mockResolvedValue({
      data: [makeCustomer()],
      current_page: 1,
      last_page: 1,
      per_page: 20,
      total: 1,
    });
    mockCreateRepair.mockResolvedValue(makeDetail());

    const {getByLabelText, getByTestId, findByLabelText, findByText} = render(
      <RepairEditScreen />,
    );
    // Select a customer + fill the issue so client-side validation would
    // otherwise pass - the location guard is the ONLY thing blocking.
    fireEvent.press(getByLabelText('Select customer'));
    fireEvent.changeText(getByTestId('repair-edit-customer-search'), 'Ada');
    await waitFor(() => expect(mockSearchCustomers).toHaveBeenCalled(), {
      timeout: 1000,
    });
    fireEvent.press(await findByLabelText('Select customer Ada Lovelace'));
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'Cracked screen',
    );
    fireEvent.press(getByLabelText('Save new repair'));

    // Banner surfaces the specific admin-contact message.
    await findByText(
      /your account has no location assigned - contact your administrator/i,
    );
    // Critical: the RPC was NOT called - the guard short-circuits before
    // handleSubmit dispatches.
    expect(mockCreateRepair).not.toHaveBeenCalled();
  });
});

describe('RepairEditScreen - edit mode', () => {
  beforeEach(() => {
    mockRouteParamsRef.params = {id: 1};
    mockGetRepairDetail.mockReset();
    mockCreateRepair.mockReset();
    mockUpdateRepair.mockReset();
    mockSearchCustomers.mockReset();
    mockGoBack.mockReset();
    mockReplace.mockReset();
    mockNavigate.mockReset();
    mockGetParent.mockReset();
    mockAddListener.mockReset().mockReturnValue(() => undefined);
    mockWorkspaceState.repairs_enabled = true;
    mockAuthState.user = {id: 7, name: 'Tester', location_id: 1};
  });

  it('renders a spinner while getRepairDetail is in flight', () => {
    mockGetRepairDetail.mockImplementation(() => new Promise(() => {}));
    const {getByText} = render(<RepairEditScreen />);
    expect(getByText('Loading repair…')).toBeTruthy();
  });

  it('renders EmptyState when getRepairDetail returns null', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(null);
    const {findByText, getByLabelText} = render(<RepairEditScreen />);
    await findByText('Repair not found');
    fireEvent.press(getByLabelText('Back'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('hydrates the form and renders customer as a read-only chip', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    const {findByText, queryByLabelText} = render(<RepairEditScreen />);
    // Title switches to "Edit repair".
    await findByText('Edit repair');
    // Customer read-only chip renders "Ada Lovelace" + the LOCKED hint.
    await findByText('Ada Lovelace');
    await findByText('Locked');
    // In edit mode we DO NOT render the create-mode customer picker.
    expect(queryByLabelText('Select customer')).toBeNull();
  });

  it('Save calls updateRepair (not createRepair) then navigation.goBack', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    mockUpdateRepair.mockResolvedValue(makeDetail());

    const {findByText, getByLabelText, getByTestId} = render(
      <RepairEditScreen />,
    );
    await findByText('Edit repair');
    // Bump the issue so the form is dirty (also proves the input hydrated).
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'Cracked screen - updated',
    );
    fireEvent.press(getByLabelText('Save changes'));

    await waitFor(() => {
      expect(mockUpdateRepair).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateRepair).not.toHaveBeenCalled();
    const [id, payload] = mockUpdateRepair.mock.calls[0];
    expect(id).toBe(1);
    expect(payload.issue_description).toBe('Cracked screen - updated');
    // customer_id must NOT be present - server-locked.
    expect((payload as Record<string, unknown>).customer_id).toBeUndefined();
    // After success, goBack fires so RepairDetail refetches on focus.
    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalled();
    });
  });
});

describe('RepairEditScreen - discard-confirm on Back', () => {
  beforeEach(() => {
    mockRouteParamsRef.params = {id: 1};
    mockGetRepairDetail.mockReset();
    mockUpdateRepair.mockReset();
    mockGoBack.mockReset();
    mockAddListener.mockReset().mockReturnValue(() => undefined);
    mockWorkspaceState.repairs_enabled = true;
    mockAuthState.user = {id: 7, name: 'Tester', location_id: 1};
  });

  it('skips the confirm and goes back when the form is clean', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const {findByText, getByLabelText} = render(<RepairEditScreen />);
    await findByText('Edit repair');
    fireEvent.press(getByLabelText('Back'));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows a three-way confirm (Discard / Keep editing / Save) when the form is dirty', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const {findByText, getByLabelText, getByTestId} = render(
      <RepairEditScreen />,
    );
    await findByText('Edit repair');

    // Dirty the form.
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'Bumped',
    );

    fireEvent.press(getByLabelText('Back'));

    expect(alertSpy).toHaveBeenCalled();
    const [title, , buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      Array<{text: string; style?: string}>,
    ];
    expect(title).toMatch(/discard/i);
    const labels = buttons.map(b => b.text);
    expect(labels).toEqual(
      expect.arrayContaining(['Keep editing', 'Discard', 'Save']),
    );
    // We didn't press any Alert button, so goBack did NOT fire directly.
    expect(mockGoBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  // T7-COV-01 remediation: exercise each of the 3 Alert buttons so a
  // regression in the branch wiring surfaces.
  it('Discard branch of the confirm fires goBack; Save routes through submit', async () => {
    mockGetRepairDetail.mockResolvedValueOnce(makeDetail());
    mockUpdateRepair.mockResolvedValueOnce(makeDetail());
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => {});
    const {findByText, getByLabelText, getByTestId} = render(
      <RepairEditScreen />,
    );
    await findByText('Edit repair');
    fireEvent.changeText(
      getByTestId('repair-edit-issue-description'),
      'Bumped',
    );
    fireEvent.press(getByLabelText('Back'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const byLabel = (label: string) => buttons.find(b => b.text === label);

    // Discard branch → goBack fires with no submit.
    await act(async () => {
      byLabel('Discard')?.onPress?.();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockUpdateRepair).not.toHaveBeenCalled();

    // Save branch → routes through handleSubmit → updateRepair fires.
    await act(async () => {
      byLabel('Save')?.onPress?.();
    });
    await waitFor(() => {
      expect(mockUpdateRepair).toHaveBeenCalledTimes(1);
    });

    alertSpy.mockRestore();
  });
});

describe('RepairEditScreen - workspace-flag bounce', () => {
  beforeEach(() => {
    mockRouteParamsRef.params = {id: 1};
    mockGetRepairDetail.mockReset();
    mockGoBack.mockReset();
    mockAddListener.mockReset().mockReturnValue(() => undefined);
    mockWorkspaceState.repairs_enabled = false;
    mockAuthState.user = {id: 7, name: 'Tester', location_id: 1};
  });

  it('bounces out when repairs_enabled is false at mount without firing an orphan fetch', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetRepairDetail.mockResolvedValue(makeDetail());

    render(<RepairEditScreen />);

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalled();
    });
    // Orphan-fetch guard: the disabled workspace short-circuits the
    // load path so no getRepairDetail call goes out. Without the guard
    // the fetch would race the goBack and produce a spurious
    // REPAIRS_DISABLED toast.
    expect(mockGetRepairDetail).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
