const crypto = require('crypto');
const { EventEmitter } = require('events');

class SessionManager extends EventEmitter {
    constructor(store) {
        super();
        this.sessions = new Map();
        this.activeSessionId = null;
        this.maxSessions = 5;
        this.sessionTimeout = 30; // minutes
        this.sessionTimers = new Map();
        this.pinAttempts = new Map(); // Track PIN attempts per session
        this.maxPinAttempts = 3;
        this.pinLockoutDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
        this.store = store || null;
        this.restoreSessions();
    }

    hashPin(pin) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(pin.toString(), salt, 64).toString('hex');
        return { hash, salt };
    }

    verifyPin(pin, hashedData) {
        const hash = crypto.scryptSync(pin.toString(), hashedData.salt, 64);
        const storedHash = Buffer.from(hashedData.hash, 'hex');
        return crypto.timingSafeEqual(hash, storedHash);
    }

    generateSessionId() {
        return crypto.randomUUID();
    }

    createSession(name, pin) {
        if (!name || name.trim().length === 0) {
            throw new Error('Session name is required');
        }

        if (name.trim().length > 50) {
            throw new Error('Session name must be 50 characters or fewer');
        }

        if (!pin || !/^\d{4}$/.test(pin.toString())) {
            throw new Error('PIN must be exactly 4 digits');
        }

        // Check for duplicate session names
        for (const session of this.sessions.values()) {
            if (session.name === name.trim()) {
                throw new Error('Session name already exists');
            }
        }

        if (this.sessions.size >= 5) {
            throw new Error('Maximum of 5 sessions allowed');
        }

        const sessionId = this.generateSessionId();
        const hashedPin = this.hashPin(pin);

        const session = {
            id: sessionId,
            name: name.trim(),
            pin: hashedPin,
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            isLocked: false,
            state: {},
            currentUrl: null
        };

        this.sessions.set(sessionId, session);
        
        // Automatically set as active session and start timer
        this.activeSessionId = sessionId;
        this.resetSessionTimer(sessionId);
        
        this.emit('sessionCreated', this.getSession(sessionId));
        this.persistSessions();

        return sessionId;
    }

    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        // Clear any active timers
        this.clearSessionTimer(sessionId);

        // If this is the active session, clear it
        if (this.activeSessionId === sessionId) {
            this.activeSessionId = null;
        }

        this.sessions.delete(sessionId);
        this.emit('sessionDeleted', { sessionId, session });
        this.persistSessions();

        return true;
    }

    validatePin(sessionId, pin) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        // Check if session is locked out due to too many failed attempts
        const attemptData = this.pinAttempts.get(sessionId);
        if (attemptData && attemptData.lockedUntil > Date.now()) {
            const remainingTime = Math.ceil((attemptData.lockedUntil - Date.now()) / 1000 / 60);
            throw new Error(`Session locked due to too many failed attempts. Try again in ${remainingTime} minutes.`);
        }

        const isValid = this.verifyPin(pin, session.pin);
        
        if (!isValid) {
            // Track failed attempt
            if (!attemptData) {
                this.pinAttempts.set(sessionId, { attempts: 1, lockedUntil: null });
            } else {
                attemptData.attempts++;
                if (attemptData.attempts >= this.maxPinAttempts) {
                    attemptData.lockedUntil = Date.now() + this.pinLockoutDuration;
                    throw new Error(`Too many failed attempts. Session locked for 5 minutes.`);
                }
            }
        } else {
            // Clear failed attempts on successful validation
            this.pinAttempts.delete(sessionId);
        }
        
        return isValid;
    }

    unlockSession(sessionId, pin) {
        if (!this.validatePin(sessionId, pin)) {
            throw new Error('Invalid PIN');
        }

        const session = this.sessions.get(sessionId);
        session.isLocked = false;
        session.lastAccessedAt = new Date();
        
        this.activeSessionId = sessionId;
        this.resetSessionTimer(sessionId);
        
        this.emit('sessionUnlocked', this.getSession(sessionId));
        this.persistSessions();
        return this.getSession(sessionId);
    }

    lockSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        session.isLocked = true;
        this.clearSessionTimer(sessionId);
        
        // Don't clear activeSessionId when locking - keep it active so user can unlock
        // if (this.activeSessionId === sessionId) {
        //     this.activeSessionId = null;
        // }

        this.emit('sessionLocked', this.getSession(sessionId));
        this.persistSessions();
        return this.getSession(sessionId);
    }

    setSessionTimeout(minutes) {
        // Validate timeout range (5-120 minutes)
        if (typeof minutes !== 'number' || minutes < 5 || minutes > 120) {
            console.warn(`Invalid session timeout: ${minutes}. Using default of 30 minutes.`);
            this.sessionTimeout = 30;
        } else {
            this.sessionTimeout = minutes;
        }
        
        // Reset all active timers with new timeout
        for (const sessionId of this.sessionTimers.keys()) {
            this.resetSessionTimer(sessionId);
        }
    }

    resetSessionTimer(sessionId) {
        this.clearSessionTimer(sessionId);
        
        const session = this.sessions.get(sessionId);
        if (!session || session.isLocked) {
            return;
        }

        const timer = setTimeout(() => {
            this.lockSession(sessionId);
        }, this.sessionTimeout * 60 * 1000);

        this.sessionTimers.set(sessionId, timer);
    }

    clearSessionTimer(sessionId) {
        const timer = this.sessionTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.sessionTimers.delete(sessionId);
        }
    }

    updateSessionActivity(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && !session.isLocked) {
            session.lastAccessedAt = new Date();
            this.resetSessionTimer(sessionId);
        }
    }

    updateSessionState(sessionId, state) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.state = { ...session.state, ...state };
            session.lastAccessedAt = new Date();
            this.persistSessions();
        }
    }

    updateSessionUrl(sessionId, url) {
        const session = this.sessions.get(sessionId);
        if (session) {
            // Validate URL scheme before storing
            if (url && typeof url === 'string') {
                try {
                    const parsed = new URL(url);
                    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                        return; // Silently reject non-HTTP URLs
                    }
                } catch {
                    return; // Silently reject malformed URLs
                }
            }
            session.currentUrl = url;
            session.lastAccessedAt = new Date();
            this.persistSessions();
        }
    }

    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        // Return session without the encrypted PIN
        const { pin, ...sessionData } = session;
        return sessionData;
    }

    getAllSessions() {
        const sessions = [];
        for (const session of this.sessions.values()) {
            const { pin, ...sessionData } = session;
            sessions.push(sessionData);
        }
        return sessions.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
    }

    getActiveSession() {
        if (!this.activeSessionId) {
            return null;
        }
        return this.getSession(this.activeSessionId);
    }

    switchToSession(sessionId, pin) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        if (session.isLocked) {
            return this.unlockSession(sessionId, pin);
        }

        this.activeSessionId = sessionId;
        session.lastAccessedAt = new Date();
        this.resetSessionTimer(sessionId);
        
        this.emit('sessionSwitched', session);
        return this.getSession(sessionId);
    }

    cleanupOldSessions() {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        const sessionsToDelete = [];
        
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.lastAccessedAt < threeDaysAgo) {
                sessionsToDelete.push(sessionId);
            }
        }
        
        for (const sessionId of sessionsToDelete) {
            console.log(`Cleaning up old session: ${this.sessions.get(sessionId).name}`);
            this.deleteSession(sessionId);
        }
        
        return sessionsToDelete.length;
    }

    persistSessions() {
        if (!this.store) return;
        const data = [];
        for (const [id, session] of this.sessions.entries()) {
            data.push({ ...session, lastAccessedAt: session.lastAccessedAt.toISOString(), createdAt: session.createdAt.toISOString() });
        }
        this.store.set('sessions', data);
        this.store.set('activeSessionId', this.activeSessionId);
    }

    restoreSessions() {
        if (!this.store) return;
        const data = this.store.get('sessions');
        if (!Array.isArray(data)) return;
        for (const s of data) {
            this.sessions.set(s.id, {
                ...s,
                createdAt: new Date(s.createdAt),
                lastAccessedAt: new Date(s.lastAccessedAt)
            });
        }
        this.activeSessionId = this.store.get('activeSessionId') || null;
    }

    cleanup() {
        // Clear all timers
        for (const timer of this.sessionTimers.values()) {
            clearTimeout(timer);
        }
        this.sessionTimers.clear();

        // Clear PIN attempt tracking
        this.pinAttempts.clear();

        // Clear all sessions
        this.sessions.clear();
        this.activeSessionId = null;

        if (this.store) {
            this.store.delete('sessions');
            this.store.delete('activeSessionId');
        }
    }
}

module.exports = SessionManager; 