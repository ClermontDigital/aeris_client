import type { Config } from 'jest';

const config: Config = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(expo|expo-.*|@expo|react-native|@react-native|react-native-webview|react-native-modal|@react-native-community/netinfo|react-native-safe-area-context|react-native-reanimated|react-native-screens|react-native-gesture-handler|@react-navigation|zustand)/)',
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
      branches: 25,
      functions: 35,
      lines: 40,
      statements: 40,
    },
  },
  testTimeout: 10000,
  verbose: true,
};

export default config;
