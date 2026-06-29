import {isLocalUrlSafeForCache} from '../constants/config';

// DR `local_url` cache-path validation (§15-2 / §22.5 Q6). This is the
// stricter sibling of isSignedUrlSafe: the value becomes the Direct baseUrl
// the till re-authenticates against during an outage, so a poisoned/loopback/
// bridge value is a credential-harvest primitive and must be refused.
describe('isLocalUrlSafeForCache', () => {
  it('accepts https to RFC1918 private IPs', () => {
    expect(isLocalUrlSafeForCache('https://192.168.1.10:8822')).toBe(true);
    expect(isLocalUrlSafeForCache('https://10.50.0.5')).toBe(true);
    expect(isLocalUrlSafeForCache('https://10.0.0.5')).toBe(true);
    expect(isLocalUrlSafeForCache('https://192.168.1.2')).toBe(true);
    expect(isLocalUrlSafeForCache('https://172.16.0.1')).toBe(true);
    expect(isLocalUrlSafeForCache('https://172.31.255.254')).toBe(true);
  });

  it('accepts https to a SINGLE-LABEL .local hostname only', () => {
    expect(isLocalUrlSafeForCache('https://aeris.local')).toBe(true);
    expect(isLocalUrlSafeForCache('https://aeris.local:8822/api')).toBe(true);
  });

  it('rejects multi-label .local names (the evil.com.local redirect vector)', () => {
    // Plain `.endsWith('.local')` accepted these; the value becomes the Direct
    // baseUrl the till re-authenticates against, so a public-domain-shaped
    // `.local` name is a credential-harvest primitive. Exactly one label only.
    expect(isLocalUrlSafeForCache('https://evil.com.local')).toBe(false);
    expect(isLocalUrlSafeForCache('https://a.b.local')).toBe(false);
    expect(isLocalUrlSafeForCache('https://aeris.shop.local')).toBe(false);
  });

  it('rejects plain http even to a private LAN target', () => {
    // No http carve-out on the DR path — the LAN endpoint must terminate TLS.
    expect(isLocalUrlSafeForCache('http://192.168.1.10:8822')).toBe(false);
    expect(isLocalUrlSafeForCache('http://aeris.local:8000')).toBe(false);
    expect(isLocalUrlSafeForCache('http://aeris.local')).toBe(false);
  });

  it('rejects loopback / localhost (the APP_URL default-value footgun, §15-3)', () => {
    expect(isLocalUrlSafeForCache('https://localhost:8822')).toBe(false);
    expect(isLocalUrlSafeForCache('https://127.0.0.1:8822')).toBe(false);
    expect(isLocalUrlSafeForCache('https://[::1]:8822')).toBe(false);
    expect(isLocalUrlSafeForCache('https://10.0.2.2:8822')).toBe(false);
  });

  it('rejects the Docker bridge ranges 172.17/16 + 172.18/16 (§22.5 Q6)', () => {
    expect(isLocalUrlSafeForCache('https://172.17.0.2:8822')).toBe(false);
    expect(isLocalUrlSafeForCache('https://172.17.0.1')).toBe(false);
    expect(isLocalUrlSafeForCache('https://172.18.0.5')).toBe(false);
    // ...but a neighbouring RFC1918 172.x that is NOT a bridge range stays ok.
    expect(isLocalUrlSafeForCache('https://172.16.0.1')).toBe(true);
    expect(isLocalUrlSafeForCache('https://172.20.0.1')).toBe(true);
  });

  it('normalizes IPv4-mapped IPv6 literals and classifies by the v4', () => {
    // ::ffff:192.168.1.2 → 192.168.1.2 (private) accepted; mapped public/bridge
    // and non-mapped IPv6 literals rejected.
    expect(isLocalUrlSafeForCache('https://[::ffff:192.168.1.2]:8822')).toBe(
      true,
    );
    expect(isLocalUrlSafeForCache('https://[::ffff:8.8.8.8]')).toBe(false);
    expect(isLocalUrlSafeForCache('https://[::ffff:172.17.0.1]')).toBe(false);
    expect(isLocalUrlSafeForCache('https://[fe80::1]')).toBe(false);
  });

  it('rejects publicly-routable hosts and external names', () => {
    expect(isLocalUrlSafeForCache('https://8.8.8.8')).toBe(false);
    expect(isLocalUrlSafeForCache('https://172.32.0.1')).toBe(false);
    expect(isLocalUrlSafeForCache('https://aeris.team')).toBe(false);
    expect(isLocalUrlSafeForCache('https://aeris.evil.com')).toBe(false);
  });

  it('rejects credentials embedded in the URL', () => {
    expect(isLocalUrlSafeForCache('https://user:pass@192.168.1.10:8822')).toBe(
      false,
    );
  });

  it('rejects empty / malformed input', () => {
    expect(isLocalUrlSafeForCache('')).toBe(false);
    expect(isLocalUrlSafeForCache('not a url')).toBe(false);
    expect(isLocalUrlSafeForCache('javascript:alert(1)')).toBe(false);
  });

  // §24.2 / M-R2 convergence: the WHATWG URL parser CANONICALIZES alternate
  // IPv4 encodings + trailing-dot into a dotted-quad, so without the raw-host
  // pre-check these would launder into 127.0.0.1 / 192.168.1.10 and slip past.
  // The PHP/Go validators reject all of these; mobile must too.
  it('rejects alternate IPv4 encodings (decimal/hex/octal/short)', () => {
    // 2130706433 === 127.0.0.1 (decimal); a poisoned self-report disguise.
    expect(isLocalUrlSafeForCache('https://2130706433')).toBe(false);
    // hex forms
    expect(isLocalUrlSafeForCache('https://0x7f000001')).toBe(false);
    expect(isLocalUrlSafeForCache('https://0x7f.0.0.1')).toBe(false);
    // octal / leading-zero octets
    expect(isLocalUrlSafeForCache('https://0177.0.0.1')).toBe(false);
    expect(isLocalUrlSafeForCache('https://0300.0250.0.1')).toBe(false);
    // short forms
    expect(isLocalUrlSafeForCache('https://127.1')).toBe(false);
    expect(isLocalUrlSafeForCache('https://192.168.257')).toBe(false);
    // a decimal that canonicalizes to a private IP must STILL be rejected
    // (not strict dotted-quad) — 3232235778 === 192.168.1.2.
    expect(isLocalUrlSafeForCache('https://3232235778')).toBe(false);
  });

  it('rejects a trailing-dot host (the parser silently strips it)', () => {
    expect(isLocalUrlSafeForCache('https://192.168.1.10.')).toBe(false);
    expect(isLocalUrlSafeForCache('https://aeris.local.')).toBe(false);
  });

  it('still accepts genuine strict dotted-quad after the convergence check', () => {
    // Guard against the raw-host pre-check over-rejecting valid addresses.
    expect(isLocalUrlSafeForCache('https://192.168.1.10:8822')).toBe(true);
    expect(isLocalUrlSafeForCache('https://10.0.0.5')).toBe(true);
  });
});
