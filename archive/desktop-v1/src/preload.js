const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  testConnection: (url) => ipcRenderer.invoke('test-connection', url),
  
  // Print functions
  printPage: (options) => ipcRenderer.invoke('print-page', options),
  printToPDF: (options) => ipcRenderer.invoke('print-to-pdf', options),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printSilent: (options) => ipcRenderer.invoke('print-silent', options),
  
  // Dialog functions to replace JavaScript confirm/alert
  showConfirmDialog: (options) => ipcRenderer.invoke('show-confirm-dialog', options),
  showAlertDialog: (options) => ipcRenderer.invoke('show-alert-dialog', options),
  
  // Focus restoration listener
  onDialogClosed: (callback) => ipcRenderer.on('dialog-closed', (_event, ...args) => callback(...args)),
  removeDialogClosedListener: () => ipcRenderer.removeAllListeners('dialog-closed'),
  
  // Settings window
  openSettings: () => ipcRenderer.invoke('open-settings'),
  
  // Navigation functions for toolbar
  navigate: (direction) => ipcRenderer.invoke('navigate', direction),
  navigateToUrl: (url) => ipcRenderer.invoke('navigate-to-url', url),
  
  // Update listeners for toolbar
  onNavigationUpdate: (callback) => ipcRenderer.on('navigation-update', (_event, ...args) => callback(...args)),
  onConnectionStatus: (callback) => ipcRenderer.on('connection-status', (_event, ...args) => callback(...args)),
  onNavigateToUrl: (callback) => ipcRenderer.on('navigate-to-url', (_event, ...args) => callback(...args)),
  
  // Update checking functions
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openReleasePage: (url) => ipcRenderer.invoke('open-release-page', url),
  
  // Session management functions
  getSessions: () => ipcRenderer.invoke('get-sessions'),
  createSession: (name, pin) => ipcRenderer.invoke('create-session', name, pin),
  deleteSession: (sessionId) => ipcRenderer.invoke('delete-session', sessionId),
  switchToSession: (sessionId, pin) => ipcRenderer.invoke('switch-to-session', sessionId, pin),

  lockSession: (sessionId) => ipcRenderer.invoke('lock-session', sessionId),
  getActiveSession: () => ipcRenderer.invoke('get-active-session'),
  updateSessionUrl: (sessionId, url) => ipcRenderer.invoke('update-session-url', sessionId, url),
  showSessionSwitcher: () => ipcRenderer.invoke('show-session-switcher'),
  closeSessionSwitcher: () => ipcRenderer.invoke('close-session-switcher'),
  createNewSession: () => ipcRenderer.invoke('create-new-session'),
  updateSessionActivity: () => ipcRenderer.invoke('update-session-activity'),
  
  // Session event listeners
  onSessionLocked: (callback) => ipcRenderer.on('session-locked', (_event, ...args) => callback(...args)),
  onSessionSwitched: (callback) => ipcRenderer.on('session-switched', (_event, ...args) => callback(...args)),
  onSessionUnlocked: (callback) => ipcRenderer.on('session-unlocked', (_event, ...args) => callback(...args)),
  onSessionSwitcherOpened: (callback) => ipcRenderer.on('session-switcher-opened', (_event, ...args) => callback(...args)),
  onSessionSwitcherClosed: (callback) => ipcRenderer.on('session-switcher-closed', (_event, ...args) => callback(...args)),
  onShowSessionOverlay: (callback) => ipcRenderer.on('show-session-overlay', (_event, ...args) => callback(...args)),
  onHideSessionOverlay: (callback) => ipcRenderer.on('hide-session-overlay', (_event, ...args) => callback(...args)),
  onPrintRequest: (callback) => ipcRenderer.on('print-request', (_event, ...args) => callback(...args)),
  onPrintSilentRequest: (callback) => ipcRenderer.on('print-silent-request', (_event, ...args) => callback(...args)),

  // Settings event listener
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (_event, ...args) => callback(...args)),
  
  // App restart function
  restartApp: () => ipcRenderer.invoke('restart-app'),
  
  removeSessionListeners: () => {
    ipcRenderer.removeAllListeners('session-locked');
    ipcRenderer.removeAllListeners('session-switched');
    ipcRenderer.removeAllListeners('session-unlocked');
    ipcRenderer.removeAllListeners('session-switcher-opened');
    ipcRenderer.removeAllListeners('session-switcher-closed');
    ipcRenderer.removeAllListeners('settings-updated');
    ipcRenderer.removeAllListeners('show-session-overlay');
    ipcRenderer.removeAllListeners('hide-session-overlay');
    ipcRenderer.removeAllListeners('print-request');
    ipcRenderer.removeAllListeners('print-silent-request');
  }
}); 