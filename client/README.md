# Aeris (v2)

Relay-native Electron desktop client for the Aeris ERP. Native UI, no
WebView. Successor to `archive/desktop-v1/`.

## Quick start

```sh
# From repo root, the workspace is already wired.
cd client
npm run dev    # opens Electron window with hot reload
npm test       # run unit tests
```

If `npm run dev` errors with `Cannot read properties of undefined
(reading 'requestSingleInstanceLock')`, ensure `ELECTRON_RUN_AS_NODE` is
not set in your shell.

## Architecture overview

- Main process owns the relay client, bearer token, and auth state.
- Renderer is a sandboxed React + react-router app with strict CSP
  (`connect-src 'none'`) — every relay call goes through main via the
  `relay:call` IPC.
- Cross-platform via electron-builder: macOS (dmg, signed +
  notarised), Windows (nsis), Linux (AppImage + deb).

See `CLAUDE.md` for the full architectural notes.
