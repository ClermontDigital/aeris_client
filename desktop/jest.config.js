module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/assets/**',
    '!src/main.js', // Exclude main.js - requires integration tests with actual Electron
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './src/session-manager.js': {
      branches: 85,
      functions: 100,
      lines: 90,
      statements: 90
    },
    './src/ipc-handlers.js': {
      branches: 68,
      functions: 80,
      lines: 85,
      statements: 85
    }
  },
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^electron$': '<rootDir>/__mocks__/electron.js'
  },
  testTimeout: 10000,
  verbose: true
};
