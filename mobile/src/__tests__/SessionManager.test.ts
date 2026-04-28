// Mock dependencies before importing SessionManager
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

import SessionManager from '../services/SessionManager';

describe('SessionManager', () => {
  beforeEach(async () => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
    SessionManager.cleanup();
    await SessionManager.init();
  });

  describe('createSession', () => {
    test('should create a session with valid name and PIN', async () => {
      const id = await SessionManager.createSession('Cashier 1', '1234');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    test('should throw on empty name', async () => {
      await expect(SessionManager.createSession('', '1234')).rejects.toThrow('Session name is required');
    });

    test('should throw on invalid PIN length', async () => {
      await expect(SessionManager.createSession('Test', '12')).rejects.toThrow('PIN must be');
    });

    test('should throw on duplicate name', async () => {
      await SessionManager.createSession('Cashier 1', '1234');
      await expect(SessionManager.createSession('Cashier 1', '5678')).rejects.toThrow('Session name already exists');
    });

    test('should throw when max sessions reached', async () => {
      for (let i = 0; i < 5; i++) {
        await SessionManager.createSession(`Session ${i}`, '1234');
      }
      await expect(SessionManager.createSession('Session 5', '1234')).rejects.toThrow('Maximum of 5 sessions');
    });
  });

  describe('validatePin', () => {
    test('should validate correct PIN', async () => {
      const id = await SessionManager.createSession('Test', '9876');
      expect(await SessionManager.validatePin(id, '9876')).toBe(true);
    });

    test('should reject wrong PIN', async () => {
      const id = await SessionManager.createSession('Test', '9876');
      expect(await SessionManager.validatePin(id, '0000')).toBe(false);
    });

    test('should lock after 3 failed attempts', async () => {
      const id = await SessionManager.createSession('Test', '9876');
      await SessionManager.validatePin(id, '0000');
      await SessionManager.validatePin(id, '0000');
      await expect(SessionManager.validatePin(id, '0000')).rejects.toThrow('Too many failed attempts');
    });

    test('should throw for non-existent session', async () => {
      await expect(SessionManager.validatePin('fake-id', '1234')).rejects.toThrow('Session not found');
    });
  });

  describe('lockSession / unlockSession', () => {
    test('should lock and unlock a session', async () => {
      const id = await SessionManager.createSession('Test', '1234');
      const locked = await SessionManager.lockSession(id);
      expect(locked.isLocked).toBe(true);

      const unlocked = await SessionManager.unlockSession(id, '1234');
      expect(unlocked.isLocked).toBe(false);
    });

    test('should throw on unlock with wrong PIN', async () => {
      const id = await SessionManager.createSession('Test', '1234');
      await SessionManager.lockSession(id);
      await expect(SessionManager.unlockSession(id, '0000')).rejects.toThrow('Invalid PIN');
    });
  });

  describe('deleteSession', () => {
    test('should delete existing session', async () => {
      const id = await SessionManager.createSession('Test', '1234');
      expect(await SessionManager.deleteSession(id)).toBe(true);
      expect(SessionManager.getSession(id)).toBeNull();
    });

    test('should throw for non-existent session', async () => {
      await expect(SessionManager.deleteSession('fake-id')).rejects.toThrow('Session not found');
    });
  });

  describe('getAllSessions', () => {
    test('should return all sessions sorted by lastAccessedAt', async () => {
      const idA = await SessionManager.createSession('A', '1234');
      // Ensure B has a later timestamp by backdating A in the internal map
      const internalSession = (SessionManager as any).sessions.get(idA);
      internalSession.lastAccessedAt = new Date(Date.now() - 10000).toISOString();
      await SessionManager.createSession('B', '5678');
      const sessions = SessionManager.getAllSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0].name).toBe('B'); // Most recent first
    });

    test('should not expose PINs', async () => {
      await SessionManager.createSession('Test', '1234');
      const sessions = SessionManager.getAllSessions();
      expect((sessions[0] as any).pin).toBeUndefined();
    });
  });

  describe('switchToSession', () => {
    test('should switch to unlocked session', async () => {
      const id1 = await SessionManager.createSession('A', '1234');
      await SessionManager.createSession('B', '5678');
      const session = await SessionManager.switchToSession(id1);
      expect(session.name).toBe('A');
      expect(SessionManager.getActiveSessionId()).toBe(id1);
    });

    test('should require PIN for locked session', async () => {
      const id = await SessionManager.createSession('A', '1234');
      await SessionManager.lockSession(id);
      await expect(SessionManager.switchToSession(id)).rejects.toThrow('PIN required');
    });
  });

  describe('updateSessionUrl', () => {
    test('should update session URL', async () => {
      const id = await SessionManager.createSession('Test', '1234');
      await SessionManager.updateSessionUrl(id, 'http://example.com/page');
      const session = SessionManager.getSession(id);
      expect(session?.currentUrl).toBe('http://example.com/page');
    });
  });

  describe('cleanup', () => {
    test('should clear all sessions', async () => {
      await SessionManager.createSession('A', '1234');
      await SessionManager.createSession('B', '5678');
      SessionManager.cleanup();
      expect(SessionManager.getAllSessions().length).toBe(0);
      expect(SessionManager.getActiveSession()).toBeNull();
    });
  });
});
