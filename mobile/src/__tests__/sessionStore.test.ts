const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore[key] || null)),
  deleteItemAsync: jest.fn((key: string) => {
    delete mockSecureStore[key];
    return Promise.resolve();
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

const mockAsyncStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn((key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(mockAsyncStorage[key] || null)),
    removeItem: jest.fn((key: string) => {
      delete mockAsyncStorage[key];
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      keys.forEach(k => delete mockAsyncStorage[k]);
      return Promise.resolve();
    }),
  },
}));

import {useSessionStore} from '../stores/sessionStore';

describe('sessionStore', () => {
  beforeEach(async () => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
    useSessionStore.getState().cleanup();
    await useSessionStore.getState().init();
  });

  test('should initialize with empty sessions', () => {
    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.activeSession).toBeNull();
    expect(state.isInitialized).toBe(true);
  });

  test('should create a session and update store', async () => {
    const id = await useSessionStore.getState().createSession('Test', '1234');
    const state = useSessionStore.getState();
    expect(state.sessions.length).toBe(1);
    expect(state.sessions[0].name).toBe('Test');
    expect(state.activeSession?.id).toBe(id);
  });

  test('should delete a session', async () => {
    const id = await useSessionStore.getState().createSession('Test', '1234');
    await useSessionStore.getState().deleteSession(id);
    expect(useSessionStore.getState().sessions.length).toBe(0);
  });

  test('should lock and unlock a session', async () => {
    const id = await useSessionStore.getState().createSession('Test', '1234');
    await useSessionStore.getState().lockSession(id);
    expect(useSessionStore.getState().activeSession?.isLocked).toBe(true);

    await useSessionStore.getState().unlockSession(id, '1234');
    expect(useSessionStore.getState().activeSession?.isLocked).toBe(false);
  });

  test('should switch between sessions', async () => {
    const id1 = await useSessionStore.getState().createSession('A', '1234');
    await useSessionStore.getState().createSession('B', '5678');
    await useSessionStore.getState().switchToSession(id1);
    expect(useSessionStore.getState().activeSession?.name).toBe('A');
  });

  test('should cleanup all sessions', async () => {
    await useSessionStore.getState().createSession('A', '1234');
    await useSessionStore.getState().createSession('B', '5678');
    useSessionStore.getState().cleanup();
    expect(useSessionStore.getState().sessions).toEqual([]);
    expect(useSessionStore.getState().activeSession).toBeNull();
  });
});
