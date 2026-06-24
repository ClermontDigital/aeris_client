#!/bin/sh
# Xcode Cloud post-clone hook — AERIS Expo app (monorepo: aeris_client, app in mobile/).
#
# Xcode Cloud runs this immediately after cloning the repo, with the working
# directory at this script's location (ios/ci_scripts). The managed Expo app
# does NOT commit the generated native project (ios/ is .gitignored except this
# ci_scripts dir), so we must: install Node + CocoaPods, install the npm
# WORKSPACE from the repo ROOT (so `expo` and the hoisted deps resolve), run
# `expo prebuild` to materialise mobile/ios/AERIS.xcworkspace, then `pod install`.
#
# Mirrors the beats / plot_mobile hooks, adapted for the monorepo (install at the
# repo root, prebuild in the mobile workspace). Signing is App-Store-Connect
# automatic (Team 6SWY68AFK6) — independent of EAS credentials.
set -e

retry() {
  n=0
  until [ "$n" -ge 3 ]; do
    "$@" && return 0
    n=$((n + 1))
    echo "↻ retry $n/3: $*"
    sleep 10
  done
  "$@"
}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"   # <root>/mobile
REPO_ROOT="$(cd "$MOBILE_DIR/.." && pwd)"       # <root>
echo "▸ repo root: $REPO_ROOT"
echo "▸ mobile:    $MOBILE_DIR"

export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1

# --- Node 20 ---
if ! command -v node >/dev/null 2>&1; then
  retry brew install node@20
  export PATH="$(brew --prefix node@20)/bin:$PATH"
fi
echo "▸ node $(node -v) / npm $(npm -v)"

# --- CocoaPods (fatal if it cannot be provisioned) ---
if ! command -v pod >/dev/null 2>&1; then
  retry brew install cocoapods
fi

# --- cmake/ninja: only needed if Hermes builds from source; warn, don't fail ---
command -v cmake >/dev/null 2>&1 || brew install cmake ninja || echo "⚠ cmake/ninja unavailable (ok unless Hermes builds from source)"

# --- Install the npm workspace from the REPO ROOT (hoists expo + RN tree) ---
export npm_config_fetch_retries=5 npm_config_fetch_retry_factor=2 npm_config_fetch_retry_maxtimeout=120000
cd "$REPO_ROOT"
retry npm ci --legacy-peer-deps --include-workspace-root

# --- Generate the native iOS project from the Expo config ---
cd "$MOBILE_DIR"
CI=1 EXPO_NO_GIT_STATUS=1 retry npx expo prebuild --platform ios --clean

# --- Pin the Node binary for the RN "Bundle React Native code and images" phase ---
echo "export NODE_BINARY=$(command -v node)" > ios/.xcode.env.local

# --- Install pods → produces ios/AERIS.xcworkspace for Xcode Cloud to build ---
cd "$MOBILE_DIR/ios"
retry pod install

echo "✓ ci_post_clone complete"
