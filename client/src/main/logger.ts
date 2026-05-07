import log from 'electron-log/main';
import fs from 'fs';
import path from 'path';

// Centralised logger. electron-log writes to the platform log path
// (~/Library/Logs/Aeris/main.log on macOS, %USERPROFILE%\AppData\Roaming\Aeris\logs on Windows).
// The Send Diagnostics button calls getRecentLogs() to bundle the last
// N lines for support.

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

// Token redaction — strip Authorization: Bearer xxx and any `token` field
// from logged payloads so a misuse can't write the bearer to disk.
const TOKEN_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /Bearer\s+[A-Za-z0-9._-]+/g, replacement: 'Bearer [REDACTED]' },
  { re: /"token"\s*:\s*"[^"]*"/g, replacement: '"token":"[REDACTED]"' },
  { re: /"authToken"\s*:\s*"[^"]*"/g, replacement: '"authToken":"[REDACTED]"' },
];

export function redact(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  let out = input;
  for (const { re, replacement } of TOKEN_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export const logger = {
  info: (...args: unknown[]) => log.info(...args.map(redact)),
  warn: (...args: unknown[]) => log.warn(...args.map(redact)),
  error: (...args: unknown[]) => log.error(...args.map(redact)),
  debug: (...args: unknown[]) => log.debug(...args.map(redact)),
};

// Tail the last `maxLines` lines of the active log file. Returns "" when
// no file transport exists yet (e.g. very early in app boot or in tests
// where electron-log is mocked).
export async function getRecentLogs(maxLines = 100): Promise<string> {
  try {
    const file = (log.transports.file as unknown as { getFile?: () => { path: string } | undefined })
      .getFile?.();
    const filePath = file?.path;
    if (!filePath) return '';
    const buf = await fs.promises.readFile(filePath, 'utf8');
    const lines = buf.split('\n');
    const tail = lines.slice(-maxLines).join('\n');
    // Defensive: re-redact in case anything slipped through earlier.
    return typeof tail === 'string' ? (redact(tail) as string) : '';
  } catch (e) {
    log.warn('[logger] getRecentLogs failed', e);
    return '';
  }
}

// Resolve to the active log file path (or null if unknown). Useful for
// tests + the rare admin case of "open log folder".
export function getLogFilePath(): string | null {
  try {
    const file = (log.transports.file as unknown as { getFile?: () => { path: string } | undefined })
      .getFile?.();
    return file?.path ?? null;
  } catch {
    return null;
  }
}

// Re-export path so callers can compose log-folder paths without
// importing 'path' twice.
export { path };

export default logger;
