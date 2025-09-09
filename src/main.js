
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
console.log('Loaded electron module: Object Version:', app ? app.getVersion() : 'No app');
const path = require('path');
const Store = require('electron-store');
const https = require('https');
const SessionManager = require('./session-manager');

const store = new Store();
const sessionManager = new SessionManager();

let mainWindow;
let settingsWindow;
let sessionSwitcherWindow;

// Default configuration
const defaultConfig = {
  baseUrl: 'http://localhost:8822',
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

  // Automatically inject modal fix script when DOM is ready
  mainWindow.webContents.on('dom-ready', () => {
    injectModalFix();
  });

  // Intercept JavaScript confirm dialogs automatically
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Ensure input events are properly handled
    if (input.type === 'keyDown' || input.type === 'keyUp') {
      // Allow all keyboard input to pass through
      return;
    }
  });

  // Handle page reloads and navigation
  mainWindow.webContents.on('did-finish-load', () => {
    injectModalFix();
  });

  mainWindow.webContents.on('did-navigate', () => {
    injectModalFix();
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

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle navigation
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const baseUrl = store.get('baseUrl', defaultConfig.baseUrl);
    const parsedUrl = new URL(navigationUrl);
    const parsedBaseUrl = new URL(baseUrl);
    
    // Allow navigation within the same domain
    if (parsedUrl.hostname !== parsedBaseUrl.hostname) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
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
}

function loadApplication() {
  // Load the application wrapper (includes toolbar + ERP content)
  mainWindow.loadFile(path.join(__dirname, 'app-wrapper.html')).catch(() => {
    // If can't load the wrapper, show error page
    mainWindow.loadFile(path.join(__dirname, 'error.html'));
  });
}

// Automatically inject modal fix script only on ERP pages (not toolbar/wrapper)
function injectModalFix() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  // Skip injection for local HTML files (toolbar, wrapper, etc)
  const currentUrl = mainWindow.webContents.getURL();
  if (currentUrl.startsWith('file://') || currentUrl.includes('toolbar.html') || currentUrl.includes('app-wrapper.html')) {
    return;
  }
  
  const modalFixScript = `
    (function() {
      'use strict';
      
      // Skip if already injected
      if (window.aerisModalFixInjected) return;
      window.aerisModalFixInjected = true;
      
      console.log('Aeris Client: Injecting Bootstrap modal focus fix');
      
      // Store original dialog functions
      const originalConfirm = window.confirm;
      const originalAlert = window.alert;
      
      // Replace window.confirm with async function that uses Electron dialogs
      window.confirm = function(message) {
        if (!window.electronAPI || !window.electronAPI.showConfirmDialog) {
          return originalConfirm.call(this, message);
        }
        
        // Create a synchronous-style promise handler
        let result = false;
        const promise = window.electronAPI.showConfirmDialog({
          message: message || 'Are you sure?',
          title: 'Aeris - Confirm'
        });
        
        // Use a flag to track completion
        let completed = false;
        promise.then(res => {
          result = res.confirmed;
          completed = true;
          
          // Restore focus to any open modals
          setTimeout(() => {
            const openModals = document.querySelectorAll('.modal.show');
            openModals.forEach(modal => {
              const firstInput = modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
              if (firstInput) {
                firstInput.focus();
                console.log('Aeris Client: Restored focus to modal input');
              }
            });
          }, 100);
          
        }).catch(error => {
          console.error('Aeris Client: Dialog error:', error);
          result = originalConfirm.call(this, message);
          completed = true;
        });
        
        // For legacy compatibility, return immediately with false
        // Most modern code should handle this properly with the promise
        return false;
      };
      
      // Replace window.alert 
      window.alert = function(message) {
        if (!window.electronAPI || !window.electronAPI.showAlertDialog) {
          return originalAlert.call(this, message);
        }
        
        window.electronAPI.showAlertDialog({
          message: message || '',
          title: 'Aeris - Alert',
          type: 'info'
        }).then(() => {
          // Restore focus to any open modals
          setTimeout(() => {
            const openModals = document.querySelectorAll('.modal.show');
            openModals.forEach(modal => {
              const firstInput = modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
              if (firstInput) {
                firstInput.focus();
                console.log('Aeris Client: Restored focus to modal input after alert');
              }
            });
          }, 100);
        }).catch(error => {
          console.error('Aeris Client: Alert error:', error);
          originalAlert.call(this, message);
        });
      };
      
      // Enhanced focus restoration for Bootstrap modals
      document.addEventListener('shown.bs.modal', function(event) {
        setTimeout(() => {
          const modal = event.target;
          const firstInput = modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
          if (firstInput) {
            firstInput.focus();
          }
        }, 150);
      });
      
      // Better dialog handling with promises for modern code
      if (window.electronAPI) {
        window.electronAPI.confirmDialog = async function(message, title = 'Confirm') {
          const result = await window.electronAPI.showConfirmDialog({
            message: message,
            title: title
          });
          
          // Restore modal focus
          setTimeout(() => {
            const openModals = document.querySelectorAll('.modal.show');
            openModals.forEach(modal => {
              const firstInput = modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
              if (firstInput) {
                firstInput.focus();
              }
            });
          }, 100);
          
          return result.confirmed;
        };
      }
      
      console.log('Aeris Client: Modal focus fix injected successfully');
    })();
  `;

  // Inject the script into the page
  mainWindow.webContents.executeJavaScript(modalFixScript).catch(error => {
    console.error('Failed to inject modal fix script:', error);
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
      label: 'File',
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
        },
        {
          label: 'Developer Tools',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.toggleDevTools();
            }
          }
        }
      ]
    }
  ];

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
    
    // For non-restart changes, apply them immediately
    if (!needsRestart) {
      // Send immediate update for session button visibility
      mainWindow.webContents.executeJavaScript(`
        const toolbarFrame = document.getElementById('toolbar-frame');
        if (toolbarFrame && toolbarFrame.contentWindow) {
          toolbarFrame.contentWindow.postMessage({
            type: 'settings-updated',
            settings: ${JSON.stringify(settings)}
          }, '*');
        }
      `).catch(() => {});
    }
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
ipcMain.handle('print-page', async (event, options = {}) => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    const printOptions = {
      silent: options.silent || false,
      printBackground: options.printBackground !== false,
      color: options.color !== false,
      margins: options.margins || {
        marginType: 'printableArea'
      },
      landscape: options.landscape || false,
      scaleFactor: options.scaleFactor || 100,
      pagesPerSheet: options.pagesPerSheet || 1,
      collate: options.collate !== false,
      copies: options.copies || 1,
      header: options.header || '',
      footer: options.footer || ''
    };

    if (options.deviceName) {
      printOptions.deviceName = options.deviceName;
    }

    await mainWindow.webContents.print(printOptions);
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

ipcMain.handle('print-silent', async (event, options = {}) => {
  try {
    if (!mainWindow) {
      throw new Error('Main window not available');
    }

    const printOptions = {
      silent: true,
      printBackground: options.printBackground !== false,
      deviceName: options.printerName
    };

    await mainWindow.webContents.print(printOptions);
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
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql']
    });
  }
  
  // Ensure cleanup happens before quit
  sessionManager.cleanup();
});

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});