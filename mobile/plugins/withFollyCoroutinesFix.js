const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Marker comment used to detect prior runs of this plugin.
// Bump the version suffix if the injected snippet changes meaningfully.
const MARKER = "# @aeris-folly-fix-v1";

/**
 * Config plugin that fixes the 'folly/coro/Coroutine.h' file not found error.
 *
 * React Native 0.83's ReactNativeDependencies.xcframework bundles folly headers
 * where Expected.h conditionally includes folly/coro/Coroutine.h when
 * FOLLY_HAS_COROUTINES is true. The FOLLY_CFG_NO_COROUTINES=1 flag is set for
 * the main project and RCT-Folly pod, but not for other pod targets (e.g.
 * RNReanimated, RNWorklets) that transitively include Expected.h.
 *
 * This plugin injects FOLLY_CFG_NO_COROUTINES=1 into every pod target's
 * GCC_PREPROCESSOR_DEFINITIONS by reusing Expo's existing post_install hook.
 *
 * Idempotent: skips injection if MARKER is already present in the Podfile.
 *
 * See: https://github.com/facebook/react-native/issues/53575
 */
function withFollyCoroutinesFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );

      let podfileContents = fs.readFileSync(podfilePath, "utf8");

      // Already applied — bail out so repeated prebuilds don't stack copies.
      if (podfileContents.includes(MARKER)) {
        return config;
      }

      const injection = `
    ${MARKER}
    # Fix 'folly/coro/Coroutine.h' file not found
    # Propagate FOLLY_CFG_NO_COROUTINES=1 to all pod targets
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        defs = build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        unless defs.include?('FOLLY_CFG_NO_COROUTINES=1')
          defs << 'FOLLY_CFG_NO_COROUTINES=1'
        end
        build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
      end
    end`;

      if (podfileContents.includes("post_install do |installer|")) {
        // Inject inside the existing Expo-generated post_install block.
        podfileContents = podfileContents.replace(
          "post_install do |installer|",
          `post_install do |installer|${injection}`
        );
      } else {
        // Fallback: append a new post_install block.
        podfileContents += `
${MARKER}
post_install do |installer|${injection}
end
`;
      }

      fs.writeFileSync(podfilePath, podfileContents);
      return config;
    },
  ]);
}

module.exports = withFollyCoroutinesFix;
