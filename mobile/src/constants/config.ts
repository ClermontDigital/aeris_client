export const DEFAULT_CONFIG = {
  baseUrl: 'http://localhost:8822',
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
