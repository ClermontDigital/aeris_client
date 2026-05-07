import { create } from 'zustand';
import type { AuthState as MainAuthState, LoginRequest } from '../../shared-types/ipc';

// Renderer-side mirror of main's auth state. Single source of truth lives
// in main (authManager.ts). This store reads via auth:get-state at boot
// and subscribes to auth:state-changed for live updates.

interface AuthStore extends MainAuthState {
  isLoading: boolean;
  init: () => Promise<void>;
  login: (req: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const initialState: MainAuthState = {
  initialized: false,
  isAuthenticated: false,
  user: null,
  expiresAt: null,
  workspaceCode: '',
  errorKind: null,
};

let unsubscribe: (() => void) | null = null;

export const useAuthStore = create<AuthStore>((set) => ({
  ...initialState,
  isLoading: false,

  init: async () => {
    if (unsubscribe) return; // idempotent
    const state = await window.aeris.auth.getState();
    set({ ...state });
    unsubscribe = window.aeris.auth.onStateChanged((next) => {
      set({ ...next });
    });
  },

  login: async (req) => {
    set({ isLoading: true });
    try {
      const next = await window.aeris.auth.login(req);
      set({ ...next, isLoading: false });
    } catch (e) {
      set({ isLoading: false, errorKind: 'unknown' });
    }
  },

  logout: async () => {
    const next = await window.aeris.auth.logout();
    set({ ...next });
  },

  clearError: () => set({ errorKind: null }),
}));
