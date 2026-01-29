import {create} from 'zustand';
import StorageService from '../services/StorageService';
import {STORAGE_KEYS, DEFAULT_CONFIG} from '../constants/config';
import type {Settings} from '../types/settings.types';

interface SettingsState {
  settings: Settings;
  isLoading: boolean;

  init: () => Promise<void>;
  saveSettings: (update: Partial<Settings>) => Promise<void>;
  testConnection: (url?: string) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    baseUrl: DEFAULT_CONFIG.baseUrl,
    sessionTimeout: DEFAULT_CONFIG.sessionTimeout,
    enableSessionManagement: DEFAULT_CONFIG.enableSessionManagement,
  },
  isLoading: true,

  init: async () => {
    const stored = await StorageService.getItem<Settings>(STORAGE_KEYS.SETTINGS);
    if (stored) {
      set({settings: stored, isLoading: false});
    } else {
      set({isLoading: false});
    }
  },

  saveSettings: async (update: Partial<Settings>) => {
    const current = get().settings;
    const updated = {...current, ...update};
    set({settings: updated});
    await StorageService.setItem(STORAGE_KEYS.SETTINGS, updated);
  },

  testConnection: async (url?: string) => {
    try {
      const testUrl = url || get().settings.baseUrl;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(testUrl, {method: 'HEAD', signal: controller.signal});
      clearTimeout(timeout);
      return resp.ok || resp.status < 500;
    } catch {
      return false;
    }
  },
}));
