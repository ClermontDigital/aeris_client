import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared-types/ipc';
import type { AerisBridge } from './types';

// The contextBridge gets a frozen, minimal surface. The renderer never
// gets ipcRenderer directly, so it can't subscribe to arbitrary channels
// or invoke ones we didn't expose.

const aeris: AerisBridge = {
  app: {
    version: () => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),
  },

  relay: {
    call: (action, params, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.RELAY_CALL, action, params, options),
  },

  auth: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_STATE),
    login: (req) => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, req),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
    onStateChanged: (cb) => {
      const handler = (_e: unknown, state: unknown) =>
        cb(state as Parameters<AerisBridge['auth']['onStateChanged']>[0] extends (s: infer S) => void ? S : never);
      ipcRenderer.on(IPC_CHANNELS.AUTH_STATE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_STATE_CHANGED, handler);
    },
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    set: (patch) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, patch),
    onChanged: (cb) => {
      const handler = (_e: unknown, next: unknown) =>
        cb(next as Parameters<AerisBridge['settings']['onChanged']>[0] extends (s: infer S) => void ? S : never);
      ipcRenderer.on(IPC_CHANNELS.SETTINGS_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SETTINGS_CHANGED, handler);
    },
  },

  lock: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.LOCK_GET_STATE),
    setPin: (pin) => ipcRenderer.invoke(IPC_CHANNELS.LOCK_SET_PIN, pin),
    verifyPin: (pin) => ipcRenderer.invoke(IPC_CHANNELS.LOCK_VERIFY_PIN, pin),
    clearPin: () => ipcRenderer.invoke(IPC_CHANNELS.LOCK_CLEAR_PIN),
    resetPin: () => ipcRenderer.invoke(IPC_CHANNELS.LOCK_RESET_PIN),
    lockNow: () => ipcRenderer.invoke(IPC_CHANNELS.LOCK_NOW),
    onStateChanged: (cb) => {
      const handler = (_e: unknown, next: unknown) =>
        cb(next as Parameters<AerisBridge['lock']['onStateChanged']>[0] extends (s: infer S) => void ? S : never);
      ipcRenderer.on(IPC_CHANNELS.LOCK_STATE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LOCK_STATE_CHANGED, handler);
    },
  },

  diagnostics: {
    getRecentLogs: (maxLines) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_GET_RECENT_LOGS, maxLines),
  },

  update: {
    checkNow: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK_NOW),
    openDownload: (url) =>
      ipcRenderer.invoke(IPC_CHANNELS.UPDATE_OPEN_DOWNLOAD, url),
    installNow: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL_NOW),
    onStatusChanged: (cb) => {
      const handler = (_e: unknown, status: unknown) =>
        cb(status as Parameters<AerisBridge['update']['onStatusChanged']>[0] extends (s: infer S) => void ? S : never);
      ipcRenderer.on(IPC_CHANNELS.UPDATE_STATUS_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATUS_CHANGED, handler);
    },
    onManualFallback: (cb) => {
      const handler = (_e: unknown, status: unknown) =>
        cb(status as Parameters<AerisBridge['update']['onManualFallback']>[0] extends (s: infer S) => void ? S : never);
      ipcRenderer.on(IPC_CHANNELS.UPDATE_MANUAL_FALLBACK, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_MANUAL_FALLBACK, handler);
    },
  },
};

contextBridge.exposeInMainWorld('aeris', aeris);
