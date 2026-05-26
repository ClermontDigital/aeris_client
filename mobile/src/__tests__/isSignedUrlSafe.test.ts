import {isSignedUrlSafe} from '../constants/config';

describe('isSignedUrlSafe', () => {
  describe('cloud (relay) mode', () => {
    it('accepts https URLs to any tenant subdomain', () => {
      expect(
        isSignedUrlSafe(
          'https://acme.aeris.team/api/v1/sales/123/invoice-signed.pdf?expires=1&signature=2',
          'relay',
        ),
      ).toBe(true);
      expect(
        isSignedUrlSafe(
          'https://demo.aeris.team/api/v1/sales/123/invoice-signed.pdf',
          'relay',
        ),
      ).toBe(true);
    });

    it('refuses http downgrades even to aeris.team', () => {
      expect(
        isSignedUrlSafe(
          'http://acme.aeris.team/api/v1/sales/123/invoice-signed.pdf',
          'relay',
        ),
      ).toBe(false);
    });

    it('refuses http to .local in cloud mode (paranoia)', () => {
      expect(
        isSignedUrlSafe('http://aeris.local:8000/foo.pdf', 'relay'),
      ).toBe(false);
    });

    it('refuses empty / malformed URLs', () => {
      expect(isSignedUrlSafe('', 'relay')).toBe(false);
      expect(isSignedUrlSafe('not a url', 'relay')).toBe(false);
      expect(isSignedUrlSafe('javascript:alert(1)', 'relay')).toBe(false);
    });
  });

  describe('direct (LAN) mode', () => {
    it('accepts http to *.local hosts', () => {
      expect(
        isSignedUrlSafe('http://aeris.local:8000/foo.pdf', 'direct'),
      ).toBe(true);
      expect(
        isSignedUrlSafe(
          'http://customer-ws.local/api/v1/sales/123/invoice-signed.pdf',
          'direct',
        ),
      ).toBe(true);
    });

    it('accepts https URLs in direct mode too', () => {
      expect(
        isSignedUrlSafe(
          'https://customer-ws.local/api/v1/sales/123/invoice-signed.pdf',
          'direct',
        ),
      ).toBe(true);
    });

    it('accepts loopback (dev / Android emulator)', () => {
      expect(
        isSignedUrlSafe('http://127.0.0.1:8000/foo.pdf', 'direct'),
      ).toBe(true);
      expect(
        isSignedUrlSafe('http://10.0.2.2:8000/foo.pdf', 'direct'),
      ).toBe(true);
    });

    it('accepts RFC1918 private IP ranges (on-prem at LAN IP)', () => {
      expect(
        isSignedUrlSafe('http://192.168.1.10:8000/invoice.pdf', 'direct'),
      ).toBe(true);
      expect(
        isSignedUrlSafe('http://10.50.0.5:8000/invoice.pdf', 'direct'),
      ).toBe(true);
      expect(
        isSignedUrlSafe('http://172.16.0.1/invoice.pdf', 'direct'),
      ).toBe(true);
      expect(
        isSignedUrlSafe('http://172.31.255.254/invoice.pdf', 'direct'),
      ).toBe(true);
    });

    it('refuses public IP ranges even in direct mode', () => {
      expect(
        isSignedUrlSafe('http://8.8.8.8/invoice.pdf', 'direct'),
      ).toBe(false);
      // 172.32.x.x is just outside the RFC1918 172.16-31 carve-out
      expect(
        isSignedUrlSafe('http://172.32.0.1/invoice.pdf', 'direct'),
      ).toBe(false);
    });

    it('refuses http to arbitrary external hosts even in direct mode', () => {
      expect(
        isSignedUrlSafe('http://example.com/invoice.pdf', 'direct'),
      ).toBe(false);
      expect(
        isSignedUrlSafe('http://aeris.evil.com/invoice.pdf', 'direct'),
      ).toBe(false);
    });
  });
});
