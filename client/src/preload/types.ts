// Public window.aeris API shape exposed by preload via contextBridge.
// Renderer imports this for typing only — the runtime values live on the
// global `window.aeris`.

import type {
  AppLockState,
  AppSettings,
  AuthState,
  CheckNowResult,
  LoginRequest,
  PrintReceiptResult,
  RelayCallOptions,
  RelayCallResult,
  SetPinResult,
  UpdateStatus,
  VerifyPinResult,
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
    // M-R8: wipe the session on a connection-mode switch (re-auth required).
    modeSwitch(): Promise<AuthState>;
    onStateChanged(cb: (state: AuthState) => void): () => void;
  };

  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(cb: (next: AppSettings) => void): () => void;
  };

  lock: {
    getState(): Promise<AppLockState>;
    setPin(pin: string): Promise<SetPinResult>;
    verifyPin(pin: string): Promise<VerifyPinResult>;
    clearPin(): Promise<{ ok: boolean }>;
    lockNow(): Promise<{ ok: boolean }>;
    onStateChanged(cb: (state: AppLockState) => void): () => void;
  };

  diagnostics: {
    getRecentLogs(maxLines?: number): Promise<string>;
  };

  print: {
    receipt(saleId: number): Promise<PrintReceiptResult>;
    testPage(): Promise<PrintReceiptResult>;
    zReport(date?: string): Promise<PrintReceiptResult>;
  };

  update: {
    checkNow(): Promise<CheckNowResult>;
    openDownload(url: string): Promise<{ ok: boolean; message?: string }>;
    installNow(): Promise<{ ok: boolean; message?: string }>;
    onStatusChanged(cb: (status: UpdateStatus) => void): () => void;
    onManualFallback(cb: (status: UpdateStatus) => void): () => void;
  };
}

declare global {
  interface Window {
    aeris: AerisBridge;
  }
}

export {};
