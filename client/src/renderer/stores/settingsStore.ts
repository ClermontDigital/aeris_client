import { create } from 'zustand';
import type { AppSettings } from '../../shared-types/ipc';
import { DEFAULT_SETTINGS } from '../../shared-types/ipc';

// Renderer-side mirror of main's electron-store settings.

interface SettingsStore {
  settings: AppSettings;
  init: () => Promise<void>;
  set: (patch: Partial<AppSettings>) => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,

  init: async () => {
    if (unsubscribe) return;
    const s = await window.aeris.settings.get();
    set({ settings: s });
    unsubscribe = window.aeris.settings.onChanged((next) => {
      set({ settings: next });
    });
  },

  set: async (patch) => {
    const next = await window.aeris.settings.set(patch);
    set({ settings: next });
  },
}));
