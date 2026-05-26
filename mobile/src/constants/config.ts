import type {ConnectionMode} from '../types/api.types';

export {validateWorkspaceCode} from '@aeris/shared';

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
  hapticsEnabled: true,
  // Default to persisting the session across cold starts — most users
  // expect a POS app to "stay open" until they explicitly sign out. When
  // false, the bearer token is held only in memory and the user must
  // re-authenticate after every app kill. Surfaced as a "Keep me signed in"
  // checkbox on LoginScreen.
  keepSignedIn: true,
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

// Server-rendered branded invoice PDF flow (RelayClient.getInvoicePdfUrl
// → signed URL → AirPrint / share sheet). Marketplace team shipped the
// server side and confirmed `sales.invoice-pdf-url` is live; flipped ON
// in v1.3.53. CheckoutScreen still falls back to the legacy
// `buildReceiptHtml` flow when this is false — flip back to false and
// re-ship to revert without a server rollback.
export const PDF_PRINT_ENABLED = true;

// Cloud-mode signed URLs MUST come back as HTTPS. Direct (LAN) mode is
// allowed to use plain HTTP for hostnames that are LAN-only — `.local`
// mDNS names, loopback, Android emulator host, AND RFC1918 private IP
// ranges (10.*, 172.16-31.*, 192.168.*) because many on-prem customers
// run the deployment at a fixed LAN IP without an mDNS name. Any other
// shape is refused.
export function isSignedUrlSafe(
  url: string,
  connectionMode: 'relay' | 'direct',
): boolean {
  if (!url) return false;
  if (url.startsWith('https://')) return true;
  if (connectionMode !== 'direct') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('.local')) return true;
    if (host === 'localhost') return true;
    if (host === '127.0.0.1') return true;
    if (host === '10.0.2.2') return true; // Android emulator → host
    return isPrivateRfc1918(host);
  } catch {
    return false;
  }
}

// Match the three RFC1918 ranges exactly: 10.0.0.0/8, 172.16.0.0/12,
// 192.168.0.0/16. We accept literal-IPv4 only (cheap, predictable). IPv6
// link-local could be added later if any tenant ships an on-prem box
// without a v4 LAN address — not seen in the wild today.
function isPrivateRfc1918(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(n => Number(n));
  if ([a, b, c, d].some(n => n < 0 || n > 255 || Number.isNaN(n))) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
