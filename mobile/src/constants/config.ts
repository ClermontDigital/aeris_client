import type {ConnectionMode} from '../types/api.types';

// Auto-lock the auth session after the app has been in the background for
// this long. The user is taken back to the LoginScreen and must re-auth.
// POS devices on a shared/store-floor are the target use case — leaving the
// app open and walking away should not leave a session live indefinitely.
export const BACKGROUND_LOCK_MS = 60 * 1000; // 1 minute

export const DEFAULT_CONFIG = {
  baseUrl: 'http://localhost:8822',
  relayUrl: 'https://api.aeris.team',
  connectionMode: 'direct' as ConnectionMode,
  workspaceCode: '',
  sessionTimeout: 30, // minutes
  maxSessions: 5,
  maxPinAttempts: 3,
  pinLockoutDuration: 5 * 60 * 1000, // 5 minutes
  sessionCleanupDays: 3,
  enableSessionManagement: false,
};

export const STORAGE_KEYS = {
  SETTINGS: 'aeris_settings',
  SESSIONS: 'aeris_sessions',
  ACTIVE_SESSION: 'aeris_active_session',
  ENCRYPTION_KEY: 'aeris_encryption_key',
  PIN_ATTEMPTS: 'aeris_pin_attempts',
};

/**
 * Normalize a base URL by stripping trailing slashes.
 * Prevents double-slash issues when appending paths (e.g. baseUrl + '/api/...').
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Validate a workspace code against the gateway regex.
 * Returns null when valid, or a friendly error message string otherwise.
 *
 * Mirrors the gateway-side rule: 3–32 chars, must start with an alphanumeric
 * character, lowercase letters/digits/dashes only. Reserved-name deny-list
 * (e.g. 'admin', 'api', 'auth') is enforced server-side; the gateway returns
 * `workspace_unknown` for those.
 *
 * Does not mutate or trim input — callers (e.g. settingsStore) handle
 * trim/lowercase before invoking this validator.
 */
export function validateWorkspaceCode(code: string): string | null {
  if (!code || code.trim().length === 0) {
    return 'Workspace code is required.';
  }
  if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(code)) {
    return 'Workspace code must be 3–32 characters: lowercase letters, numbers, and dashes; cannot start with a dash.';
  }
  return null;
}

import {Platform} from 'react-native';

/**
 * Resolve 'localhost' to a routable IP for the current platform.
 * - iOS Simulator shares the host network but may resolve localhost to IPv6 ::1,
 *   so we use 127.0.0.1 instead.
 * - Android Emulator has its own network stack; 10.0.2.2 is the special alias
 *   for the host machine's loopback.
 */
export function resolveFetchUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
      return parsed.toString();
    }
  } catch { /* pass through */ }
  return url;
}
