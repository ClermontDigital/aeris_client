const SessionManager = require('../session-manager');

describe('SessionManager', () => {
  let sessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    sessionManager.cleanup();
    jest.useRealTimers();
  });

  describe('Session Creation', () => {
    test('should create a session with valid name and PIN', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session.name).toBe('Alice');
      expect(session.id).toBe(sessionId);
      expect(session.pin).toBeUndefined(); // Should not expose PIN
    });

    test('should throw error when name is empty', () => {
      expect(() => sessionManager.createSession('', '1234'))
        .toThrow('Session name is required');
    });

    test('should throw error when name is only whitespace', () => {
      expect(() => sessionManager.createSession('   ', '1234'))
        .toThrow('Session name is required');
    });

    test('should throw error when PIN is not 4 digits', () => {
      expect(() => sessionManager.createSession('Alice', '123'))
        .toThrow('PIN must be exactly 4 digits');

      expect(() => sessionManager.createSession('Alice', '12345'))
        .toThrow('PIN must be exactly 4 digits');
    });

    test('should throw error when PIN is missing', () => {
      expect(() => sessionManager.createSession('Alice', ''))
        .toThrow('PIN must be exactly 4 digits');
    });

    test('should reject duplicate session names', () => {
      sessionManager.createSession('Alice', '1234');

      expect(() => sessionManager.createSession('Alice', '5678'))
        .toThrow('Session name already exists');
    });

    test('should enforce maximum of 5 sessions', () => {
      sessionManager.createSession('User1', '1111');
      sessionManager.createSession('User2', '2222');
      sessionManager.createSession('User3', '3333');
      sessionManager.createSession('User4', '4444');
      sessionManager.createSession('User5', '5555');

      expect(() => sessionManager.createSession('User6', '6666'))
        .toThrow('Maximum of 5 sessions allowed');
    });

    test('should trim whitespace from session names', () => {
      const sessionId = sessionManager.createSession('  Alice  ', '1234');
      const session = sessionManager.getSession(sessionId);

      expect(session.name).toBe('Alice');
    });

    test('should set newly created session as active', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      const activeSession = sessionManager.getActiveSession();

      expect(activeSession).toBeDefined();
      expect(activeSession.id).toBe(sessionId);
    });

    test('should emit sessionCreated event', (done) => {
      sessionManager.on('sessionCreated', (session) => {
        expect(session).toBeDefined();
        expect(session.name).toBe('Alice');
        done();
      });

      sessionManager.createSession('Alice', '1234');
    });
  });

  describe('PIN Encryption and Validation', () => {
    test('should hash PIN before storing', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      const session = sessionManager.sessions.get(sessionId);

      expect(session.pin).toBeDefined();
      expect(session.pin.hash).toBeDefined();
      expect(session.pin.salt).toBeDefined();
      expect(session.pin.hash).not.toBe('1234');
    });

    test('should validate correct PIN', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      const isValid = sessionManager.validatePin(sessionId, '1234');

      expect(isValid).toBe(true);
    });

    test('should reject incorrect PIN', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      const isValid = sessionManager.validatePin(sessionId, '9999');

      expect(isValid).toBe(false);
    });

    test('should throw error for non-existent session during validation', () => {
      expect(() => sessionManager.validatePin('fake-id', '1234'))
        .toThrow('Session not found');
    });
  });

  describe('PIN Attempt Limiting', () => {
    test('should track failed PIN attempts', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.validatePin(sessionId, '0000'); // Failed attempt 1
      sessionManager.validatePin(sessionId, '0000'); // Failed attempt 2

      const attemptData = sessionManager.pinAttempts.get(sessionId);
      expect(attemptData.attempts).toBe(2);
    });

    test('should lock session after 3 failed attempts', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.validatePin(sessionId, '0000'); // Attempt 1
      sessionManager.validatePin(sessionId, '0000'); // Attempt 2

      expect(() => {
        sessionManager.validatePin(sessionId, '0000'); // Attempt 3
      }).toThrow('Too many failed attempts');
    });

    test('should enforce 5-minute lockout', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      // Trigger lockout
      try {
        sessionManager.validatePin(sessionId, '0000');
        sessionManager.validatePin(sessionId, '0000');
        sessionManager.validatePin(sessionId, '0000');
      } catch (e) {
        // Expected
      }

      // Try immediately - should still be locked
      expect(() => {
        sessionManager.validatePin(sessionId, '1234');
      }).toThrow(/locked due to too many failed attempts/);
    });

    test('should reset attempts after successful validation', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.validatePin(sessionId, '0000'); // Failed
      sessionManager.validatePin(sessionId, '0000'); // Failed
      sessionManager.validatePin(sessionId, '1234'); // Success

      const attemptData = sessionManager.pinAttempts.get(sessionId);
      expect(attemptData).toBeUndefined();
    });
  });

  describe('Session Deletion', () => {
    test('should delete a session', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.deleteSession(sessionId);

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeNull();
    });

    test('should throw error when deleting non-existent session', () => {
      expect(() => sessionManager.deleteSession('fake-id'))
        .toThrow('Session not found');
    });

    test('should clear active session if deleted session was active', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.deleteSession(sessionId);

      const activeSession = sessionManager.getActiveSession();
      expect(activeSession).toBeNull();
    });

    test('should emit sessionDeleted event', (done) => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.on('sessionDeleted', ({ sessionId: id }) => {
        expect(id).toBe(sessionId);
        done();
      });

      sessionManager.deleteSession(sessionId);
    });

    test('should clear session timer when deleted', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      expect(sessionManager.sessionTimers.has(sessionId)).toBe(true);

      sessionManager.deleteSession(sessionId);

      expect(sessionManager.sessionTimers.has(sessionId)).toBe(false);
    });
  });

  describe('Session Locking and Unlocking', () => {
    test('should lock a session', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.lockSession(sessionId);

      const session = sessionManager.getSession(sessionId);
      expect(session.isLocked).toBe(true);
    });

    test('should throw error when locking non-existent session', () => {
      expect(() => sessionManager.lockSession('fake-id'))
        .toThrow('Session not found');
    });

    test('should emit sessionLocked event', (done) => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.on('sessionLocked', (session) => {
        expect(session.isLocked).toBe(true);
        done();
      });

      sessionManager.lockSession(sessionId);
    });

    test('should unlock session with correct PIN', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      sessionManager.lockSession(sessionId);

      const unlockedSession = sessionManager.unlockSession(sessionId, '1234');

      expect(unlockedSession.isLocked).toBe(false);
    });

    test('should throw error when unlocking with incorrect PIN', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      sessionManager.lockSession(sessionId);

      expect(() => sessionManager.unlockSession(sessionId, '9999'))
        .toThrow('Invalid PIN');
    });

    test('should emit sessionUnlocked event', (done) => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      sessionManager.lockSession(sessionId);

      sessionManager.on('sessionUnlocked', (session) => {
        expect(session.isLocked).toBe(false);
        done();
      });

      sessionManager.unlockSession(sessionId, '1234');
    });
  });

  describe('Session Timeout', () => {
    test('should set default timeout to 30 minutes', () => {
      expect(sessionManager.sessionTimeout).toBe(30);
    });

    test('should accept valid timeout values (5-120 minutes)', () => {
      sessionManager.setSessionTimeout(60);
      expect(sessionManager.sessionTimeout).toBe(60);

      sessionManager.setSessionTimeout(5);
      expect(sessionManager.sessionTimeout).toBe(5);

      sessionManager.setSessionTimeout(120);
      expect(sessionManager.sessionTimeout).toBe(120);
    });

    test('should reject invalid timeout values', () => {
      sessionManager.setSessionTimeout(4); // Too low
      expect(sessionManager.sessionTimeout).toBe(30); // Should use default

      sessionManager.setSessionTimeout(121); // Too high
      expect(sessionManager.sessionTimeout).toBe(30);

      sessionManager.setSessionTimeout('invalid'); // Wrong type
      expect(sessionManager.sessionTimeout).toBe(30);
    });

    test('should lock session after timeout period', () => {
      sessionManager.setSessionTimeout(1); // 1 minute for testing
      const sessionId = sessionManager.createSession('Alice', '1234');

      // Fast-forward past 1 minute to ensure timer fires
      jest.runAllTimers();

      const session = sessionManager.getSession(sessionId);
      expect(session.isLocked).toBe(true);
    });

    test('should reset timer on activity', () => {
      sessionManager.setSessionTimeout(1);
      const sessionId = sessionManager.createSession('Alice', '1234');

      // Advance 30 seconds
      jest.advanceTimersByTime(30 * 1000);

      // Update activity
      sessionManager.updateSessionActivity(sessionId);

      // Advance another 30 seconds (total 60s, but timer was reset)
      jest.advanceTimersByTime(30 * 1000);

      const session = sessionManager.getSession(sessionId);
      expect(session.isLocked).toBe(false);
    });

    test('should not reset timer for locked sessions', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      sessionManager.lockSession(sessionId);

      const timerBefore = sessionManager.sessionTimers.has(sessionId);
      sessionManager.updateSessionActivity(sessionId);
      const timerAfter = sessionManager.sessionTimers.has(sessionId);

      expect(timerBefore).toBe(false);
      expect(timerAfter).toBe(false);
    });
  });

  describe('Session Switching', () => {
    test('should switch to unlocked session', () => {
      const sessionId1 = sessionManager.createSession('Alice', '1234');
      const sessionId2 = sessionManager.createSession('Bob', '5678');

      const switchedSession = sessionManager.switchToSession(sessionId1, '1234');

      expect(switchedSession.id).toBe(sessionId1);
      expect(sessionManager.getActiveSession().id).toBe(sessionId1);
    });

    test('should unlock and switch to locked session with correct PIN', () => {
      const sessionId1 = sessionManager.createSession('Alice', '1234');
      const sessionId2 = sessionManager.createSession('Bob', '5678');
      sessionManager.lockSession(sessionId1);

      const switchedSession = sessionManager.switchToSession(sessionId1, '1234');

      expect(switchedSession.isLocked).toBe(false);
      expect(sessionManager.getActiveSession().id).toBe(sessionId1);
    });

    test('should throw error for non-existent session', () => {
      expect(() => sessionManager.switchToSession('fake-id', '1234'))
        .toThrow('Session not found');
    });

    test('should update lastAccessedAt on switch', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      const session = sessionManager.sessions.get(sessionId);
      const pastTime = new Date(Date.now() - 10000);
      session.lastAccessedAt = pastTime;

      sessionManager.switchToSession(sessionId, '1234');
      const updatedTime = sessionManager.sessions.get(sessionId).lastAccessedAt;

      expect(updatedTime.getTime()).toBeGreaterThan(pastTime.getTime());
    });
  });

  describe('Session Cleanup', () => {
    test('should cleanup sessions older than 3 days', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      const session = sessionManager.sessions.get(sessionId);

      // Set lastAccessedAt to 4 days ago
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
      session.lastAccessedAt = fourDaysAgo;

      const cleanedCount = sessionManager.cleanupOldSessions();

      expect(cleanedCount).toBe(1);
      expect(sessionManager.getSession(sessionId)).toBeNull();
    });

    test('should not cleanup recent sessions', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      const cleanedCount = sessionManager.cleanupOldSessions();

      expect(cleanedCount).toBe(0);
      expect(sessionManager.getSession(sessionId)).toBeDefined();
    });

    test('should clear all data on cleanup', () => {
      sessionManager.createSession('Alice', '1234');
      sessionManager.createSession('Bob', '5678');

      sessionManager.cleanup();

      expect(sessionManager.sessions.size).toBe(0);
      expect(sessionManager.sessionTimers.size).toBe(0);
      expect(sessionManager.pinAttempts.size).toBe(0);
      expect(sessionManager.activeSessionId).toBeNull();
    });
  });

  describe('Session Listing', () => {
    test('should return all sessions', () => {
      sessionManager.createSession('Alice', '1234');
      sessionManager.createSession('Bob', '5678');
      sessionManager.createSession('Charlie', '9012');

      const sessions = sessionManager.getAllSessions();

      expect(sessions).toHaveLength(3);
      expect(sessions.map(s => s.name)).toContain('Alice');
      expect(sessions.map(s => s.name)).toContain('Bob');
      expect(sessions.map(s => s.name)).toContain('Charlie');
    });

    test('should not expose PINs in session list', () => {
      sessionManager.createSession('Alice', '1234');

      const sessions = sessionManager.getAllSessions();

      expect(sessions[0].pin).toBeUndefined();
    });

    test('should sort sessions by lastAccessedAt (most recent first)', () => {
      const id1 = sessionManager.createSession('Alice', '1234');
      const id2 = sessionManager.createSession('Bob', '5678');
      const id3 = sessionManager.createSession('Charlie', '9012');

      // Backdate all sessions
      const now = Date.now();
      sessionManager.sessions.get(id1).lastAccessedAt = new Date(now - 30000);
      sessionManager.sessions.get(id2).lastAccessedAt = new Date(now - 20000);
      sessionManager.sessions.get(id3).lastAccessedAt = new Date(now - 10000);

      // Update Alice's access time to be most recent
      sessionManager.updateSessionActivity(id1);

      const sessions = sessionManager.getAllSessions();
      expect(sessions[0].name).toBe('Alice');
    });
  });

  describe('Session State Management', () => {
    test('should update session state', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.updateSessionState(sessionId, { cart: ['item1', 'item2'] });

      const session = sessionManager.sessions.get(sessionId);
      expect(session.state.cart).toEqual(['item1', 'item2']);
    });

    test('should update session URL', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');

      sessionManager.updateSessionUrl(sessionId, 'http://aeris.local/dashboard');

      const session = sessionManager.sessions.get(sessionId);
      expect(session.currentUrl).toBe('http://aeris.local/dashboard');
    });

    test('should update lastAccessedAt when updating state', () => {
      const sessionId = sessionManager.createSession('Alice', '1234');
      const session = sessionManager.sessions.get(sessionId);
      const pastTime = new Date(Date.now() - 10000);
      session.lastAccessedAt = pastTime;

      sessionManager.updateSessionState(sessionId, { data: 'test' });
      const updatedTime = sessionManager.sessions.get(sessionId).lastAccessedAt;

      expect(updatedTime.getTime()).toBeGreaterThan(pastTime.getTime());
    });
  });
});
