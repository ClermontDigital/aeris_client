import { app, BrowserWindow } from 'electron';
import { createMainWindow, loadRenderer } from './window';
import { registerIpc, attachWindow as attachWindowIpc } from './ipc';
import { initRelayBridge } from './relayBridge';
import { initialize as initAuth } from './authManager';
import { attachAutoLock } from './autoLock';
import { initAutoUpdater, setRegisteredWindow } from './autoUpdater';
import { logger } from './logger';

// Single-instance lock — only one Aeris window across the app's lifetime.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  await initRelayBridge();
  // IPC channel handlers are global and registered exactly once for the
  // app's lifetime — ipcMain.handle throws on duplicate channels, which
  // bit us when macOS `activate` re-created the window.
  registerIpc();
  mainWindow = createMainWindow();
  attachWindowIpc(mainWindow);
  attachAutoLock(mainWindow);
  // Kick off auth restore (non-blocking). The renderer will read state
  // via auth:get-state and listen on auth:state-changed for updates.
  void initAuth();
  await loadRenderer(mainWindow);
  initAutoUpdater(mainWindow);
  logger.info('[main] window ready');
});

app.on('window-all-closed', () => {
  // macOS: keep the app alive until the user quits explicitly.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) {
    mainWindow = createMainWindow();
    // Re-attach window-scoped subscribers; channel handlers stay registered.
    attachWindowIpc(mainWindow);
    attachAutoLock(mainWindow);
    setRegisteredWindow(mainWindow);
    void loadRenderer(mainWindow);
  }
});

// Surface render-process crashes to the log so a blank window has a
// breadcrumb (Phase 4 will add a restart prompt UI).
app.on('render-process-gone', (_event, _wc, details) => {
  logger.error('[main] render-process-gone', details);
});
