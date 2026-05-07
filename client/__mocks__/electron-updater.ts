// Minimal electron-updater mock. Tests that drive event paths use the
// returned EventEmitter via emit(); the production code subscribes via
// `autoUpdater.on(...)`.
import { EventEmitter } from 'events';

class MockAutoUpdater extends EventEmitter {
  logger: unknown = null;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checkForUpdates = jest.fn().mockResolvedValue(undefined);
  checkForUpdatesAndNotify = jest.fn().mockResolvedValue(undefined);
}

export const autoUpdater = new MockAutoUpdater();

// Test helper — reset state between tests.
export const __resetMock = () => {
  autoUpdater.removeAllListeners();
  autoUpdater.logger = null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.checkForUpdates.mockClear();
  autoUpdater.checkForUpdatesAndNotify.mockClear();
};
