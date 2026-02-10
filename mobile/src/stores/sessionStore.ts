import {create} from 'zustand';
import SessionManager from '../services/SessionManager';
import type {SessionPublic} from '../types/session.types';

interface SessionState {
  sessions: SessionPublic[];
  activeSession: SessionPublic | null;
  isInitialized: boolean;

  init: () => Promise<void>;
  refreshSessions: () => void;
  createSession: (name: string, pin: string) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
  switchToSession: (sessionId: string, pin?: string) => Promise<SessionPublic>;
  lockSession: (sessionId: string) => Promise<void>;
  unlockSession: (sessionId: string, pin: string) => Promise<SessionPublic>;
  updateSessionUrl: (sessionId: string, url: string) => Promise<void>;
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

  createSession: async (name: string, pin: string) => {
    const id = await SessionManager.createSession(name, pin);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
    return id;
  },

  deleteSession: async (sessionId: string) => {
    await SessionManager.deleteSession(sessionId);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
  },

  switchToSession: async (sessionId: string, pin?: string) => {
    const session = await SessionManager.switchToSession(sessionId, pin);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
    return session;
  },

  lockSession: async (sessionId: string) => {
    await SessionManager.lockSession(sessionId);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
  },

  unlockSession: async (sessionId: string, pin: string) => {
    const session = await SessionManager.unlockSession(sessionId, pin);
    set({
      sessions: SessionManager.getAllSessions(),
      activeSession: SessionManager.getActiveSession(),
    });
    return session;
  },

  updateSessionUrl: async (sessionId: string, url: string) => {
    await SessionManager.updateSessionUrl(sessionId, url);
  },

  cleanup: () => {
    SessionManager.cleanup();
    set({sessions: [], activeSession: null});
  },
}));
