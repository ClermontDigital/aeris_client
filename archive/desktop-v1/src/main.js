
const { app, BrowserWindow, Menu, MenuItem, ipcMain, dialog, shell } = require('electron');

// Set the app name for dock/taskbar display - must be done before app ready
app.setName('AERIS');
console.log('Loaded electron module: Object Version:', app ? app.getVersion() : 'No app');
const path = require('path');
const Store = require('electron-store');
const SessionManager = require('./session-manager');
const {
  ReachabilityTracker,
  decideAutoAction,
  PROBE_INTERVAL_MS,
  FAILBACK_CLOUD_HOLD_MS,
} = require('./dr-failover-monitor');
const { partitionFor } = require('./dr-partition');

const store = new Store();
const sessionManager = new SessionManager(store);

let mainWindow;
let settingsWindow;
let sessionSwitcherWindow;
let sessionCleanupInterval = null;

// DR M3 (DARK by default). Reachability trackers + the probe interval handle.
// These stay dormant unless the `drAutoFailover` flag is on — no probe traffic,
// no auto-swap when off (see startDrFailoverMonitor / probeEndpoints).
const cloudReachability = new ReachabilityTracker();
const nasReachability = new ReachabilityTracker();
let drProbeInterval = null;
// Re-entrancy guard so an in-flight auto-switch isn't triggered twice.
let drAutoSwapInFlight = false;

// Default configuration
const defaultConfig = {
  baseUrl: 'http://aeris.local:8000',
  // DR NAS warm-failover: `localUrl` is the in-store (NAS/LAN) target the
  // webview loads when `routingMode === 'local'`. `baseUrl` stays the cloud
  // target. Empty until the operator configures + validates a LAN address.
  localUrl: '',
  routingMode: 'cloud',
  // DR M3 automated failover. DARK by default — flag OFF ≡ today's behaviour
  // (manual cloud↔in-store toggle only, no health probing, no auto-swap).
  // Turning this on is a separate, proof-gated event (see PROJECT_DR_M3_BUILD_PLAN).
  drAutoFailover: false,
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

// DR routing: resolve which URL the webview should load. In 'local' (in-store)
// mode this is the validated NAS LAN target; otherwise the cloud baseUrl.
function getActiveTargetUrl() {
  const mode = store.get('routingMode', defaultConfig.routingMode);
  if (mode === 'local') {
    return store.get('localUrl', defaultConfig.localUrl);
  }
  return store.get('baseUrl', defaultConfig.baseUrl);
}

// will-navigate security boundary (DR cross-target guard). Navigation is
// confined to the ACTIVE target's host — same host = in-app (allow), any other
// host (or a malformed URL) = treat as external and open in the system browser.
// Pure so it can be unit-tested without spinning up a BrowserWindow. After a
// cloud↔local switch the active target changes, so NAS nav is allowed in local
// mode and cloud nav is allowed in cloud mode, but never the reverse.
function isNavigationAllowed(navigationUrl, activeTargetUrl) {
  try {
    const parsedUrl = new URL(navigationUrl);
    const parsedBaseUrl = new URL(activeTargetUrl);
    return parsedUrl.hostname === parsedBaseUrl.hostname;
  } catch (error) {
    return false;
  }
}

// Webview popup policy (pure, for unit test). Aeris2's UI opens popups in TWO
// shapes, both of which the v1 webview must allow or the sales-view Print
// Invoice button silently drops:
//
//   (a) URL popup — window.open('/sales/{id}/invoice.pdf?inline=1', '_blank')
//       (Sales/Show.tsx). Same-host only.
//   (b) Blank popup — window.open('', '_blank') then doc.write from the opener
//       (RemittanceStatementModal, RepairBarcodeModal, LabelPrintModal, POS/
//       ReceiptModal fallback). Same-origin by construction: the popup is
//       hydrated by the opener via document.write, no navigation happens.
//
// Both spawn a child BrowserWindow that inherits the webview session (auth
// cookie carries). Off-host URLs hand off to the system browser; anything
// else denies fail-closed.
const CHILD_WINDOW_OPTIONS = {
  width: 900,
  height: 1100,
  title: 'AERIS',
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    enableRemoteModule: false,
  },
};

function decideWebviewPopup(url, activeTargetUrl) {
  // Blank popup — doc.write pattern. Same-origin by construction.
  if (url === '' || url === 'about:blank') {
    return { action: 'allow', overrideBrowserWindowOptions: CHILD_WINDOW_OPTIONS };
  }
  if (isNavigationAllowed(url, activeTargetUrl)) {
    return { action: 'allow', overrideBrowserWindowOptions: CHILD_WINDOW_OPTIONS };
  }
  const external =
    url && (url.startsWith('https://') || url.startsWith('http://')) ? url : null;
  return { action: 'deny', external };
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

  // Webview popup gate. Aeris2's UI opens the invoice PDF (Sales/Show.tsx,
  // POS/ReceiptModal.tsx fallback) via window.open(url, '_blank'). Without
  // this handler on the WEBVIEW'S webContents those calls silently drop — the
  // sales-view "Print Invoice" button appears to do nothing. Same-host popups
  // spawn a child window that inherits the webview session so the auth cookie
  // carries the PDF request; off-host popups hand off to the system browser.
  //
  // NB: mainWindow.webContents.setWindowOpenHandler (below) fires for popups
  // opened by the OUTER app-wrapper.html, not by webview guest content — those
  // two paths must be handled separately.
  mainWindow.webContents.on('did-attach-webview', (_event, webviewWebContents) => {
    webviewWebContents.setWindowOpenHandler(({ url }) => {
      const decision = decideWebviewPopup(url, getActiveTargetUrl());
      if (decision.action === 'deny') {
        if (decision.external) {
          shell.openExternal(decision.external);
        } else {
          console.warn('Blocked webview popup with invalid scheme:', url);
        }
        return { action: 'deny' };
      }
      // Explicit session inheritance: the child window MUST share the webview's
      // session (persist:main / persist:nas / per-cashier), else the invoice
      // PDF request 401s exactly like the pre-fix bug. `session:` in
      // webPreferences takes precedence over `partition:` — pass the object
      // directly so DR partitions and per-cashier partitions all Just Work.
      const options = decision.overrideBrowserWindowOptions;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...options,
          webPreferences: {
            ...options.webPreferences,
            session: webviewWebContents.session,
          },
        },
      };
    });
  });

  // Handle navigation with security validation
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    // Confine navigation to the ACTIVE target (cloud baseUrl or NAS localUrl) —
    // not always baseUrl, else NAS nav is treated as external after a switch.
    const activeTargetUrl = getActiveTargetUrl();

    if (isNavigationAllowed(navigationUrl, activeTargetUrl)) {
      return; // same host as the active target — in-app navigation.
    }

    // Different host or malformed URL — block in-app and (for valid web
    // schemes) hand off to the system browser.
    event.preventDefault();
    if (navigationUrl.startsWith('https://') || navigationUrl.startsWith('http://')) {
      shell.openExternal(navigationUrl);
    } else {
      console.warn('Blocked navigation to invalid scheme/URL:', navigationUrl);
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
    localUrl: store.get('localUrl', defaultConfig.localUrl),
    routingMode: store.get('routingMode', defaultConfig.routingMode),
    drAutoFailover: store.get('drAutoFailover', defaultConfig.drAutoFailover),
    autoStart: store.get('autoStart', defaultConfig.autoStart),
    enableSessionManagement: store.get('enableSessionManagement', defaultConfig.enableSessionManagement),
    sessionTimeout: store.get('sessionTimeout', defaultConfig.sessionTimeout)
  };

  return settings;
});

ipcMain.handle('save-settings', (event, settings) => {
  // Validate baseUrl scheme before saving (lax http/https — cloud target).
  if (settings.baseUrl) {
    try {
      const parsed = new URL(settings.baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { success: false, error: 'Only http:// and https:// URLs are allowed' };
      }
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }
  }

  // DR: the NAS/LAN target gets the STRICT validator (no fall-through to the lax
  // http/https check) — a poisoned localUrl is a credential-harvest primitive.
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
    baseUrl: store.get('baseUrl', defaultConfig.baseUrl),
    enableSessionManagement: store.get('enableSessionManagement', defaultConfig.enableSessionManagement)
  };

  store.set('baseUrl', settings.baseUrl);
  store.set('localUrl', settings.localUrl || '');
  // DR M3: persist the auto-failover flag (default OFF). Coerce to a strict
  // boolean so a missing/garbage value can never accidentally enable it.
  store.set('drAutoFailover', settings.drAutoFailover === true);
  store.set('autoStart', settings.autoStart);
  store.set('enableSessionManagement', settings.enableSessionManagement);
  store.set('sessionTimeout', settings.sessionTimeout);

  // DR M3: (re)start or stop the health monitor to match the flag. With the
  // flag off this tears the probe timer down entirely — ZERO probe traffic.
  syncDrFailoverMonitor();

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
    // Validate URL scheme to prevent SSRF with file://, javascript:, etc.
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http:// and https:// URLs are allowed');
    }

    const testWindow = new BrowserWindow({
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

    // Validate URL scheme for security
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http:// and https:// URLs are allowed');
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
  sessionCleanupInterval = setInterval(() => {
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
    // Validate URL scheme before storing
    if (url && typeof url === 'string') {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http:// and https:// URLs are allowed');
      }
    }
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

// DR routing-mode switch core (cloud ↔ in-store/NAS). Reload-in-place, NOT a
// restart. Shared by the manual IPC handler and the M3 auto-swap orchestrator
// so there is exactly ONE switch implementation (no forked switch logic).
//
// `trigger` is 'manual' (default) or 'auto' — only affects the
// routing-mode-changed payload so the renderer can distinguish auto vs manual
// copy. The per-endpoint partition model (dr-partition.js) means we DO NOT clear
// the target's session on switch: each endpoint keeps its own login so a cashier
// with a warm in-store session keeps selling through an outage. See dr-partition
// for the security note (isolation + explicit-logout-still-clears).
async function performRoutingModeSwitch(mode, { trigger = 'manual' } = {}) {
  if (mode !== 'cloud' && mode !== 'local') {
    return { success: false, error: 'Invalid routing mode' };
  }

  // Fail closed: refuse to switch to in-store mode unless a valid LAN target is
  // already stored. (Applies to BOTH manual and auto — auto additionally gates
  // on this in decideAutoAction, this is defence-in-depth.)
  if (mode === 'local') {
    const localUrl = store.get('localUrl', defaultConfig.localUrl);
    const { isLocalUrlSafeForCache } = require('./dr-url-validator');
    if (!localUrl || !isLocalUrlSafeForCache(localUrl)) {
      return { success: false, error: 'No valid in-store (NAS) URL configured' };
    }
  }

  store.set('routingMode', mode);
  const targetUrl = getActiveTargetUrl();

  // PER-ENDPOINT PARTITIONS (M3 owner decision — replaces clear-all-on-switch).
  // We deliberately DO NOT clear storage here: the target endpoint loads its own
  // persistent partition (cloud reuses legacy persist:main[/persist:user-id];
  // NAS uses persist:nas[:user-id]).
  // A warm session there = no re-login; an empty one = that endpoint's login
  // screen. Cloud and NAS partitions are isolated, so neither leaks into the
  // other. Explicit LOGOUT (logout-endpoint IPC) is what clears a partition.

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('routing-mode-changed', { mode, targetUrl, trigger });
  }

  return { success: true, mode, targetUrl, trigger };
}

// DR routing-mode switch (manual). Reload-in-place, NOT a restart.
ipcMain.handle('set-routing-mode', async (event, mode) => {
  try {
    return await performRoutingModeSwitch(mode, { trigger: 'manual' });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// DR M3: explicit logout for ONE endpoint (the partitions belonging to the
// given mode, across all cashiers). This REPLACES the blanket clear-on-switch
// re-auth guarantee with a deliberate, isolation-preserving clear: logging out
// of NAS must NOT wipe the cloud session and vice-versa. Storages list matches
// the Electron clearStorageData enum (note the 'indexdb' quirk — no 2nd 'e').
ipcMain.handle('logout-endpoint', async (event, mode) => {
  try {
    if (mode !== 'cloud' && mode !== 'local') {
      return { success: false, error: 'Invalid routing mode' };
    }
    const { partitionsForEndpoint } = require('./dr-partition');
    const { session } = require('electron');
    let sessionIds = [];
    if (store.get('enableSessionManagement', defaultConfig.enableSessionManagement)) {
      sessionIds = sessionManager.getAllSessions().map((s) => s.id);
    }
    const partitions = partitionsForEndpoint(mode, sessionIds);
    const storages = ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'];
    await Promise.all(
      partitions.map((p) => session.fromPartition(p).clearStorageData({ storages }))
    );
    return { success: true, mode, cleared: partitions };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- DR M3 health monitor + auto-swap orchestrator (DARK by default) --------

// Unauthenticated reachability probe. Any HTTP answer (even non-2xx) = the box
// answered = REACHABLE. A transport error / timeout = unreachable. We never send
// auth, never parse a body — we only care that something on the other end
// spoke. Uses Electron's net.request (respects system proxy/cert config) with a
// hard timeout so a black-holed endpoint reports a transport failure promptly.
function probeEndpoint(baseUrl) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (reachable) => {
      if (settled) return;
      settled = true;
      resolve(reachable);
    };
    let url;
    try {
      // Aeris2 serves GET /health (and /up) unauthenticated.
      url = new URL('/health', baseUrl).toString();
    } catch {
      return done(false);
    }
    try {
      const { net } = require('electron');
      const request = net.request({ method: 'GET', url });
      const timer = setTimeout(() => {
        try { request.abort(); } catch { /* ignore */ }
        done(false); // timeout = transport failure
      }, 5000);
      request.on('response', () => {
        clearTimeout(timer);
        done(true); // any HTTP status = reachable
      });
      request.on('error', () => {
        clearTimeout(timer);
        done(false); // DNS/connect/TLS error = transport failure
      });
      request.end();
    } catch {
      done(false);
    }
  });
}

// One probe tick: probe BOTH endpoints, feed the hysteresis trackers, then run
// the single decision site and act on it. Only ever called by the interval that
// startDrFailoverMonitor sets up (and that interval only runs when the flag is
// on), so there is NO probe traffic at all when the flag is off.
async function runDrProbeTick() {
  // Re-check the flag every tick — defence in depth so a stale interval can
  // never act after the flag is turned off.
  if (store.get('drAutoFailover', defaultConfig.drAutoFailover) !== true) {
    return;
  }

  const baseUrl = store.get('baseUrl', defaultConfig.baseUrl);
  const localUrl = store.get('localUrl', defaultConfig.localUrl);

  const cloudOk = await probeEndpoint(baseUrl);
  cloudOk ? cloudReachability.reportSuccess() : cloudReachability.reportTransportFailure();

  // Only probe the NAS if a LAN target is configured; otherwise it can never be
  // a failover target and we skip the traffic.
  if (localUrl) {
    const nasOk = await probeEndpoint(localUrl);
    nasOk ? nasReachability.reportSuccess() : nasReachability.reportTransportFailure();
  } else {
    nasReachability.reset();
  }

  await maybeAutoSwap();
}

// THE single auto-swap decision + action site. Pure decision in
// decideAutoAction; this thin wrapper supplies the live snapshot and invokes the
// SHARED switch (performRoutingModeSwitch) — it never forks the switch logic.
async function maybeAutoSwap() {
  if (drAutoSwapInFlight) return;

  const { isLocalUrlSafeForCache } = require('./dr-url-validator');
  const localUrl = store.get('localUrl', defaultConfig.localUrl);

  const decision = decideAutoAction({
    enabled: store.get('drAutoFailover', defaultConfig.drAutoFailover) === true,
    currentMode: store.get('routingMode', defaultConfig.routingMode),
    cloudReachable: cloudReachability.reachable,
    nasReachable: nasReachability.reachable,
    localUrlValid: !!localUrl && isLocalUrlSafeForCache(localUrl),
    cloudSustainedMs: cloudReachability.reachableSustainedMs(),
    failbackHoldMs: FAILBACK_CLOUD_HOLD_MS,
  });

  if (decision.action === 'none') return;

  drAutoSwapInFlight = true;
  try {
    await performRoutingModeSwitch(decision.mode, { trigger: 'auto' });
  } finally {
    drAutoSwapInFlight = false;
  }
}

// Start the probe interval iff the flag is on. Idempotent. Resets the trackers
// on (re)start so a fresh enable doesn't act on stale state.
function startDrFailoverMonitor() {
  if (drProbeInterval) return;
  cloudReachability.reset();
  nasReachability.reset();
  drProbeInterval = setInterval(() => {
    runDrProbeTick().catch((e) => console.error('DR probe tick failed:', e.message));
  }, PROBE_INTERVAL_MS);
}

// Stop the probe interval and clear reachability state — NO probe traffic after.
function stopDrFailoverMonitor() {
  if (drProbeInterval) {
    clearInterval(drProbeInterval);
    drProbeInterval = null;
  }
  cloudReachability.reset();
  nasReachability.reset();
}

// Reconcile the monitor with the current flag value. Called at startup and
// whenever settings change.
function syncDrFailoverMonitor() {
  if (store.get('drAutoFailover', defaultConfig.drAutoFailover) === true) {
    startDrFailoverMonitor();
  } else {
    stopDrFailoverMonitor();
  }
}

// App event handlers. Skipped under the unit-test harness so requiring this
// module to exercise the pure helpers (isNavigationAllowed) doesn't spin up a
// real BrowserWindow / settings init.
if (process.env.NODE_ENV !== 'test') {
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

  // DR M3: start the health monitor iff `drAutoFailover` is on (default OFF ⇒
  // no probe traffic, no auto-swap — flag-off ≡ today).
  syncDrFailoverMonitor();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
}

app.on('window-all-closed', () => {
  // Clean up session manager
  sessionManager.cleanup();
  
  // Always quit the app when all windows are closed (including macOS)
  // This is appropriate for a single-window ERP client application
  app.quit();
});

app.on('before-quit', () => {
  // Clear transient web storage on quit, but preserve cookies so that
  // Laravel session and "remember me" tokens survive app restarts.
  // CSRF tokens are regenerated per-session by Laravel automatically.
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.session.clearStorageData({
      storages: ['sessionstorage']
    });
  }

  if (sessionCleanupInterval) {
    clearInterval(sessionCleanupInterval);
    sessionCleanupInterval = null;
  }

  // DR M3: tear down the health probe timer.
  stopDrFailoverMonitor();

  // Ensure cleanup happens before quit
  sessionManager.cleanup();
});

// Exported for unit testing of the will-navigate cross-target security
// boundary. Not used by the running app (the listener calls the in-scope fn).
// The DR monitor primitives are re-exported from their own modules so callers
// can unit-test them without loading the Electron app shell.
module.exports = {
  isNavigationAllowed,
  decideWebviewPopup,
  // Re-exports for convenience / discoverability (pure, tested in their own specs).
  ReachabilityTracker,
  decideAutoAction,
  partitionFor,
};

