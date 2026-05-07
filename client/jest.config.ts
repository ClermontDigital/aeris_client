import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@aeris/shared$': '<rootDir>/../shared/src/index.ts',
    '^@aeris/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^electron$': '<rootDir>/__mocks__/electron.ts',
    '^electron-store$': '<rootDir>/__mocks__/electron-store.ts',
    '^electron-log$': '<rootDir>/__mocks__/electron-log.ts',
    '^electron-log/main$': '<rootDir>/__mocks__/electron-log.ts',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.test.json' },
    ],
  },
};

export default config;
