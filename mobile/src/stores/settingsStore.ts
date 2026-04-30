import {create} from 'zustand';
import StorageService from '../services/StorageService';
import {STORAGE_KEYS, DEFAULT_CONFIG, normalizeBaseUrl, resolveFetchUrl} from '../constants/config';
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
    relayUrl: DEFAULT_CONFIG.relayUrl,
    connectionMode: DEFAULT_CONFIG.connectionMode,
    workspaceCode: DEFAULT_CONFIG.workspaceCode,
  },
  isLoading: true,

  init: async () => {
    const stored = await StorageService.getItem<Settings>(STORAGE_KEYS.SETTINGS);
    if (stored) {
      // Merge over defaults so fields added in newer builds (e.g. workspaceCode)
      // don't end up undefined when an older persisted payload is loaded.
      set({settings: {...DEFAULT_CONFIG, ...stored}, isLoading: false});
    } else {
      set({isLoading: false});
    }
  },

  saveSettings: async (update: Partial<Settings>) => {
    const current = get().settings;
    // Workspace codes are case-insensitive and surrounded whitespace is a typo
    // in 100% of cases. Match what the gateway does at handler.go:88 so we
    // never persist a value that the relay would reject.
    if (update.workspaceCode !== undefined) {
      update = {...update, workspaceCode: update.workspaceCode.trim().toLowerCase()};
    }
    const merged = {...current, ...update};
    // Normalize the base URL to prevent trailing-slash issues in path construction
    if (merged.baseUrl) {
      merged.baseUrl = normalizeBaseUrl(merged.baseUrl);
    }
    set({settings: merged});
    await StorageService.setItem(STORAGE_KEYS.SETTINGS, merged);
  },

  testConnection: async (url?: string) => {
    try {
      const testUrl = url || get().settings.baseUrl;
      // Validate URL scheme before testing
      const parsed = new URL(testUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const fetchUrl = resolveFetchUrl(testUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(fetchUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // If fetch completes without throwing, the server is reachable
      return true;
    } catch {
      return false;
    }
  },
}));
