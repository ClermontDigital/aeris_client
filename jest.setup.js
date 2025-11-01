// Jest setup file
// Add custom matchers if needed
require('@testing-library/jest-dom');

// Suppress console warnings during tests (optional)
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
