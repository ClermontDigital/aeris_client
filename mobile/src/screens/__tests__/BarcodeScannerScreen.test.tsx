import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {RepairDetail} from '../../types/api.types';

// React 19 + jest-expo: window.dispatchEvent for the global error reporter.
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

// Top up the shared jest.setup vision-camera mock with the two symbols the
// screen also imports statically. useCameraFormat resolves once per render;
// Camera.getCameraPermissionStatus is a module-level static accessed via
// the default `Camera` export.
jest.mock('react-native-vision-camera', () => {
  const React = require('react');
  const Camera: any = React.forwardRef(function CameraMock(
    _props: unknown,
    _ref: unknown,
  ) {
    return null;
  });
  Camera.getCameraPermissionStatus = jest.fn(() => 'granted');
  return {
    Camera,
  useCameraDevice: jest.fn(() => ({
    id: 'back',
    minZoom: 1,
    maxZoom: 6,
    neutralZoom: 1,
    physicalDevices: ['wide-angle-camera'],
    supportsFocus: false,
  })),
  useCameraFormat: jest.fn(() => undefined),
  useCameraPermission: jest.fn(() => ({
    hasPermission: true,
    requestPermission: jest.fn(() => Promise.resolve(true)),
  })),
  // captureFn lets tests fire a code scan by grabbing the last-registered
  // onCodeScanned callback (stashed on the module for external access).
  useCodeScanner: jest.fn(({onCodeScanned}) => {
    (globalThis as any).__lastCodeScannedHandler = onCodeScanned;
    return {codeTypes: [], onCodeScanned};
  }),
  };
});

// Cart-store stub — the QuickSale-mode repair confirm branch calls into
// this store; the direct-navigate branches don't touch it.
const mockCartState: any = {
  items: [],
  clear: jest.fn(),
  setCustomer: jest.fn(),
  addItem: jest.fn(),
  setRepairId: jest.fn(),
  setRepairNumber: jest.fn(),
};
jest.mock('../../stores/cartStore', () => {
  const useCartStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(mockCartState) : mockCartState;
  useCartStore.getState = () => mockCartState;
  useCartStore.setState = jest.fn();
  useCartStore.subscribe = () => () => undefined;
  return {useCartStore};
});

// productCacheStore stub — only getByBarcode is read; return null so the
// tests only hit the paths under test (repair short-circuit).
jest.mock('../../stores/productCacheStore', () => {
  const state = {getByBarcode: () => null};
  const useProductCacheStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useProductCacheStore.getState = () => state;
  return {useProductCacheStore};
});

// scannerVisibilityStore — no-op for these tests.
jest.mock('../../stores/scannerVisibilityStore', () => {
  const state = {setScannerVisible: jest.fn(), isScannerVisible: false};
  const useScannerVisibilityStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useScannerVisibilityStore.getState = () => state;
  return {useScannerVisibilityStore};
});

// Stable haptics.
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

const mockGetRepairByBarcode = jest.fn();
const mockGetRepairDetail = jest.fn();
const mockGetProductByBarcode = jest.fn();
const mockGetStock = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getRepairByBarcode: (...a: unknown[]) => mockGetRepairByBarcode(...a),
    getRepairDetail: (...a: unknown[]) => mockGetRepairDetail(...a),
    getProductByBarcode: (...a: unknown[]) => mockGetProductByBarcode(...a),
    getStock: (...a: unknown[]) => mockGetStock(...a),
  },
}));

// Navigation mock — mode is set via useRoute().params.mode per test.
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockGetParent = jest.fn();
const mockGetState = jest.fn<{routes: Array<{name: string}>}, []>(() => ({
  routes: [],
}));
const mockAddListener = jest.fn(() => () => undefined);
const mockRouteParams: {current: Record<string, unknown>} = {current: {}};

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: () => undefined,
  useNavigation: () => ({
    replace: mockReplace,
    navigate: mockNavigate,
    goBack: mockGoBack,
    getParent: mockGetParent,
    getState: mockGetState,
    addListener: mockAddListener,
  }),
  useRoute: () => ({params: mockRouteParams.current}),
}));

import BarcodeScannerScreen from '../BarcodeScannerScreen';

function fireScan(value: string): void {
  const cb = (globalThis as any).__lastCodeScannedHandler as
    | ((codes: Array<{value: string}>) => void)
    | undefined;
  if (!cb) throw new Error('onCodeScanned handler was never registered');
  cb([{value}]);
}

function makeRepairDetail(over: Partial<RepairDetail> = {}): RepairDetail {
  const now = new Date().toISOString();
  return {
    id: 42,
    repair_number: 'REP-20260702-000001',
    customer_id: 7,
    customer_name: 'Ada Lovelace',
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
    estimated_cost: 199,
    final_cost: null,
    status: 'ready',
    priority: 'normal',
    received_at: now,
    estimated_completion: null,
    completed_at: null,
    picked_up_at: null,
    created_at: now,
    updated_at: now,
    customer: {id: 7, name: 'Ada Lovelace', email: null, phone: null},
    items: [
      {
        id: 10,
        repair_id: 42,
        product_id: 900,
        item_name: 'Screen assembly',
        item_sku: 'SCR-900',
        item_type: 'part',
        quantity: 1,
        unit_price: 130,
        line_total: 130,
        notes: null,
        status: 'reserved',
        created_at: now,
        updated_at: now,
      },
    ],
    status_history: [],
    ...over,
  };
}

describe('BarcodeScannerScreen WSA-1 repair mode', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockGetParent.mockReset();
    mockGetState.mockReset().mockReturnValue({routes: []});
    mockAddListener.mockReset().mockReturnValue(() => undefined);
    mockGetRepairByBarcode.mockReset();
    mockGetRepairDetail.mockReset();
    mockGetProductByBarcode.mockReset();
    mockGetStock.mockReset();
    mockCartState.clear.mockClear();
    mockCartState.setCustomer.mockClear();
    mockCartState.addItem.mockClear();
    mockCartState.setRepairId.mockClear();
    mockCartState.setRepairNumber.mockClear();
    mockRouteParams.current = {};
    delete (globalThis as any).__lastCodeScannedHandler;
  });

  it('routes a REP-* scan in repair mode to RepairDetail via a local replace when the stack hosts RepairsList', async () => {
    mockRouteParams.current = {mode: 'repair'};
    mockGetState.mockReturnValue({routes: [{name: 'RepairsList'}]});
    const detail = makeRepairDetail({id: 77});
    mockGetRepairByBarcode.mockResolvedValueOnce(detail);

    render(<BarcodeScannerScreen />);
    fireScan('REP-20260702-000001');

    await waitFor(() => {
      expect(mockGetRepairByBarcode).toHaveBeenCalledWith('REP-20260702-000001');
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('RepairDetail', {id: 77});
    });
    // Product lookup path MUST NOT be exercised for a REP-* scan.
    expect(mockGetProductByBarcode).not.toHaveBeenCalled();
  });

  it('shows the "Not a repair barcode" state when the scanned string does not match REP-YYYYMMDD-NNNNNN in repair mode', async () => {
    mockRouteParams.current = {mode: 'repair'};

    const {findByText} = render(<BarcodeScannerScreen />);
    fireScan('1234567890123');

    await findByText('Not a repair barcode');
    expect(mockGetRepairByBarcode).not.toHaveBeenCalled();
    expect(mockGetProductByBarcode).not.toHaveBeenCalled();
  });

  it('shows the "Not a repair we can find" state when the server returns null for a REP-* scan in repair mode', async () => {
    mockRouteParams.current = {mode: 'repair'};
    mockGetRepairByBarcode.mockResolvedValueOnce(null);

    const {findByText} = render(<BarcodeScannerScreen />);
    fireScan('REP-20260702-000002');

    await findByText('Not a repair we can find');
    expect(mockGetProductByBarcode).not.toHaveBeenCalled();
  });

  it('unconditionally intercepts a REP-* scan in cart mode and shows the "Take payment for repair" confirm alert', async () => {
    mockRouteParams.current = {mode: 'cart'};
    const detail = makeRepairDetail();
    mockGetRepairByBarcode.mockResolvedValueOnce(detail);
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    render(<BarcodeScannerScreen />);
    fireScan('REP-20260702-000001');

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Take payment for repair',
        'Parts reserved at intake. Ready to take payment?',
        expect.any(Array),
      );
    });
    // Product path is bypassed by the short-circuit even in cart mode.
    expect(mockGetProductByBarcode).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('Confirm branch on a REP-* scan in cart mode clears cart, adds real product_id items, sets repair link, and navigates to Cart', async () => {
    mockRouteParams.current = {mode: 'cart'};
    mockGetState.mockReturnValue({
      routes: [{name: 'ProductGrid'}, {name: 'Scanner'}],
    });
    const detail = makeRepairDetail();
    mockGetRepairByBarcode.mockResolvedValueOnce(detail);
    mockGetRepairDetail.mockResolvedValueOnce(detail);
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    render(<BarcodeScannerScreen />);
    fireScan('REP-20260702-000001');

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const confirm = buttons.find(b => b.text === 'Confirm');
    await confirm?.onPress?.();

    await waitFor(() => {
      expect(mockCartState.clear).toHaveBeenCalled();
    });
    // Real product_id per the T8 stock contract — negative synthetic ids
    // would 422 on POSController::processSale.
    const addCall = mockCartState.addItem.mock.calls[0][0];
    expect(addCall.id).toBe(900);
    expect(mockCartState.setRepairId).toHaveBeenCalledWith(detail.id);
    expect(mockNavigate).toHaveBeenCalledWith('Cart');
    alertSpy.mockRestore();
  });

  it('Confirm branch blocks with the "till desktop" alert when the scanned repair has labour lines', async () => {
    mockRouteParams.current = {mode: 'cart'};
    mockGetState.mockReturnValue({
      routes: [{name: 'ProductGrid'}, {name: 'Scanner'}],
    });
    const withLabour = makeRepairDetail({
      items: [
        {
          id: 10,
          repair_id: 42,
          product_id: 900,
          item_name: 'Screen',
          item_sku: 'SCR',
          item_type: 'part',
          quantity: 1,
          unit_price: 130,
          line_total: 130,
          notes: null,
          status: 'reserved',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 11,
          repair_id: 42,
          product_id: null,
          item_name: 'Labour',
          item_sku: null,
          item_type: 'labor',
          quantity: 1,
          unit_price: 70,
          line_total: 70,
          notes: null,
          status: 'reserved',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });
    mockGetRepairByBarcode.mockResolvedValueOnce(withLabour);
    mockGetRepairDetail.mockResolvedValueOnce(withLabour);
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);

    render(<BarcodeScannerScreen />);
    fireScan('REP-20260702-000001');

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    const confirm = buttons.find(b => b.text === 'Confirm');
    await confirm?.onPress?.();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Repair labour handling',
        expect.stringContaining('till desktop'),
      );
    });
    expect(mockCartState.clear).not.toHaveBeenCalled();
    expect(mockCartState.addItem).not.toHaveBeenCalled();
    expect(mockCartState.setRepairId).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('leaves the existing product-scan path untouched: a non-REP scan in cart mode calls getProductByBarcode', async () => {
    mockRouteParams.current = {mode: 'cart'};
    mockGetProductByBarcode.mockResolvedValueOnce(null);

    render(<BarcodeScannerScreen />);
    fireScan('9310072000012');

    await waitFor(() => {
      expect(mockGetProductByBarcode).toHaveBeenCalledWith('9310072000012');
    });
    expect(mockGetRepairByBarcode).not.toHaveBeenCalled();
  });
});
