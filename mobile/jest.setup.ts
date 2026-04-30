// Polyfill crypto.getRandomValues for tests
const mockCrypto = require('crypto');
if (typeof global.crypto === 'undefined') {
  (global as any).crypto = {
    getRandomValues: (arr: any) => mockCrypto.randomFillSync(arr),
  };
}

// Mock expo-crypto
jest.mock('expo-crypto', () => {
  const mockCryptoModule = require('crypto');
  return {
    getRandomBytes: (count: number) => mockCryptoModule.randomBytes(count),
    getRandomValues: (arr: any) => mockCryptoModule.randomFillSync(arr),
    digestStringAsync: jest.fn((_algo: string, data: string) => {
      return Promise.resolve(
        mockCryptoModule.createHash('sha256').update(data).digest('hex')
      );
    }),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  };
});

// Mock expo-secure-store
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    setItemAsync: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    getItemAsync: jest.fn((key: string) => {
      return Promise.resolve(store[key] || null);
    }),
    deleteItemAsync: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  };
});

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      setItem: jest.fn((key: string, value: string) => {
        store[key] = value;
        return Promise.resolve();
      }),
      getItem: jest.fn((key: string) => {
        return Promise.resolve(store[key] || null);
      }),
      removeItem: jest.fn((key: string) => {
        delete store[key];
        return Promise.resolve();
      }),
      multiRemove: jest.fn((keys: string[]) => {
        keys.forEach(k => delete store[k]);
        return Promise.resolve();
      }),
    },
  };
});

// Mock @react-native-community/netinfo
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true }),
  ),
}));

// Mock expo-keep-awake
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(),
}));

// Mock expo-navigation-bar
jest.mock('expo-navigation-bar', () => ({
  setVisibilityAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-print
jest.mock('expo-print', () => ({
  printAsync: jest.fn(() => Promise.resolve()),
  printToFileAsync: jest.fn(() => Promise.resolve({ uri: 'file:///tmp/test.pdf' })),
}));

// Mock expo-sharing
jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(() => Promise.resolve()),
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
}));

// Mock expo-device
jest.mock('expo-device', () => ({
  isDevice: true,
  deviceName: 'Test Device',
  modelName: 'TestModel',
  DeviceType: { PHONE: 1, TABLET: 2 },
  deviceType: 2,
}));

// Mock expo-application
jest.mock('expo-application', () => ({
  applicationId: 'com.aeris.erp',
  nativeApplicationVersion: '1.3.0',
  nativeBuildVersion: '1',
}));

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Mock expo-camera
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: jest.fn(() => [{ granted: true }, jest.fn()]),
  BarcodeScanningResult: {},
}));

// Mock expo-local-authentication
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(() => Promise.resolve(true)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(true)),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
}));

// Mock expo-status-bar
jest.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
  setStatusBarHidden: jest.fn(),
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useAnimatedStyle: jest.fn(() => ({})),
    useSharedValue: jest.fn((init: any) => ({ value: init })),
    withTiming: jest.fn((val: any) => val),
    withSpring: jest.fn((val: any) => val),
  };
});

// Mock react-native-screens
jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
}));
