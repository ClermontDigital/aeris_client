const mockStorage: Record<string, string> = {};

jest.mock('react-native-get-random-values', () => {});

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn((key: string, value: string) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(mockStorage[key] || null)),
    removeItem: jest.fn((key: string) => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
      return Promise.resolve();
    }),
  },
}));

jest.mock('react-native-background-timer', () => ({
  setTimeout: jest.fn((cb: Function, ms: number) => global.setTimeout(cb, ms)),
  clearTimeout: jest.fn((id: number) => global.clearTimeout(id)),
}));

const nodeCrypto = require('crypto');
if (typeof global.crypto === 'undefined') {
  (global as any).crypto = {
    getRandomValues: (arr: Uint8Array) => nodeCrypto.randomFillSync(arr),
  };
}

import {useSessionStore} from '../stores/sessionStore';

describe('sessionStore', () => {
  beforeEach(async () => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
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
