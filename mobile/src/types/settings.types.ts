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
  // M3-D — client-side AUTOMATED failover master switch. Default OFF (and
  // OFF everywhere — no deployment auto-enables; §3 guardrail 2). When false
  // the §19.2 routing cascade behaves EXACTLY as the M2 manual path: Rule 4
  // PROMPTS the cashier to switch in Settings and never auto-applies. When
  // true (post §6 proof-gate, per-deployment) Rule 4 AUTO-APPLIES the
  // cloud→on-prem swap under the M3-A hysteresis/cert guards. This is the
  // SINGLE place activation is gated — see routingDecisionService.decideRouting.
  autoFailoverEnabled?: boolean;
}
