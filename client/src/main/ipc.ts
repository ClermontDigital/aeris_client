import { app, ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, AppSettings } from '../shared-types/ipc';
import { settingsStore } from './settingsStore';
import { registerRelayBridgeIpc } from './relayBridge';
import { registerAuthIpc, registerAuthWindow } from './authManager';
import {
  registerAppLockIpc,
  registerAppLockWindow,
  initialize as initAppLock,
} from './appLockManager';
import { getRecentLogs } from './logger';
import { safeHandle } from './senderGuard';
import { printReceipt, printTestReceipt, printZReport } from './printService';
import {
  failoverOrchestrator,
  registerDrWindow,
  getDrState,
} from './failoverOrchestrator';
import { DrActivityReport } from '../shared-types/ipc';

// Channel-handler registration is global per process: ipcMain.handle
// throws on duplicate channel names, so we install handlers exactly once
// from app.whenReady() and re-attach window-scoped subscribers via
// attachWindow() on every (re)created BrowserWindow.

let ipcRegistered = false;
let settingsUnsubscribe: (() => void) | null = null;

export function registerIpc(): void {
  if (ipcRegistered) return;

  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion());

  safeHandle(IPC_CHANNELS.SETTINGS_GET, () => settingsStore.get());
  safeHandle(IPC_CHANNELS.SETTINGS_SET, (_e, patch) =>
    settingsStore.set(patch as Partial<AppSettings>),
  );

  safeHandle(IPC_CHANNELS.DIAGNOSTICS_GET_RECENT_LOGS, (_e, maxLines) =>
    getRecentLogs(typeof maxLines === 'number' ? maxLines : 100),
  );

  safeHandle(IPC_CHANNELS.PRINT_RECEIPT, async (_e, saleId) => {
    if (
      typeof saleId !== 'number' ||
      !Number.isInteger(saleId) ||
      saleId <= 0
    ) {
      return { ok: false, message: 'saleId must be a positive integer' };
    }
    return printReceipt(saleId);
  });
  safeHandle(IPC_CHANNELS.PRINT_TEST, () => printTestReceipt());
  safeHandle(IPC_CHANNELS.PRINT_ZREPORT, async (_e, date) => {
    // Regex catches shape; round-trip through Date.UTC catches roll-overs
    // like 2026-02-30 → Mar 2 that Date.parse alone would silently accept.
    if (date !== undefined) {
      if (typeof date !== 'string') {
        return { ok: false, message: 'invalid date' };
      }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!m) return { ok: false, message: 'invalid date' };
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (
        Number.isNaN(dt.getTime()) ||
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== mo - 1 ||
        dt.getUTCDate() !== d
      ) {
        return { ok: false, message: 'invalid date' };
      }
    }
    return printZReport(date as string | undefined);
  });

  // DR M3-E: read-only DR state for the renderer chip/banner + the renderer's
  // mid-transaction activity report. Orchestration itself is main-owned.
  safeHandle(IPC_CHANNELS.DR_GET_STATE, () => getDrState());
  safeHandle(IPC_CHANNELS.DR_REPORT_ACTIVITY, (_e, report) => {
    const r = (report ?? {}) as Partial<DrActivityReport>;
    failoverOrchestrator.reportActivity({
      cartItemCount: typeof r.cartItemCount === 'number' ? r.cartItemCount : 0,
      activeScreen: typeof r.activeScreen === 'string' ? r.activeScreen : null,
    });
    return { ok: true };
  });

  registerRelayBridgeIpc();
  registerAuthIpc();
  registerAppLockIpc();
  initAppLock();

  ipcRegistered = true;
}

// Wire window-scoped subscribers (settings broadcast, auth + lock
// state-changed) to the supplied window. Safe to call again on a fresh
// window after the previous one was closed.
export function attachWindow(mainWindow: BrowserWindow): void {
  if (settingsUnsubscribe) {
    settingsUnsubscribe();
    settingsUnsubscribe = null;
  }
  settingsUnsubscribe = settingsStore.onChange((next) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, next);
  });
  mainWindow.on('closed', () => {
    if (settingsUnsubscribe) {
      settingsUnsubscribe();
      settingsUnsubscribe = null;
    }
  });

  registerAuthWindow(mainWindow);
  registerAppLockWindow(mainWindow);
  registerDrWindow(mainWindow);
}

// Test-only: reset the one-shot guard between scenarios so re-importing
// the module doesn't carry over state from a prior test run.
export function _resetForTests(): void {
  ipcRegistered = false;
  if (settingsUnsubscribe) {
    settingsUnsubscribe();
    settingsUnsubscribe = null;
  }
}
