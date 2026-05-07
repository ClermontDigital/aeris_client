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
};

contextBridge.exposeInMainWorld('aeris', aeris);
