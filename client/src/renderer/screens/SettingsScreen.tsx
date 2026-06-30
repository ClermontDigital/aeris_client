import React, { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAppLockStore } from '../stores/appLockStore';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../theme/tokens';

const AUTO_LOCK_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '1 minute', value: 1 * 60 * 1000 },
  { label: '2 minutes', value: 2 * 60 * 1000 },
  { label: '5 minutes', value: 5 * 60 * 1000 },
  { label: '15 minutes', value: 15 * 60 * 1000 },
  { label: '30 minutes', value: 30 * 60 * 1000 },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.surfaceBorder}`,
        borderRadius: BORDER_RADIUS.lg,
        padding: SPACING.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING.sm,
      }}
    >
      <h2 style={{ margin: 0, fontSize: FONT_SIZE.lg, color: COLORS.text }}>{title}</h2>
      {children}
    </section>
  );
}

export function SettingsScreen(): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.set);
  const logout = useAuthStore((s) => s.logout);
  const modeSwitch = useAuthStore((s) => s.modeSwitch);
  const lockNow = useAppLockStore((s) => s.lockNow);
  const clearPin = useAppLockStore((s) => s.clearPin);
  const isPinSet = useAppLockStore((s) => s.isPinSet);
  const [version, setVersion] = useState<string>('…');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmWorkspaceSwitch, setConfirmWorkspaceSwitch] = useState(false);
  const [confirmPinReset, setConfirmPinReset] = useState(false);
  const [diagnosticsToast, setDiagnosticsToast] = useState<string | null>(null);
  const [printerNameDraft, setPrinterNameDraft] = useState<string>(
    settings.printerName ?? '',
  );
  // DR Direct/LAN mode (§3.1/§8). Local drafts so the URL field doesn't
  // commit on every keystroke; the mode toggle commits immediately.
  const [baseUrlDraft, setBaseUrlDraft] = useState<string>(settings.baseUrl ?? '');
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  // FIX 2 (§14.7): confirm-then-switch state. Holds the pending target mode +
  // the host the bearer would be sent to, so the dialog can show it before we
  // flip + wipe the session.
  const [pendingModeSwitch, setPendingModeSwitch] = useState<{
    next: 'relay' | 'direct';
    host: string;
  } | null>(null);
  const [printToast, setPrintToast] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    setPrinterNameDraft(settings.printerName ?? '');
  }, [settings.printerName]);

  useEffect(() => {
    setBaseUrlDraft(settings.baseUrl ?? '');
  }, [settings.baseUrl]);

  const onSaveBaseUrl = async () => {
    const trimmed = baseUrlDraft.trim();
    // FIX 1: the AUTHORITATIVE validation lives in MAIN (settingsStore.set →
    // isLocalUrlSafeForCache, §15-2). MAIN rejects an unsafe Direct baseUrl and
    // the IPC invoke rejects; surface that message inline so the cashier sees
    // why it wasn't saved. The renderer is NOT the only check.
    setBaseUrlError(null);
    try {
      await setSettings({ baseUrl: trimmed });
    } catch (e) {
      // Electron prefixes forwarded errors with "Error: " — strip it.
      const msg =
        e instanceof Error ? e.message.replace(/^Error:\s*/, '') : String(e);
      setBaseUrlError(msg);
      // Revert the draft to the last-persisted (safe) value so the field
      // doesn't keep showing the rejected URL as if it were saved.
      setBaseUrlDraft(settings.baseUrl ?? '');
    }
  };

  useEffect(() => {
    void window.aeris.app.version().then(setVersion);
  }, []);

  const onSendDiagnostics = async () => {
    const text = await window.aeris.diagnostics.getRecentLogs(100);
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        setDiagnosticsToast('Diagnostics copied to clipboard.');
      } catch {
        setDiagnosticsToast('Could not access clipboard.');
      }
    } else {
      setDiagnosticsToast('No log lines available.');
    }
    setTimeout(() => setDiagnosticsToast(null), 3000);
  };

  const onSavePrinterName = async () => {
    const trimmed = printerNameDraft.trim();
    await setSettings({ printerName: trimmed === '' ? null : trimmed });
  };

  // Resolve the host the bearer would be sent to after the flip, for the §14.7
  // confirm dialog. →direct targets the NAS (baseUrl); →relay targets the cloud
  // (relayUrl). Falls back to the raw string if it doesn't parse as a URL.
  const targetHostFor = (next: 'relay' | 'direct'): string => {
    const raw = next === 'direct' ? settings.baseUrl : settings.relayUrl;
    if (!raw) return '';
    try {
      return new URL(raw).host;
    } catch {
      return raw;
    }
  };

  // FIX 2 (§14.7): a connection-mode flip (cloud ↔ in-store) changes the auth
  // audience — the relay Sanctum token is not valid on the on-prem ERP and
  // vice-versa. Rather than flip on the bare <select> change, open a confirm
  // dialog that shows the TARGET HOST + the directional copy, mirroring v1's
  // app-wrapper.html handleRoutingModeToggle (which shows "Target: <host>").
  // Only confirmModeSwitch() actually persists + wipes the session.
  const onChangeConnectionMode = (next: 'relay' | 'direct') => {
    if (next === settings.connectionMode) return;
    setPendingModeSwitch({ next, host: targetHostFor(next) });
  };

  // Persist the new mode + wipe the session so the cashier re-authenticates
  // against the new target. Mirrors mobile's SettingsModal (clearLocalSession +
  // the §14.7 copy). Only reached after the user confirms the dialog.
  const confirmModeSwitch = async () => {
    const pending = pendingModeSwitch;
    setPendingModeSwitch(null);
    if (!pending) return;
    try {
      await setSettings({ connectionMode: pending.next });
    } catch (e) {
      // MAIN fail-closed gate refused the switch (e.g. →direct with an unsafe /
      // unset baseUrl). Surface it where the URL field is and abort the flip.
      const msg =
        e instanceof Error ? e.message.replace(/^Error:\s*/, '') : String(e);
      setBaseUrlError(msg);
      return;
    }
    await modeSwitch();
  };

  const onPrintTest = async () => {
    const res = await window.aeris.print.testPage();
    setPrintToast(
      res.ok
        ? { kind: 'success', text: 'Test page sent to the printer.' }
        : { kind: 'error', text: res.message || 'Print failed.' },
    );
    setTimeout(() => setPrintToast(null), 4000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.lg, maxWidth: 720 }}>
      <h1 style={{ fontSize: FONT_SIZE.xxl, color: COLORS.text, margin: 0 }}>Settings</h1>

      <Section title="Workspace & connection">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ color: COLORS.textMuted }}>Workspace</span>
          <span style={{ color: COLORS.text }}>{settings.workspaceCode || '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ color: COLORS.textMuted }}>Relay URL</span>
          <span style={{ color: COLORS.text, fontSize: FONT_SIZE.sm }}>{settings.relayUrl}</span>
        </div>

        {/* DR Direct/LAN mode (§3.1/§8). 'Cloud' = relay via the gateway;
            'In-store' = peer-to-peer over the LAN to the on-prem/NAS server,
            which keeps the till selling during a WAN outage. Switching mode
            re-authenticates against the new target — surfaced as the §14.7
            in-store copy by the login flow. */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs, color: COLORS.text, marginTop: SPACING.sm }}>
          <span>Connection mode</span>
          <select
            value={settings.connectionMode}
            onChange={(e) =>
              onChangeConnectionMode(e.target.value as 'relay' | 'direct')
            }
            style={{
              padding: `${SPACING.sm}px ${SPACING.md}px`,
              border: `1px solid ${COLORS.inputBorder}`,
              borderRadius: BORDER_RADIUS.md,
              background: COLORS.inputBg,
              color: COLORS.text,
            }}
          >
            <option value="relay">Cloud (via Aeris relay)</option>
            <option value="direct">In-store (direct to LAN server)</option>
          </select>
        </label>

        {settings.connectionMode === 'direct' ? (
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs, color: COLORS.text }}
          >
            <span>In-store server URL</span>
            <input
              type="text"
              value={baseUrlDraft}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              onBlur={() => void onSaveBaseUrl()}
              placeholder="https://aeris.shop.local:8822"
              aria-label="In-store server URL"
              style={{
                padding: `${SPACING.sm}px ${SPACING.md}px`,
                border: `1px solid ${COLORS.inputBorder}`,
                borderRadius: BORDER_RADIUS.md,
                background: COLORS.inputBg,
                color: COLORS.text,
              }}
            />
            <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
              The on-prem server's LAN address. Used only in in-store mode.
            </span>
            {baseUrlError ? (
              <span
                role="alert"
                style={{ color: COLORS.danger, fontSize: FONT_SIZE.sm }}
              >
                {baseUrlError}
              </span>
            ) : null}
          </label>
        ) : null}

        {/* DR M3-E auto-failover master flag (default OFF, ships dark). When
            enabled the app automatically fails over cloud→in-store on a
            sustained cloud outage (and back when the cloud returns + the
            sync queue has drained), re-signing-in silently. Per-deployment
            enablement is gated behind the DR proof process; left OFF here. */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: SPACING.sm, color: COLORS.text, marginTop: SPACING.sm }}
        >
          <input
            type="checkbox"
            checked={settings.autoFailoverEnabled}
            onChange={(e) =>
              void setSettings({ autoFailoverEnabled: e.target.checked })
            }
          />
          Automatic failover to in-store mode during a cloud outage
        </label>
        <span style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
          When on, Aeris switches to the in-store server automatically if the
          cloud becomes unreachable, and back when it returns. Leave off unless
          your deployment has been enabled for disaster-recovery failover.
        </span>

        <Button
          variant="secondary"
          onClick={() => setConfirmWorkspaceSwitch(true)}
          style={{ alignSelf: 'flex-start', marginTop: SPACING.xs }}
        >
          Change workspace
        </Button>
      </Section>

      <Section title="App lock">
        <label style={{ display: 'flex', alignItems: 'center', gap: SPACING.sm, color: COLORS.text }}>
          <input
            type="checkbox"
            checked={settings.lockEnabled}
            onChange={(e) => void setSettings({ lockEnabled: e.target.checked })}
          />
          Auto-lock when idle or window loses focus
        </label>
        {!settings.lockEnabled ? (
          <div style={{ color: COLORS.warning, fontSize: FONT_SIZE.sm }}>
            Warning: with auto-lock disabled, anyone with access to this machine can use Aeris.
          </div>
        ) : null}

        <label style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs, color: COLORS.text }}>
          <span>Auto-lock after</span>
          <select
            value={settings.autoLockMs}
            disabled={!settings.lockEnabled}
            onChange={(e) => void setSettings({ autoLockMs: Number(e.target.value) })}
            style={{
              padding: `${SPACING.sm}px ${SPACING.md}px`,
              border: `1px solid ${COLORS.inputBorder}`,
              borderRadius: BORDER_RADIUS.md,
              background: COLORS.inputBg,
              color: COLORS.text,
            }}
          >
            {AUTO_LOCK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <Button variant="secondary" onClick={() => void lockNow()} style={{ alignSelf: 'flex-start' }}>
          Lock now
        </Button>

        {isPinSet ? (
          <Button
            variant="secondary"
            onClick={() => setConfirmPinReset(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            Reset PIN
          </Button>
        ) : null}
      </Section>

      <Section title="Printing">
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: SPACING.xs, color: COLORS.text }}
        >
          <span>Receipt printer name</span>
          <input
            type="text"
            value={printerNameDraft}
            onChange={(e) => setPrinterNameDraft(e.target.value)}
            onBlur={() => void onSavePrinterName()}
            placeholder="Use system default"
            aria-label="Receipt printer name"
            style={{
              padding: `${SPACING.sm}px ${SPACING.md}px`,
              border: `1px solid ${COLORS.inputBorder}`,
              borderRadius: BORDER_RADIUS.md,
              background: COLORS.inputBg,
              color: COLORS.text,
            }}
          />
        </label>
        <p style={{ margin: 0, color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
          Leave blank to use the system's default printer.
        </p>
        <Button
          variant="secondary"
          onClick={() => void onPrintTest()}
          style={{ alignSelf: 'flex-start' }}
        >
          Print test receipt
        </Button>
        {printToast ? (
          <div
            role="status"
            style={{
              color: printToast.kind === 'success' ? COLORS.success : COLORS.danger,
              fontSize: FONT_SIZE.sm,
            }}
          >
            {printToast.text}
          </div>
        ) : null}
      </Section>

      <Section title="About">
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: COLORS.textMuted }}>Version</span>
          <span style={{ color: COLORS.text }}>{version}</span>
        </div>
        <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>Aeris v2 client</div>
      </Section>

      <Section title="Diagnostics">
        <p style={{ margin: 0, color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
          Copy the last 100 lines of the application log to your clipboard so support can
          paste them into a ticket.
        </p>
        <Button variant="secondary" onClick={onSendDiagnostics} style={{ alignSelf: 'flex-start' }}>
          Send Diagnostics
        </Button>
        {diagnosticsToast ? (
          <div role="status" style={{ color: COLORS.success, fontSize: FONT_SIZE.sm }}>
            {diagnosticsToast}
          </div>
        ) : null}
      </Section>

      <Section title="Account">
        <Button
          variant="danger"
          onClick={() => setConfirmLogout(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          Sign out
        </Button>
      </Section>

      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Sign out of Aeris?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmLogout(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void logout()}>
              Sign out
            </Button>
          </>
        }
      >
        You will be returned to the login screen.
      </Modal>

      <Modal
        open={confirmPinReset}
        onClose={() => setConfirmPinReset(false)}
        title="Reset your PIN?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmPinReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmPinReset(false);
                void clearPin();
              }}
            >
              Reset PIN
            </Button>
          </>
        }
      >
        Resetting your PIN clears it immediately. You'll be prompted to set a new
        PIN right away before you can keep using Aeris.
      </Modal>

      {/* FIX 2 (§14.7): mode-switch confirm. Shows the target host + the
          directional copy before flipping + wiping the session. */}
      <Modal
        open={pendingModeSwitch !== null}
        onClose={() => setPendingModeSwitch(null)}
        title={
          pendingModeSwitch?.next === 'direct'
            ? 'Switch to in-store mode'
            : 'Switch to cloud mode'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingModeSwitch(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void confirmModeSwitch()}>
              Switch &amp; sign out
            </Button>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          {pendingModeSwitch?.next === 'direct'
            ? 'Switching to in-store mode — sign in again to continue.'
            : 'Switching to cloud mode — sign in again to continue.'}
        </p>
        {pendingModeSwitch?.host ? (
          <p style={{ margin: `${SPACING.sm}px 0 0`, color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>
            Target: {pendingModeSwitch.host}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={confirmWorkspaceSwitch}
        onClose={() => setConfirmWorkspaceSwitch(false)}
        title="Switch workspace?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmWorkspaceSwitch(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmWorkspaceSwitch(false);
                void logout();
              }}
            >
              Sign out
            </Button>
          </>
        }
      >
        Switching workspace will sign you out. You can choose a different workspace on the
        login screen.
      </Modal>
    </div>
  );
}
