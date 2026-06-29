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
  // §19.4 presence beacon — cloud (relay) sink gate. Defaults to off/undefined.
  // The gateway /presence/beacon endpoint does not exist yet, so the relay
  // beacon is NOT emitted for ordinary cloud-only clients (it would be
  // fleet-wide 404 noise). usePresenceBeacon emits the relay sink only when DR
  // is actually in use for this client OR when this flag is explicitly set.
  // Remove the gate once the gateway presence contract ships (§22.5 Q10).
  presenceBeaconEnabled?: boolean;
}
