// DR NAS warm-failover LAN-target validator (main-process only, no Electron deps).
//
// Ported VERBATIM from aeris_client/mobile/src/constants/config.ts
// (isLocalUrlSafeForCache + rawHostFromUrl, rawIpv4HostAcceptable,
//  isPrivateRfc1918, isDockerBridge, mappedV4).
//
// The served/typed `localUrl` becomes the in-store (NAS) target the webview
// loads and RE-AUTHENTICATES against during an outage — so a poisoned value is
// a direct credential-harvest primitive. We therefore validate it FAR more
// strictly than a lax http/https check:
//
//   - HTTPS only. The DR LAN endpoint terminates TLS. Plain http is refused
//     outright; no LAN http carve-out here.
//   - Host must be a private LAN target: RFC1918 (10/8, 172.16-31/12,
//     192.168/16) OR a single-label `.local` mDNS/split-horizon name.
//   - REJECT loopback / localhost (the default-value footgun) and the
//     Android-emulator host alias.
//   - REJECT the Docker bridge ranges 172.17/16 + 172.18/16 (the container's
//     view of its own bridge network — never a reachable LAN address).
//   - REJECT credentials embedded in the URL.
//   - REJECT alt-encoded IPv4 (hex/octal/decimal/short) + trailing-dot, which
//     the WHATWG URL parser would otherwise launder into a dotted-quad.

// Match the three RFC1918 ranges exactly: 10.0.0.0/8, 172.16.0.0/12,
// 192.168.0.0/16. We accept literal-IPv4 only (cheap, predictable).
function isPrivateRfc1918(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(n => Number(n));
  if ([a, b, c, d].some(n => n < 0 || n > 255 || Number.isNaN(n))) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

// The Docker bridge ranges the Aeris2 container sees on the Synology profile.
// A blind self-report would ship the container's 172.17.x/172.18.x bridge IP —
// the box talking about ITSELF on its internal Docker network, not a LAN
// address any till can reach. These MUST be rejected even though 172.16.0.0/12
// is otherwise a valid RFC1918 range.
function isDockerBridge(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\./);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 172 && (b === 17 || b === 18);
}

// Decode an IPv4-mapped IPv6 literal's trailing 32 bits to dotted-quad form.
// Accepts both the textual `::ffff:a.b.c.d` and the URL-parser-normalized hex
// form `::ffff:hhhh:hhhh` (e.g. `::ffff:c0a8:102`). Returns the IPv4 string or
// null if it is not a `::ffff:`-mapped literal.
function mappedV4(inner) {
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

// Lift the RAW host from the original URL string, BEFORE the WHATWG parser can
// canonicalize alternate IPv4 encodings or strip a trailing dot.
function rawHostFromUrl(url) {
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

function rawIpv4HostAcceptable(rawHost) {
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

function isLocalUrlSafeForCache(url) {
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // HTTPS only — no LAN http carve-out on the DR cache path.
  if (parsed.protocol !== 'https:') return false;
  // Reject alt-encoded IPv4 + trailing-dot BEFORE the WHATWG parser's
  // canonicalized hostname can launder them into a dotted-quad that passes the
  // RFC1918 check below. Inspect the raw host string.
  const rawHost = rawHostFromUrl(url);
  if (rawHost === null) return false;
  const ipv4Verdict = rawIpv4HostAcceptable(rawHost);
  if (ipv4Verdict === false) return false;
  // Credentials-in-URL are a redirect/exfil smell — refuse.
  if (parsed.username || parsed.password) return false;
  let host = parsed.hostname.toLowerCase();
  // Normalize an IPv4-mapped IPv6 literal (::ffff:a.b.c.d) to its IPv4 form so
  // it classifies on the same RFC1918 rules.
  if (host.startsWith('[') && host.endsWith(']')) {
    const inner = host.slice(1, -1);
    const v4 = mappedV4(inner);
    host = v4 ?? inner;
  }
  // Loopback / emulator-host aliases: the self-report footgun.
  if (host === 'localhost') return false;
  if (host === '127.0.0.1') return false;
  if (host === '::1') return false;
  if (host === '10.0.2.2') return false; // Android emulator → host loopback
  // Docker bridge view of the container's own network — never LAN-reachable.
  if (isDockerBridge(host)) return false;
  // Single-label `.local` mDNS name ONLY — exactly one label before `.local`.
  // A plain `.endsWith('.local')` accepted attacker names like `evil.com.local`,
  // which (becoming the target the till re-authenticates against) is a
  // credential-harvest redirect primitive.
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.local$/.test(host)) return true;
  return isPrivateRfc1918(host);
}

module.exports = { isLocalUrlSafeForCache };
