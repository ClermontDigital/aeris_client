import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC_CHANNELS } from '../shared-types/ipc';
import type {
  CheckNowResult,
  UpdateStatus,
} from '../shared-types/ipc';
import { logger } from './logger';

// Auto-update orchestration. Two paths run in parallel:
//   1. Primary: electron-updater polls GitHub Releases (client-vX.Y.Z) on
//      launch and every 6 hours. autoDownload + autoInstallOnAppQuit are
//      on, so updates apply on next quit.
//   2. Manual fallback (peer review revision #5): if electron-updater has
//      not surfaced an `available` / `downloaded` event within 30 s of
//      launch, hit the GitHub API once. If a newer release exists, fire
//      `update:manual-fallback` so the renderer can show a Download
//      button. Guards against bugs in 2.0.0's auto-update path itself.

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FALLBACK_DELAY_MS = 30 * 1000; // 30 seconds
const FALLBACK_FETCH_TIMEOUT_MS = 10 * 1000; // 10 seconds
const RELEASES_URL =
  'https://api.github.com/repos/ClermontDigital/aeris_client/releases/latest';
const TAG_PREFIX = 'client-v';

interface UpdaterDeps {
  fetchImpl?: typeof fetch;
  // Override for tests: skip the real autoUpdater wiring entirely so we
  // can drive the manual-fallback path without electron-updater firing.
  skipPrimary?: boolean;
  // Override for tests: shorter delay so the fallback fires inside test
  // timing budgets.
  fallbackDelayMs?: number;
  pollIntervalMs?: number;
}

let lastStatus: UpdateStatus = { kind: 'idle' };
let primarySawUpdate = false;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let registeredWindow: BrowserWindow | null = null;
let ipcRegistered = false;

// 10-line semver comparator. We accept tags shaped `client-vX.Y.Z` (and
// the bare `vX.Y.Z` variant for forgiveness). Returns 1 if `a > b`,
// -1 if `a < b`, 0 if equal. Pre-release suffixes are ignored — Aeris
// does not ship pre-releases through this channel.
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): [number, number, number] => {
    const cleaned = s.replace(/^client-v/, '').replace(/^v/, '').split('-')[0] ?? '';
    const parts = cleaned.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}

// Reset to a known state — only used by tests between scenarios.
export function __resetForTests(): void {
  lastStatus = { kind: 'idle' };
  primarySawUpdate = false;
  if (fallbackTimer) clearTimeout(fallbackTimer);
  if (pollInterval) clearInterval(pollInterval);
  fallbackTimer = null;
  pollInterval = null;
  registeredWindow = null;
  ipcRegistered = false;
}

export function getStatus(): UpdateStatus {
  return lastStatus;
}

function broadcastStatus(next: UpdateStatus): void {
  lastStatus = next;
  if (registeredWindow && !registeredWindow.isDestroyed()) {
    registeredWindow.webContents.send(IPC_CHANNELS.UPDATE_STATUS_CHANGED, next);
  }
}

function markPrimarySawUpdate(): void {
  primarySawUpdate = true;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

function wirePrimaryUpdater(): void {
  autoUpdater.logger = logger as unknown as typeof autoUpdater.logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    broadcastStatus({ kind: 'checking' });
  });
  autoUpdater.on('update-available', (info: { version?: string }) => {
    markPrimarySawUpdate();
    broadcastStatus({ kind: 'available', version: info?.version });
  });
  autoUpdater.on('update-not-available', () => {
    broadcastStatus({ kind: 'not-available' });
  });
  autoUpdater.on('download-progress', (p: { percent?: number }) => {
    broadcastStatus({ kind: 'downloading', progress: p?.percent });
  });
  autoUpdater.on('update-downloaded', (info: { version?: string }) => {
    markPrimarySawUpdate();
    broadcastStatus({ kind: 'downloaded', version: info?.version });
  });
  autoUpdater.on('error', (err: Error) => {
    logger.warn('[autoUpdater] error', err?.message ?? err);
    broadcastStatus({ kind: 'error', message: err?.message ?? String(err) });
  });
}

async function fetchLatestRelease(
  fetchImpl: typeof fetch,
): Promise<{ tag_name?: string; html_url?: string } | null> {
  // The GitHub API rate-limits unauthenticated requests; one call per
  // launch is well inside the budget. AbortController so a hung request
  // doesn't trap the timer.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FALLBACK_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn('[autoUpdater] fallback fetch non-ok', res.status);
      return null;
    }
    return (await res.json()) as { tag_name?: string; html_url?: string };
  } catch (err) {
    logger.warn('[autoUpdater] fallback fetch failed', (err as Error)?.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function runManualFallback(fetchImpl: typeof fetch): Promise<void> {
  if (primarySawUpdate) return;
  const release = await fetchLatestRelease(fetchImpl);
  if (!release || !release.tag_name) return;
  if (!release.tag_name.startsWith(TAG_PREFIX) && !release.tag_name.startsWith('v')) {
    return;
  }
  const current = app.getVersion();
  if (compareSemver(release.tag_name, current) <= 0) return;
  const version = release.tag_name.replace(/^client-v/, '').replace(/^v/, '');
  const status: UpdateStatus = {
    kind: 'manual-fallback',
    version,
    htmlUrl: release.html_url,
  };
  broadcastStatus(status);
  if (registeredWindow && !registeredWindow.isDestroyed()) {
    registeredWindow.webContents.send(IPC_CHANNELS.UPDATE_MANUAL_FALLBACK, status);
  }
}

function registerIpc(): void {
  if (ipcRegistered) return;
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK_NOW, async (): Promise<CheckNowResult> => {
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      const message = (err as Error)?.message ?? 'check-for-updates failed';
      return { ok: false, message };
    }
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_OPEN_DOWNLOAD, async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return { ok: false, message: 'invalid url' };
    }
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL_NOW, async () => {
    try {
      autoUpdater.quitAndInstall();
      return { ok: true };
    } catch (err) {
      const message = (err as Error)?.message ?? 'install-now failed';
      return { ok: false, message };
    }
  });
  ipcRegistered = true;
}

export function initAutoUpdater(
  mainWindow: BrowserWindow,
  deps: UpdaterDeps = {},
): void {
  registeredWindow = mainWindow;
  registerIpc();

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const fallbackDelay = deps.fallbackDelayMs ?? FALLBACK_DELAY_MS;
  const pollMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;

  if (!deps.skipPrimary) {
    try {
      wirePrimaryUpdater();
      void autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        logger.warn('[autoUpdater] initial check failed', (err as Error)?.message);
      });
      pollInterval = setInterval(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          logger.warn('[autoUpdater] periodic check failed', (err as Error)?.message);
        });
      }, pollMs);
    } catch (err) {
      logger.warn('[autoUpdater] wirePrimaryUpdater threw', (err as Error)?.message);
    }
  }

  if (typeof fetchImpl === 'function') {
    fallbackTimer = setTimeout(() => {
      void runManualFallback(fetchImpl);
    }, fallbackDelay);
  }
}

// Test seam — invoke the fallback path directly without waiting for the timer.
export async function __runManualFallbackForTests(
  fetchImpl: typeof fetch,
): Promise<void> {
  await runManualFallback(fetchImpl);
}
