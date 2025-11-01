// Test preload.js
jest.mock('electron');

describe('Preload Script', () => {
  let mockContextBridge;
  let mockIpcRenderer;

  beforeEach(() => {
    // Reset modules
    jest.resetModules();

    // Get mocked electron modules
    const electron = require('electron');
    mockContextBridge = electron.contextBridge;
    mockIpcRenderer = electron.ipcRenderer;

    // Clear all mocks
    jest.clearAllMocks();
  });

  test('should expose electronAPI to main world', () => {
    // Load preload script
    require('../preload');

    // Verify contextBridge was called
    expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      'electronAPI',
      expect.any(Object)
    );
  });

  test('should expose all required API methods', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    // Settings methods
    expect(exposedAPI).toHaveProperty('getSettings');
    expect(exposedAPI).toHaveProperty('saveSettings');
    expect(exposedAPI).toHaveProperty('testConnection');

    // Print methods
    expect(exposedAPI).toHaveProperty('printPage');
    expect(exposedAPI).toHaveProperty('printToPDF');
    expect(exposedAPI).toHaveProperty('getPrinters');
    expect(exposedAPI).toHaveProperty('printSilent');

    // Dialog methods
    expect(exposedAPI).toHaveProperty('showConfirmDialog');
    expect(exposedAPI).toHaveProperty('showAlertDialog');

    // Navigation methods
    expect(exposedAPI).toHaveProperty('navigate');
    expect(exposedAPI).toHaveProperty('navigateToUrl');

    // Session methods
    expect(exposedAPI).toHaveProperty('getSessions');
    expect(exposedAPI).toHaveProperty('createSession');
    expect(exposedAPI).toHaveProperty('deleteSession');
    expect(exposedAPI).toHaveProperty('switchToSession');
    expect(exposedAPI).toHaveProperty('getActiveSession');
    expect(exposedAPI).toHaveProperty('lockSession');
  });

  test('getSettings should call ipcRenderer.invoke with correct channel', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    exposedAPI.getSettings();

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('get-settings');
  });

  test('saveSettings should call ipcRenderer.invoke with settings data', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    const settings = { baseUrl: 'http://test.local' };
    exposedAPI.saveSettings(settings);

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('save-settings', settings);
  });

  test('createSession should call ipcRenderer.invoke with name and PIN', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    exposedAPI.createSession('Alice', '1234');

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('create-session', 'Alice', '1234');
  });

  test('onSettingsUpdated should register event listener', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    const callback = jest.fn();
    exposedAPI.onSettingsUpdated(callback);

    expect(mockIpcRenderer.on).toHaveBeenCalledWith('settings-updated', callback);
  });

  test('onSessionLocked should register event listener', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    const callback = jest.fn();
    exposedAPI.onSessionLocked(callback);

    expect(mockIpcRenderer.on).toHaveBeenCalledWith('session-locked', callback);
  });

  test('removeSessionListeners should remove all session-related listeners', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    exposedAPI.removeSessionListeners();

    expect(mockIpcRenderer.removeAllListeners).toHaveBeenCalledWith('session-locked');
    expect(mockIpcRenderer.removeAllListeners).toHaveBeenCalledWith('session-switched');
    expect(mockIpcRenderer.removeAllListeners).toHaveBeenCalledWith('session-unlocked');
    expect(mockIpcRenderer.removeAllListeners).toHaveBeenCalledWith('settings-updated');
  });

  test('print methods should invoke correct IPC channels', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    exposedAPI.printPage({ silent: true });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('print-page', { silent: true });

    exposedAPI.printToPDF({});
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('print-to-pdf', {});

    exposedAPI.getPrinters();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('get-printers');

    exposedAPI.printSilent({ printerName: 'Printer1' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('print-silent', { printerName: 'Printer1' });
  });

  test('navigation methods should invoke correct IPC channels', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    exposedAPI.navigate('back');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('navigate', 'back');

    exposedAPI.navigateToUrl('http://test.local');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('navigate-to-url', 'http://test.local');

    exposedAPI.openSettings();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('open-settings');
  });

  test('dialog methods should invoke correct IPC channels', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    exposedAPI.showConfirmDialog({ message: 'Confirm?' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('show-confirm-dialog', { message: 'Confirm?' });

    exposedAPI.showAlertDialog({ message: 'Alert!' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('show-alert-dialog', { message: 'Alert!' });
  });

  test('session management methods should invoke correct IPC channels', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    exposedAPI.getSessions();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('get-sessions');

    exposedAPI.deleteSession('session-id');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('delete-session', 'session-id');

    exposedAPI.switchToSession('session-id', '1234');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('switch-to-session', 'session-id', '1234');

    exposedAPI.getActiveSession();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('get-active-session');

    exposedAPI.lockSession('session-id');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('lock-session', 'session-id');

    exposedAPI.updateSessionUrl('session-id', 'http://test.local');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('update-session-url', 'session-id', 'http://test.local');

    exposedAPI.updateSessionActivity();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('update-session-activity');
  });

  test('update methods should invoke correct IPC channels', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    exposedAPI.checkForUpdates();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('check-for-updates');

    exposedAPI.openReleasePage('https://github.com/releases');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('open-release-page', 'https://github.com/releases');

    exposedAPI.restartApp();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('restart-app');
  });

  test('testConnection should invoke test-connection channel', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    exposedAPI.testConnection('http://test.local');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('test-connection', 'http://test.local');
  });

  test('event listeners should be correctly bound', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    const callback = jest.fn();

    exposedAPI.onDialogClosed(callback);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('dialog-closed', callback);

    exposedAPI.onNavigationUpdate(callback);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('navigation-update', callback);

    exposedAPI.onConnectionStatus(callback);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('connection-status', callback);

    exposedAPI.onNavigateToUrl(callback);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('navigate-to-url', callback);

    exposedAPI.onSessionSwitched(callback);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('session-switched', callback);

    exposedAPI.onSessionUnlocked(callback);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('session-unlocked', callback);
  });

  test('generic event listener should work', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    const callback = jest.fn();

    exposedAPI.on('custom-event', callback);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('custom-event', callback);
  });

  test('removeDialogClosedListener should remove listener', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];
    const callback = jest.fn();

    exposedAPI.removeDialogClosedListener(callback);
    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith('dialog-closed', callback);
  });

  test('session switcher methods should invoke correct channels', () => {
    require('../preload');

    const exposedAPI = mockContextBridge.exposeInMainWorld.mock.calls[0][1];

    exposedAPI.showSessionSwitcher();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('show-session-switcher');

    exposedAPI.closeSessionSwitcher();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('close-session-switcher');

    exposedAPI.createNewSession();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('create-new-session');
  });
});
