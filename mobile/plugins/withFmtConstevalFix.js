const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Marker comment used to detect prior runs of this plugin.
// Bump the version suffix if the injected snippet changes meaningfully.
const MARKER = "# @aeris-fmt-consteval-fix-v1";

/**
 * Config plugin that fixes the `fmt` pod failing to compile under newer
 * Clang toolchains (Xcode Cloud moved to Clang 21 / iOS 26.5 SDK).
 *
 * React Native 0.83.4 pins fmt 11.0.2 (react-native/third-party-podspecs/
 * fmt.podspec). Building it with Clang 21 in C++20 mode fails:
 *
 *   fmt/include/fmt/format-inl.h:59:24: error: call to consteval function
 *   'fmt::basic_format_string<...>' is not a constant expression
 *
 * fmt uses `consteval` for compile-time format-string checking (FMT_STRING /
 * FMT_COMPILE_STRING). Clang 21 is stricter and rejects fmt 11.0.2's
 * consteval `basic_format_string` construction. fmt gates this behind
 * FMT_USE_CONSTEVAL; defining it to 0 makes FMT_CONSTEVAL empty so the check
 * is a plain constexpr/runtime path — fmt still formats correctly, it just
 * skips the compile-time validation that the toolchain can't evaluate.
 *
 * Injected GLOBALLY (every pod target) so FMT_USE_CONSTEVAL is consistent
 * across every translation unit that includes fmt headers (fmt, RCT-Folly,
 * React-Core, ...) — a mismatch would risk an ODR violation.
 *
 * Mirrors withFollyCoroutinesFix's mechanism (reuse Expo's post_install hook,
 * idempotent via MARKER). Info.plist / pbxproj edits are wiped by
 * `expo prebuild --clean`, so the Podfile hook is the durable home.
 */
function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      // Defensive guard for Android-only prebuilds (mirrors the folly fix).
      if (config.modRequest.platform !== "ios") {
        return config;
      }
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );

      let podfileContents = fs.readFileSync(podfilePath, "utf8");

      // Already applied — bail so repeated prebuilds don't stack copies.
      if (podfileContents.includes(MARKER)) {
        return config;
      }

      const injection = `
    ${MARKER}
    # Fix fmt 11.0.2 'call to consteval function ... is not a constant
    # expression' under Clang 21. Disable fmt's consteval format-string path.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        defs = build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        unless defs.include?('FMT_USE_CONSTEVAL=0')
          defs << 'FMT_USE_CONSTEVAL=0'
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

module.exports = withFmtConstevalFix;
