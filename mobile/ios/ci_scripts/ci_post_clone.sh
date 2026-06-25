#!/bin/sh
# Xcode Cloud post-clone hook — AERIS (Expo app in the aeris_client MONOREPO).
#
# LOCATION: Apple runs ci_scripts that sit beside the Xcode project. Ours is at
# mobile/ios/ci_scripts/ci_post_clone.sh (committed). ios/ IS committed as a
# scaffold so Xcode Cloud can resolve the AERIS scheme; this script regenerates
# the native project with `expo prebuild --clean` at build time, then pod installs.
#
# MONOREPO: CI_PRIMARY_REPOSITORY_PATH is the repo ROOT (aeris_client). `npm ci`
# there installs the workspace tree (mobile/ gets expo + the RN stack); prebuild
# and pod install run in mobile/. Mirrors beats / plot_mobile, adapted for the
# workspace layout. Signing is App-Store-Connect-managed (Team 6SWY68AFK6).
set -e

REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
[ -n "$REPO_ROOT" ] || REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/mobile"
echo "[ci_post_clone] repo root: $REPO_ROOT ; mobile: $MOBILE_DIR"

export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_ANALYTICS=1

# --- Node 20 (Expo SDK 55 / RN 0.83 need >= 20.19.4) ---
node_major="$(node --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')"
if [ -z "$node_major" ] || [ "$node_major" -lt 20 ]; then
  brew_ok=0
  for attempt in 1 2 3; do
    if brew install node@20; then brew_ok=1; break; fi
    echo "[ci_post_clone] brew install node@20 attempt $attempt failed; retry in 10s" >&2; sleep 10
  done
  if [ "$brew_ok" = 1 ]; then
    export PATH="$(brew --prefix)/opt/node@20/bin:$PATH"
  else
    echo "[ci_post_clone] brew failed 3x; falling back to nodejs.org tarball" >&2
    NODE_TARBALL_VER=v20.19.4
    curl -fsSL "https://nodejs.org/dist/${NODE_TARBALL_VER}/node-${NODE_TARBALL_VER}-darwin-arm64.tar.gz" -o /tmp/node20.tar.gz
    mkdir -p "$HOME/.node20"; tar -xzf /tmp/node20.tar.gz -C "$HOME/.node20" --strip-components=1
    export PATH="$HOME/.node20/bin:$PATH"
  fi
fi
command -v node >/dev/null 2>&1 || { echo "ERROR: Node >= 20 unavailable." >&2; exit 1; }
command -v pod >/dev/null 2>&1 || brew install cocoapods
# Hermes-from-source safety net (RN normally uses the prebuilt artifact):
command -v cmake >/dev/null 2>&1 || brew install cmake
command -v ninja >/dev/null 2>&1 || brew install ninja
echo "[ci_post_clone] node $(node --version) / npm $(npm --version)"

# --- Install the npm WORKSPACE from the repo root ---
cd "$REPO_ROOT"
npm_ok=0
for attempt in 1 2 3; do
  if npm ci --legacy-peer-deps --include-workspace-root \
        --fetch-retries=5 --fetch-retry-factor=2 --fetch-retry-maxtimeout=120000; then npm_ok=1; break; fi
  echo "[ci_post_clone] npm ci attempt $attempt failed; retry in 10s" >&2; sleep 10
done
[ "$npm_ok" = 1 ] || { echo "ERROR: npm ci failed after retries." >&2; exit 1; }

# --- Regenerate the native iOS project (committed ios/ is just a scaffold) ---
cd "$MOBILE_DIR"
# Xcode Cloud presets CI=TRUE; Expo rejects uppercase TRUE as a bool, so override.
CI=1 EXPO_NO_GIT_STATUS=1 ./node_modules/.bin/expo prebuild --platform ios --clean --no-install

# --- Xcode 16 ENABLE_USER_SCRIPT_SANDBOXING is on by default and breaks pods
# whose prepare_command/script phases write undeclared outputs. Disable it on the
# regenerated Podfile (applied AFTER prebuild, BEFORE pod install). Non-fatal:
# if the Expo template marker ever moves, warn instead of aborting the build. ---
python3 - <<'PYEOF' || echo "[ci_post_clone] WARN: sandbox Podfile patch skipped (marker not found)"
from pathlib import Path
p = Path('ios/Podfile'); t = p.read_text()
hook = """
    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_project.native_targets.each do |target|
        target.build_configurations.each do |config|
          config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
        end
      end
      aggregate_target.user_project.save
    end
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
      end
    end
"""
marker = ':ccache_enabled => ccache_enabled?(podfile_properties),'
assert marker in t, 'ccache marker missing'
needle = ')\n  end\nend\n'
i = t.rindex(needle)
p.write_text(t[:i + 1] + '\n' + hook + '  end\nend\n')
print('[ci_post_clone] Podfile post_install: ENABLE_USER_SCRIPT_SANDBOXING=NO')
PYEOF

# --- Pin NODE_BINARY for the xcodebuild "Bundle React Native code" phase ---
echo "export NODE_BINARY=$(command -v node)" > ios/.xcode.env.local

# --- Stamp CFBundleVersion from the Xcode Cloud build number. `expo prebuild
# --clean` rewrites Info.plist from app.json's static ios.buildNumber every run,
# so without this every TestFlight upload would carry the SAME build number and
# App Store Connect would reject the duplicate. CI_BUILD_NUMBER is monotonic per
# workflow run; CFBundleShortVersionString (the marketing version) stays as
# app.json sets it. Non-fatal so a local prebuild isn't blocked. ---
if [ -n "$CI_BUILD_NUMBER" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $CI_BUILD_NUMBER" ios/AERIS/Info.plist \
    && echo "[ci_post_clone] CFBundleVersion set to $CI_BUILD_NUMBER" \
    || echo "[ci_post_clone] WARN: could not set CFBundleVersion (Info.plist layout changed?)"
else
  echo "[ci_post_clone] CI_BUILD_NUMBER unset (local run); leaving CFBundleVersion as-is"
fi

# --- pod install -> produces ios/AERIS.xcworkspace ---
cd "$MOBILE_DIR/ios"
pod_ok=0
for attempt in 1 2 3; do
  if pod install; then pod_ok=1; break; fi
  echo "[ci_post_clone] pod install attempt $attempt failed; retry in 10s" >&2; sleep 10
done
[ "$pod_ok" = 1 ] || { echo "ERROR: pod install failed after retries." >&2; exit 1; }

echo "[ci_post_clone] done"
