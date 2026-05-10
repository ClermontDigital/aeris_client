import { ipcMain } from 'electron';
import StoreMock from 'electron-store';
import { IPC_CHANNELS } from '../../shared-types/ipc';
import { registerIpc, _resetForTests as resetIpc } from '../ipc';
import { settingsStore } from '../settingsStore';
import { tokenStore } from '../tokenStore';
import { initRelayBridge, getRelayClient } from '../relayBridge';

type IpcMainMock = typeof ipcMain & {
  __reset: () => void;
  __invoke: (channel: string, ...args: unknown[]) => unknown;
};

describe('ipc handlers', () => {
  beforeEach(async () => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
    tokenStore._resetCache();
    (ipcMain as IpcMainMock).__reset();
    (ipcMain.handle as jest.Mock).mockClear();
    resetIpc();
    await initRelayBridge();
    registerIpc();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('print:receipt validation', () => {
    test('rejects non-number saleId', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_RECEIPT,
        'not a number',
      );
      expect(result).toEqual({
        ok: false,
        message: 'saleId must be a positive integer',
      });
    });

    test('rejects zero saleId', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_RECEIPT,
        0,
      );
      expect(result).toEqual({
        ok: false,
        message: 'saleId must be a positive integer',
      });
    });

    test('rejects negative saleId', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_RECEIPT,
        -5,
      );
      expect(result).toEqual({
        ok: false,
        message: 'saleId must be a positive integer',
      });
    });

    test('rejects non-integer saleId', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_RECEIPT,
        3.7,
      );
      expect(result).toEqual({
        ok: false,
        message: 'saleId must be a positive integer',
      });
    });

    test('rejects NaN saleId', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_RECEIPT,
        Number.NaN,
      );
      expect(result).toEqual({
        ok: false,
        message: 'saleId must be a positive integer',
      });
    });
  });

  describe('print:zreport validation', () => {
    test('rejects non-string non-undefined date', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        12345,
      );
      expect(result).toEqual({ ok: false, message: 'invalid date' });
    });

    test('rejects malformed date string', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        '08/05/2026',
      );
      expect(result).toEqual({ ok: false, message: 'invalid date' });
    });

    test('rejects partial ISO date', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        '2026-05',
      );
      expect(result).toEqual({ ok: false, message: 'invalid date' });
    });

    // #M8 — regex alone accepts impossible months/days; Date.parse closes the gap.
    test('rejects impossible ISO date that regex alone would accept', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        '9999-99-99',
      );
      expect(result).toEqual({ ok: false, message: 'invalid date' });
    });

    test('rejects an impossible month', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        '2026-13-01',
      );
      expect(result).toEqual({ ok: false, message: 'invalid date' });
    });

    test('rejects roll-over date (Feb 30) that Date.parse alone accepts', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        '2026-02-30',
      );
      expect(result).toEqual({ ok: false, message: 'invalid date' });
    });

    test('rejects roll-over date (Apr 31)', async () => {
      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        '2026-04-31',
      );
      expect(result).toEqual({ ok: false, message: 'invalid date' });
    });

    test('accepts undefined date and forwards to printZReport', async () => {
      const c = getRelayClient();
      (c as unknown as { getDailyZReport: jest.Mock }).getDailyZReport = jest
        .fn()
        .mockRejectedValue(new Error('forced'));

      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        undefined,
      );
      expect(result).toEqual({ ok: false, message: 'forced' });
      expect(
        (c as unknown as { getDailyZReport: jest.Mock }).getDailyZReport,
      ).toHaveBeenCalledWith(undefined, undefined);
    });

    test('accepts ISO date string and forwards to printZReport', async () => {
      const c = getRelayClient();
      (c as unknown as { getDailyZReport: jest.Mock }).getDailyZReport = jest
        .fn()
        .mockRejectedValue(new Error('forced'));

      const result = await (ipcMain as IpcMainMock).__invoke(
        IPC_CHANNELS.PRINT_ZREPORT,
        '2026-05-08',
      );
      expect(result).toEqual({ ok: false, message: 'forced' });
      expect(
        (c as unknown as { getDailyZReport: jest.Mock }).getDailyZReport,
      ).toHaveBeenCalledWith('2026-05-08', undefined);
    });
  });
});
