const crypto = require('crypto');
const { EventEmitter } = require('events');

class SessionManager extends EventEmitter {
    constructor() {
        super();
        this.sessions = new Map();
        this.activeSessionId = null;
        this.maxSessions = 5;
        this.sessionTimeout = 30; // minutes
        this.encryptionKey = this.generateEncryptionKey();
        this.sessionTimers = new Map();
    }

    generateEncryptionKey() {
        // Generate a random key for this app session
        return crypto.randomBytes(32);
    }

    encryptPin(pin) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(pin.toString(), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag: authTag.toString('hex')
        };
    }

    decryptPin(encryptedData) {
        try {
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            return null;
        }
    }

    generateSessionId() {
        return crypto.randomUUID();
    }

    createSession(name, pin) {
        if (!name || name.trim().length === 0) {
            throw new Error('Session name is required');
        }

        if (!pin || pin.toString().length !== 4) {
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
        const encryptedPin = this.encryptPin(pin);
        
        const session = {
            id: sessionId,
            name: name.trim(),
            pin: encryptedPin,
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

        return true;
    }

    validatePin(sessionId, pin) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        const decryptedPin = this.decryptPin(session.pin);
        return decryptedPin === pin.toString();
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
        return this.getSession(sessionId);
    }

    setSessionTimeout(minutes) {
        this.sessionTimeout = minutes;
        
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
        }
    }

    updateSessionUrl(sessionId, url) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.currentUrl = url;
            session.lastAccessedAt = new Date();
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

    cleanup() {
        // Clear all timers
        for (const timer of this.sessionTimers.values()) {
            clearTimeout(timer);
        }
        this.sessionTimers.clear();
        
        // Clear all sessions
        this.sessions.clear();
        this.activeSessionId = null;
    }
}

module.exports = SessionManager; 