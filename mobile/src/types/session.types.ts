export interface HashedPin {
  hash: string;
  salt: string;
}

export interface Session {
  id: string;
  name: string;
  pin: HashedPin;
  createdAt: string;
  lastAccessedAt: string;
  isLocked: boolean;
  state: Record<string, unknown>;
  currentUrl: string | null;
}

export interface SessionPublic {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
  isLocked: boolean;
  state: Record<string, unknown>;
  currentUrl: string | null;
}

export interface PinAttemptData {
  attempts: number;
  lockedUntil: number | null;
}
