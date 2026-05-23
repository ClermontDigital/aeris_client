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
    randomUUID: () => mockCryptoModule.randomUUID(),
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

// @expo/vector-icons removed in v1.3.20 — Lucide is the new baseline (§08).
// Keep this comment as the migration breadcrumb; no mock is needed because
// nothing imports the package any more.

// Mock lucide-react-native — every icon resolves to a string component so
// it renders inertly in RTL tests. The Icon component (src/components/Icon.tsx)
// looks each icon up in this module, so the Proxy returning string-render
// stubs keeps any lookup happy regardless of which Lucide glyph is requested.
jest.mock('lucide-react-native', () => {
  const handler = {
    get: (_target: object, prop: string) => prop,
  };
  return new Proxy({}, handler);
});

// Mock @react-native-cookies/cookies — native module not available under Jest.
jest.mock('@react-native-cookies/cookies', () => ({
  __esModule: true,
  default: {
    clearAll: jest.fn(() => Promise.resolve()),
    get: jest.fn(() => Promise.resolve({})),
    set: jest.fn(() => Promise.resolve()),
  },
}));

// Mock react-native-reanimated. The package's bundled mock
// (`react-native-reanimated/mock`) transitively loads react-native-worklets,
// which ships ESM-only — Jest can't parse it under the default RN preset and
// fails to load any file that imports reanimated (e.g. MotionCard). Roll our
// own minimal stub instead.
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const passthroughTiming = (val: any) => val;
  const passthroughDelay = (_d: any, val: any) => val;
  const easingFn = (t: number) => t;
  const easingFactory = () => easingFn;
  // Layout-animation builders (FadeIn, SlideInDown, etc.) are chainable in
  // real reanimated — `FadeIn.duration(220).delay(80)` returns a builder.
  // Tests just need them to not blow up; nothing actually animates.
  const layoutBuilder: any = {};
  ['duration', 'delay', 'springify', 'damping', 'stiffness', 'easing'].forEach(
    name => {
      layoutBuilder[name] = jest.fn(() => layoutBuilder);
    },
  );
  return {
    __esModule: true,
    default: {
      View: RN.View,
      Text: RN.Text,
      ScrollView: RN.ScrollView,
      Image: RN.Image,
      createAnimatedComponent: (c: any) => c,
    },
    View: RN.View,
    Text: RN.Text,
    ScrollView: RN.ScrollView,
    Image: RN.Image,
    createAnimatedComponent: (c: any) => c,
    useAnimatedStyle: jest.fn(() => ({})),
    useSharedValue: jest.fn((init: any) => ({ value: init })),
    withTiming: jest.fn(passthroughTiming),
    withSpring: jest.fn(passthroughTiming),
    withDelay: jest.fn(passthroughDelay),
    withSequence: jest.fn((...args: any[]) => args[args.length - 1]),
    withRepeat: jest.fn((val: any) => val),
    FadeIn: layoutBuilder,
    FadeOut: layoutBuilder,
    FadeInDown: layoutBuilder,
    FadeInUp: layoutBuilder,
    SlideInDown: layoutBuilder,
    SlideOutDown: layoutBuilder,
    SlideInUp: layoutBuilder,
    SlideOutUp: layoutBuilder,
    Layout: layoutBuilder,
    Easing: {
      linear: easingFn,
      ease: easingFn,
      quad: easingFn,
      cubic: easingFn,
      in: easingFactory,
      out: easingFactory,
      inOut: easingFactory,
      bezier: easingFactory,
    },
  };
});

// Mock react-native-screens
jest.mock('react-native-screens', () => ({
  enableScreens: jest.fn(),
}));
