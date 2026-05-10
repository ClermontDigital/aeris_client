import { ipcMain } from 'electron';
import { RelayError } from '@aeris/shared';
import {
  initRelayBridge,
  registerRelayBridgeIpc,
  getRelayClient,
} from '../relayBridge';
import { settingsStore } from '../settingsStore';
import { tokenStore } from '../tokenStore';
import {
  IPC_CHANNELS,
  PAYLOAD_SIZE_BUDGET_BYTES,
} from '../../shared-types/ipc';
import StoreMock from 'electron-store';

describe('relayBridge', () => {
  beforeEach(async () => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
    tokenStore._resetCache();
    (ipcMain as unknown as { __reset: () => void }).__reset();
    (ipcMain.handle as jest.Mock).mockClear();
    await initRelayBridge();
    registerRelayBridgeIpc();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function invoke(...args: unknown[]) {
    return (ipcMain as unknown as {
      __invoke: (ch: string, ...a: unknown[]) => Promise<unknown>;
    }).__invoke(IPC_CHANNELS.RELAY_CALL, ...args);
  }

  test('rejects non-string action with BAD_REQUEST', async () => {
    const result = (await invoke(123, {})) as { ok: boolean; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('BAD_REQUEST');
  });

  test('rejects payload exceeding budget with PAYLOAD_TOO_LARGE', async () => {
    // Build a string that JSON-stringifies to > 200 KB.
    const big = 'x'.repeat(PAYLOAD_SIZE_BUDGET_BYTES + 100);
    const result = (await invoke('dashboard.summary', { big })) as {
      ok: boolean;
      code: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('classifies RelayError TIMEOUT correctly', async () => {
    const c = getRelayClient();
    jest
      .spyOn(c, 'getDailySummary')
      .mockRejectedValue(
        new RelayError('slow', 'TIMEOUT', 'cid-1', 'dashboard.summary'),
      );
    const result = (await invoke('dashboard.summary', {})) as {
      ok: boolean;
      code: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TIMEOUT');
  });

  test('classifies a 401-shaped error as UNAUTHORIZED', async () => {
    const c = getRelayClient();
    const err = new Error('expired') as Error & { status: number };
    err.status = 401;
    jest.spyOn(c, 'getDailySummary').mockRejectedValue(err);
    const result = (await invoke('dashboard.summary', {})) as {
      ok: boolean;
      code: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNAUTHORIZED');
  });

  test('classifies a no-status error as NETWORK', async () => {
    const c = getRelayClient();
    jest
      .spyOn(c, 'getDailySummary')
      .mockRejectedValue(new Error('ECONNREFUSED'));
    const result = (await invoke('dashboard.summary', {})) as {
      ok: boolean;
      code: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NETWORK');
  });

  test('happy path returns ok: true with data', async () => {
    const c = getRelayClient();
    jest
      .spyOn(c, 'getDailySummary')
      .mockResolvedValue({ ping: 'pong' } as never);
    const result = (await invoke('dashboard.summary', {})) as {
      ok: boolean;
      data: unknown;
    };
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ ping: 'pong' });
  });

  // #M6 — typed-method dispatch coverage.
  test('relay:call routes dashboard.summary through getDailySummary (typed shape)', async () => {
    const c = getRelayClient();
    const summary = {
      total_revenue_cents: 12345,
      completed_sales: 3,
      pending_sales: 1,
    };
    const spy = jest
      .spyOn(c, 'getDailySummary')
      .mockResolvedValue(summary as never);
    const result = (await invoke('dashboard.summary', {
      date: '2026-05-08',
      location_id: 7,
    })) as { ok: boolean; data: unknown };
    expect(spy).toHaveBeenCalledWith('2026-05-08', 7);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(summary);
  });

  test('relay:call routes sale.create through createSale (cents-shape)', async () => {
    const c = getRelayClient();
    const created = { sale_id: 42, sale_number: 'INV-42', total_cents: 1100 };
    const spy = jest
      .spyOn(c, 'createSale')
      .mockResolvedValue(created as never);
    const centsPayload = {
      items: [{ product_id: 1, quantity: 2, unit_price_cents: 500 }],
      payments: [{ method: 'cash', amount_cents: 1100 }],
      tax_cents: 100,
      total_cents: 1100,
    };
    const result = (await invoke('sale.create', centsPayload)) as {
      ok: boolean;
      data: unknown;
    };
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject(centsPayload);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(created);
  });

  test('relay:call routes inventory.adjust-stock through adjustStock', async () => {
    const c = getRelayClient();
    const adj = { id: 1, product_id: 9, quantity_delta: -2 };
    const spy = jest.spyOn(c, 'adjustStock').mockResolvedValue(adj as never);
    const input = { product_id: 9, quantity_delta: -2, reason: 'damage' };
    const result = (await invoke('inventory.adjust-stock', input)) as {
      ok: boolean;
      data: unknown;
    };
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject(input);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(adj);
  });

  test('auth.* actions are blocked from the relay bridge (must use auth:login / auth:logout)', async () => {
    const c = getRelayClient();
    const loginSpy = jest.spyOn(c, 'login');
    const relayRpcSpy = jest.fn();
    (c as unknown as { relayRpc: jest.Mock }).relayRpc = relayRpcSpy;
    for (const action of [
      'auth.login',
      'auth.biometric',
      'auth.logout',
      'auth.refresh',
    ]) {
      const result = (await invoke(action, {})) as {
        ok: boolean;
        code: string;
        message: string;
      };
      expect(result.ok).toBe(false);
      expect(result.code).toBe('BAD_REQUEST');
      expect(result.message).toBe('unknown action');
    }
    expect(loginSpy).not.toHaveBeenCalled();
    expect(relayRpcSpy).not.toHaveBeenCalled();
  });

  test('unknown action is rejected with BAD_REQUEST before reaching relay (#H4)', async () => {
    const c = getRelayClient();
    const summarySpy = jest.spyOn(c, 'getDailySummary');
    // Ensure even a tampered relayRpc would reveal the bypass if it fired.
    const relayRpcSpy = jest.fn();
    (c as unknown as { relayRpc: jest.Mock }).relayRpc = relayRpcSpy;
    const result = (await invoke('debug.ping', {})) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('BAD_REQUEST');
    expect(result.message).toBe('unknown action');
    expect(summarySpy).not.toHaveBeenCalled();
    expect(relayRpcSpy).not.toHaveBeenCalled();
  });
});
