# Aeris ERP Client

npm-workspace monorepo for the Aeris ERP client surface.

## Packages

- `shared/` (`@aeris/shared`) — contract layer used by both apps:
  the relay client, types, and normalizers.
- `client/` (Aeris v2) — Electron 33 desktop client. Relay-only,
  native UI (React + Vite). Successor to v1.
- `mobile/` — Expo SDK 55 / React Native iOS + Android app. Native
  POS screens; the relay path now lives in `@aeris/shared`.
- `archive/desktop-v1/` — frozen Aeris v1 desktop (WebView wrapper).
  Excluded from workspaces. Built only for security patches via the
  `archive-build-v1` workflow_dispatch.

## Quick start

```bash
# Install everything (workspace root).
npm ci

# Run tests across all workspaces.
npm run test:all

# Typecheck shared + client (composite projects).
npm run typecheck

# Typecheck mobile (separate, not composite).
cd mobile && npx tsc --noEmit
```

Per-app commands:

```bash
# Aeris v2 desktop client
cd client
npm run dev          # electron-vite dev (DevTools attached)
npm test             # Jest + RTL
npm run build        # production main + preload + renderer
npm run package:mac  # build a signed/notarised Aeris.app
npm run package:win  # nsis installer
npm run package:linux

# Mobile
cd mobile
npx expo start                                                 # dev server
npm test                                                       # Jest
# iOS production builds run on Xcode Cloud (push to `release`).
# Android production builds run in GitHub Actions
# (.github/workflows/android-build.yml, workflow_dispatch or `mobile-v*` tag).

# Archived v1 (security patches only)
cd archive/desktop-v1
npm install
npm run build:mac
```

## Release tagging

CI is path-filtered and gated on tag prefixes:

| Tag prefix             | Builds + ships                                    |
|------------------------|---------------------------------------------------|
| `client-vX.Y.Z`        | Aeris v2 desktop -> GitHub Releases (signed +    |
|                        | notarised dmg/zip + nsis + AppImage/deb +        |
|                        | electron-updater channel manifests)              |
| `mobile-vX.Y.Z`        | `android-build.yml` -> signed APK + AAB artifacts |
|                        | (iOS uses its own Xcode Cloud trigger on the     |
|                        | `release` branch push)                           |
| `desktop-v1-vX.Y.Z`    | manual security-patch on archived v1             |

Path-filtered jobs in `.github/workflows/build-release.yml`:

- `client/**` or `shared/**` -> client tests + builds
- `mobile/**` or `shared/**` -> mobile typecheck + Jest (production
  builds run on Xcode Cloud / `android-build.yml`, not here)
- `archive/desktop-v1/**` -> v1 archive build (workflow_dispatch only)

## Required GitHub secrets

Desktop: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASS`,
`APPLE_TEAM_ID`. Optional `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`.

Android: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Optional
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` for Play submission.

## Documentation

- `client/CLAUDE.md` — Aeris v2 architecture, build, IPC contract,
  CSP, token confinement.
- `mobile/` — see `mobile/README.md` and the existing mobile
  documentation under `docs/`.
- `archive/desktop-v1/` — frozen v1 README + TESTING docs.

## License

MIT — see `LICENSE`.
