import { BrowserWindow } from 'electron';
import StoreMock from 'electron-store';
import {
  printReceipt,
  printTestReceipt,
  printZReport,
  buildReceiptHtml,
  buildZReportHtml,
} from '../printService';
import { settingsStore } from '../settingsStore';
import { getRelayClient, initRelayBridge } from '../relayBridge';
import { tokenStore } from '../tokenStore';

// Type alias for the mock helpers exposed by __mocks__/electron.ts.
type BWMock = jest.Mock & {
  __instances: Array<{
    webContents: { print: jest.Mock };
    isDestroyed: () => boolean;
    destroy: () => void;
    loadURL: jest.Mock;
  }>;
  __resetInstances: () => void;
};

const SAMPLE_RECEIPT = {
  sale_number: 'INV-1',
  business_name: 'Acme Corp',
  business_address: '1 Main Street',
  items: [
    { name: 'Widget', quantity: 2, unit_price: '$5.00', line_total: '$10.00' },
  ],
  subtotal: '$10.00',
  tax: '$1.00',
  total: '$11.00',
  payments: [{ method: 'cash', amount: '$11.00' }],
  date: '2026-05-08',
  served_by: 'Alice',
};

describe('printService', () => {
  beforeEach(async () => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
    tokenStore._resetCache();
    (BrowserWindow as unknown as BWMock).__resetInstances();
    (BrowserWindow as unknown as jest.Mock).mockClear();
    await initRelayBridge();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('happy path: fetches receipt, prints, returns ok', async () => {
    const c = getRelayClient();
    (c as unknown as { getReceipt: jest.Mock }).getReceipt = jest
      .fn()
      .mockResolvedValue(SAMPLE_RECEIPT);

    const result = await printReceipt(42);

    expect(result).toEqual({ ok: true });
    const instances = (BrowserWindow as unknown as BWMock).__instances;
    expect(instances.length).toBeGreaterThan(0);
    const win = instances[instances.length - 1];
    expect(win.webContents.print).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true, printBackground: true }),
      expect.any(Function),
    );
  });

  test('uses configured printerName from settings', async () => {
    settingsStore.set({ printerName: 'EPSON-TM-T20' });
    const c = getRelayClient();
    (c as unknown as { getReceipt: jest.Mock }).getReceipt = jest
      .fn()
      .mockResolvedValue(SAMPLE_RECEIPT);

    await printReceipt(7);

    const instances = (BrowserWindow as unknown as BWMock).__instances;
    const win = instances[instances.length - 1];
    const opts = win.webContents.print.mock.calls[0][0];
    expect(opts.deviceName).toBe('EPSON-TM-T20');
  });

  test('printer-not-found: retries once with system default and returns ok', async () => {
    settingsStore.set({ printerName: 'Ghost-Printer' });
    const c = getRelayClient();
    (c as unknown as { getReceipt: jest.Mock }).getReceipt = jest
      .fn()
      .mockResolvedValue(SAMPLE_RECEIPT);

    // First instance's print fails ("printer missing"); second succeeds.
    const callCounts: jest.Mock[] = [];
    const BWMock = BrowserWindow as unknown as jest.Mock;
    const originalImpl = BWMock.getMockImplementation()!;
    BWMock.mockImplementation(() => {
      const inst = originalImpl();
      const myIndex = callCounts.length;
      const spy = jest.fn(
        (_opts: unknown, cb: (s: boolean, m?: string) => void) => {
          if (myIndex === 0) cb(false, 'Printer not found');
          else cb(true);
        },
      );
      inst.webContents.print = spy;
      callCounts.push(spy);
      return inst;
    });

    try {
      const result = await printReceipt(99);
      expect(result).toEqual({ ok: true });
      expect(callCounts).toHaveLength(2);
      // First attempt used the configured deviceName, second omitted it.
      expect(callCounts[0].mock.calls[0][0].deviceName).toBe('Ghost-Printer');
      expect(callCounts[1].mock.calls[0][0].deviceName).toBeUndefined();
    } finally {
      BWMock.mockImplementation(originalImpl);
    }
  });

  test('hard print failure (no configured printer) returns ok:false with message', async () => {
    const c = getRelayClient();
    (c as unknown as { getReceipt: jest.Mock }).getReceipt = jest
      .fn()
      .mockResolvedValue(SAMPLE_RECEIPT);

    const BWMock = BrowserWindow as unknown as jest.Mock;
    const originalImpl = BWMock.getMockImplementation()!;
    BWMock.mockImplementation(() => {
      const inst = originalImpl();
      inst.webContents.print = jest.fn(
        (_opts: unknown, cb: (s: boolean, m?: string) => void) =>
          cb(false, 'Out of paper'),
      );
      return inst;
    });

    try {
      const result = await printReceipt(1);
      // No configured printer — single attempt, fails through.
      expect(result).toEqual({ ok: false, message: 'Out of paper' });
    } finally {
      BWMock.mockImplementation(originalImpl);
    }
  });

  test('returns ok:false when getReceipt fails (does not throw past IPC)', async () => {
    const c = getRelayClient();
    (c as unknown as { getReceipt: jest.Mock }).getReceipt = jest
      .fn()
      .mockRejectedValue(new Error('NETWORK'));

    const result = await printReceipt(123);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('NETWORK');
    }
  });

  test('printTestReceipt prints without hitting the relay', async () => {
    const c = getRelayClient();
    const getSpy = jest.fn().mockResolvedValue(SAMPLE_RECEIPT);
    (c as unknown as { getReceipt: jest.Mock }).getReceipt = getSpy;

    const result = await printTestReceipt();

    expect(result).toEqual({ ok: true });
    expect(getSpy).not.toHaveBeenCalled();
  });

  test('hidden print window has navigation guards wired', async () => {
    const c = getRelayClient();
    (c as unknown as { getReceipt: jest.Mock }).getReceipt = jest
      .fn()
      .mockResolvedValue(SAMPLE_RECEIPT);

    await printReceipt(42);

    const instances = (BrowserWindow as unknown as BWMock).__instances;
    const win = instances[instances.length - 1] as unknown as {
      webContents: {
        setWindowOpenHandler: jest.Mock;
        on: jest.Mock;
      };
    };
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const wohResult = win.webContents.setWindowOpenHandler.mock.calls[0][0]();
    expect(wohResult).toEqual({ action: 'deny' });

    const willNavCall = win.webContents.on.mock.calls.find(
      (c: unknown[]) => c[0] === 'will-navigate',
    );
    expect(willNavCall).toBeDefined();
    const preventDefault = jest.fn();
    willNavCall![1]({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  test('printZReport: happy path fetches report, builds HTML, prints', async () => {
    settingsStore.set({ workspaceCode: 'AcmePOS' });
    const report = {
      date: '2026-05-08',
      user_id: null,
      total_sales: 4,
      completed_sales: 3,
      pending_sales: 1,
      total_revenue_cents: 12345,
      total_gst_cents: 1122,
      total_discount_cents: 0,
      unique_customers: 2,
      total_items_sold: 7,
      average_sale_cents: 4115,
      payment_method_breakdown: { cash: 6000, card: 6345 },
      sales_by_staff: { Alice: 2, Bob: 1 },
      hourly_breakdown: { '09': 1, '10': 2 },
      sales_by_status: { completed: 3, pending: 1 },
    };
    const c = getRelayClient();
    const getZ = jest.fn().mockResolvedValue(report);
    (c as unknown as { getDailyZReport: jest.Mock }).getDailyZReport = getZ;

    const result = await printZReport('2026-05-08');

    expect(result).toEqual({ ok: true });
    expect(getZ).toHaveBeenCalledWith('2026-05-08', undefined);
    const instances = (BrowserWindow as unknown as BWMock).__instances;
    expect(instances.length).toBeGreaterThan(0);
    const win = instances[instances.length - 1];
    expect(win.webContents.print).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true, printBackground: true }),
      expect.any(Function),
    );
  });

  test('printZReport: returns ok:false when getDailyZReport fails', async () => {
    const c = getRelayClient();
    (c as unknown as { getDailyZReport: jest.Mock }).getDailyZReport = jest
      .fn()
      .mockRejectedValue(new Error('TIMEOUT'));

    const result = await printZReport();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('TIMEOUT');
    }
  });

  test('printZReport hidden window has same security webPreferences + nav guards', async () => {
    const c = getRelayClient();
    (c as unknown as { getDailyZReport: jest.Mock }).getDailyZReport = jest
      .fn()
      .mockResolvedValue({
        date: '2026-05-08',
        user_id: null,
        total_sales: 0,
        completed_sales: 0,
        pending_sales: 0,
        total_revenue_cents: 0,
        total_gst_cents: 0,
        total_discount_cents: 0,
        unique_customers: 0,
        total_items_sold: 0,
        average_sale_cents: 0,
        payment_method_breakdown: {},
        sales_by_staff: {},
        hourly_breakdown: {},
        sales_by_status: {},
      });

    await printZReport();

    const ctorCalls = (BrowserWindow as unknown as jest.Mock).mock.calls;
    const lastArgs = ctorCalls[ctorCalls.length - 1][0];
    expect(lastArgs.webPreferences).toEqual(
      expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: false,
      }),
    );
    const win = (BrowserWindow as unknown as BWMock).__instances.slice(-1)[0] as unknown as {
      webContents: { setWindowOpenHandler: jest.Mock; on: jest.Mock };
    };
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    expect(
      win.webContents.on.mock.calls.some((c: unknown[]) => c[0] === 'will-navigate'),
    ).toBe(true);
  });

  test('buildZReportHtml escapes user-controlled fields', () => {
    const html = buildZReportHtml(
      {
        date: '2026-05-08',
        user_id: null,
        total_sales: 1,
        completed_sales: 1,
        pending_sales: 0,
        total_revenue_cents: 100,
        total_gst_cents: 10,
        total_discount_cents: 0,
        unique_customers: 1,
        total_items_sold: 1,
        average_sale_cents: 100,
        payment_method_breakdown: { '<script>alert(1)</script>': 100 },
        sales_by_staff: { '<b>Mallory</b>': 1 },
        hourly_breakdown: {},
        sales_by_status: {},
      },
      '<workspace>',
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Mallory&lt;/b&gt;');
    expect(html).toContain('&lt;workspace&gt;');
  });

  test('buildReceiptHtml escapes HTML in user-controlled fields', () => {
    const html = buildReceiptHtml({
      ...SAMPLE_RECEIPT,
      business_name: '<script>alert(1)</script>',
      items: [
        {
          name: 'Bad <b>item</b>',
          quantity: 1,
          unit_price: '$1',
          line_total: '$1',
        },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Bad &lt;b&gt;item&lt;/b&gt;');
  });

  // #M10 — buildZReportHtml branch coverage (all three optional sections).
  describe('buildZReportHtml branches', () => {
    function makeReport(over: Record<string, unknown> = {}) {
      return {
        date: '2026-05-08',
        user_id: null,
        total_sales: 1,
        completed_sales: 1,
        pending_sales: 0,
        total_revenue_cents: 100,
        total_gst_cents: 10,
        total_discount_cents: 0,
        unique_customers: 1,
        total_items_sold: 1,
        average_sale_cents: 100,
        payment_method_breakdown: {},
        sales_by_staff: {},
        hourly_breakdown: {},
        sales_by_status: {},
        ...over,
      };
    }

    test('renders all three sections when payment / staff / hourly all present', () => {
      const html = buildZReportHtml(
        makeReport({
          payment_method_breakdown: { cash: 5000, card: 5000 },
          sales_by_staff: { Alice: 2, Bob: 1 },
          hourly_breakdown: { '09': 1, '10': 2 },
        }),
        'AcmePOS',
      );
      expect(html).toContain('Payment methods');
      expect(html).toContain('Staff');
      expect(html).toContain('Hourly breakdown');
      expect(html).toContain('Alice');
      expect(html).toContain('cash');
      expect(html).toContain('09:00');
    });

    test('omits each section when its source map is empty', () => {
      const html = buildZReportHtml(makeReport(), 'AcmePOS');
      expect(html).not.toContain('Payment methods');
      expect(html).not.toContain('Staff');
      expect(html).not.toContain('Hourly breakdown');
    });

    test('renders only the payment-methods section when staff + hourly absent', () => {
      const html = buildZReportHtml(
        makeReport({ payment_method_breakdown: { cash: 100 } }),
        'AcmePOS',
      );
      expect(html).toContain('Payment methods');
      expect(html).not.toContain('Staff');
      expect(html).not.toContain('Hourly breakdown');
    });

    test('renders only the staff section when payment + hourly absent', () => {
      const html = buildZReportHtml(
        makeReport({ sales_by_staff: { Alice: 1 } }),
        'AcmePOS',
      );
      expect(html).not.toContain('Payment methods');
      expect(html).toContain('Staff');
      expect(html).toContain('Alice');
      expect(html).not.toContain('Hourly breakdown');
    });

    test('renders only the hourly section when payment + staff absent', () => {
      const html = buildZReportHtml(
        makeReport({ hourly_breakdown: { '14': 3 } }),
        'AcmePOS',
      );
      expect(html).not.toContain('Payment methods');
      expect(html).not.toContain('Staff');
      expect(html).toContain('Hourly breakdown');
      expect(html).toContain('14:00');
    });
  });
});
