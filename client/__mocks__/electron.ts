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
  isPackaged: true,
};

// Tracked instances so tests can inspect webContents.print arguments.
const browserWindowInstances: BrowserWindowInstance[] = [];

interface BrowserWindowInstance {
  webContents: {
    send: jest.Mock;
    on: jest.Mock;
    setWindowOpenHandler: jest.Mock;
    print: jest.Mock;
  };
  on: jest.Mock;
  removeListener: jest.Mock;
  isDestroyed: jest.Mock;
  isMinimized: jest.Mock;
  restore: jest.Mock;
  focus: jest.Mock;
  show: jest.Mock;
  loadURL: jest.Mock;
  loadFile: jest.Mock;
  once: jest.Mock;
  destroy: jest.Mock;
}

function makeBrowserWindow(): BrowserWindowInstance {
  return {
    webContents: {
      send: jest.fn(),
      on: jest.fn(),
      setWindowOpenHandler: jest.fn(),
      // print(opts, cb) — default success; tests override per case.
      print: jest.fn(
        (
          _opts: unknown,
          cb: (success: boolean, failureReason?: string) => void,
        ) => cb(true),
      ),
    },
    on: jest.fn(),
    // autoLock detach path uses removeListener; default to a noop spy.
    removeListener: jest.fn(),
    isDestroyed: jest.fn().mockReturnValue(false),
    isMinimized: jest.fn().mockReturnValue(false),
    restore: jest.fn(),
    focus: jest.fn(),
    show: jest.fn(),
    loadURL: jest.fn().mockResolvedValue(undefined),
    loadFile: jest.fn().mockResolvedValue(undefined),
    once: jest.fn(),
    destroy: jest.fn(),
  };
}

// Constructor double — `new BrowserWindow()` returns a tracked instance.
// Cast to `any` because Jest's mock-class types don't capture statics.
export const BrowserWindow = jest.fn(() => {
  const inst = makeBrowserWindow();
  browserWindowInstances.push(inst);
  return inst;
}) as unknown as jest.Mock & {
  getAllWindows: jest.Mock;
  __instances: BrowserWindowInstance[];
  __resetInstances: () => void;
};
BrowserWindow.getAllWindows = jest.fn().mockReturnValue([]);
BrowserWindow.__instances = browserWindowInstances;
BrowserWindow.__resetInstances = (): void => {
  browserWindowInstances.length = 0;
};

export const shell = {
  // Real Electron returns a Promise<void>; tests assume the same shape so
  // window.ts's .catch() chain doesn't crash on a sync undefined.
  openExternal: jest.fn().mockResolvedValue(undefined),
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
