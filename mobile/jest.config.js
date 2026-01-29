module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-webview|react-native-encrypted-storage|react-native-print|react-native-share|react-native-modal|react-native-background-timer|react-native-keep-awake|@react-native-community/netinfo|react-native-device-info|react-native-safe-area-context|react-native-immersive)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    '!src/assets/**',
    '!src/components/**',
    '!src/screens/**',
    '!src/App.tsx',
  ],
  coverageThreshold: {
    global: {
      branches: 25,
      functions: 35,
      lines: 40,
      statements: 40,
    },
  },
  testMatch: ['**/__tests__/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'],
  testTimeout: 10000,
  verbose: true,
};
