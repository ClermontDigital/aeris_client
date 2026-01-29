export const DEFAULT_CONFIG = {
  baseUrl: 'http://aeris.local:8000',
  sessionTimeout: 30, // minutes
  maxSessions: 5,
  maxPinAttempts: 3,
  pinLockoutDuration: 5 * 60 * 1000, // 5 minutes
  sessionCleanupDays: 7,
  enableSessionManagement: false,
};

export const STORAGE_KEYS = {
  SETTINGS: 'aeris_settings',
  SESSIONS: 'aeris_sessions',
  ACTIVE_SESSION: 'aeris_active_session',
  ENCRYPTION_KEY: 'aeris_encryption_key',
};
