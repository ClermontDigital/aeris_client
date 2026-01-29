import {useEffect, useCallback} from 'react';
import SessionManager from '../services/SessionManager';
import {useSessionStore} from '../stores/sessionStore';

export function useSessionTimeout(timeoutMinutes: number) {
  const activeSession = useSessionStore(s => s.activeSession);

  useEffect(() => {
    SessionManager.setSessionTimeout(timeoutMinutes);
  }, [timeoutMinutes]);

  useEffect(() => {
    if (activeSession && !activeSession.isLocked) {
      SessionManager.updateSessionActivity(activeSession.id);
    }
  }, [activeSession]);

  /** Call this on user activity (navigation, touch, etc.) to reset the timer */
  const resetTimeout = useCallback(() => {
    if (activeSession && !activeSession.isLocked) {
      SessionManager.updateSessionActivity(activeSession.id);
    }
  }, [activeSession]);

  return {resetTimeout};
}
