# CLAUDE.md

Guidance for Claude Code (claude.ai/code) and future agents working
in this repository.

## Project shape

`aeris_client/` is an npm-workspace monorepo. Three active packages
plus one archived:

- `shared/` (`@aeris/shared`) — contract layer for both apps:
  RelayClient, types, normalizers.
- `client/` — **Aeris v2**, the relay-native Electron 33 desktop
  client (React + Vite + Zustand + react-router HashRouter). Native
  UI; no WebView. Talks to the Aeris ERP server only via the
  marketplace relay.
- `mobile/` — Expo SDK 55 / React Native iOS + Android app. Native
  POS screens. The relay path now lives in `@aeris/shared`.
- `archive/desktop-v1/` — frozen v1 (WebView wrapper around the
  Aeris2 web UI). Excluded from workspaces. Built only on demand via
  the `archive-build-v1` workflow_dispatch for security patches.

## Commands

```bash
# Install everything from the repo root.
npm ci

# Across all workspaces.
npm run test:all
npm run typecheck      # tsc --build (shared + client; composite)

# Mobile is not a composite project — typecheck it directly.
cd mobile && npx tsc --noEmit
```

### Aeris v2 client (`cd client`)

- `npm run dev` — electron-vite dev with DevTools.
- `npm test` — Jest + RTL.
- `npm run build` — production main + preload + renderer bundles
  to `out/`. `package.json#main` points at `out/main/index.js`;
  `electron-builder.yml#files` lists `out/**`. All three must agree.
- `npm run package:mac|win|linux` — electron-builder. macOS path
  signs + notarises (`mac.notarize: true`); APPLE_ID /
  APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID env vars are required.

### Mobile (`cd mobile`)

- `npx expo start` — Expo dev server.
- `npm test` — Jest.
- **iOS production builds** run on Xcode Cloud (configured at
  `mobile/ios/ci_scripts/ci_post_clone.sh`). Triggered on push to the
  `release` branch; auto-submits to TestFlight. CFBundleVersion is
  stamped from `CI_BUILD_NUMBER`.
- **Android production builds** run in GitHub Actions
  (`.github/workflows/android-build.yml`, native Gradle, no EAS).
  Triggered by `workflow_dispatch` or a `mobile-v*` tag push. Outputs
  signed APK + AAB as workflow artifacts; optional Play submission
  via `fastlane supply` when `submit=true`. `versionCode` is stamped
  from `GITHUB_RUN_NUMBER`.

## CI/CD

`.github/workflows/build-release.yml` is path-filtered (dorny/paths-filter).

| Trigger                                | Jobs                                |
|----------------------------------------|-------------------------------------|
| `shared/**`                            | shared-test                         |
| `client/**` or `shared/**`             | client-test, client-build-{mac,win,linux} |
| `mobile/**` or `shared/**`             | mobile-typecheck, test-mobile (Jest + typecheck only; iOS production builds run on Xcode Cloud, Android on `android-build.yml`) |
| `archive/desktop-v1/**` + dispatch     | archive-build-v1                    |

Per-app release tagging:

| Tag prefix             | Effect                                            |
|------------------------|---------------------------------------------------|
| `client-vX.Y.Z`        | Cut Aeris v2 GitHub Release (dmg/zip/exe/AppImage/deb + electron-updater channel manifests) |
| `mobile-vX.Y.Z`        | Triggers `android-build.yml` (signed APK + AAB artifacts). iOS uses its own Xcode Cloud trigger on `release` branch push. |
| `desktop-v1-vX.Y.Z`    | Archived v1 security-patch GitHub Release        |

Required secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_ID_PASS`, `APPLE_TEAM_ID` (desktop signing/notarization);
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (Android signing);
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (only when submitting to Play).
Optional `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`.

Branch strategy:

- `main` — development, no automation (typecheck + tests run locally).
- `release` — push merges trigger CI; tag pushes trigger releases.

## Architecture (Aeris v2 client)

See `client/CLAUDE.md` for the full picture. Key invariants:

- **Token confinement.** The bearer token never crosses the IPC
  boundary into the renderer. `client/src/main/relayBridge.ts` owns
  the singleton RelayClient; the renderer issues calls via the typed
  `relay:call` IPC.
- **Strict CSP.** The renderer's HTML declares
  `connect-src 'none'`; every relay call goes through main. Do not
  loosen.
- **Single source of truth for auth.** `main/authManager.ts` holds
  state; renderer mirrors via `auth:get-state` + `auth:state-changed`.
- **401 vs network distinction.** 401 wipes the session and routes
  to `/login` with `errorKind: 'expired'`. Network errors keep the
  session and surface a transient banner.
- **PAYLOAD_SIZE_BUDGET_BYTES = 200 KB** at the IPC entry; oversize
  payloads are rejected with `PAYLOAD_TOO_LARGE`.
- **PIN persists across logout.** Reset PIN is an explicit user
  action in Settings (lock:reset-pin IPC).
- **Update banner.** The renderer subscribes to
  `update:status-changed` + `update:manual-fallback` and surfaces
  Restart-now / Download actions.

## Architecture (mobile)

```
mobile/src/
├── App.tsx                  # NavigationContainer, auth gating, init
├── navigation/              # React Navigation
├── screens/                 # LoginScreen, DashboardScreen, QuickSale,
│                            # Cart, Checkout, BarcodeScanner,
│                            # TransactionList, ReceiptViewer, ERPScreen
├── services/                # ApiClient, StorageService,
│                            # EncryptionService, SessionManager,
│                            # ConnectionService, PrintService
├── stores/                  # Zustand stores
├── types/                   # api/navigation/settings/session
├── constants/               # theme, api, config
└── components/              # Toolbar, WebViewContainer, PinPad, ...
```

Mobile uses the same `@aeris/shared` RelayClient as the v2 desktop,
so a contract change in `shared/` may affect both. The mobile
typecheck CI job (`mobile-typecheck`) catches type drift before
Xcode Cloud / Gradle builds run.

## Documentation

- `client/CLAUDE.md` — Aeris v2 architecture, build, IPC contract.
- `client/README.md` — quick reference for the desktop client.
- `archive/desktop-v1/` — frozen v1 README + TESTING docs.
