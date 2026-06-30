// IPC Handlers Module - extracted from main.js for testability
const { dialog, shell, app } = require('electron');
const path = require('path');

class IPCHandlers {
  constructor(store, sessionManager, defaultConfig, getMainWindow, getAppIcon) {
    this.store = store;
    this.sessionManager = sessionManager;
    this.defaultConfig = defaultConfig;
    this.getMainWindow = getMainWindow;
    this.getAppIcon = getAppIcon;
  }

  // Settings Handlers
  async getSettings() {
    const settings = {
      baseUrl: this.store.get('baseUrl', this.defaultConfig.baseUrl),
      localUrl: this.store.get('localUrl', this.defaultConfig.localUrl),
      routingMode: this.store.get('routingMode', this.defaultConfig.routingMode),
      drAutoFailover: this.store.get('drAutoFailover', this.defaultConfig.drAutoFailover),
      autoStart: this.store.get('autoStart', this.defaultConfig.autoStart),
      enableSessionManagement: this.store.get('enableSessionManagement', this.defaultConfig.enableSessionManagement),
      sessionTimeout: this.store.get('sessionTimeout', this.defaultConfig.sessionTimeout)
    };

    return settings;
  }

  // DR routing: resolve which URL the webview should load.
  getActiveTargetUrl() {
    const mode = this.store.get('routingMode', this.defaultConfig.routingMode);
    if (mode === 'local') {
      return this.store.get('localUrl', this.defaultConfig.localUrl);
    }
    return this.store.get('baseUrl', this.defaultConfig.baseUrl);
  }

  async saveSettings(event, settings) {
    // Validate baseUrl scheme before saving (lax http/https — cloud target).
    if (settings.baseUrl) {
      try {
        const parsed = new URL(settings.baseUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { success: false, error: 'Only http/https URLs are allowed' };
        }
      } catch {
        return { success: false, error: 'Invalid URL format' };
      }
    }

    // DR: the NAS/LAN target gets the STRICT validator (no fall-through to the
    // lax http/https check). A poisoned localUrl is a credential-harvest vector.
    if (settings.localUrl) {
      const { isLocalUrlSafeForCache } = require('./dr-url-validator');
      if (!isLocalUrlSafeForCache(settings.localUrl)) {
        return {
          success: false,
          error: 'In-store URL must be an https:// LAN address (private IP or a single-label .local name)'
        };
      }
    }

    const oldSettings = {
      baseUrl: this.store.get('baseUrl', this.defaultConfig.baseUrl),
      enableSessionManagement: this.store.get('enableSessionManagement', this.defaultConfig.enableSessionManagement)
    };

    this.store.set('baseUrl', settings.baseUrl);
    this.store.set('localUrl', settings.localUrl || '');
    // DR M3: persist the auto-failover flag (default OFF). Strict boolean coerce
    // so a missing/garbage value can never accidentally enable it.
    this.store.set('drAutoFailover', settings.drAutoFailover === true);
    this.store.set('autoStart', settings.autoStart);
    this.store.set('enableSessionManagement', settings.enableSessionManagement);
    this.store.set('sessionTimeout', settings.sessionTimeout);

    // Handle auto-start
    app.setLoginItemSettings({
      openAtLogin: settings.autoStart
    });

    // Update session timeout in session manager
    if (settings.enableSessionManagement) {
      this.sessionManager.setSessionTimeout(settings.sessionTimeout);
    }

    // Check if critical settings changed that require restart
    const needsRestart = (
      oldSettings.baseUrl !== settings.baseUrl ||
      oldSettings.enableSessionManagement !== settings.enableSessionManagement
    );

    // Notify main window of settings change immediately
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings-updated', {
        ...settings,
        needsRestart
      });
    }

    return { success: true, needsRestart };
  }

  async restartApp() {
    app.relaunch();
    app.exit();
  }

  async testConnection(event, url) {
    // Validate URL scheme
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only http/https URLs are allowed' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    const { BrowserWindow } = require('electron');
    let testWindow;
    try {
      testWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });

      await testWindow.loadURL(url);
      testWindow.close();
      return { success: true };
    } catch (error) {
      if (testWindow && !testWindow.isDestroyed()) {
        testWindow.close();
      }
      return { success: false, error: error.message };
    }
  }

  // Print Handlers
  async printPage(event, options = {}) {
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      mainWindow.webContents.send('print-request', options);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async printToPDF(event, options = {}) {
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      const pdfOptions = {
        marginsType: options.marginsType || 0,
        pageSize: options.pageSize || 'A4',
        printBackground: options.printBackground !== false,
        printSelectionOnly: options.printSelectionOnly || false,
        landscape: options.landscape || false
      };

      const data = await mainWindow.webContents.printToPDF(pdfOptions);
      return { success: true, data: data.toString('base64') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getPrinters() {
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      const printers = await mainWindow.webContents.getPrintersAsync();
      return { success: true, printers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async printSilent(event, options = {}) {
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      mainWindow.webContents.send('print-silent-request', options);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Navigation Handlers
  async openSettings() {
    // This will be implemented by main.js
    return { success: true };
  }

  async navigate(event, direction) {
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      switch (direction) {
        case 'back':
          if (mainWindow.webContents.canGoBack()) {
            mainWindow.webContents.goBack();
          }
          break;
        case 'forward':
          if (mainWindow.webContents.canGoForward()) {
            mainWindow.webContents.goForward();
          }
          break;
        case 'refresh':
          mainWindow.webContents.reload();
          break;
        case 'home':
          // This will trigger loadApplication in main.js
          break;
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async navigateToUrl(event, url) {
    // Validate URL scheme
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only http/https URLs are allowed' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      mainWindow.webContents.send('navigate-to-url', { url });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Dialog Handlers
  async showConfirmDialog(event, options) {
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Cancel', 'OK'],
        defaultId: 1,
        cancelId: 0,
        title: options.title || 'Aeris - Confirm',
        message: options.message || 'Are you sure?',
        detail: options.detail || '',
        noLink: true,
        icon: this.getAppIcon()
      });

      // Restore focus to web contents after dialog
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.focus();
          mainWindow.webContents.send('dialog-closed', { confirmed: result.response === 1 });
        }
      }, 50);

      return { confirmed: result.response === 1 };
    } catch (error) {
      return { confirmed: false, error: error.message };
    }
  }

  async showAlertDialog(event, options) {
    try {
      const mainWindow = this.getMainWindow();
      if (!mainWindow) {
        throw new Error('Main window not available');
      }

      await dialog.showMessageBox(mainWindow, {
        type: options.type || 'info',
        buttons: ['OK'],
        title: options.title || 'Aeris - Alert',
        message: options.message || '',
        detail: options.detail || '',
        noLink: true,
        icon: this.getAppIcon()
      });

      // Restore focus
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.focus();
          mainWindow.webContents.send('dialog-closed', { confirmed: true });
        }
      }, 50);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Update Handlers
  async checkForUpdates() {
    try {
      return {
        success: true,
        updateAvailable: false,
        version: app.getVersion(),
        releaseUrl: null,
        downloadUrl: null
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async openReleasePage(event, url) {
    try {
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL provided');
      }

      if (!url.startsWith('https://') && !url.startsWith('http://')) {
        throw new Error('Only http/https URLs are allowed');
      }

      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Session Management Handlers
  async getSessions() {
    return this.sessionManager.getAllSessions();
  }

  async createSession(event, name, pin) {
    try {
      const sessionId = this.sessionManager.createSession(name, pin);
      return { success: true, sessionId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async deleteSession(event, sessionId) {
    try {
      this.sessionManager.deleteSession(sessionId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async switchToSession(event, sessionId, pin) {
    try {
      const session = this.sessionManager.switchToSession(sessionId, pin);
      return { success: true, session };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getActiveSession() {
    return this.sessionManager.getActiveSession();
  }

  async updateSessionUrl(event, sessionId, url) {
    // Validate URL scheme
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { success: false, error: 'Only http/https URLs are allowed' };
        }
      } catch {
        return { success: false, error: 'Invalid URL format' };
      }
    }

    try {
      this.sessionManager.updateSessionUrl(sessionId, url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async lockSession(event, sessionId) {
    try {
      const session = this.sessionManager.lockSession(sessionId);
      return { success: true, session };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async showSessionSwitcher() {
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('show-session-overlay');
    }
    return { success: true };
  }

  async closeSessionSwitcher() {
    const mainWindow = this.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hide-session-overlay');
    }
    return { success: true };
  }

  async createNewSession() {
    return { success: true };
  }

  async updateSessionActivity() {
    const activeSession = this.sessionManager.getActiveSession();
    if (activeSession) {
      this.sessionManager.updateSessionActivity(activeSession.id);
    }
    return { success: true };
  }

  // DR routing-mode switch (cloud ↔ in-store/NAS). Reload-in-place, NOT a
  // restart — does not use the needsRestart path.
  //
  // PER-ENDPOINT PARTITIONS (M3 owner decision — replaces clear-all-on-switch):
  // cloud and NAS keep SEPARATE persistent partitions, so we DO NOT clear
  // storage on a switch. The target endpoint's own partition loads — a warm
  // session keeps the cashier selling through an outage; an empty one shows that
  // endpoint's login. Cloud and NAS partitions are isolated (neither leaks into
  // the other). Explicit logout (logoutEndpoint) is what clears a partition.
  //
  // `trigger` ('manual' default | 'auto') is passed through to the renderer in
  // the routing-mode-changed payload so the UI can show auto-specific copy. The
  // M3 auto-swap orchestrator (main.js) reuses THIS method — no forked switch.
  async setRoutingMode(event, mode, trigger = 'manual') {
    try {
      if (mode !== 'cloud' && mode !== 'local') {
        return { success: false, error: 'Invalid routing mode' };
      }

      // Fail closed: refuse in-store mode unless a valid LAN target is stored.
      if (mode === 'local') {
        const localUrl = this.store.get('localUrl', this.defaultConfig.localUrl);
        const { isLocalUrlSafeForCache } = require('./dr-url-validator');
        if (!localUrl || !isLocalUrlSafeForCache(localUrl)) {
          return { success: false, error: 'No valid in-store (NAS) URL configured' };
        }
      }

      this.store.set('routingMode', mode);

      const targetUrl = this.getActiveTargetUrl();

      const mainWindow = this.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('routing-mode-changed', { mode, targetUrl, trigger });
      }

      return { success: true, mode, targetUrl, trigger };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // DR M3: explicit per-endpoint logout. Clears ONLY the partitions belonging to
  // `mode` (across all cashiers), so logging out of NAS does not wipe the cloud
  // session and vice-versa — preserving the per-endpoint isolation the new
  // partition model relies on. This is the deliberate replacement for the old
  // blanket clear-on-switch re-auth guarantee.
  async logoutEndpoint(event, mode) {
    try {
      if (mode !== 'cloud' && mode !== 'local') {
        return { success: false, error: 'Invalid routing mode' };
      }
      const { partitionsForEndpoint } = require('./dr-partition');
      const { session } = require('electron');
      let sessionIds = [];
      if (this.store.get('enableSessionManagement', this.defaultConfig.enableSessionManagement)) {
        sessionIds = this.sessionManager.getAllSessions().map((s) => s.id);
      }
      const partitions = partitionsForEndpoint(mode, sessionIds);
      // Storages MUST be members of Electron's Session.clearStorageData enum.
      // NOTE the Electron quirk: it is 'indexdb' (no second 'e'). Unknown keys
      // are SILENTLY IGNORED by Chromium. 'sessionstorage' is not a member and
      // is dropped on the partition's page reload anyway.
      const storages = ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'];
      await Promise.all(
        partitions.map((p) => session.fromPartition(p).clearStorageData({ storages }))
      );
      return { success: true, mode, cleared: partitions };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Register all handlers
  registerHandlers(ipcMain) {
    // Settings
    ipcMain.handle('get-settings', this.getSettings.bind(this));
    ipcMain.handle('save-settings', this.saveSettings.bind(this));
    ipcMain.handle('restart-app', this.restartApp.bind(this));
    ipcMain.handle('test-connection', this.testConnection.bind(this));

    // Print
    ipcMain.handle('print-page', this.printPage.bind(this));
    ipcMain.handle('print-to-pdf', this.printToPDF.bind(this));
    ipcMain.handle('get-printers', this.getPrinters.bind(this));
    ipcMain.handle('print-silent', this.printSilent.bind(this));

    // Navigation
    ipcMain.handle('open-settings', this.openSettings.bind(this));
    ipcMain.handle('navigate', this.navigate.bind(this));
    ipcMain.handle('navigate-to-url', this.navigateToUrl.bind(this));

    // Dialogs
    ipcMain.handle('show-confirm-dialog', this.showConfirmDialog.bind(this));
    ipcMain.handle('show-alert-dialog', this.showAlertDialog.bind(this));

    // Updates
    ipcMain.handle('check-for-updates', this.checkForUpdates.bind(this));
    ipcMain.handle('open-release-page', this.openReleasePage.bind(this));

    // Sessions
    ipcMain.handle('get-sessions', this.getSessions.bind(this));
    ipcMain.handle('create-session', this.createSession.bind(this));
    ipcMain.handle('delete-session', this.deleteSession.bind(this));
    ipcMain.handle('switch-to-session', this.switchToSession.bind(this));
    ipcMain.handle('get-active-session', this.getActiveSession.bind(this));
    ipcMain.handle('update-session-url', this.updateSessionUrl.bind(this));
    ipcMain.handle('lock-session', this.lockSession.bind(this));
    ipcMain.handle('show-session-switcher', this.showSessionSwitcher.bind(this));
    ipcMain.handle('close-session-switcher', this.closeSessionSwitcher.bind(this));
    ipcMain.handle('create-new-session', this.createNewSession.bind(this));
    ipcMain.handle('update-session-activity', this.updateSessionActivity.bind(this));

    // DR routing
    ipcMain.handle('set-routing-mode', this.setRoutingMode.bind(this));
    ipcMain.handle('logout-endpoint', this.logoutEndpoint.bind(this));
  }
}

module.exports = IPCHandlers;
