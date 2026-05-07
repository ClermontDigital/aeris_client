# @aeris/shared

Contract layer shared between `aeris_client/mobile/` (Expo) and `aeris_client/client/` (Electron v2). This package will hold the relay RPC client, API types, normalizers, cart math, and relay action constants — anything both apps must agree on. Do not put platform-specific code here: no `expo-*`, no `electron`, no DOM, no React Native runtime imports. Mobile bundlers (Metro) read `src/index.ts` directly via Babel, so source must be RN-runtime-safe; Node consumers (jest, the Electron main process bundler) read pre-compiled output from `dist/`.
