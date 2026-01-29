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
  onDialogClosed: (callback) => ipcRenderer.on('dialog-closed', callback),
  removeDialogClosedListener: (callback) => ipcRenderer.removeListener('dialog-closed', callback),
  
  // Settings window
  openSettings: () => ipcRenderer.invoke('open-settings'),
  
  // Navigation functions for toolbar
  navigate: (direction) => ipcRenderer.invoke('navigate', direction),
  navigateToUrl: (url) => ipcRenderer.invoke('navigate-to-url', url),
  
  // Update listeners for toolbar
  onNavigationUpdate: (callback) => ipcRenderer.on('navigation-update', callback),
  onConnectionStatus: (callback) => ipcRenderer.on('connection-status', callback),
  onNavigateToUrl: (callback) => ipcRenderer.on('navigate-to-url', callback),
  
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
  onSessionLocked: (callback) => ipcRenderer.on('session-locked', callback),
  onSessionSwitched: (callback) => ipcRenderer.on('session-switched', callback),
  onSessionUnlocked: (callback) => ipcRenderer.on('session-unlocked', callback),
  onSessionSwitcherOpened: (callback) => ipcRenderer.on('session-switcher-opened', callback),
  onSessionSwitcherClosed: (callback) => ipcRenderer.on('session-switcher-closed', callback),
  
  // Generic event listener for all session events
  on: (eventName, callback) => ipcRenderer.on(eventName, callback),
  
  // Settings event listener
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', callback),
  
  // App restart function
  restartApp: () => ipcRenderer.invoke('restart-app'),
  
  removeSessionListeners: () => {
    ipcRenderer.removeAllListeners('session-locked');
    ipcRenderer.removeAllListeners('session-switched');
    ipcRenderer.removeAllListeners('session-unlocked');
    ipcRenderer.removeAllListeners('session-switcher-opened');
    ipcRenderer.removeAllListeners('session-switcher-closed');
    ipcRenderer.removeAllListeners('settings-updated');
  }
}); 