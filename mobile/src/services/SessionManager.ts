import BackgroundTimer from 'react-native-background-timer';
import EncryptionService from './EncryptionService';
import StorageService from './StorageService';
import {STORAGE_KEYS, DEFAULT_CONFIG} from '../constants/config';
import type {Session, SessionPublic, PinAttemptData} from '../types/session.types';

function generateId(): string {
  const chars = 'abcdef0123456789';
  let id = '';
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
    if ([8, 12, 16, 20].includes(i)) id += '-';
  }
  return id;
}

class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private activeSessionId: string | null = null;
  private sessionTimers: Map<string, number> = new Map();
  private pinAttempts: Map<string, PinAttemptData> = new Map();
  private sessionTimeout: number = DEFAULT_CONFIG.sessionTimeout;
  private onSessionLocked: ((session: SessionPublic) => void) | null = null;

  setOnSessionLocked(cb: (session: SessionPublic) => void): void {
    this.onSessionLocked = cb;
  }

  async init(): Promise<void> {
    await EncryptionService.init();
    await this.restoreSessions();
  }

  private persistSessions(): void {
    const data = Array.from(this.sessions.values());
    Promise.all([
      StorageService.setItem(STORAGE_KEYS.SESSIONS, data),
      StorageService.setItem(STORAGE_KEYS.ACTIVE_SESSION, this.activeSessionId),
    ]).catch(err => console.error('Failed to persist sessions:', err));
  }

  private async restoreSessions(): Promise<void> {
    const data = await StorageService.getItem<Session[]>(STORAGE_KEYS.SESSIONS);
    if (Array.isArray(data)) {
      for (const s of data) {
        this.sessions.set(s.id, s);
      }
    }
    this.activeSessionId = await StorageService.getItem<string>(STORAGE_KEYS.ACTIVE_SESSION);
  }

  createSession(name: string, pin: string): string {
    if (!name || name.trim().length === 0) {
      throw new Error('Session name is required');
    }
    if (!pin || pin.length !== 4) {
      throw new Error('PIN must be exactly 4 digits');
    }

    for (const session of this.sessions.values()) {
      if (session.name === name.trim()) {
        throw new Error('Session name already exists');
      }
    }

    if (this.sessions.size >= DEFAULT_CONFIG.maxSessions) {
      throw new Error('Maximum of 5 sessions allowed');
    }

    const sessionId = generateId();
    const encryptedPin = EncryptionService.encryptPin(pin);
    const now = new Date().toISOString();

    const session: Session = {
      id: sessionId,
      name: name.trim(),
      pin: encryptedPin,
      createdAt: now,
      lastAccessedAt: now,
      isLocked: false,
      state: {},
      currentUrl: null,
    };

    this.sessions.set(sessionId, session);
    this.activeSessionId = sessionId;
    this.resetSessionTimer(sessionId);
    this.persistSessions();

    return sessionId;
  }

  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    this.clearSessionTimer(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }

    this.sessions.delete(sessionId);
    this.persistSessions();
    return true;
  }

  validatePin(sessionId: string, pin: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const attemptData = this.pinAttempts.get(sessionId);
    if (attemptData?.lockedUntil && attemptData.lockedUntil > Date.now()) {
      const remaining = Math.ceil((attemptData.lockedUntil - Date.now()) / 1000 / 60);
      throw new Error(`Session locked due to too many failed attempts. Try again in ${remaining} minutes.`);
    }

    const decryptedPin = EncryptionService.decryptPin(session.pin);
    const isValid = decryptedPin === pin;

    if (!isValid) {
      if (!attemptData) {
        this.pinAttempts.set(sessionId, {attempts: 1, lockedUntil: null});
      } else {
        attemptData.attempts++;
        if (attemptData.attempts >= DEFAULT_CONFIG.maxPinAttempts) {
          attemptData.lockedUntil = Date.now() + DEFAULT_CONFIG.pinLockoutDuration;
          throw new Error('Too many failed attempts. Session locked for 5 minutes.');
        }
      }
    } else {
      this.pinAttempts.delete(sessionId);
    }

    return isValid;
  }

  unlockSession(sessionId: string, pin: string): SessionPublic {
    if (!this.validatePin(sessionId, pin)) {
      throw new Error('Invalid PIN');
    }

    const session = this.sessions.get(sessionId)!;
    session.isLocked = false;
    session.lastAccessedAt = new Date().toISOString();
    this.activeSessionId = sessionId;
    this.resetSessionTimer(sessionId);
    this.persistSessions();

    return this.getSession(sessionId)!;
  }

  lockSession(sessionId: string): SessionPublic {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.isLocked = true;
    this.clearSessionTimer(sessionId);
    this.persistSessions();

    const pub = this.getSession(sessionId)!;
    this.onSessionLocked?.(pub);
    return pub;
  }

  setSessionTimeout(minutes: number): void {
    if (typeof minutes !== 'number' || minutes < 5 || minutes > 120) {
      this.sessionTimeout = DEFAULT_CONFIG.sessionTimeout;
    } else {
      this.sessionTimeout = minutes;
    }

    for (const sessionId of this.sessionTimers.keys()) {
      this.resetSessionTimer(sessionId);
    }
  }

  private resetSessionTimer(sessionId: string): void {
    this.clearSessionTimer(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session || session.isLocked) return;

    const timer = BackgroundTimer.setTimeout(() => {
      this.lockSession(sessionId);
    }, this.sessionTimeout * 60 * 1000);

    this.sessionTimers.set(sessionId, timer as unknown as number);
  }

  private clearSessionTimer(sessionId: string): void {
    const timer = this.sessionTimers.get(sessionId);
    if (timer !== undefined) {
      BackgroundTimer.clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
    }
  }

  updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && !session.isLocked) {
      session.lastAccessedAt = new Date().toISOString();
      this.resetSessionTimer(sessionId);
    }
  }

  updateSessionState(sessionId: string, state: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = {...session.state, ...state};
      session.lastAccessedAt = new Date().toISOString();
      this.persistSessions();
    }
  }

  updateSessionUrl(sessionId: string, url: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.currentUrl = url;
      session.lastAccessedAt = new Date().toISOString();
      this.persistSessions();
    }
  }

  getSession(sessionId: string): SessionPublic | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const {pin: _pin, ...publicData} = session;
    return publicData;
  }

  getAllSessions(): SessionPublic[] {
    const sessions: SessionPublic[] = [];
    for (const session of this.sessions.values()) {
      const {pin: _pin, ...publicData} = session;
      sessions.push(publicData);
    }
    return sessions.sort(
      (a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime(),
    );
  }

  getActiveSession(): SessionPublic | null {
    if (!this.activeSessionId) return null;
    return this.getSession(this.activeSessionId);
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  switchToSession(sessionId: string, pin?: string): SessionPublic {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.isLocked) {
      if (!pin) throw new Error('PIN required for locked session');
      return this.unlockSession(sessionId, pin);
    }

    this.activeSessionId = sessionId;
    session.lastAccessedAt = new Date().toISOString();
    this.resetSessionTimer(sessionId);
    this.persistSessions();

    return this.getSession(sessionId)!;
  }

  cleanupOldSessions(): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DEFAULT_CONFIG.sessionCleanupDays);

    const toDelete: string[] = [];
    for (const [id, session] of this.sessions.entries()) {
      if (new Date(session.lastAccessedAt) < cutoff) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.deleteSession(id);
    }

    return toDelete.length;
  }

  cleanup(): void {
    for (const timer of this.sessionTimers.values()) {
      BackgroundTimer.clearTimeout(timer);
    }
    this.sessionTimers.clear();
    this.pinAttempts.clear();
    this.sessions.clear();
    this.activeSessionId = null;
    Promise.all([
      StorageService.removeItem(STORAGE_KEYS.SESSIONS),
      StorageService.removeItem(STORAGE_KEYS.ACTIVE_SESSION),
    ]).catch(err => console.error('Failed to clear session storage:', err));
  }
}

export default new SessionManager();
