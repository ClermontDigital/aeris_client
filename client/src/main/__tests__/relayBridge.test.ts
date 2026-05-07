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
    const result = (await invoke('test.action', { big })) as {
      ok: boolean;
      code: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('classifies RelayError TIMEOUT correctly', async () => {
    const c = getRelayClient();
    (c as unknown as { relayRpc: jest.Mock }).relayRpc = jest
      .fn()
      .mockRejectedValue(new RelayError('slow', 'TIMEOUT', 'cid-1', 'a.b'));
    const result = (await invoke('a.b', {})) as { ok: boolean; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TIMEOUT');
  });

  test('classifies a 401-shaped error as UNAUTHORIZED', async () => {
    const c = getRelayClient();
    const err = new Error('expired') as Error & { status: number };
    err.status = 401;
    (c as unknown as { relayRpc: jest.Mock }).relayRpc = jest
      .fn()
      .mockRejectedValue(err);
    const result = (await invoke('a.b', {})) as { ok: boolean; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('UNAUTHORIZED');
  });

  test('classifies a no-status error as NETWORK', async () => {
    const c = getRelayClient();
    (c as unknown as { relayRpc: jest.Mock }).relayRpc = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED'));
    const result = (await invoke('a.b', {})) as { ok: boolean; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NETWORK');
  });

  test('happy path returns ok: true with data', async () => {
    const c = getRelayClient();
    (c as unknown as { relayRpc: jest.Mock }).relayRpc = jest
      .fn()
      .mockResolvedValue({ ping: 'pong' });
    const result = (await invoke('debug.ping', {})) as {
      ok: boolean;
      data: unknown;
    };
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ ping: 'pong' });
  });
});
