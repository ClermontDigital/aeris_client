jest.mock('electron');

// Exercises the will-navigate cross-target security boundary (main.js:117-140
// → isNavigationAllowed). This is THE webview-wrapper boundary: after a
// cloud↔local DR switch the active target host changes, so in-app navigation
// must follow it (NAS host in local mode, cloud host in cloud mode) while every
// other host is blocked + handed to the system browser.
//
// main.js skips its app.whenReady() bootstrap under NODE_ENV='test' (jest sets
// this by default), so requiring it here only loads the pure helpers.
const { isNavigationAllowed, decideWebviewPopup } = require('../main');

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

// Webview popup policy — the sales-view "Print Invoice" path.
// Aeris2 opens the invoice PDF via window.open('/sales/{id}/invoice.pdf', '_blank').
// The v1 webview needs allowpopups (app-wrapper.html) AND main must supply a
// setWindowOpenHandler on the webview's webContents. Same-host = allow, spawning
// a child window that inherits the webview session (cookie carries → PDF renders).
// Off-host = deny + hand off to system browser. Anything else = deny.
describe('main.js decideWebviewPopup (webview popup policy)', () => {
  const NAS = 'https://192.168.1.10:8822';
  const CLOUD = 'https://aeris.example.com';

  test('ALLOWS same-host invoice PDF popup with child-window options', () => {
    const decision = decideWebviewPopup(`${CLOUD}/sales/42/invoice.pdf?inline=1`, CLOUD);
    expect(decision.action).toBe('allow');
    expect(decision.overrideBrowserWindowOptions).toEqual(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
          enableRemoteModule: false,
        }),
      })
    );
  });

  test('ALLOWS same-host popup in local (NAS) mode too', () => {
    const decision = decideWebviewPopup(`${NAS}/sales/42/invoice.pdf?inline=1`, NAS);
    expect(decision.action).toBe('allow');
  });

  test('DENIES cross-target popup after DR switch (cloud URL while active=NAS)', () => {
    const decision = decideWebviewPopup(`${CLOUD}/sales/42/invoice.pdf`, NAS);
    expect(decision.action).toBe('deny');
    expect(decision.external).toBe(`${CLOUD}/sales/42/invoice.pdf`);
  });

  test('DENIES off-host popup + hands off to system browser', () => {
    const decision = decideWebviewPopup('https://evil.example.org/phish', CLOUD);
    expect(decision.action).toBe('deny');
    expect(decision.external).toBe('https://evil.example.org/phish');
  });

  test('DENIES javascript: scheme without external hand-off (fail-closed)', () => {
    const decision = decideWebviewPopup('javascript:alert(1)', CLOUD);
    expect(decision.action).toBe('deny');
    expect(decision.external).toBeNull();
  });

  test('DENIES file: scheme without external hand-off', () => {
    const decision = decideWebviewPopup('file:///etc/passwd', CLOUD);
    expect(decision.action).toBe('deny');
    expect(decision.external).toBeNull();
  });

  test('DENIES malformed URL fail-closed', () => {
    const decision = decideWebviewPopup('not-a-url', CLOUD);
    expect(decision.action).toBe('deny');
    expect(decision.external).toBeNull();
  });

  // Aeris2 opens blank popups then doc.write from the opener in 4 modals:
  // RemittanceStatementModal, RepairBarcodeModal, LabelPrintModal, POS/
  // ReceiptModal fallback. Same-origin by construction — no navigation.
  test('ALLOWS empty URL (doc.write popup pattern)', () => {
    const decision = decideWebviewPopup('', CLOUD);
    expect(decision.action).toBe('allow');
    expect(decision.overrideBrowserWindowOptions).toBeDefined();
  });

  test('ALLOWS about:blank (doc.write popup pattern)', () => {
    const decision = decideWebviewPopup('about:blank', CLOUD);
    expect(decision.action).toBe('allow');
    expect(decision.overrideBrowserWindowOptions).toBeDefined();
  });
});
