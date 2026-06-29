import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ErrorBanner } from '../components/ErrorBanner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZE } from '../theme/tokens';

// Inlined to honour the renderer's "no @aeris/shared runtime imports"
// rule. Mirrors shared/src/constants/config.ts verbatim.
const WORKSPACE_RE = /^[a-z0-9][a-z0-9-]{2,30}$/;
function validateWorkspaceCode(s: string): string | null {
  if (!s) return 'Workspace required.';
  if (!WORKSPACE_RE.test(s)) return 'Workspace: lowercase letters, digits, dashes (3–31 chars).';
  return null;
}

// errorKind → human copy. Mirrors mobile/src/stores/authStore.ts mapping
// so that "session expired" / "wrong creds" / "offline" read identically
// across platforms.
function copyForError(kind: string | null): string | null {
  switch (kind) {
    case 'invalid':
      return 'Workspace, email, or password is incorrect.';
    case 'expired':
      return 'Your session has expired. Please log in again.';
    case 'mode-switch':
      // §21 Q5 copy — mirrors mobile's SettingsModal so the cashier reads the
      // mode change, not an app misbehaviour, mid-shift.
      return 'Switching to in-store mode — sign in again to continue.';
    case 'network':
      return "Couldn't reach the server. Check your connection and try again.";
    case 'unknown':
      return 'Sign in failed. Please try again.';
    default:
      return null;
  }
}

export function LoginScreen(): React.ReactElement {
  const errorKind = useAuthStore((s) => s.errorKind);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const clearError = useAuthStore((s) => s.clearError);
  const persistedWorkspace = useSettingsStore((s) => s.settings.workspaceCode);

  const [workspace, setWorkspace] = useState(persistedWorkspace ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceTouched, setWorkspaceTouched] = useState(false);

  // Settings load asynchronously — sync into local state once.
  useEffect(() => {
    if (persistedWorkspace && !workspace) {
      setWorkspace(persistedWorkspace);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedWorkspace]);

  const workspaceTrimmed = workspace.trim().toLowerCase();
  const workspaceError = workspaceTouched
    ? validateWorkspaceCode(workspaceTrimmed)
    : null;

  const canSubmit =
    !!email.trim() &&
    !!password &&
    !!workspaceTrimmed &&
    validateWorkspaceCode(workspaceTrimmed) === null &&
    !isLoading;

  const onSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!canSubmit) return;
      // Clear stale banner here, not on every keystroke — otherwise the
      // banner flickers as the user types.
      if (errorKind) clearError();
      await login({
        workspaceCode: workspaceTrimmed,
        email: email.trim(),
        password,
      });
    },
    [canSubmit, clearError, errorKind, login, workspaceTrimmed, email, password],
  );

  const errorCopy = copyForError(errorKind);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.primary,
        padding: SPACING.lg,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 460,
          maxWidth: '100%',
          background: COLORS.cream,
          padding: `${SPACING.xl}px ${SPACING.xl}px ${SPACING.xl}px`,
          borderRadius: BORDER_RADIUS.lg,
          border: `1px solid ${COLORS.surfaceBorder}`,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING.md,
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div
          style={{
            fontSize: FONT_SIZE.title,
            fontWeight: 700,
            color: COLORS.text,
            textAlign: 'center',
            marginBottom: SPACING.sm,
          }}
        >
          Aeris
        </div>

        {errorCopy ? (
          <ErrorBanner
            message={errorCopy}
            tone={
              errorKind === 'expired' || errorKind === 'mode-switch'
                ? 'warning'
                : 'error'
            }
          />
        ) : null}

        <TextField
          label="Workspace"
          name="workspace"
          placeholder="acme-prod"
          value={workspace}
          onChange={(e) => {
            setWorkspace(e.target.value.toLowerCase());
          }}
          onBlur={() => setWorkspaceTouched(true)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          maxLength={32}
          disabled={isLoading}
          errorText={workspaceError ?? undefined}
        />

        <TextField
          label="Email"
          name="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          autoComplete="username"
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          disabled={isLoading}
        />

        <TextField
          label="Password"
          name="password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          disabled={isLoading}
        />

        <Button
          type="submit"
          disabled={!canSubmit}
          loading={isLoading}
          fullWidth
          style={{ marginTop: SPACING.sm }}
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
