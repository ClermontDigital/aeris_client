import { app, ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../shared-types/ipc';
import { settingsStore } from './settingsStore';
import { registerRelayBridgeIpc } from './relayBridge';
import { registerAuthIpc, registerAuthWindow } from './authManager';
import {
  registerAppLockIpc,
  registerAppLockWindow,
  initialize as initAppLock,
} from './appLockManager';
import { getRecentLogs } from './logger';

// One-stop IPC registration. Called once after the main window is created.
// All channel registration is keyed off IPC_CHANNELS so the renderer's
// preload bridge has a single source of truth for channel names.

export function registerIpc(mainWindow: BrowserWindow): void {
  // App version (used in Settings → About).
  ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion());

  // Settings.
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => settingsStore.get());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_e, patch) => settingsStore.set(patch));
  settingsStore.onChange((next) => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, next);
  });

  // Diagnostics: bundle recent log lines for Send Diagnostics flow.
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_GET_RECENT_LOGS, async (_e, maxLines?: number) => {
    return getRecentLogs(typeof maxLines === 'number' ? maxLines : 100);
  });

  // Relay bridge + auth.
  registerRelayBridgeIpc();
  registerAuthIpc();
  registerAuthWindow(mainWindow);

  // App lock.
  registerAppLockIpc();
  registerAppLockWindow(mainWindow);
  initAppLock();
}
