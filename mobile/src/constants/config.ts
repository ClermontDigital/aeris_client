import type {ConnectionMode} from '../types/api.types';

export {validateWorkspaceCode} from '@aeris/shared';

export const DEFAULT_CONFIG = {
  baseUrl: 'http://localhost:8822',
  relayUrl: 'https://api.aeris.team',
  // Default to relay (cloud) so a fresh install reaches a working
  // endpoint on first launch. Direct mode is the on-premises path —
  // valid for merchants self-hosting AERIS on their LAN, but the
  // default localhost:8822 baseUrl above would just produce a network
  // error for a brand-new user. Direct stays selectable in Settings;
  // it's just no longer the cold-start default. Changed for the App
  // Store reviewer flow; an Apple reviewer who skipped the submission
  // notes was hitting a broken first-launch on Direct mode.
  connectionMode: 'relay' as ConnectionMode,
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
  // M3-D — automated client failover ships DARK. Default OFF on every build;
  // never auto-enabled by any deployment (§3 guardrail 2). Flipping this on is
  // a separate, proof-gated (§6) per-deployment event.
  autoFailoverEnabled: false,
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

// The Docker bridge ranges the Aeris2 container sees on the Synology profile
// (docker-compose.synology.yml uses `driver: bridge`). A blind self-report
// would ship the container's `172.17.x`/`172.18.x` bridge IP — which is the
// box talking about ITSELF on its internal Docker network, not a LAN address
// any till can reach. §22.5 Q6 / §15-3: these MUST be rejected on the DR
// cache path even though 172.16.0.0/12 is otherwise a valid RFC1918 range.
function isDockerBridge(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\./);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 172 && (b === 17 || b === 18);
}

// Decode an IPv4-mapped IPv6 literal's trailing 32 bits to dotted-quad form.
// Accepts both the textual `::ffff:a.b.c.d` and the URL-parser-normalized
// hex form `::ffff:hhhh:hhhh` (e.g. `::ffff:c0a8:102`). Returns the IPv4
// string or null if it is not a `::ffff:`-mapped literal.
function mappedV4(inner: string): string | null {
  const prefix = '::ffff:';
  if (!inner.startsWith(prefix)) return null;
  const suffix = inner.slice(prefix.length);
  // Already dotted-quad.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(suffix)) return suffix;
  // Hex form: one or two 16-bit groups (a single group covers values < 0x10000,
  // e.g. `::ffff:102` for 0.0.1.2). Reconstruct the 32-bit value.
  const groups = suffix.split(':');
  if (groups.length < 1 || groups.length > 2) return null;
  if (!groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const hi = groups.length === 2 ? parseInt(groups[0], 16) : 0;
  const lo = parseInt(groups[groups.length - 1], 16);
  const value = hi * 0x10000 + lo;
  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  const c = (value >>> 8) & 0xff;
  const d = value & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

// Stricter sibling of isSignedUrlSafe, for the DR `local_url` cache path
// (§15-2 / §22.5 Q6). The served `local_url` becomes the Direct `baseUrl`
// the device fails over to and RE-AUTHENTICATES against during an outage —
// so a poisoned value is a direct credential-harvest primitive. We therefore
// validate it FAR more strictly than the read-only signed-URL accept-list:
//
//   - HTTPS only. The DR LAN endpoint terminates TLS (§14.5/§22.2 — LE
//     DNS-01 + split-horizon, SPKI-pinned). Plain http is refused outright;
//     unlike isSignedUrlSafe there is no http-for-LAN carve-out here.
//   - Host must be a private LAN target: RFC1918 (10/8, 172.16-31/12,
//     192.168/16) OR a `.local` mDNS/split-horizon name.
//   - REJECT loopback / localhost (the §15-3 default-value footgun:
//     APP_URL defaults to http://localhost:8822 → a blind self-report would
//     point every till at itself) and the Android-emulator host alias.
//   - REJECT the Docker bridge ranges 172.17/16 + 172.18/16 (the container's
//     view of its own bridge network — never a reachable LAN address).
//   - REJECT credentials embedded in the URL.
//
// This mirrors the gateway-side ingest validation (§15-2): the same shape is
// rejected at BOTH ingest and cache ("and", not "or" — §22.5 Q6). When the
// public-DNS split-horizon names from §22.2 land, allow them here too (they
// resolve to the private IP on-LAN); until then `.local` covers the pilot.
// Convergence with the PHP/Go validators (§24.2 / M-R2). The WHATWG `URL`
// parser CANONICALIZES alternate IPv4 encodings — decimal (`2130706433`), hex
// (`0x7f000001`), octal (`0177.0.0.1`), short (`127.1`) — and strips a trailing
// dot, so `parsed.hostname` would read `127.0.0.1` for inputs the PHP/Go copies
// REJECT outright. To keep all three validators in lockstep we inspect the RAW
// host (lifted from the original URL string, before canonicalization) and:
//   - reject a trailing-dot host (`192.168.1.10.`),
//   - reject any host that "looks IPv4-ish" (purely numeric, contains `0x`/`0X`,
//     or is dot-separated numerics) UNLESS it is strict dotted-quad
//     `d.d.d.d` with every octet 0-255 and no leading-zero octets.
// A non-IPv4-shaped host (a `.local` name, a hostname) passes through to the
// WHATWG-parsed checks below unchanged.
function rawHostFromUrl(url: string): string | null {
  // scheme://[user[:pass]@]host[:port][/...?#]
  const m = url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/);
  if (!m) return null;
  let authority = m[1];
  // Drop userinfo (credentials are rejected separately below, but strip here so
  // the host extraction is correct when they're present).
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  // Bracketed IPv6 literal — host is everything up to the closing bracket.
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end === -1 ? null : authority.slice(0, end + 1);
  }
  // Strip port (the last colon-delimited numeric segment).
  const colon = authority.lastIndexOf(':');
  if (colon !== -1) authority = authority.slice(0, colon);
  return authority;
}

function rawIpv4HostAcceptable(rawHost: string): boolean | null {
  // Returns: true = valid strict dotted-quad, false = an IPv4-ish host that is
  // NOT strict dotted-quad (reject), null = not IPv4-shaped (defer to other
  // checks).
  const host = rawHost.toLowerCase();
  // Trailing dot → reject (the WHATWG parser would silently strip it).
  if (host.endsWith('.')) return false;
  // Hex anywhere → an alt encoding → reject.
  if (host.includes('0x')) return false;
  const parts = host.split('.');
  // "IPv4-ish" heuristic: every dot-separated part is purely numeric (covers
  // decimal `2130706433`, octal `0177.0.0.1`, short `127.1`, and genuine
  // dotted-quad). A part with a non-digit char means it's a hostname → defer.
  const allNumeric = parts.every(p => p.length > 0 && /^[0-9]+$/.test(p));
  if (!allNumeric) return null;
  // It's numeric-shaped → MUST be strict dotted-quad to be accepted.
  if (parts.length !== 4) return false;
  for (const p of parts) {
    // No leading-zero octets (octal smell), and 0-255 only.
    if (p.length > 1 && p[0] === '0') return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

export function isLocalUrlSafeForCache(url: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // HTTPS only — no LAN http carve-out on the DR cache path.
  if (parsed.protocol !== 'https:') return false;
  // §24.2 / M-R2 convergence: reject alt-encoded IPv4 + trailing-dot BEFORE the
  // WHATWG parser's canonicalized hostname can launder them into a dotted-quad
  // that passes the RFC1918 check below. Inspect the raw host string.
  const rawHost = rawHostFromUrl(url);
  if (rawHost === null) return false;
  const ipv4Verdict = rawIpv4HostAcceptable(rawHost);
  if (ipv4Verdict === false) return false;
  // Credentials-in-URL are a redirect/exfil smell — refuse.
  if (parsed.username || parsed.password) return false;
  let host = parsed.hostname.toLowerCase();
  // Normalize an IPv4-mapped IPv6 literal (::ffff:a.b.c.d) to its IPv4 form so
  // it classifies on the same RFC1918 rules. The WHATWG URL parser keeps IPv6
  // literals bracketed AND compresses the dotted-quad suffix to hex — e.g.
  // `[::ffff:192.168.1.2]` → `[::ffff:c0a8:102]` — so strip the brackets and
  // decode the trailing 32 bits back to a.b.c.d. Only a mapped *private* v4
  // survives; every other IPv6 literal falls through and is rejected (RFC1918
  // / single-label-.local are the only accept paths below).
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1);
    const v4 = mappedV4(inner);
    host = v4 ?? inner;
  }
  // Loopback / emulator-host aliases: the self-report footgun (§15-3).
  if (host === 'localhost') return false;
  if (host === '127.0.0.1') return false;
  if (host === '::1') return false;
  if (host === '10.0.2.2') return false; // Android emulator → host loopback
  // Docker bridge view of the container's own network — never LAN-reachable.
  if (isDockerBridge(host)) return false;
  // Single-label `.local` mDNS name ONLY — exactly one label before `.local`
  // and no extra dots. A plain `.endsWith('.local')` accepted attacker names
  // like `evil.com.local`, which (becoming the Direct baseUrl the till
  // re-authenticates against) is a credential-harvest redirect primitive.
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.local$/.test(host)) return true;
  return isPrivateRfc1918(host);
}
