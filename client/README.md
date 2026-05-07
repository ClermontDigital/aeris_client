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
- Cross-platform via electron-builder: macOS (dmg + zip, signed +
  notarised), Windows (nsis), Linux (AppImage + deb).

See `CLAUDE.md` for the full architectural notes.

## Build

```sh
# Production renderer + main + preload bundle (electron-vite → out/).
npm run build

# Local platform packaging (electron-builder reads electron-builder.yml).
npm run package:mac     # dmg + zip (x64 + arm64)
npm run package:win     # nsis (x64)
npm run package:linux   # AppImage + deb (x64)

# CI runs the same flow per platform — see .github/workflows/build-release.yml.
```

The mac package step requires a valid Apple Developer account with the
following env vars (already wired into CI as repo secrets):

- `CSC_LINK` — base64-encoded Developer ID Application certificate
- `CSC_KEY_PASSWORD` — keystore password
- `APPLE_ID` — Apple ID for notarization
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password
- `APPLE_TEAM_ID` — developer team identifier

For Windows code-sign, set `CSC_LINK` + `CSC_KEY_PASSWORD` (or
`WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` in CI). Without a cert, the
build still succeeds but the installer triggers a SmartScreen warning
on first launch — see *Open questions* in the project plan.

## Cutting a release

```sh
# 1. Bump version in client/package.json (semver — major if breaking).
# 2. Commit + push to main; merge into release.
# 3. Tag.
git tag client-v2.0.1
git push origin client-v2.0.1
```

The `release-client` job in `.github/workflows/build-release.yml` runs
`client-build-{mac,win,linux}` in parallel, downloads the artifacts,
and creates a GitHub Release named `Aeris X.Y.Z` tagged
`client-vX.Y.Z` with all installers, blockmaps, and
`latest-*.yml` channel manifests attached.

## Auto-update

- **Primary**: `electron-updater` polls GitHub Releases on launch and
  every 6 hours. Channel: tags matching `client-v*` on
  `ClermontDigital/aeris_client`. Updates download automatically and
  apply on next quit.
- **Manual fallback** (peer review revision #5): if `electron-updater`
  is silent for 30 s after launch, the main process polls the GitHub
  releases-latest endpoint once. If a newer version exists, the
  renderer shows a non-blocking "Aeris X.Y.Z available — Download"
  banner that opens the release page in the system browser. Guards
  against bugs in 2.0.0's auto-update path itself.
- **Linux `.deb` users**: `electron-updater` does not support `.deb`
  channels. They receive only the manual-fallback banner.
- **Linux AppImage**: auto-updates via electron-updater **only when
  launched from its install path** (an AppImage runtime quirk —
  `LD_LIBRARY_PATH` must resolve to the install directory).

## Smoke checklist

After a fresh `npm run package:<os>` install:

1. Launch app → LoginScreen.
2. Enter workspace + email + password → Dashboard renders.
3. Transactions → list renders (or empty-state).
4. Tap a sale → SaleDetail renders items + payments + totals.
5. Tap Receipt → renders.
6. Settings → toggle auto-lock → lock-now → PIN unlock.
7. Logout → relaunch → lands at LoginScreen.
8. Inside Settings, "Check for updates" surfaces the current channel
   state (idle / available / downloading / etc.).

## Known limitations (v1 Slim)

- Receipt is read-only — no print path. Documented; v1.5 ships printing.
- No QuickSale / Cart / Checkout / Customer picker — v2 (Full).
- No biometric unlock (Touch ID / Windows Hello). Post-2.0 candidate.
- Windows code-sign cert availability is an open question. Until
  resolved, 2.0.0 ships unsigned + 2.0.1 will add the cert.

