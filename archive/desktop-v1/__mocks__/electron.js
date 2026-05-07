// Mock Electron module for testing
const EventEmitter = require('events');

class BrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = {
      send: jest.fn(),
      on: jest.fn(),
      session: {
        clearStorageData: jest.fn()
      },
      canGoBack: jest.fn(() => true),
      canGoForward: jest.fn(() => true),
      goBack: jest.fn(),
      goForward: jest.fn(),
      reload: jest.fn(),
      print: jest.fn(),
      printToPDF: jest.fn(() => Promise.resolve(Buffer.from('mock-pdf'))),
      getPrintersAsync: jest.fn(() => Promise.resolve([])),
      focus: jest.fn(),
      toggleDevTools: jest.fn(),
      setWindowOpenHandler: jest.fn(),
    };
    this._isDestroyed = false;
    this._isMaximized = false;
    this._bounds = { width: 1200, height: 800, x: 0, y: 0 };
  }

  loadFile(file) {
    return Promise.resolve();
  }

  loadURL(url) {
    return Promise.resolve();
  }

  show() {}
  hide() {}
  close() {
    this.emit('close');
    this.emit('closed');
  }
  focus() {}

  maximize() {
    this._isMaximized = true;
    this.emit('maximize');
  }

  unmaximize() {
    this._isMaximized = false;
    this.emit('unmaximize');
  }

  isMaximized() {
    return this._isMaximized;
  }

  getBounds() {
    return this._bounds;
  }

  setBounds(bounds) {
    this._bounds = { ...this._bounds, ...bounds };
    this.emit('resize');
  }

  isDestroyed() {
    return this._isDestroyed;
  }

  setFullScreen(flag) {}
  isFullScreen() { return false; }

  static getAllWindows() {
    return [];
  }
}

class Menu {
  static buildFromTemplate(template) {
    return new Menu();
  }
  static setApplicationMenu(menu) {}
}

class MenuItem {
  constructor(options) {
    this.options = options;
  }
}

const ipcMain = {
  handle: jest.fn((channel, handler) => {
    ipcMain._handlers = ipcMain._handlers || {};
    ipcMain._handlers[channel] = handler;
  }),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  // Helper for testing
  _invokeHandler: async (channel, ...args) => {
    if (ipcMain._handlers && ipcMain._handlers[channel]) {
      return await ipcMain._handlers[channel]({ sender: {} }, ...args);
    }
    throw new Error(`No handler registered for ${channel}`);
  }
};

const ipcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  send: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
};

const dialog = {
  showMessageBox: jest.fn(() => Promise.resolve({ response: 1 })),
  showOpenDialog: jest.fn(() => Promise.resolve({ canceled: false, filePaths: [] })),
  showSaveDialog: jest.fn(() => Promise.resolve({ canceled: false, filePath: '' })),
};

const shell = {
  openExternal: jest.fn(() => Promise.resolve()),
};

const app = {
  getVersion: jest.fn(() => '1.2.1'),
  getName: jest.fn(() => 'AERIS'),
  setName: jest.fn(),
  getPath: jest.fn((name) => `/mock/path/${name}`),
  whenReady: jest.fn(() => Promise.resolve()),
  on: jest.fn(),
  quit: jest.fn(),
  exit: jest.fn(),
  relaunch: jest.fn(),
  setLoginItemSettings: jest.fn(),
  dock: {
    setIcon: jest.fn(),
  },
};

const contextBridge = {
  exposeInMainWorld: jest.fn(),
};

module.exports = {
  BrowserWindow,
  Menu,
  MenuItem,
  ipcMain,
  ipcRenderer,
  dialog,
  shell,
  app,
  contextBridge,
};
