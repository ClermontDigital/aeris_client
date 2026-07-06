# AERIS Mobile — Build & Deploy

How to ship the AERIS Expo app (`mobile/`) to TestFlight (iOS) and
Google Play / sideload APK (Android).

> **EAS is no longer used.** iOS builds on Xcode Cloud; Android builds
> on GitHub Actions with native Gradle. There is no `eas.json` in the
> repo and no `eas-cli` step in CI.

---

> **Android release process:** see
> [`ANDROID_RELEASE_GUIDE.md`](./ANDROID_RELEASE_GUIDE.md) for the full
> Play Console setup + tag-based release flow.

## iOS — Xcode Cloud → TestFlight

**Trigger:** push to the `apple` branch (each push runs a billed Xcode
Cloud build — only push when a TestFlight build is actually wanted).

**Config:** App Store Connect → Xcode Cloud → Workflow. The build
script lives at `mobile/ios/ci_scripts/ci_post_clone.sh` and:

1. Installs Node 20 + Expo CLI dependencies via the repo-root
   `npm ci` (so the `@aeris/shared` workspace resolves).
2. Runs `expo prebuild --platform ios` to regenerate the native iOS
   project from `app.json` (the committed `mobile/ios/` scaffold is
   replaced).
3. Hands off to Xcode Cloud's standard archive + sign + upload to
   TestFlight pipeline.

**Versioning:** `CFBundleVersion` is stamped from `CI_BUILD_NUMBER`
(Xcode Cloud's monotonic counter), so every TestFlight build is
unique even if the marketing `version` in `app.json` hasn't changed.

**To cut a TestFlight build:** commit + push to `apple`.

---

## Android — GitHub Actions native Gradle

**Workflow:** `.github/workflows/android-build.yml`.

**Trigger:** `workflow_dispatch` (manual, with profile + submit-to-Play
inputs) or push of a `mobile-v*` tag.

**Build steps:** checkout → setup-node 20 + JDK 17 + Android SDK 35 →
`npm ci` → `expo prebuild --platform android --clean` (Android scaffold
is **not** committed — regenerated every run) → decode signing keystore
from secret → stamp `versionCode` from `GITHUB_RUN_NUMBER` →
`./gradlew assembleRelease bundleRelease` → upload signed APK + AAB as
workflow artifacts → optional `fastlane supply` Play upload.

**Required GitHub repo secrets:**

| Secret                              | Purpose                                                    |
|-------------------------------------|------------------------------------------------------------|
| `ANDROID_KEYSTORE_BASE64`           | base64 of the upload keystore (`.jks`)                     |
| `ANDROID_KEYSTORE_PASSWORD`         | keystore password                                          |
| `ANDROID_KEY_ALIAS`                 | key alias inside the keystore (usually `upload`)           |
| `ANDROID_KEY_PASSWORD`              | alias password                                             |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`  | base64 of Play service-account JSON (only when submitting) |

**To cut an Android build for the Samsung tablet sideload:**

1. GitHub → **Actions** → **Android build (native Gradle)** → **Run workflow**.
   Branch `main`, profile `production`, submit `false`.
2. Wait ~25–40 min for the green checkmark.
3. Download the `aeris-android-apk` artifact (zip), unzip → `app-release.apk`.
4. `adb install -r app-release.apk` over USB (developer mode on),
   or AirDrop / email to the tablet and tap to install (requires
   "Install unknown apps" enabled for the file source).

**To submit to Google Play (internal track):** same workflow, but set
`submit=true`. The first Play upload must be done manually via the
Console — the API only accepts uploads after a listing exists and a
first release has been created.

---

## One-time keystore migration (from EAS, if not already done)

The Android signing keystore originally lived on EAS. To move it into
GitHub Secrets:

1. `cd mobile && npx eas-cli credentials` → Android → production →
   Keystore: Download. Capture the store password, key alias, key
   password.
2. Back up the raw `.jks` to 1Password + an offline copy. **Losing
   the keystore is terminal for the Play listing.**
3. `openssl base64 -A -in keystore.jks | pbcopy` → paste into
   `ANDROID_KEYSTORE_BASE64` secret.
4. Add the three password/alias values as the remaining `ANDROID_*`
   secrets.
5. Confirm one green Gradle CI run before deleting the keystore from EAS.

---

## Local development

```bash
cd mobile
npx expo start           # Metro dev server (iOS sim, Android emu, Expo Go)
npx expo run:ios         # build + run on a connected iPhone / sim
npx expo run:android     # build + run on a connected device / emu
npm test                 # Jest
npx tsc --noEmit         # typecheck (CI mirrors this)
```

No EAS account is required for local development.
