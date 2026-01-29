// Polyfill crypto.getRandomValues for tests
const nodeCrypto = require('crypto');
if (typeof global.crypto === 'undefined') {
  global.crypto = {
    getRandomValues: (arr) => nodeCrypto.randomFillSync(arr),
  };
}

// Mock react-native-get-random-values (no-op, polyfill above handles it)
jest.mock('react-native-get-random-values', () => {});

// Mock react-native-encrypted-storage
jest.mock('react-native-encrypted-storage', () => ({
  default: {
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
}));

// Mock react-native-background-timer
jest.mock('react-native-background-timer', () => ({
  setTimeout: jest.fn((cb, ms) => global.setTimeout(cb, ms)),
  clearTimeout: jest.fn((id) => global.clearTimeout(id)),
  setInterval: jest.fn((cb, ms) => global.setInterval(cb, ms)),
  clearInterval: jest.fn((id) => global.clearInterval(id)),
}));

// Mock react-native-device-info
jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve('test-device-id')),
  getDeviceId: jest.fn(() => 'test-device'),
  isTablet: jest.fn(() => true),
}));

// Mock react-native-print
jest.mock('react-native-print', () => ({
  print: jest.fn(() => Promise.resolve()),
}));

// Mock react-native-share
jest.mock('react-native-share', () => ({
  default: { open: jest.fn(() => Promise.resolve()) },
}));

// Mock react-native-keep-awake
jest.mock('react-native-keep-awake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

// Mock react-native-immersive
jest.mock('react-native-immersive', () => ({
  Immersive: { on: jest.fn() },
}));
