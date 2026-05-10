import { BrowserWindow, shell } from 'electron';
import path from 'path';
import { logger } from './logger';

// Window factory. Renderer security is locked down per the plan:
// - contextIsolation: true (no shared globals between main / renderer)
// - nodeIntegration: false (renderer can't require())
// - sandbox: true (renderer process is OS-level sandboxed)
// - webSecurity: true (default; same-origin enforcement)
// CSP is set via <meta> tag in index.html with connect-src 'none' so the
// renderer can NEVER make outbound network requests — all relay traffic
// goes through main.

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Aeris',
    backgroundColor: '#fdf0d5', // CREAM, matches theme background
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Open external links in the system browser, never in the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      // Promise rejection should not crash the main process (#L1).
      void shell
        .openExternal(url)
        .catch((e) => logger.warn('[window] openExternal failed', e));
    }
    return { action: 'deny' };
  });

  // Localhost is only ever a valid renderer origin in dev (Vite dev
  // server). Packaged builds load file:// and must reject loopback URLs.
  const isDev = !!process.env['ELECTRON_RENDERER_URL'];
  win.webContents.on('will-navigate', (e, url) => {
    // Block in-window navigation to anywhere except the loaded app URL.
    // The renderer is a SPA — react-router handles in-app navigation
    // without firing will-navigate.
    const allowed =
      url.startsWith('file://') ||
      (isDev &&
        (url.startsWith('http://localhost:') ||
          url.startsWith('http://127.0.0.1:')));
    if (!allowed) {
      e.preventDefault();
      // Same defensive pattern as the windowOpenHandler above (#L1).
      void shell
        .openExternal(url)
        .catch((err) => logger.warn('[window] openExternal failed', err));
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    // Auto-open devtools in dev so renderer console errors are visible
    // without the user hunting for the menu shortcut.
    if (process.env['ELECTRON_RENDERER_URL']) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  return win;
}

export async function loadRenderer(win: BrowserWindow): Promise<void> {
  // electron-vite injects ELECTRON_RENDERER_URL during `npm run dev` (Vite
  // dev server). In packaged / preview builds we load the built HTML.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}
