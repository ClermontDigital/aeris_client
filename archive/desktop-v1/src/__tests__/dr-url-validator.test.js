const { isLocalUrlSafeForCache } = require('../dr-url-validator');

describe('isLocalUrlSafeForCache (DR NAS LAN target validator)', () => {
  const accept = [
    ['https RFC1918 192.168/16', 'https://192.168.1.10'],
    ['https RFC1918 10/8', 'https://10.0.0.5'],
    ['https single-label .local', 'https://aeris.local'],
  ];

  const reject = [
    ['http (no LAN carve-out)', 'http://192.168.1.10'],
    ['localhost', 'https://localhost'],
    ['loopback 127.0.0.1', 'https://127.0.0.1'],
    ['docker bridge 172.17/16', 'https://172.17.0.2'],
    ['multi-label .local (evil.com.local)', 'https://evil.com.local'],
    ['public IP', 'https://93.184.216.34'],
    ['hex-encoded IPv4', 'https://0x7f000001'],
    ['decimal-encoded IPv4', 'https://2130706433'],
    ['trailing-dot host', 'https://192.168.1.10.'],
    ['IPv6 loopback literal', 'https://[::1]'],
    ['credentials in URL', 'https://user:pass@192.168.1.10'],
    ['empty string', ''],
  ];

  test.each(accept)('accepts %s', (_label, url) => {
    expect(isLocalUrlSafeForCache(url)).toBe(true);
  });

  test.each(reject)('rejects %s', (_label, url) => {
    expect(isLocalUrlSafeForCache(url)).toBe(false);
  });
});
