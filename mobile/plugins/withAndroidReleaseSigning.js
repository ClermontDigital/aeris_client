const { withAppBuildGradle } = require("expo/config-plugins");

// Marker so repeated prebuilds don't stack duplicate signingConfig blocks.
const MARKER = "@aeris-android-release-signing-v1";

/**
 * Config plugin that makes the RELEASE Android build sign with the upload
 * keystore instead of the debug key.
 *
 * Expo's `expo prebuild` emits an app/build.gradle that declares ONLY a
 * `debug` signingConfig and points the release buildType at
 * `signingConfig signingConfigs.debug`. The bare React Native community
 * template wires a `release` signingConfig from the MYAPP_UPLOAD_* gradle
 * properties by convention — Expo's does not. So writing MYAPP_UPLOAD_* into
 * gradle.properties (as the CI does) has no effect: nothing reads it, and the
 * AAB comes out debug-signed. Google Play rejects a debug-signed bundle
 * ("You uploaded an APK or Android App Bundle that was signed in debug mode").
 *
 * This plugin adds a real `release` signingConfig backed by those same
 * MYAPP_UPLOAD_* properties and repoints the release buildType at it. When the
 * properties are absent (local dev with no keystore) it falls back to the
 * debug key so a local `assembleRelease` still builds. CI writes the four
 * MYAPP_UPLOAD_* props (from repo secrets) before ./gradlew, so real release
 * builds sign with the upload key: CN=AERIS, not CN=Android Debug.
 *
 * Lives in app config (not the workflow YAML) so it also fixes local release
 * builds and survives `expo prebuild --clean`.
 */
const RELEASE_SIGNING_CONFIG = `        // ${MARKER}
        release {
            if (project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
                storeFile file(project.property('MYAPP_UPLOAD_STORE_FILE'))
                storePassword project.property('MYAPP_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('MYAPP_UPLOAD_KEY_ALIAS')
                keyPassword project.property('MYAPP_UPLOAD_KEY_PASSWORD')
            }
        }
`;

function patchBuildGradle(contents) {
  if (contents.includes(MARKER)) {
    return contents;
  }

  // 1. Inject the `release` signingConfig alongside Expo's default `debug`
  //    one. There is exactly one `signingConfigs {` block.
  let out = contents.replace(
    /signingConfigs\s*\{/,
    (match) => `${match}\n${RELEASE_SIGNING_CONFIG}`
  );

  // 2. Repoint the release buildType off signingConfigs.debug. Anchored on
  //    `buildTypes {` so it targets the release buildType (not the debug
  //    buildType, and not the signingConfigs.release added above, which comes
  //    before buildTypes). Falls back to debug signing when the upload props
  //    are absent so a local release build still works.
  out = out.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s+)signingConfigs\.debug/,
    "$1project.hasProperty('MYAPP_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
  );

  if (out === contents || !out.includes("signingConfigs.release")) {
    throw new Error(
      "withAndroidReleaseSigning: could not wire the release signingConfig — " +
        "Expo's build.gradle template may have changed."
    );
  }

  return out;
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error(
        "withAndroidReleaseSigning: expected a groovy build.gradle"
      );
    }
    cfg.modResults.contents = patchBuildGradle(cfg.modResults.contents);
    return cfg;
  });
};
