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
      autoStart: this.store.get('autoStart', this.defaultConfig.autoStart),
      enableSessionManagement: this.store.get('enableSessionManagement', this.defaultConfig.enableSessionManagement),
      sessionTimeout: this.store.get('sessionTimeout', this.defaultConfig.sessionTimeout)
    };

    return settings;
  }

  async saveSettings(event, settings) {
    const oldSettings = {
      baseUrl: this.store.get('baseUrl', this.defaultConfig.baseUrl),
      enableSessionManagement: this.store.get('enableSessionManagement', this.defaultConfig.enableSessionManagement)
    };

    this.store.set('baseUrl', settings.baseUrl);
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
    const { BrowserWindow } = require('electron');
    try {
      const testWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false
        }
      });

      await testWindow.loadURL(url);
      testWindow.close();
      return { success: true };
    } catch (error) {
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
  }
}

module.exports = IPCHandlers;
