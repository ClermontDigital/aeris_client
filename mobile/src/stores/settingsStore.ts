import {create} from 'zustand';
import StorageService from '../services/StorageService';
import {STORAGE_KEYS, DEFAULT_CONFIG, normalizeBaseUrl, resolveFetchUrl} from '../constants/config';
import type {Settings} from '../types/settings.types';
import type {ConnectionMode} from '../types/api.types';

// Mirror of shared/src/types/api.types.ts — ConnectionMode is a literal union,
// so keep this allowlist tight. Anything else in storage (e.g. an 'auto' value
// from a long-dead build) falls back to DEFAULT_CONFIG.connectionMode.
const CONNECTION_MODES: readonly ConnectionMode[] = ['direct', 'relay'];

function pickString(v: unknown, fallback: string, requireNonEmpty = false): string {
  if (typeof v === 'string' && (!requireNonEmpty || v.length > 0)) {
    return v;
  }
  return fallback;
}

function pickNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function pickBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickConnectionMode(v: unknown): ConnectionMode {
  return CONNECTION_MODES.includes(v as ConnectionMode)
    ? (v as ConnectionMode)
    : DEFAULT_CONFIG.connectionMode;
}

/**
 * Build a Settings object from an unknown blob pulled out of storage.
 * Per-field type validation defends against shape drift: an older build
 * may have persisted `baseUrl: null`, which would otherwise survive the
 * spread merge and crash downstream `.replace(...)` calls.
 */
function coerceSettings(stored: unknown): Settings {
  const s =
    stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return {
    baseUrl: pickString(s.baseUrl, DEFAULT_CONFIG.baseUrl, true),
    sessionTimeout: pickNumber(s.sessionTimeout, DEFAULT_CONFIG.sessionTimeout),
    enableSessionManagement: pickBoolean(
      s.enableSessionManagement,
      DEFAULT_CONFIG.enableSessionManagement,
    ),
    autoStart:
      s.autoStart === undefined ? undefined : pickBoolean(s.autoStart, false),
    relayUrl: pickString(s.relayUrl, DEFAULT_CONFIG.relayUrl, true),
    connectionMode: pickConnectionMode(s.connectionMode),
    workspaceCode:
      typeof s.workspaceCode === 'string'
        ? s.workspaceCode
        : DEFAULT_CONFIG.workspaceCode,
    hapticsEnabled: pickBoolean(s.hapticsEnabled, DEFAULT_CONFIG.hapticsEnabled),
  };
}

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
    try {
      const stored = await StorageService.getItem<unknown>(STORAGE_KEYS.SETTINGS);
      if (stored !== null && stored !== undefined) {
        // Per-field validation rather than spread: a stale payload may carry
        // `baseUrl: null` or `connectionMode: 'auto'` from an older build,
        // and those values would survive `{...DEFAULT_CONFIG, ...stored}`
        // and crash downstream string ops.
        set({settings: coerceSettings(stored)});
      }
    } finally {
      // Always release the splash gate, even if storage I/O threw — settings
      // simply remain at defaults rather than stranding the user on a blank
      // splash screen.
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
