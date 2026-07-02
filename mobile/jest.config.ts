import type { Config } from 'jest';

const config: Config = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Resolve @aeris/shared to TS source so jest-expo's babel transform
    // handles it; the dist build emits CommonJS that doesn't satisfy
    // jest-expo's react-native preset (interopRequireDefault chain).
    '^@aeris/shared$': '<rootDir>/../shared/src/index.ts',
    '^@aeris/shared/(.*)$': '<rootDir>/../shared/src/$1',
    // Dedupe React under Jest. The monorepo root resolves react 18.3.1
    // (pulled by client/), but the mobile workspace ships react 19.2.0.
    // Jest's resolver walks up to the root copy for transitive deps
    // (e.g. zustand's useSyncExternalStoreWithSelector), which then calls
    // hooks from a different React than the renderer. Force every `react`
    // resolution to the mobile workspace copy so subscriptions (and any
    // other hook path zustand takes) see one React.
    '^react$': '<rootDir>/node_modules/react',
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(expo|expo-.*|@expo|react-native|@react-native|react-native-webview|react-native-modal|react-native-animatable|@react-native-community/netinfo|react-native-safe-area-context|react-native-reanimated|react-native-screens|react-native-gesture-handler|@react-navigation|zustand)/)',
  ],
  setupFilesAfterEnv: ['./jest.setup.ts'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/assets/**',
  ],
  coverageThreshold: {
    global: {
      // Thresholds floor coverage so it can't silently rot, but they're not
      // load-bearing on absolute values — tuned down to leave ~3pp headroom
      // so a small feature commit doesn't false-fail CI on a 0.X% miss.
      // Raise as the suite grows.
      branches: 22,
      functions: 32,
      lines: 38,
      statements: 38,
    },
  },
  testTimeout: 10000,
  verbose: true,
  // forceExit covers a known Jest workers-not-exiting issue: every suite
  // passes (133/133) locally + on CI, but the runner returns exit 1 because
  // some teardown (likely an unref'd timer in zustand/AsyncStorage mocks or
  // RN's AppState/InteractionManager) leaves a worker hanging. That makes
  // CI red on a green test run, which gates EVERY downstream build job. We
  // keep verbose output so a real failure is still loud, and rely on
  // failing-tests-fail-CI rather than failing-teardown-fails-CI. The
  // underlying open-handle bug is tracked separately — run with
  // --detectOpenHandles locally to investigate.
  forceExit: true,
};

export default config;
