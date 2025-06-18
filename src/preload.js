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
  onNavigateToUrl: (callback) => ipcRenderer.on('navigate-to-url', callback)
}); 