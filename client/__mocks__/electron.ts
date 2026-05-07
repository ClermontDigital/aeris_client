// Minimal electron mock for unit tests. Tests that need a richer mock
// (e.g. ipcMain.handle dispatching) override individual fields per-test
// via jest.mock() factories.

const handlers = new Map<string, (...args: unknown[]) => unknown>();

export const ipcMain = {
  handle: jest.fn(
    (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  ),
  removeHandler: jest.fn((channel: string) => handlers.delete(channel)),
  // Test helper — invoke a registered handler as if from the renderer.
  __invoke: (channel: string, ...args: unknown[]) => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler registered for ${channel}`);
    return h({} as unknown, ...args);
  },
  __reset: () => handlers.clear(),
};

export const safeStorage = {
  isEncryptionAvailable: jest.fn().mockReturnValue(true),
  encryptString: jest.fn((s: string) => Buffer.from('enc:' + s)),
  decryptString: jest.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, '')),
};

export const app = {
  getVersion: jest.fn().mockReturnValue('2.0.0-test'),
  getPath: jest.fn().mockReturnValue('/tmp/aeris-test'),
  whenReady: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn(),
  on: jest.fn(),
  requestSingleInstanceLock: jest.fn().mockReturnValue(true),
};

export class BrowserWindow {
  webContents = { send: jest.fn(), on: jest.fn(), setWindowOpenHandler: jest.fn() };
  on = jest.fn();
  isDestroyed = jest.fn().mockReturnValue(false);
  isMinimized = jest.fn().mockReturnValue(false);
  restore = jest.fn();
  focus = jest.fn();
  show = jest.fn();
  loadURL = jest.fn().mockResolvedValue(undefined);
  loadFile = jest.fn().mockResolvedValue(undefined);
  once = jest.fn();
  static getAllWindows = jest.fn().mockReturnValue([]);
}

export const shell = {
  openExternal: jest.fn(),
};

export const powerMonitor = {
  getSystemIdleTime: jest.fn().mockReturnValue(0),
};

export const clipboard = {
  writeText: jest.fn(),
  readText: jest.fn().mockReturnValue(''),
};

export const contextBridge = {
  exposeInMainWorld: jest.fn(),
};

export const ipcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
};
