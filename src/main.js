const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let mainWindow;
let settingsWindow;

// Default configuration
const defaultConfig = {
  baseUrl: 'http://localhost:8080',
  autoStart: false,
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function loadApplication() {
  const baseUrl = store.get('baseUrl', defaultConfig.baseUrl);
  
  mainWindow.loadURL(baseUrl).catch(() => {
    // If can't load the main URL, show error page
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
  return {
    baseUrl: store.get('baseUrl', defaultConfig.baseUrl),
    autoStart: store.get('autoStart', defaultConfig.autoStart)
  };
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set('baseUrl', settings.baseUrl);
  store.set('autoStart', settings.autoStart);
  
  // Handle auto-start
  app.setLoginItemSettings({
    openAtLogin: settings.autoStart
  });
  
  return true;
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
}); 