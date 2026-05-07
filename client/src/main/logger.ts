import log from 'electron-log/main';

// Centralised logger. electron-log writes to the platform log path
// (~/Library/Logs/Aeris/main.log on macOS, %USERPROFILE%\AppData\Roaming\Aeris\logs on Windows).
// Phase 3 will wire a "Send Diagnostics" button that bundles the last 100
// lines of these logs.

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

export default logger;
