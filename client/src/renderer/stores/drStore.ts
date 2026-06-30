import { create } from 'zustand';
import type { DrState, DrActivityReport } from '../../shared-types/ipc';
import { DEFAULT_DR_STATE } from '../../shared-types/ipc';

// Renderer-side mirror of main's DR failover state (M3-E). Single source of
// truth lives in main (failoverOrchestrator). This store reads via dr:get-state
// at boot and subscribes to dr:state-changed for live updates. The renderer is
// READ-ONLY w.r.t. orchestration — it only reports cart/screen activity back so
// main's mid-transaction defer is accurate.

interface DrStore extends DrState {
  init: () => Promise<void>;
  reportActivity: (report: DrActivityReport) => void;
}

let unsubscribe: (() => void) | null = null;

export const useDrStore = create<DrStore>((set) => ({
  ...DEFAULT_DR_STATE,

  init: async () => {
    if (unsubscribe) return; // idempotent
    // Defensive optional-chaining — production preload always exposes the
    // dr bridge, but jsdom tests that don't stub it shouldn't crash on a
    // missing namespace. Tests get DEFAULT_DR_STATE; production gets live.
    const dr = window.aeris?.dr;
    if (!dr) return;
    const state = await dr.getState();
    set({ ...state });
    unsubscribe = dr.onStateChanged((next) => {
      set({ ...next });
    });
  },

  reportActivity: (report) => {
    // Fire-and-forget; main re-evaluates the cascade on receipt. No-op when
    // the bridge isn't present (jsdom tests without a dr stub).
    window.aeris?.dr?.reportActivity?.(report);
  },
}));
