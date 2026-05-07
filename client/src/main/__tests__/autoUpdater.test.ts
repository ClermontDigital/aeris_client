import { ipcMain, BrowserWindow, shell, app } from 'electron';
// The Jest moduleNameMapper aliases this to __mocks__/electron-updater.ts;
// the strict UpdateInfo / ProgressInfo types from the real package are
// irrelevant for the mocked emit() shape.
import * as updaterModule from 'electron-updater';
const autoUpdater = (updaterModule as unknown as {
  autoUpdater: import('events').EventEmitter & {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    checkForUpdates: jest.Mock;
    checkForUpdatesAndNotify: jest.Mock;
  };
}).autoUpdater;
const __resetMock = (updaterModule as unknown as { __resetMock: () => void })
  .__resetMock;
import {
  initAutoUpdater,
  __runManualFallbackForTests,
  __resetForTests,
  compareSemver,
  getStatus,
} from '../autoUpdater';
import { IPC_CHANNELS } from '../../shared-types/ipc';

describe('autoUpdater', () => {
  let win: BrowserWindow;

  beforeEach(() => {
    __resetMock();
    __resetForTests();
    (ipcMain as unknown as { __reset: () => void }).__reset();
    (ipcMain.handle as jest.Mock).mockClear();
    (shell.openExternal as jest.Mock).mockClear();
    (app.getVersion as jest.Mock).mockReturnValue('2.0.0');
    win = new BrowserWindow();
  });

  afterEach(() => {
    __resetForTests();
  });

  describe('compareSemver', () => {
    test('compares numeric tuples correctly', () => {
      expect(compareSemver('2.0.1', '2.0.0')).toBe(1);
      expect(compareSemver('2.0.0', '2.0.1')).toBe(-1);
      expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
      expect(compareSemver('3.0.0', '2.99.99')).toBe(1);
      expect(compareSemver('2.10.0', '2.9.99')).toBe(1);
    });

    test('strips client-v / v / pre-release suffixes', () => {
      expect(compareSemver('client-v2.0.1', '2.0.0')).toBe(1);
      expect(compareSemver('v2.0.1', 'v2.0.0')).toBe(1);
      expect(compareSemver('2.0.1-beta', '2.0.0')).toBe(1);
    });
  });

  describe('primary updater wiring', () => {
    test('subscribes to electron-updater events and forwards to renderer', () => {
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000 });
      autoUpdater.emit('checking-for-update');
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ kind: 'checking' }),
      );
      autoUpdater.emit('update-available', { version: '2.0.1' });
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ kind: 'available', version: '2.0.1' }),
      );
      autoUpdater.emit('download-progress', { percent: 42 });
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ kind: 'downloading', progress: 42 }),
      );
      autoUpdater.emit('update-downloaded', { version: '2.0.1' });
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ kind: 'downloaded', version: '2.0.1' }),
      );
    });

    test('error event broadcasts kind=error', () => {
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000 });
      autoUpdater.emit('error', new Error('boom'));
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_STATUS_CHANGED,
        expect.objectContaining({ kind: 'error', message: 'boom' }),
      );
    });

    test('configures autoDownload + autoInstallOnAppQuit', () => {
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000 });
      expect(autoUpdater.autoDownload).toBe(true);
      expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
      expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalled();
    });
  });

  describe('IPC channels', () => {
    test('update:check-now invokes autoUpdater.checkForUpdates', async () => {
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000 });
      const res = (await (ipcMain as unknown as {
        __invoke: (ch: string) => Promise<unknown>;
      }).__invoke(IPC_CHANNELS.UPDATE_CHECK_NOW)) as { ok: boolean };
      expect(res).toEqual({ ok: true });
      expect(autoUpdater.checkForUpdates).toHaveBeenCalled();
    });

    test('update:check-now returns ok:false on error', async () => {
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000 });
      autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
      const res = (await (ipcMain as unknown as {
        __invoke: (ch: string) => Promise<unknown>;
      }).__invoke(IPC_CHANNELS.UPDATE_CHECK_NOW)) as {
        ok: boolean;
        message?: string;
      };
      expect(res.ok).toBe(false);
      expect(res.message).toBe('offline');
    });

    test('update:open-download routes through shell.openExternal', async () => {
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000 });
      const res = (await (ipcMain as unknown as {
        __invoke: (ch: string, ...a: unknown[]) => Promise<unknown>;
      }).__invoke(
        IPC_CHANNELS.UPDATE_OPEN_DOWNLOAD,
        'https://github.com/x/y/releases/tag/client-v2.0.1',
      )) as { ok: boolean };
      expect(res.ok).toBe(true);
      expect(shell.openExternal).toHaveBeenCalledWith(
        'https://github.com/x/y/releases/tag/client-v2.0.1',
      );
    });

    test('update:open-download rejects non-http(s) URLs', async () => {
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000 });
      const res = (await (ipcMain as unknown as {
        __invoke: (ch: string, ...a: unknown[]) => Promise<unknown>;
      }).__invoke(
        IPC_CHANNELS.UPDATE_OPEN_DOWNLOAD,
        'file:///etc/passwd',
      )) as { ok: boolean };
      expect(res.ok).toBe(false);
      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('manual-fallback poller', () => {
    function makeFetch(body: { tag_name?: string; html_url?: string } | null): jest.Mock {
      return jest.fn().mockResolvedValue({
        ok: body != null,
        json: async () => body,
        status: body == null ? 500 : 200,
      });
    }

    test('fires manual-fallback IPC when newer release exists and primary is silent', async () => {
      const f = makeFetch({
        tag_name: 'client-v2.0.1',
        html_url: 'https://github.com/ClermontDigital/aeris_client/releases/tag/client-v2.0.1',
      });
      initAutoUpdater(win, { skipPrimary: true, fallbackDelayMs: 1_000_000, fetchImpl: f });
      await __runManualFallbackForTests(f);
      expect(f).toHaveBeenCalled();
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_MANUAL_FALLBACK,
        expect.objectContaining({
          kind: 'manual-fallback',
          version: '2.0.1',
          htmlUrl:
            'https://github.com/ClermontDigital/aeris_client/releases/tag/client-v2.0.1',
        }),
      );
      expect(getStatus().kind).toBe('manual-fallback');
    });

    test('does NOT fire when electron-updater already saw an update', async () => {
      const f = makeFetch({
        tag_name: 'client-v2.0.1',
        html_url: 'https://example/release',
      });
      initAutoUpdater(win, { fallbackDelayMs: 1_000_000, fetchImpl: f });
      autoUpdater.emit('update-available', { version: '2.0.1' });
      (win.webContents.send as jest.Mock).mockClear();
      await __runManualFallbackForTests(f);
      // The fallback path bails out before fetching when primarySawUpdate
      // is true. Confirm no manual-fallback IPC and no fetch.
      expect(f).not.toHaveBeenCalled();
      expect(win.webContents.send).not.toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_MANUAL_FALLBACK,
        expect.anything(),
      );
    });

    test('does NOT fire when GitHub has the same or older version', async () => {
      const f = makeFetch({
        tag_name: 'client-v2.0.0',
        html_url: 'https://example/release',
      });
      initAutoUpdater(win, { skipPrimary: true, fallbackDelayMs: 1_000_000, fetchImpl: f });
      await __runManualFallbackForTests(f);
      expect(win.webContents.send).not.toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_MANUAL_FALLBACK,
        expect.anything(),
      );
    });

    test('does NOT fire when fetch fails', async () => {
      const f = jest.fn().mockRejectedValue(new Error('offline'));
      initAutoUpdater(win, { skipPrimary: true, fallbackDelayMs: 1_000_000, fetchImpl: f });
      await __runManualFallbackForTests(f as unknown as typeof fetch);
      expect(win.webContents.send).not.toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_MANUAL_FALLBACK,
        expect.anything(),
      );
    });

    test('does NOT fire when tag_name does not match expected prefix', async () => {
      const f = makeFetch({
        tag_name: 'mobile-v3.0.0',
        html_url: 'https://example/release',
      });
      initAutoUpdater(win, { skipPrimary: true, fallbackDelayMs: 1_000_000, fetchImpl: f });
      await __runManualFallbackForTests(f);
      expect(win.webContents.send).not.toHaveBeenCalledWith(
        IPC_CHANNELS.UPDATE_MANUAL_FALLBACK,
        expect.anything(),
      );
    });

    test('fires after the configured delay when primary is silent', async () => {
      jest.useFakeTimers();
      try {
        const f = makeFetch({
          tag_name: 'client-v2.0.1',
          html_url: 'https://example/release',
        });
        initAutoUpdater(win, { skipPrimary: true, fallbackDelayMs: 50, fetchImpl: f });
        jest.advanceTimersByTime(50);
        // Drain the microtask queue to let the awaited fetch resolve.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(f).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
