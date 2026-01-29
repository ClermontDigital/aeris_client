
const { app, BrowserWindow, Menu, MenuItem, ipcMain, dialog, shell } = require('electron');

// Set the app name for dock/taskbar display - must be done before app ready
app.setName('AERIS');
console.log('Loaded electron module: Object Version:', app ? app.getVersion() : 'No app');
const path = require('path');
const Store = require('electron-store');
const SessionManager = require('./session-manager');

const store = new Store();
const sessionManager = new SessionManager();

let mainWindow;
let settingsWindow;
let sessionSwitcherWindow;

// Default configuration
const defaultConfig = {
  baseUrl: 'http://aeris.local',
  autoStart: false,
  enableSessionManagement: true,
  sessionTimeout: 30, // minutes
  windowState: {
    width: 1200,
    height: 800,
    maximized: true
  }
};

// Get platform-specific icon
function getAppIcon() {
  return path.join(__dirname, 'assets/icons/icon.png');
}

function createMainWindow() {
  const windowState = store.get('windowState', defaultConfig.windowState);
  
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    minWidth: 800,
    minHeight: 600,
    title: 'AERIS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: getAppIcon(),
    titleBarStyle: 'default',
    show: false
  });

  // Maximize if it was maximized before
  if (windowState.maximized) {
    mainWindow.maximize();
  }

  // Load the application
  loadApplication();

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Intercept JavaScript confirm dialogs automatically
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Ensure input events are properly handled
    if (input.type === 'keyDown' || input.type === 'keyUp') {
      // Allow all keyboard input to pass through
      return;
    }
  });

  // Handle window state changes
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', () => {
    store.set('windowState.maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    store.set('windowState.maximized', false);
  });

  // Handle external links with security validation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Validate URL scheme for security
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    } else {
      console.warn('Blocked external link with invalid scheme:', url);
    }
    return { action: 'deny' };
  });

  // Handle navigation with security validation
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const baseUrl = store.get('baseUrl', defaultConfig.baseUrl);

    try {
      const parsedUrl = new URL(navigationUrl);
      const parsedBaseUrl = new URL(baseUrl);

      // Allow navigation within the same domain
      if (parsedUrl.hostname !== parsedBaseUrl.hostname) {
        event.preventDefault();
        // Only open external links with valid schemes
        if (navigationUrl.startsWith('https://') || navigationUrl.startsWith('http://')) {
          shell.openExternal(navigationUrl);
        } else {
          console.warn('Blocked navigation to invalid scheme:', navigationUrl);
        }
      }
    } catch (error) {
      event.preventDefault();
      console.warn('Blocked navigation to malformed URL:', navigationUrl);
    }
  });

  // Handle window close - quit the app when main window is closed
  mainWindow.on('close', () => {
    // Clean up session manager before quitting
    sessionManager.cleanup();
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Add context menu for right-click copy/paste
  mainWindow.webContents.on('context-menu', (event, params) => {
    const contextMenu = new Menu();

    // Add edit actions based on context
    if (params.editFlags.canCut) {
      contextMenu.append(new MenuItem({
        label: 'Cut',
        accelerator: 'CmdOrCtrl+X',
        role: 'cut'
      }));
    }

    if (params.editFlags.canCopy) {
      contextMenu.append(new MenuItem({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        role: 'copy'
      }));
    }

    if (params.editFlags.canPaste) {
      contextMenu.append(new MenuItem({
        label: 'Paste',
        accelerator: 'CmdOrCtrl+V',
        role: 'paste'
      }));
    }

    if (params.editFlags.canSelectAll) {
      contextMenu.append(new MenuItem({
        label: 'Select All',
        accelerator: 'CmdOrCtrl+A',
        role: 'selectAll'
      }));
    }

    // Only show menu if there are items
    if (contextMenu.items.length > 0) {
      contextMenu.popup();
    }
  });
}

function loadApplication() {
  // Load the application wrapper (includes toolbar + ERP content)
  mainWindow.loadFile(path.join(__dirname, 'app-wrapper.html')).catch(() => {
    // If can't load the wrapper, show error page
    mainWindow.loadFile(path.join(__dirname, 'error.html'));
  });
}


function saveWindowState() {
  if (!mainWindow) return;
  
  const bounds = mainWindow.getBounds();
  store.set('windowState', {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: mainWindow.isMaximized()
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 500,
    height: 400,
    resizable: false,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: getAppIcon()
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createPrintPreviewWindow(pdfData) {
  const previewWindow = new BrowserWindow({
    width: 800,
    height: 600,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: getAppIcon(),
    title: 'Print Preview'
  });

  // Create a data URL for the PDF
  const pdfUrl = `data:application/pdf;base64,${pdfData.toString('base64')}`;
  
  // Load the PDF in the preview window
  previewWindow.loadURL(pdfUrl);

  previewWindow.on('closed', () => {
    // Clean up
  });
}

function createMenu() {
  const template = [
    {
      label: 'AERIS',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => createSettingsWindow()
        },
        { type: 'separator' },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) {
              loadApplication();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          role: 'undo'
        },
        {
          label: 'Redo',
          accelerator: process.platform === 'darwin' ? 'Cmd+Shift+Z' : 'Ctrl+Y',
          role: 'redo'
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          role: 'cut'
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          role: 'copy'
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          role: 'paste'
        },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          role: 'selectAll'
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Print',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.print();
            }
          }
        },
        {
          label: 'Print Preview',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.printToPDF({}).then(data => {
                // Open print preview in new window
                createPrintPreviewWindow(data);
              }).catch(error => {
                console.error('Failed to generate print preview:', error);
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Full Screen',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          }
        }
      ]
    }
  ];

  // Add DevTools menu item only in development
  if (process.env.NODE_ENV !== 'production') {
    template[2].submenu.push({
      label: 'Developer Tools',
      accelerator: 'F12',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.toggleDevTools();
        }
      }
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC handlers
ipcMain.handle('get-settings', () => {
  const settings = {
    baseUrl: store.get('baseUrl', defaultConfig.baseUrl),
    autoStart: store.get('autoStart', defaultConfig.autoStart),
    enableSessionManagement: store.get('enableSessionManagement', defaultConfig.enableSessionManagement),
    sessionTimeout: store.get('sessionTimeout', defaultConfig.sessionTimeout)
  };

  return settings;
});

ipcMain.handle('save-settings', (event, settings) => {
  const oldSettings = {
    baseUrl: store.get('baseUrl', defaultConfig.baseUrl),
    enableSessionManagement: store.get('enableSessionManagement', defaultConfig.enableSessionManagement)
  };
  
  store.set('baseUrl', settings.baseUrl);
  store.set('autoStart', settings.autoStart);
  store.set('enableSessionManagement', settings.enableSessionManagement);
  store.set('sessionTimeout', settings.sessionTimeout);
  
  // Handle auto-start
  app.setLoginItemSettings({
    openAtLogin: settings.autoStart
  });
  
  // Update session timeout in session manager
  if (settings.enableSessionManagement) {
    sessionManager.setSessionTimeout(settings.sessionTimeout);
  }
  
  // Check if critical settings changed that require restart
  const needsRestart = (
    oldSettings.baseUrl !== settings.baseUrl ||
    oldSettings.enableSessionManagement !== settings.enableSessionManagement
  );
  
  // Notify main window of settings change immediately
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-updated', {
      ...settings,
      needsRestart
    });
    
    // Note: Settings updates are now handled via IPC in the app-wrapper
  }
  
  return { success: true, needsRestart };
});

ipcMain.handle('restart-app', () => {
  app.relaunch();
  app.exit();
});

ipcMain.handle('test-connection', async (event, url) => {
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
});

// Print-related IPC handlers
// Note: Primary printing is handled by app-wrapper.html via webview.print()
// These handlers serve as fallbacks for cases where direct webview printing fails
ipcMain.handle('print-page', async (event, options = {}) => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    // Send print request to app wrapper to handle webview printing
    mainWindow.webContents.send('print-request', options);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('print-to-pdf', async (event, options = {}) => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    // For PDF generation, we need to use the main window's webContents as a fallback
    // since webview PDF generation requires complex message passing
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
});

// Get available printers - this needs to be handled at the main process level
ipcMain.handle('get-printers', async () => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    const printers = await mainWindow.webContents.getPrintersAsync();
    return { success: true, printers };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Silent printing - route through app wrapper for webview targeting
ipcMain.handle('print-silent', async (event, options = {}) => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    // Send silent print request to app wrapper
    mainWindow.webContents.send('print-silent-request', options);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Toolbar navigation handlers
ipcMain.handle('open-settings', async () => {
  createSettingsWindow();
  return { success: true };
});

ipcMain.handle('navigate', async (event, direction) => {
  try {
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
        loadApplication();
        break;
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('navigate-to-url', async (event, url) => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    // Send navigation request to app wrapper to handle iframe navigation
    mainWindow.webContents.send('navigate-to-url', { url });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Dialog handling to fix Bootstrap modal focus issues
ipcMain.handle('show-confirm-dialog', async (event, options) => {
  try {
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
      icon: getAppIcon()
    });

    // Restore focus to web contents after dialog
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.focus();
        // Send focus restoration message to renderer
        mainWindow.webContents.send('dialog-closed', { confirmed: result.response === 1 });
      }
    }, 50);

    return { confirmed: result.response === 1 };
  } catch (error) {
    return { confirmed: false, error: error.message };
  }
});

ipcMain.handle('show-alert-dialog', async (event, options) => {
  try {
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
      icon: getAppIcon()
    });

    // Restore focus to web contents after dialog
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
});

// Update checking functions
ipcMain.handle('check-for-updates', async () => {
  try {
    // Basic stub implementation - can be enhanced with actual update checking
    // For now, return no updates available
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
});

ipcMain.handle('open-release-page', async (event, url) => {
  try {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }

    // Validate URL scheme for security
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('Only http/https URLs are allowed');
    }

    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Session Management Functions
function createSessionSwitcher() {
  // Instead of creating a separate window, send event to main window to show overlay
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('show-session-overlay');
  }
}

// Initialize session manager with settings
function initializeSessionManager() {
  const settings = store.get();
  sessionManager.setSessionTimeout(settings.sessionTimeout || defaultConfig.sessionTimeout);
  
  // Clean up old sessions on startup
  const cleanedCount = sessionManager.cleanupOldSessions();
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} old sessions on startup`);
  }
  
  // Set up periodic cleanup every hour
  setInterval(() => {
    const cleanedCount = sessionManager.cleanupOldSessions();
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} old sessions during periodic cleanup`);
    }
  }, 60 * 60 * 1000); // 1 hour
  
  // Listen for session events
  sessionManager.on('sessionLocked', (session) => {
    console.log(`Session ${session.name} locked due to inactivity`);
    if (mainWindow) {
      mainWindow.webContents.send('session-locked', session.id);
    }
  });
  
  sessionManager.on('sessionCreated', (session) => {
    console.log(`New session created: ${session.name}`);
  });
  
  sessionManager.on('sessionUnlocked', (session) => {
    console.log(`Session ${session.name} unlocked`);
    if (mainWindow) {
      mainWindow.webContents.send('session-unlocked', session);
    }
  });
}

// Session IPC Handlers
ipcMain.handle('get-sessions', async () => {
  return sessionManager.getAllSessions();
});

ipcMain.handle('create-session', async (event, name, pin) => {
  try {
    const sessionId = sessionManager.createSession(name, pin);
    return { success: true, sessionId };
  } catch (error) {
    console.error('Failed to create session:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-session', async (event, sessionId) => {
  try {
    sessionManager.deleteSession(sessionId);
    return { success: true };
  } catch (error) {
    console.error('Failed to delete session:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('switch-to-session', async (event, sessionId, pin) => {
  try {
    const session = sessionManager.switchToSession(sessionId, pin);
    return { success: true, session };
  } catch (error) {
    console.error('Failed to switch session:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-active-session', async () => {
  return sessionManager.getActiveSession();
});

ipcMain.handle('update-session-url', async (event, sessionId, url) => {
  try {
    sessionManager.updateSessionUrl(sessionId, url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('lock-session', async (event, sessionId) => {
  try {
    const session = sessionManager.lockSession(sessionId);
    return { success: true, session };
  } catch (error) {
    console.error('Failed to lock session:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('show-session-switcher', async () => {
  createSessionSwitcher();
  return { success: true };
});

ipcMain.handle('close-session-switcher', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hide-session-overlay');
  }
  return { success: true };
});

ipcMain.handle('create-new-session', async () => {
  // This is now handled by the session-switcher.html form
  // Just return success to maintain compatibility
  return { success: true };
});

// Update session activity on user interaction
ipcMain.handle('update-session-activity', async () => {
  const activeSession = sessionManager.getActiveSession();
  if (activeSession) {
    sessionManager.updateSessionActivity(activeSession.id);
  }
  return { success: true };
});

// App event handlers
app.whenReady().then(() => {
  // Set app icon explicitly for macOS dock
  if (process.platform === 'darwin') {
    try {
      const iconPath = path.join(__dirname, 'assets/icons/icon.png');
      app.dock.setIcon(iconPath);
    } catch (error) {
      console.log('Could not set dock icon:', error.message);
    }
  }
  
  // Initialize settings
  Object.keys(defaultConfig).forEach(key => {
    if (!store.has(key)) {
      store.set(key, defaultConfig[key]);
    }
  });

  createMainWindow();
  createMenu();
  initializeSessionManager();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Clean up session manager
  sessionManager.cleanup();
  
  // Always quit the app when all windows are closed (including macOS)
  // This is appropriate for a single-window ERP client application
  app.quit();
});

app.on('before-quit', () => {
  // Clear web session data before quit to prevent CSRF token issues
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.session.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexeddb', 'websql']
    });
  }
  
  // Ensure cleanup happens before quit
  sessionManager.cleanup();
});

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    // Validate URL scheme for security
    if (navigationUrl.startsWith('https://') || navigationUrl.startsWith('http://')) {
      shell.openExternal(navigationUrl);
    } else {
      console.warn('Blocked new-window request to invalid scheme:', navigationUrl);
    }
  });
});