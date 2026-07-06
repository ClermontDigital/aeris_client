import React from 'react';
import {render, waitFor, fireEvent, act} from '@testing-library/react-native';
import type {Product, RepairDetail} from '../../types/api.types';

// React 19 + jest-expo: window.dispatchEvent is needed for the global error
// reporter. See DashboardScreen.test.tsx for the full rationale.
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
const mockAddRepairItem = jest.fn();
const mockUpdateRepairItem = jest.fn();
const mockRemoveRepairItem = jest.fn();
const mockSearchProducts = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getRepairDetail: (...a: unknown[]) => mockGetRepairDetail(...a),
    addRepairItem: (...a: unknown[]) => mockAddRepairItem(...a),
    updateRepairItem: (...a: unknown[]) => mockUpdateRepairItem(...a),
    removeRepairItem: (...a: unknown[]) => mockRemoveRepairItem(...a),
    searchProducts: (...a: unknown[]) => mockSearchProducts(...a),
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

jest.mock('../../hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({isTablet: false}),
}));

const mockSetSettlementOrPrintInFlight = jest.fn();
jest.mock('../../stores/transactionActivityStore', () => ({
  useTransactionActivityStore: {
    getState: () => ({
      setSettlementOrPrintInFlight: mockSetSettlementOrPrintInFlight,
    }),
  },
}));

const mockWorkspaceState = {repairs_enabled: true};
jest.mock('../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: {
    getState: () => mockWorkspaceState,
  },
}));

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({goBack: mockGoBack, navigate: mockNavigate}),
  useRoute: () => ({params: {id: 1}}),
}));

import RepairItemsEditorSheet from '../RepairItemsEditorSheet';
import {useRepairItemScanStore} from '../../stores/repairItemScanStore';

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
    assigned_to: null,
    assigned_to_name: null,
    device_type: 'Phone',
    brand: 'Apple',
    model: 'iPhone 13',
    serial_number: null,
    issue_description: 'Cracked screen',
    diagnosis: null,
    notes: null,
    estimated_cost: null,
    final_cost: null,
    status: 'in_progress',
    priority: 'normal',
    received_at: now,
    estimated_completion: null,
    completed_at: null,
    picked_up_at: null,
    created_at: now,
    updated_at: now,
    customer: null,
    items: [],
    status_history: [],
    ...over,
  };
}

function makeProduct(over: Partial<Product> = {}): Product {
  return {
    id: 900,
    name: 'iPhone 13 Screen Assembly',
    sku: 'SCREEN-IP13',
    barcode: null,
    price_cents: 13000,
    tax_rate: 10,
    stock_on_hand: 5,
    category_id: null,
    category_name: null,
    image_url: null,
    is_active: true,
    ...over,
  };
}

function okPage(products: Product[]) {
  return {
    data: products,
    meta: {current_page: 1, last_page: 1, per_page: 20, total: products.length},
  };
}

describe('RepairItemsEditorSheet — add part from stock', () => {
  beforeEach(() => {
    mockGetRepairDetail.mockReset().mockResolvedValue(makeDetail());
    mockAddRepairItem
      .mockReset()
      .mockImplementation(() => Promise.resolve(makeDetail()));
    mockSearchProducts.mockReset().mockResolvedValue(okPage([makeProduct()]));
    mockGoBack.mockReset();
    mockNavigate.mockReset();
    useRepairItemScanStore.getState().clear();
    mockSetSettlementOrPrintInFlight.mockReset();
  });

  async function openAddForm(utils: ReturnType<typeof render>) {
    await waitFor(() =>
      expect(mockGetRepairDetail).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add part'));
    });
  }

  it('selecting a stock product sends addRepairItem with the REAL product_id', async () => {
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    // Search stock — debounced searchProducts fires, result renders.
    await act(async () => {
      fireEvent.changeText(
        utils.getByLabelText('Search stock parts'),
        'screen',
      );
    });
    await waitFor(() =>
      expect(mockSearchProducts).toHaveBeenCalledWith('screen', 1),
    );
    // a11y label folds in sku + price + on-hand so VoiceOver announces them.
    const result = await utils.findByLabelText(
      'Add iPhone 13 Screen Assembly, SCREEN-IP13, $130.00, 5 in stock',
    );

    // Select it — links the product, prefills name + price.
    await act(async () => {
      fireEvent.press(result);
    });

    // Submit.
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });

    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    const [repairId, payload] = mockAddRepairItem.mock.calls[0];
    expect(repairId).toBe(1);
    expect(payload).toMatchObject({
      item_type: 'part',
      item_name: 'iPhone 13 Screen Assembly',
      product_id: 900, // the REAL catalogue id — enables stock reserve/decrement
      item_sku: 'SCREEN-IP13',
      unit_price: 130, // prefilled from price_cents/100
      quantity: 1,
    });
  });

  it('keeps the add form open and re-armed on the search after Add (add-another)', async () => {
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'screen');
    });
    const result = await utils.findByLabelText(
      'Add iPhone 13 Screen Assembly, SCREEN-IP13, $130.00, 5 in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });
    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));

    // The form did NOT close — it reset to a clean search state so the next
    // part can be added straight away (the linked chip is gone, search is back).
    expect(utils.getByLabelText('Search stock parts')).toBeTruthy();
    expect(utils.queryByLabelText('Change stock item')).toBeNull();
    // "Done" closes the add form back to the list.
    expect(utils.getByLabelText('Done adding parts')).toBeTruthy();
  });

  it('refreshes the items list from a fresh detail fetch after adding (write response omits items[])', async () => {
    // Reproduces the reported bug: the add RPC returns the parent repair
    // WITHOUT items[] hydrated, so the list would show "no items yet" until a
    // back-nav refetch. The editor now re-reads authoritative detail after the
    // write. First getRepairDetail (load) is empty; the post-add re-read has
    // the new part.
    const withItem = makeDetail({
      items: [
        {
          id: 55,
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
          created_at: '',
          updated_at: '',
        },
      ],
    });
    mockGetRepairDetail
      .mockReset()
      .mockResolvedValueOnce(makeDetail()) // initial load — no items
      .mockResolvedValue(withItem); // post-add re-read — has the part
    // The add RPC's own return deliberately lacks items[] (server write shape).
    mockAddRepairItem.mockReset().mockResolvedValue(makeDetail());

    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'screen');
    });
    const result = await utils.findByLabelText(
      'Add iPhone 13 Screen Assembly, SCREEN-IP13, $130.00, 5 in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });

    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    // A second detail fetch happened (the authoritative re-read) …
    await waitFor(() =>
      expect(mockGetRepairDetail).toHaveBeenCalledTimes(2),
    );
    // … and the freshly-added part now shows in the list.
    await utils.findByLabelText('iPhone 13 Screen Assembly');
  });

  it('is parts-only: no Labour type toggle, opens on the stock search', async () => {
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);
    expect(utils.queryByLabelText('Labour')).toBeNull();
    expect(utils.queryByLabelText('Part')).toBeNull();
    // Search is the primary path — the form opens straight onto it. The
    // off-catalogue name field is hidden until "Enter part manually" is tapped.
    expect(utils.getByLabelText('Search stock parts')).toBeTruthy();
    expect(utils.queryByLabelText('Part name')).toBeNull();
    expect(
      utils.getByLabelText('Enter an off-catalogue part manually'),
    ).toBeTruthy();
  });

  it('a stock product with no sell price prefills a BLANK price and blocks Add until one is typed', async () => {
    mockSearchProducts
      .mockReset()
      .mockResolvedValue(
        okPage([
          makeProduct({
            id: 901,
            name: 'Warranty gasket',
            sku: 'GKT-901',
            price_cents: 0,
          }),
        ]),
      );
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'gasket');
    });
    const result = await utils.findByLabelText(/Add Warranty gasket/);
    await act(async () => {
      fireEvent.press(result);
    });

    // No price on file -> the cashier must enter one; a bare Add is rejected
    // rather than silently booking the part at $0.00.
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });
    expect(mockAddRepairItem).not.toHaveBeenCalled();
    await utils.findByText('Unit price must be a positive number.');

    // Enter a price -> Add now goes through with the typed value.
    await act(async () => {
      fireEvent.changeText(
        utils.getByLabelText('Unit price in dollars'),
        '4.00',
      );
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });
    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    expect(mockAddRepairItem.mock.calls[0][1]).toMatchObject({
      product_id: 901,
      unit_price: 4,
    });
  });

  it('an off-catalogue part typed by hand sends product_id: null', async () => {
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    // Reveal the off-catalogue path, then type a name + price by hand.
    await act(async () => {
      fireEvent.press(
        utils.getByLabelText('Enter an off-catalogue part manually'),
      );
    });
    await act(async () => {
      fireEvent.changeText(
        utils.getByLabelText('Part name'),
        'Salvaged flex cable',
      );
      fireEvent.changeText(
        utils.getByLabelText('Unit price in dollars'),
        '12.50',
      );
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });

    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    const [, payload] = mockAddRepairItem.mock.calls[0];
    expect(payload).toMatchObject({
      item_type: 'part',
      item_name: 'Salvaged flex cable',
      product_id: null,
      unit_price: 12.5,
    });
  });

  it('"Change" unlinks the product and re-arms the stock search', async () => {
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    await act(async () => {
      fireEvent.changeText(
        utils.getByLabelText('Search stock parts'),
        'screen',
      );
    });
    const result = await utils.findByLabelText(
      'Add iPhone 13 Screen Assembly, SCREEN-IP13, $130.00, 5 in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });
    // Linked chip visible (Add surfaces), search field gone.
    expect(utils.queryByLabelText('Search stock parts')).toBeNull();
    expect(utils.getByLabelText('Add item to repair')).toBeTruthy();

    // Change → unlinks and returns to a clean search state: search field back,
    // the linked chip + Add gone (nothing to add until a fresh pick / manual).
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Change stock item'));
    });
    expect(utils.getByLabelText('Search stock parts')).toBeTruthy();
    expect(utils.queryByLabelText('Change stock item')).toBeNull();
    expect(utils.queryByLabelText('Add item to repair')).toBeNull();
  });

  it('renders the empty state when the stock search returns nothing', async () => {
    mockSearchProducts.mockResolvedValue(okPage([]));
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    await act(async () => {
      fireEvent.changeText(
        utils.getByLabelText('Search stock parts'),
        'nonexistent',
      );
    });
    await waitFor(() =>
      expect(mockSearchProducts).toHaveBeenCalledWith('nonexistent', 1),
    );
    await waitFor(() =>
      expect(utils.getByText(/No matching stock parts/i)).toBeTruthy(),
    );
  });

  it('a metered stock part (unit_type m) accepts a fractional quantity and sends it', async () => {
    const hose = makeProduct({
      id: 950,
      name: 'Hydraulic Hose',
      sku: 'HOSE-10',
      price_cents: 1500,
      stock_on_hand: 25,
      unit_type: 'm',
      allows_decimal_quantity: true,
    });
    mockSearchProducts.mockReset().mockResolvedValue(okPage([hose]));

    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'hose');
    });
    // Result row shows the unit next to on-hand.
    const result = await utils.findByLabelText(
      'Add Hydraulic Hose, HOSE-10, $15.00, 25 m in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });

    // The quantity field is now unit-labelled + decimal — enter 1.3 m.
    const qtyInput = utils.getByLabelText('Quantity in m');
    expect(qtyInput.props.keyboardType).toBe('decimal-pad');
    await act(async () => {
      fireEvent.changeText(qtyInput, '1.3');
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });

    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    const [, payload] = mockAddRepairItem.mock.calls[0];
    expect(payload).toMatchObject({
      item_type: 'part',
      product_id: 950,
      quantity: 1.3, // fractional, NOT truncated
    });
  });

  it('clamps a metered quantity to the server DECIMAL(12,3) precision (3 dp)', async () => {
    const hose = makeProduct({
      id: 951,
      name: 'Air Hose',
      sku: 'HOSE-A',
      price_cents: 900,
      stock_on_hand: 40,
      unit_type: 'm',
      allows_decimal_quantity: true,
    });
    mockSearchProducts.mockReset().mockResolvedValue(okPage([hose]));

    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'hose');
    });
    const result = await utils.findByLabelText(
      'Add Air Hose, HOSE-A, $9.00, 40 m in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });
    // Type 4 decimal places — should be clamped to 3 before the wire.
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Quantity in m'), '1.2367');
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });

    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    const [, payload] = mockAddRepairItem.mock.calls[0];
    expect(payload.quantity).toBeCloseTo(1.237, 3);
    // No more than 3 decimal places reach the wire.
    expect(Number.isInteger((payload.quantity as number) * 1000)).toBe(true);
  });

  it('unlinking a metered part clears the metered state — off-catalogue entry is a whole-number each line', async () => {
    const hose = makeProduct({
      id: 952,
      name: 'Fuel Hose',
      sku: 'HOSE-F',
      price_cents: 1200,
      stock_on_hand: 30,
      unit_type: 'm',
      allows_decimal_quantity: true,
    });
    mockSearchProducts.mockReset().mockResolvedValue(okPage([hose]));

    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'hose');
    });
    const result = await utils.findByLabelText(
      'Add Fuel Hose, HOSE-F, $12.00, 30 m in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });
    // Linked → the metered "Quantity in m" field is present.
    expect(utils.getByLabelText('Quantity in m')).toBeTruthy();

    // Change → back to a clean search; the metered field is gone.
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Change stock item'));
    });
    expect(utils.queryByLabelText('Quantity in m')).toBeNull();

    // Reveal off-catalogue entry → a whole-number 'each' line (integer keypad).
    await act(async () => {
      fireEvent.press(
        utils.getByLabelText('Enter an off-catalogue part manually'),
      );
    });
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Part name'), 'Zip tie');
      fireEvent.changeText(utils.getByLabelText('Unit price in dollars'), '2');
    });
    const qtyInput = utils.getByLabelText('Quantity');
    expect(qtyInput.props.value).toBe('1');
    expect(qtyInput.props.keyboardType).toBe('number-pad');

    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });
    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    const [, payload] = mockAddRepairItem.mock.calls[0];
    expect(payload).toMatchObject({product_id: null, quantity: 1});
  });

  it('Scan opens the product scanner, and a scanned product links + adds with its real product_id', async () => {
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    // Tap Scan → navigates to the product-barcode scanner.
    await act(async () => {
      fireEvent.press(
        utils.getByLabelText('Scan a product barcode to add'),
      );
    });
    expect(mockNavigate).toHaveBeenCalledWith('RepairItemScanner');

    // Simulate the scanner resolving a product and handing it back via the
    // store (what BarcodeScannerScreen does in 'repair-item' mode).
    await act(async () => {
      useRepairItemScanStore
        .getState()
        .setPendingProduct(
          makeProduct({id: 970, name: 'Scanned Widget', sku: 'WIDGET-1', price_cents: 4500}),
        );
    });

    // The editor links it — the linked-stock chip shows the product name and
    // the Add affordance surfaces. Submit sends the real id.
    expect(utils.getByText('Scanned Widget')).toBeTruthy();
    expect(utils.getByLabelText('Change stock item')).toBeTruthy();
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });
    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    const [, payload] = mockAddRepairItem.mock.calls[0];
    expect(payload).toMatchObject({
      item_type: 'part',
      product_id: 970,
      item_name: 'Scanned Widget',
    });
    // Store consumed (cleared) so it can't re-link on the next render.
    expect(useRepairItemScanStore.getState().pendingProduct).toBeNull();
  });

  it('ignores a stale scanned product when no scan was requested from this editor', async () => {
    // A pending product present WITHOUT the user tapping Scan (e.g. stale
    // from a prior session) must NOT auto-link.
    useRepairItemScanStore
      .getState()
      .setPendingProduct(makeProduct({id: 971, name: 'Stale Widget'}));

    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);

    // Nothing auto-linked: no linked chip, still on the stock search, and the
    // stale store entry was cleared.
    expect(utils.queryByLabelText('Change stock item')).toBeNull();
    expect(utils.getByLabelText('Search stock parts')).toBeTruthy();
    expect(useRepairItemScanStore.getState().pendingProduct).toBeNull();
    expect(mockAddRepairItem).not.toHaveBeenCalled();
  });

  it('rejects a metered quantity below the 0.001 minimum with a banner', async () => {
    const hose = makeProduct({
      id: 953,
      name: 'Brake Hose',
      sku: 'HOSE-B',
      price_cents: 800,
      stock_on_hand: 12,
      unit_type: 'm',
      allows_decimal_quantity: true,
    });
    mockSearchProducts.mockReset().mockResolvedValue(okPage([hose]));

    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'hose');
    });
    const result = await utils.findByLabelText(
      'Add Brake Hose, HOSE-B, $8.00, 12 m in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Quantity in m'), '0');
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });

    // Zero is below the 0.001 floor → validation banner, no RPC.
    await waitFor(() =>
      expect(utils.getByText(/Quantity must be greater than 0/i)).toBeTruthy(),
    );
    expect(mockAddRepairItem).not.toHaveBeenCalled();
  });

  it('a non-metered (each) part truncates a typed decimal to a whole number', async () => {
    // Default fixture has no unit_type -> treated as 'each' -> whole-number.
    const utils = render(<RepairItemsEditorSheet />);
    await openAddForm(utils);
    await act(async () => {
      fireEvent.changeText(utils.getByLabelText('Search stock parts'), 'screen');
    });
    const result = await utils.findByLabelText(
      'Add iPhone 13 Screen Assembly, SCREEN-IP13, $130.00, 5 in stock',
    );
    await act(async () => {
      fireEvent.press(result);
    });

    // Plain integer keyboard; a typed "1.3" is parsed with parseInt -> 1.
    const qtyInput = utils.getByLabelText('Quantity');
    expect(qtyInput.props.keyboardType).toBe('number-pad');
    await act(async () => {
      fireEvent.changeText(qtyInput, '1.3');
    });
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Add item to repair'));
    });

    await waitFor(() => expect(mockAddRepairItem).toHaveBeenCalledTimes(1));
    const [, payload] = mockAddRepairItem.mock.calls[0];
    expect(payload).toMatchObject({product_id: 900, quantity: 1});
  });
});
