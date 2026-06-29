jest.mock('electron');

// Exercises the will-navigate cross-target security boundary (main.js:117-140
// → isNavigationAllowed). This is THE webview-wrapper boundary: after a
// cloud↔local DR switch the active target host changes, so in-app navigation
// must follow it (NAS host in local mode, cloud host in cloud mode) while every
// other host is blocked + handed to the system browser.
//
// main.js skips its app.whenReady() bootstrap under NODE_ENV='test' (jest sets
// this by default), so requiring it here only loads the pure helpers.
const { isNavigationAllowed } = require('../main');

describe('main.js will-navigate cross-target guard', () => {
  const NAS = 'https://192.168.1.10:8822';
  const CLOUD = 'https://aeris.example.com';

  describe("routingMode: 'local' (active target = NAS)", () => {
    test('ALLOWS navigation to the NAS host', () => {
      expect(isNavigationAllowed(`${NAS}/dashboard`, NAS)).toBe(true);
    });

    test('BLOCKS navigation to the cloud host', () => {
      expect(isNavigationAllowed(`${CLOUD}/dashboard`, NAS)).toBe(false);
    });

    test('BLOCKS navigation to an unrelated host', () => {
      expect(isNavigationAllowed('https://evil.example.org/phish', NAS)).toBe(
        false,
      );
    });
  });

  describe("routingMode: 'cloud' (active target = cloud)", () => {
    test('ALLOWS navigation to the cloud host', () => {
      expect(isNavigationAllowed(`${CLOUD}/dashboard`, CLOUD)).toBe(true);
    });

    test('BLOCKS navigation to the NAS host', () => {
      expect(isNavigationAllowed(`${NAS}/dashboard`, CLOUD)).toBe(false);
    });

    test('BLOCKS navigation to an unrelated host', () => {
      expect(isNavigationAllowed('https://evil.example.org/phish', CLOUD)).toBe(
        false,
      );
    });
  });

  test('BLOCKS a malformed navigation URL (fail-closed)', () => {
    expect(isNavigationAllowed('not-a-url', NAS)).toBe(false);
  });

  test('BLOCKS when the active target URL is malformed (fail-closed)', () => {
    expect(isNavigationAllowed(`${NAS}/x`, 'garbage')).toBe(false);
  });
});
