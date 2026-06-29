import { isLocalUrlSafeForCache } from '../drUrlValidator';

// Faithful-port parity tests for the DR Direct/LAN baseUrl gate. Mirrors the
// mobile + v1 validators (PROJECT_DR_NAS_WARM_FAILOVER.md §15-2 / §22.5 Q6).
// NOTE: the client jest infra is currently broken (ts-jest → jest-util
// resolution failure); this file typechecks under tsconfig.test.json and runs
// once that is repaired.

describe('isLocalUrlSafeForCache', () => {
  describe('accepts valid private LAN https targets', () => {
    const ok = [
      'https://192.168.1.10',
      'https://192.168.1.10:8822',
      'https://10.0.0.5',
      'https://172.16.0.1',
      'https://172.31.255.254',
      'https://aeris.local',
      'https://aeris.local:8822',
      'https://nas1.local',
    ];
    it.each(ok)('%s', (url) => {
      expect(isLocalUrlSafeForCache(url)).toBe(true);
    });
  });

  describe('rejects unsafe / non-LAN targets', () => {
    const bad = [
      '', // empty
      'http://192.168.1.10', // plain http — no LAN carve-out on the DR path
      'https://evil.example.com', // public host
      'https://localhost', // loopback footgun
      'https://127.0.0.1',
      'https://10.0.2.2', // Android emulator host alias
      'https://172.17.0.2', // Docker bridge
      'https://172.18.0.2', // Docker bridge
      'https://evil.com.local', // multi-label .local redirect primitive
      'https://user:pass@192.168.1.10', // credentials-in-URL
      'https://2130706433', // decimal-encoded 127.0.0.1
      'https://0x7f000001', // hex-encoded
      'https://0177.0.0.1', // octal-encoded
      'https://127.1', // short-form
      'https://192.168.1.10.', // trailing dot
      'https://[::1]', // IPv6 loopback literal
      'https://100.64.0.1', // CGNAT — not RFC1918
      'https://169.254.1.1', // link-local
      'not-a-url',
    ];
    it.each(bad)('%s', (url) => {
      expect(isLocalUrlSafeForCache(url)).toBe(false);
    });
  });

  it('accepts an IPv4-mapped IPv6 literal of a private v4', () => {
    expect(isLocalUrlSafeForCache('https://[::ffff:192.168.1.2]')).toBe(true);
  });
});
