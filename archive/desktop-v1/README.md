# Aeris Desktop v1.x (archived)

This directory contains the legacy Aeris desktop client v1.x: a thin Electron 28 WebView wrapper that loads the on-prem Aeris2 web UI from a configurable `baseUrl`. It only supports on-prem direct mode (no marketplace-relay) and is built on Electron 28 (now end-of-life). It was archived on 2026-05-07 and is superseded by the Aeris v2 native-UI client at `aeris_client/client/`. From the archive date onward, this codebase receives security patches only — no feature work — and only via the manual `archive-build-v1` `workflow_dispatch` CI job. Releases cut from this directory use the tag scheme `desktop-v1-vX.Y.Z`.

## Cutting a security patch

To ship a security patch on the archived v1.x line: clone this repo, `cd archive/desktop-v1/`, run `npm ci`, apply the fix, bump the version in `package.json`, commit on `main` (or a topic branch merged to `main`), then manually trigger the `archive-build-v1` workflow from the GitHub Actions UI (Actions tab -> "Build and Release Aeris Client" -> "Run workflow"). The workflow reuses the existing macOS notary credentials and code-sign secrets to produce signed dmg / nsis / AppImage / deb artifacts and publishes a GitHub Release tagged `desktop-v1-vX.Y.Z`. Do not push to `release` to ship a v1 patch — the standard CI path now targets `client/` (Aeris v2).
