import {create} from 'zustand';
import SessionManager from '../services/SessionManager';
import type {SessionPublic} from '../types/session.types';

interface SessionState {
  sessions: SessionPublic[];
  activeSession: SessionPublic | null;
  isInitialized: boolean;

  init: () => Promise<void>;
  refreshSessions: () => void;
  createSession: (name: string, pin: string) => string;
  deleteSession: (sessionId: string) => void;
  switchToSession: (sessionId: string, pin?: string) => SessionPublic;
  lockSession: (sessionId: string) => void;
  unlockSession: (sessionId: string, pin: string) => SessionPublic;
  updateSessionUrl: (sessionId: string, url: string) => void;
  cleanup: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSession: null,
  isInitialized: false,

  init: async () => {
    await SessionManager.init();
    SessionManager.setOnSessionLocked(() => {
      set({
        sessions: SessionManager.getAllSessions(),
        activeSession: SessionManager.getActiveSession(),
      });
    });
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
      isInitialized: true,
    });
  },

  refreshSessions: () => {
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
  },

  createSession: (name: string, pin: string) => {
    const id = SessionManager.createSession(name, pin);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
    return id;
  },

  deleteSession: (sessionId: string) => {
    SessionManager.deleteSession(sessionId);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
  },

  switchToSession: (sessionId: string, pin?: string) => {
    const session = SessionManager.switchToSession(sessionId, pin);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
    return session;
  },

  lockSession: (sessionId: string) => {
    SessionManager.lockSession(sessionId);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
  },

  unlockSession: (sessionId: string, pin: string) => {
    const session = SessionManager.unlockSession(sessionId, pin);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
    return session;
  },

  updateSessionUrl: (sessionId: string, url: string) => {
    SessionManager.updateSessionUrl(sessionId, url);
  },

  cleanup: () => {
    SessionManager.cleanup();
    set({sessions: [], activeSession: null});
  },
}));
