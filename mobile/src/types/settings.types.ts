import type {ConnectionMode} from './api.types';

export interface Settings {
  baseUrl: string;
  sessionTimeout: number;
  enableSessionManagement: boolean;
  autoStart?: boolean;
  relayUrl?: string;
  connectionMode?: ConnectionMode;
  workspaceCode?: string;
  hapticsEnabled?: boolean;
  // When true (default), the bearer token persists to SecureStorage on login
  // and the user stays signed in across cold starts until they tap Sign out
  // or the API returns 401. When false, the token lives in memory only — the
  // user is signed in for the current app launch but the cold-start
  // restoreSession flow finds nothing in SecureStorage and routes to login.
  // Surfaced as a "Keep me signed in" checkbox on LoginScreen.
  keepSignedIn?: boolean;
}
