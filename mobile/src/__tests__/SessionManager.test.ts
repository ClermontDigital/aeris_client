// Mock dependencies before importing SessionManager
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

// Polyfill crypto for tests
const nodeCrypto = require('crypto');
if (typeof global.crypto === 'undefined') {
  (global as any).crypto = {
    getRandomValues: (arr: Uint8Array) => nodeCrypto.randomFillSync(arr),
  };
}

import SessionManager from '../services/SessionManager';

describe('SessionManager', () => {
  beforeEach(async () => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    SessionManager.cleanup();
    await SessionManager.init();
  });

  describe('createSession', () => {
    test('should create a session with valid name and PIN', () => {
      const id = SessionManager.createSession('Cashier 1', '1234');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    test('should throw on empty name', () => {
      expect(() => SessionManager.createSession('', '1234')).toThrow('Session name is required');
    });

    test('should throw on invalid PIN length', () => {
      expect(() => SessionManager.createSession('Test', '12')).toThrow('PIN must be exactly 4 digits');
    });

    test('should throw on duplicate name', () => {
      SessionManager.createSession('Cashier 1', '1234');
      expect(() => SessionManager.createSession('Cashier 1', '5678')).toThrow('Session name already exists');
    });

    test('should throw when max sessions reached', () => {
      for (let i = 0; i < 5; i++) {
        SessionManager.createSession(`Session ${i}`, '1234');
      }
      expect(() => SessionManager.createSession('Session 5', '1234')).toThrow('Maximum of 5 sessions');
    });
  });

  describe('validatePin', () => {
    test('should validate correct PIN', () => {
      const id = SessionManager.createSession('Test', '9876');
      expect(SessionManager.validatePin(id, '9876')).toBe(true);
    });

    test('should reject wrong PIN', () => {
      const id = SessionManager.createSession('Test', '9876');
      expect(SessionManager.validatePin(id, '0000')).toBe(false);
    });

    test('should lock after 3 failed attempts', () => {
      const id = SessionManager.createSession('Test', '9876');
      SessionManager.validatePin(id, '0000');
      SessionManager.validatePin(id, '0000');
      expect(() => SessionManager.validatePin(id, '0000')).toThrow('Too many failed attempts');
    });

    test('should throw for non-existent session', () => {
      expect(() => SessionManager.validatePin('fake-id', '1234')).toThrow('Session not found');
    });
  });

  describe('lockSession / unlockSession', () => {
    test('should lock and unlock a session', () => {
      const id = SessionManager.createSession('Test', '1234');
      const locked = SessionManager.lockSession(id);
      expect(locked.isLocked).toBe(true);

      const unlocked = SessionManager.unlockSession(id, '1234');
      expect(unlocked.isLocked).toBe(false);
    });

    test('should throw on unlock with wrong PIN', () => {
      const id = SessionManager.createSession('Test', '1234');
      SessionManager.lockSession(id);
      expect(() => SessionManager.unlockSession(id, '0000')).toThrow('Invalid PIN');
    });
  });

  describe('deleteSession', () => {
    test('should delete existing session', () => {
      const id = SessionManager.createSession('Test', '1234');
      expect(SessionManager.deleteSession(id)).toBe(true);
      expect(SessionManager.getSession(id)).toBeNull();
    });

    test('should throw for non-existent session', () => {
      expect(() => SessionManager.deleteSession('fake-id')).toThrow('Session not found');
    });
  });

  describe('getAllSessions', () => {
    test('should return all sessions sorted by lastAccessedAt', () => {
      const idA = SessionManager.createSession('A', '1234');
      // Ensure B has a later timestamp by backdating A in the internal map
      const internalSession = (SessionManager as any).sessions.get(idA);
      internalSession.lastAccessedAt = new Date(Date.now() - 10000).toISOString();
      SessionManager.createSession('B', '5678');
      const sessions = SessionManager.getAllSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0].name).toBe('B'); // Most recent first
    });

    test('should not expose PINs', () => {
      SessionManager.createSession('Test', '1234');
      const sessions = SessionManager.getAllSessions();
      expect((sessions[0] as any).pin).toBeUndefined();
    });
  });

  describe('switchToSession', () => {
    test('should switch to unlocked session', () => {
      const id1 = SessionManager.createSession('A', '1234');
      const id2 = SessionManager.createSession('B', '5678');
      const session = SessionManager.switchToSession(id1);
      expect(session.name).toBe('A');
      expect(SessionManager.getActiveSessionId()).toBe(id1);
    });

    test('should require PIN for locked session', () => {
      const id = SessionManager.createSession('A', '1234');
      SessionManager.lockSession(id);
      expect(() => SessionManager.switchToSession(id)).toThrow('PIN required');
    });
  });

  describe('updateSessionUrl', () => {
    test('should update session URL', () => {
      const id = SessionManager.createSession('Test', '1234');
      SessionManager.updateSessionUrl(id, 'http://example.com/page');
      const session = SessionManager.getSession(id);
      expect(session?.currentUrl).toBe('http://example.com/page');
    });
  });

  describe('cleanup', () => {
    test('should clear all sessions', () => {
      SessionManager.createSession('A', '1234');
      SessionManager.createSession('B', '5678');
      SessionManager.cleanup();
      expect(SessionManager.getAllSessions().length).toBe(0);
      expect(SessionManager.getActiveSession()).toBeNull();
    });
  });
});
