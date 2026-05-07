// Public window.aeris API shape exposed by preload via contextBridge.
// Renderer imports this for typing only — the runtime values live on the
// global `window.aeris`.

import type {
  AppSettings,
  AuthState,
  LoginRequest,
  RelayCallOptions,
  RelayCallResult,
} from '../shared-types/ipc';

export interface AerisBridge {
  app: {
    version(): Promise<string>;
  };

  relay: {
    call<T = unknown>(
      action: string,
      params?: unknown,
      options?: RelayCallOptions,
    ): Promise<RelayCallResult<T>>;
  };

  auth: {
    getState(): Promise<AuthState>;
    login(req: LoginRequest): Promise<AuthState>;
    logout(): Promise<AuthState>;
    onStateChanged(cb: (state: AuthState) => void): () => void;
  };

  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(cb: (next: AppSettings) => void): () => void;
  };
}

declare global {
  interface Window {
    aeris: AerisBridge;
  }
}

export {};
