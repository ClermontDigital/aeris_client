/**
 * Validate a workspace code against the gateway regex.
 * Returns null when valid, or a friendly error message string otherwise.
 *
 * Mirrors the gateway-side rule: 3–32 chars, must start with an alphanumeric
 * character, lowercase letters/digits/dashes only. Reserved-name deny-list
 * (e.g. 'admin', 'api', 'auth') is enforced server-side; the gateway returns
 * `workspace_unknown` for those.
 *
 * Does not mutate or trim input — callers (e.g. settingsStore) handle
 * trim/lowercase before invoking this validator.
 */
export function validateWorkspaceCode(code: string): string | null {
  if (!code || code.trim().length === 0) {
    return 'Workspace code is required.';
  }
  if (!/^[a-z0-9][a-z0-9-]{2,30}$/.test(code)) {
    return 'Workspace code must be 3–32 characters: lowercase letters, numbers, and dashes; cannot start with a dash.';
  }
  return null;
}
