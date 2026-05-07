# CLAUDE.md — `client/` (Aeris v2)

This file is for Claude Code (claude.ai/code) and future agents working in
`aeris_client/client/`. It explains the architecture, build, and the
non-obvious constraints that distinguish this directory from the
archived v1 desktop wrapper.

## What this is

`client/` is **Aeris v2** — a relay-native Electron desktop client.
Successor to `archive/desktop-v1/` (which was a WebView wrapper around
the on-prem Aeris2 web UI). v2 renders native UI in the renderer and
talks to the Aeris ERP server via the marketplace relay only — there is
no WebView and no on-prem direct mode.

## Tech stack

- **Electron 33+** with `electron-vite` for main / preload / renderer
  build splits.
- **React 18 + TypeScript** in the renderer.
- **Zustand** stores (`authStore`, `settingsStore`, `appLockStore`).
- **react-router v6** (HashRouter) for navigation.
- **Jest + RTL** for unit tests.
- **`@aeris/shared`** for the relay client, types, and normalizers
  (workspace package at `aeris_client/shared/`).

## Architecture rules

### Token confinement

The bearer token **never** crosses the IPC boundary into the renderer.
`main/relayBridge.ts` owns the singleton `RelayClient` from
`@aeris/shared`; the renderer issues calls via the typed `relay:call`
IPC. Token persistence uses Electron `safeStorage` with electron-store —
on Linux without a secret-service daemon, falls back to plaintext with a
one-time warning.

### Renderer security (strict CSP)

`src/renderer/index.html` declares:
```
Content-Security-Policy:
  default-src 'self';
  connect-src 'none';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
```

`connect-src 'none'` means the renderer **cannot** make outbound network
requests at all — every relay call goes through main. `BrowserWindow`
uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

The renderer never imports `@aeris/shared` runtime values. Type-only
imports are fine.

### Auth + 401 vs network distinction

`main/authManager.ts` is the single source of truth for auth state.
Renderer mirrors via `auth:get-state` + the `auth:state-changed` event.

- **HTTP 401** → token wiped, renderer routed to `/login` with
  `errorKind: 'expired'`.
- **Network / timeout** → renderer shows transient banner, session
  preserved. Distinguished via `errorKind: 'network'`.

### IPC payload-size budget

`src/shared-types/ipc.ts` exports `PAYLOAD_SIZE_BUDGET_BYTES = 200 KB`.
`main/relayBridge.ts` rejects oversize payloads with code
`PAYLOAD_TOO_LARGE` before they hit the relay.

## Directory layout

```
client/
  package.json                  # name "aeris-client", version 2.0.0
  electron-vite.config.ts       # main + preload + renderer split
  electron-builder.yml          # SKELETON — Phase 4 finalises sign/notary/updater
  build/entitlements.mac.plist  # macOS hardened runtime entitlements
  src/
    main/                       # Electron main process
      index.ts                  # lifecycle, single-instance lock
      window.ts                 # BrowserWindow factory
      ipc.ts                    # registers all IPC channels
      tokenStore.ts             # safeStorage + electron-store
      relayBridge.ts            # owns RelayClient, exposes relay:call
      authManager.ts            # owns auth state, login/logout/restore
      settingsStore.ts          # workspace, relayUrl, autoLockMs, lockEnabled
      logger.ts                 # electron-log + token redaction
    preload/
      index.ts                  # contextBridge → window.aeris
      types.ts                  # AerisBridge API shape
    renderer/                   # React app
      main.tsx                  # entry
      App.tsx                   # boot guard + Routes
      theme/{tokens,global.css} # CREAM/NAVY/CRIMSON brand palette
      router/Routes.tsx         # auth + lock guards
      stores/                   # Zustand stores (mirror main state)
      services/relay.ts         # thin IPC wrapper for relay:call
      components/               # AppShell, Sidebar, TopBar, Button, ...
      screens/                  # placeholders (Phase 3 builds real impls)
      hooks/useDebounce.ts
    shared-types/               # IPC channel + event names + payload budget
```

## Commands

```sh
# Dev: electron-vite watches main/preload/renderer + spawns Electron.
npm run dev

# Build production bundles.
npm run build

# Tests (Jest + RTL).
npm test
npm run test:coverage

# Typecheck both projects.
npm run typecheck

# Package for distribution (Phase 4 finalises signing/notarisation).
npm run package:mac
npm run package:win
npm run package:linux
```

## Gotchas

- **`ELECTRON_RUN_AS_NODE`** must NOT be set when running `npm run dev`.
  If set, Electron runs as plain Node and `require('electron')` returns
  the path string instead of the API. If `npm run dev` errors with
  `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`,
  unset that env var.
- **electron-store v10 is ESM-only** and calls `app.getName()` in its
  constructor, which throws before `app.whenReady()`. Both
  `tokenStore.ts` and `settingsStore.ts` defer `new Store(...)` until
  the first read/write to dodge this.
- **`@aeris/shared`** uses TS sources directly (`main: src/index.ts`)
  for both Vite (client) and Metro (mobile). Do not change to a built
  `dist/` `main` without verifying both bundlers can statically resolve
  the named re-exports — Rollup chokes on TypeScript's `__exportStar`
  output with "X is not exported".

## Test layout

- `src/main/__tests__/*.test.ts` — main process unit tests (use the
  electron / electron-store / electron-log mocks under `__mocks__/`).
- `src/renderer/__tests__/*.test.tsx` — renderer unit tests, jsdom
  environment. Stub `window.aeris` per-test.

## What still needs to happen (Phases 3 → 5)

| Phase | Scope |
|------|------|
| 3 | Auth UI, settings UI, PIN setup + AppLock, Dashboard, Transactions, SaleDetail, Receipt (read-only) |
| 4 | electron-builder finalisation, code-sign, notarise, auto-update + manual-poll fallback |
| 5 | Final v1 banner release; archive v1 |

See `/Users/developersteve/.claude/plans/now-i-want-you-effervescent-reddy.md`
for the full plan.
