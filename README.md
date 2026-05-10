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
eas build --platform ios --profile production --auto-submit    # TestFlight

# Archived v1 (security patches only)
cd archive/desktop-v1
npm install
npm run build:mac
```

EAS Build for mobile must use `"image": "sdk-55"` in `eas.json`
(Xcode 26.2 / Swift 6.2). Other Xcode versions fail.

## Release tagging

CI is path-filtered and gated on tag prefixes. Tagging from `release`
cuts a release for one app:

| Tag prefix             | Builds + ships                                    |
|------------------------|---------------------------------------------------|
| `client-vX.Y.Z`        | Aeris v2 desktop -> GitHub Releases (signed +    |
|                        | notarised dmg/zip + nsis + AppImage/deb +        |
|                        | electron-updater channel manifests)              |
| `mobile-vX.Y.Z`        | mobile EAS build -> TestFlight (auto-submit) +   |
|                        | Android EAS production build                     |
| `desktop-v1-vX.Y.Z`    | manual security-patch on archived v1             |

Path-filtered jobs in `.github/workflows/build-release.yml` use
`dorny/paths-filter` to scope work:

- `client/**` or `shared/**` -> client tests + builds
- `mobile/**` or `shared/**` -> mobile typecheck + tests + EAS builds
- `archive/desktop-v1/**` -> v1 archive build (workflow_dispatch only)

## Required GitHub secrets

`EXPO_TOKEN`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_ID_PASS`, `APPLE_TEAM_ID`. Optional `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD` for Windows code-sign.

## Documentation

- `client/CLAUDE.md` — Aeris v2 architecture, build, IPC contract,
  CSP, token confinement.
- `mobile/` — see `mobile/README.md` and the existing mobile
  documentation under `docs/`.
- `archive/desktop-v1/` — frozen v1 README + TESTING docs.

## License

MIT — see `LICENSE`.
