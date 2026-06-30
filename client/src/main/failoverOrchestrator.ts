import { BrowserWindow } from 'electron';
import {
  DrMode,
  DrState,
  DEFAULT_DR_STATE,
  IPC_CHANNELS,
} from '../shared-types/ipc';
import {
  decideRouting,
  RoutingInputs,
  RoutingMode,
  RoutingDecision,
} from './routingDecision';
import { cloudReachability } from './cloudReachability';
import { drState } from './drState';
import { txnActivity } from './txnActivity';
import { settingsStore } from './settingsStore';
import {
  getState as getAuthState,
  handleModeSwitch,
  silentReauth,
} from './authManager';
import { isDirectMode, reportDrPresence } from './relayBridge';
import { drRoutingPoll } from './drRoutingPoll';
import { nasHealthProbe } from './nasHealthProbe';
import { logger } from './logger';

// failoverOrchestrator (Electron main) — M3-E auto-failover + auto-failback.
// The single side-effecting consumer of the routing cascade. Electron analogue
// of mobile's useAutoFailover + useAutoFailback + useRoutingDecision +
// useDrPresenceBeat, collapsed into one main-process module driven by signal
// changes (no React render loop here).
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-A/§M3-B/§M3-C, §3.
//
// FLAG ISOLATION (§3 guardrail 1): autoFailoverEnabled is the SINGLE gate.
//   - Flag OFF (default): the cascade's Rule 4 returns 'outage-prompt' (M2
//     manual path) and Rule 6 the flag-free 'failback-ready'; this module
//     performs NO swap in either direction — behaviour is byte-identical to
//     today. It only publishes the DrState chip/banner (advisory, no actuation).
//   - Flag ON (post §6): Rule 4 → 'outage-auto' triggers the cloud→NAS swap;
//     'failback-ready' triggers the NAS→cloud swap (gated here on the flag).
//
// THE SWAP mirrors the manual Settings switch EXACTLY (SettingsScreen
// confirmModeSwitch): settingsStore.set({connectionMode[, baseUrl]}) then
// handleModeSwitch() (clears the audience-specific bearer) then a SILENT
// re-auth against the new edge (M3-C). Anti-flap latches prevent re-firing
// within one outage/recovery; the cloud-unreachable hysteresis (3 failures)
// and the 45s failback hold window live in the upstream producers + cascade.
//
// NEVER mid-transaction: the cascade's Rule 1 defers (deferred=true) whenever a
// sale/refund is in flight or the cart/Checkout is active, so a swap can't
// interrupt a transaction.

let started = false;
let evaluating = false;
const unsubscribers: Array<() => void> = [];

// Anti-flap latches: once a swap is initiated we latch so a re-evaluation
// can't double-fire. They reset when we are safely back on the OTHER side.
let failoverLatched = false; // cloud→NAS swap in progress / done this outage
let failbackLatched = false; // NAS→cloud swap in progress / done this recovery

// 'switching' is a transient UI state we hold while a swap's clear-session +
// re-auth round-trip is in flight, so the chip reads 🔄 rather than flickering.
let switching = false;

// --- DrState publication to the renderer -----------------------------------

const subscribers = new Set<BrowserWindow>();
let lastPublished: DrState = { ...DEFAULT_DR_STATE };

export function registerDrWindow(win: BrowserWindow): void {
  subscribers.add(win);
  win.on('closed', () => subscribers.delete(win));
}

export function getDrState(): DrState {
  return lastPublished;
}

function emit(next: DrState): void {
  lastPublished = next;
  for (const win of subscribers) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC_CHANNELS.DR_STATE_CHANGED, next);
    } catch (e) {
      logger.warn('[failover] failed to emit DR state', e);
    }
  }
}

// Map the cascade decision + live signals onto the renderer DrState chip.
function resolveDrState(decision: RoutingDecision): DrState {
  const dr = drState.get();
  const settings = settingsStore.get();
  const directMode = settings.connectionMode === 'direct';

  let mode: DrMode;
  if (switching) {
    mode = 'switching';
  } else if (decision.mode === 'offline') {
    mode = 'offline';
  } else {
    // Reflect the ACTUAL connection mode for the steady-state chip (cloud vs
    // local), not the cascade's desired mode — the swap, when it happens,
    // flips connectionMode and we re-publish.
    mode = directMode ? 'local' : 'cloud';
  }

  return {
    mode,
    drEnabled: dr.drEnabled,
    autoFailoverEnabled: settings.autoFailoverEnabled === true,
    promptFailover: decision.promptFailover,
    cloudReachable: cloudReachability.getCloudReachable(),
    nasReachable: dr.nasProbeReachable,
    nasCertMismatch: dr.certTrust === 'mismatch',
  };
}

// --- Cascade input assembly -------------------------------------------------

function buildInputs(): RoutingInputs {
  const dr = drState.get();
  const settings = settingsStore.get();
  const txn = txnActivity.snapshot();
  const currentMode: RoutingMode =
    settings.connectionMode === 'direct' ? 'local' : 'cloud';

  // cloudReachable: null (unknown / cold start) is treated as reachable so a
  // fresh app never demotes the cloud before it has signal — matches mobile.
  const cloudReachable = cloudReachability.getCloudReachable() !== false;

  // nasReachable: the live probe verdict. null (unknown) is treated optimistic
  // ONLY if a target is cached (cold start before the first probe); with no
  // cached target it's false. Matches mobile's null=optimistic-cold-start rule.
  const probe = dr.nasProbeReachable;
  const nasReachable = dr.cachedLocalUrl
    ? probe === null
      ? true
      : probe
    : false;

  return {
    cartItemCount: txn.cartItemCount,
    activeScreen: txn.activeScreen,
    saleInFlight: txn.saleInFlight,
    settlementOrPrintInFlight: txn.settlementOrPrintInFlight,
    accountWriteInFlight: txn.accountWriteInFlight,
    directive: dr.directive,
    cloudReachable,
    nasReachable,
    nasCertTrust: dr.certTrust,
    currentMode,
    cloudReachableSustainedMs: cloudReachability.reachableSustainedMs(),
    // M3-B: the real drain signal. Only honoured when the deployment runs DR
    // (drEnabled); a non-DR / pre-seam deployment keeps hysteresis-only
    // failback by reporting drained=true (mirrors mobile's drEnabled gate).
    reconcileQueueDrained: dr.drEnabled ? dr.failbackEligible : true,
    autoFailoverEnabled: settings.autoFailoverEnabled === true,
  };
}

// --- The swap actuators ------------------------------------------------------

async function doSwap(
  direction: 'failover' | 'failback',
  patch: { connectionMode: 'relay' | 'direct'; baseUrl?: string },
): Promise<void> {
  switching = true;
  evaluate(); // publish 🔄
  try {
    // Mirror the manual Settings switch: persist the new mode/target, then wipe
    // the audience-specific session (handleModeSwitch sets the deliberate-switch
    // banner), then attempt a SILENT re-auth against the new edge.
    settingsStore.set(patch);
    await handleModeSwitch();
    const outcome = await silentReauth();
    logger.info('[failover] swap complete', { direction, reauth: outcome });
  } catch (e) {
    logger.warn('[failover] swap failed', { direction, error: (e as Error)?.message });
  } finally {
    switching = false;
    evaluate(); // re-publish steady-state chip
  }
}

// --- The evaluation loop -----------------------------------------------------

function evaluate(): void {
  if (evaluating) return; // guard against re-entrancy from settings onChange
  evaluating = true;
  try {
    const decision = decideRouting(buildInputs());
    const settings = settingsStore.get();
    const flagOn = settings.autoFailoverEnabled === true;
    const mode = settings.connectionMode;

    // Reset latches when we're safely settled on the other side.
    if (mode === 'relay' && decision.reason !== 'outage-auto') {
      failoverLatched = false;
    }
    if (mode === 'relay' && decision.reason !== 'failback-ready') {
      failbackLatched = false;
    }

    // Publish the advisory chip/banner state regardless of the flag.
    emit(resolveDrState(decision));

    // Actuation is FLAG-GATED + transaction-safe + anti-flap. Flag OFF ⇒ no
    // swap in either direction (M2 manual path), proven by test.
    if (!flagOn || decision.deferred || switching) return;

    if (
      decision.reason === 'outage-auto' &&
      mode === 'relay' &&
      !failoverLatched
    ) {
      const target = drState.get().cachedLocalUrl;
      if (!target) return; // nasUsable should guarantee this; be safe.
      failoverLatched = true;
      void doSwap('failover', { connectionMode: 'direct', baseUrl: target });
      return;
    }

    if (
      decision.reason === 'failback-ready' &&
      mode === 'direct' &&
      !failbackLatched
    ) {
      failbackLatched = true;
      void doSwap('failback', { connectionMode: 'relay' });
      return;
    }
  } finally {
    evaluating = false;
  }
}

// --- DR presence beat (best-effort, Direct mode only) -----------------------

let presenceTimer: ReturnType<typeof setInterval> | null = null;
const PRESENCE_INTERVAL_MS = 60_000;

function deviceId(): string {
  // Stable-enough per-install id. Reuse the workspace+platform as a coarse
  // device key; a precise machine id isn't needed for a presence count.
  return `electron-${process.platform}`;
}

async function beatPresence(): Promise<void> {
  // Only while in Direct (NAS) mode AND DR enabled — zero new requests for a
  // cloud-only / non-DR client. Best-effort: any non-2xx is a silent no-op in
  // the shared reportDrPresence().
  if (!isDirectMode()) return;
  if (!drState.get().drEnabled) return;
  if (!getAuthState().isAuthenticated) return;
  try {
    await reportDrPresence({ device_id: deviceId(), mode: 'local' });
  } catch {
    /* silent — best-effort */
  }
}

// --- Lifecycle ---------------------------------------------------------------

export const failoverOrchestrator = {
  start(): void {
    if (started) return;
    started = true;

    // Re-evaluate whenever ANY input changes: cloud reachability, DR state
    // (routing poll / health probe), or settings (manual mode/flag change).
    unsubscribers.push(cloudReachability.onChange(() => evaluate()));
    unsubscribers.push(drState.onChange(() => evaluate()));
    unsubscribers.push(settingsStore.onChange(() => evaluate()));

    // Start the producers.
    drRoutingPoll.start();
    nasHealthProbe.start();

    // Presence beat loop.
    void beatPresence();
    presenceTimer = setInterval(() => void beatPresence(), PRESENCE_INTERVAL_MS);

    // Initial publish.
    evaluate();
    logger.info('[failover] orchestrator started (dark unless autoFailoverEnabled)');
  },

  // Renderer reported cart/screen — re-evaluate so the mid-transaction defer
  // and the chip stay current.
  reportActivity(report: { cartItemCount: number; activeScreen: string | null }): void {
    txnActivity.report(report);
    evaluate();
  },

  stop(): void {
    for (const u of unsubscribers.splice(0)) u();
    drRoutingPoll.stop();
    nasHealthProbe.stop();
    if (presenceTimer) {
      clearInterval(presenceTimer);
      presenceTimer = null;
    }
    started = false;
  },

  // Test hooks.
  _evaluateForTests(): void {
    evaluate();
  },
  _resetForTests(): void {
    this.stop();
    failoverLatched = false;
    failbackLatched = false;
    switching = false;
    evaluating = false;
    lastPublished = { ...DEFAULT_DR_STATE };
  },
};
