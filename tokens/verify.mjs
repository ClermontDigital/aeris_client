#!/usr/bin/env node
/**
 * tokens/verify.mjs
 *
 * Verifies that the AERIS brand-token consumers (mobile theme.ts +
 * marketing website theme.css) match the canonical values in
 * tokens/aeris-brand.json. No external deps; Node 22+ built-ins only.
 *
 * Usage:
 *   node tokens/verify.mjs                 # report only, exit 1 on mismatch
 *   node tokens/verify.mjs --fix-website   # rewrite the website --aeris-*
 *                                          # block to match canonical, then
 *                                          # re-verify
 */

import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CANONICAL_PATH = resolve(__dirname, 'aeris-brand.json');
const MOBILE_THEME_PATH = resolve(
  REPO_ROOT,
  'mobile/src/constants/theme.ts',
);
const WEBSITE_THEME_PATH = resolve(
  REPO_ROOT,
  '..',
  'aeris_websitev3/styles/theme.css',
);

const FIX_WEBSITE = process.argv.includes('--fix-website');

// ---- canonical -----------------------------------------------------------

const canonical = JSON.parse(readFileSync(CANONICAL_PATH, 'utf8'));
// `color` = brand-locked palette (§04); both consumers must mirror.
// `support-color` = mobile-only convenience variants; checked against
// mobile only, not the website.
const canonicalColors = canonical.color;
const canonicalSupportColors = canonical['support-color'] || {};
const canonicalMobileColors = {...canonicalColors, ...canonicalSupportColors};

// Normalise hex for comparison. Lowercases, expands 3-digit to 6-digit so
// `#900` and `#990000` compare equal. Pass-through for non-hex.
function normHex(value) {
  if (typeof value !== 'string') return value;
  const m = value.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!m) return value.trim().toLowerCase();
  const hex = m[1].toLowerCase();
  if (hex.length === 3) {
    return '#' + hex.split('').map(c => c + c).join('');
  }
  return '#' + hex;
}

// ---- mobile extractor ----------------------------------------------------

// Map the canonical color keys onto candidate identifiers we expect to find
// in mobile/src/constants/theme.ts. The mobile file uses SCREAMING_SNAKE
// `const NAVY = ...` declarations plus camelCase keys inside `COLORS = { }`.
// We accept either; first match wins.
const MOBILE_COLOR_MAP = {
  // v0.3 brand palette (§04)
  'royal':              ['ROYAL_RED', 'royal'],
  'crimson':            ['CRIMSON', 'crimson'],
  'navy':               ['NAVY', 'navy'],
  'blue':               ['DUSTY_BLUE', 'blue'],
  'cream':              ['CREAM', 'cream'],
  // supporting tokens (variants of the five base colours)
  'navy-light':         ['NAVY_LIGHT', 'navyLight'],
  'navy-deep':          ['NAVY_DEEP', 'navyDeep'],
  'navy-ink':           ['NAVY_INK', 'navyInk'],
  'cream-light':        ['CREAM_LIGHT', 'creamLight'],
  'crimson-dark':       ['CRIMSON_DARK', 'crimsonDark'],
  'text-body':          ['TEXT_BODY', 'textBody'],
  'text-on-dark-muted': ['TEXT_ON_DARK_MUTED', 'textOnDarkMuted'],
};

function extractMobileColors(src) {
  const found = {};
  // const FOO = '#abc' style
  const constRe = /\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*'(#[0-9a-fA-F]{3,8})'/g;
  let m;
  while ((m = constRe.exec(src))) {
    found[m[1]] = normHex(m[2]);
  }
  // camelKey: '#abc' style inside object literals
  const keyRe = /(\b[a-zA-Z][a-zA-Z0-9_]*)\s*:\s*'(#[0-9a-fA-F]{3,8})'/g;
  while ((m = keyRe.exec(src))) {
    // Don't clobber a const-declared value with an object-literal alias.
    if (!(m[1] in found)) found[m[1]] = normHex(m[2]);
  }
  return found;
}

// ---- website extractor ---------------------------------------------------

function extractWebsiteColors(src) {
  const found = {};
  // First pass: direct hex assignments.
  const hexRe = /--aeris-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = hexRe.exec(src))) {
    found[m[1]] = normHex(m[2]);
  }
  // Second pass: var() indirection (e.g. `--aeris-text-body: var(--aeris-navy)`).
  // Resolve transitively against direct-hex tokens we just collected.
  const varRe = /--aeris-([a-z0-9-]+)\s*:\s*var\(--aeris-([a-z0-9-]+)\)\s*;/g;
  while ((m = varRe.exec(src))) {
    const target = m[2];
    if (target in found) found[m[1]] = found[target];
  }
  return found;
}

// ---- diffing -------------------------------------------------------------

const ANSI = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
};

function fmt(label, color) {
  return `${ANSI[color]}${label}${ANSI.reset}`;
}

function diffMobile(mobileFound) {
  const rows = [];
  for (const [key, expected] of Object.entries(canonicalMobileColors)) {
    const candidates = MOBILE_COLOR_MAP[key] || [];
    let actual;
    let resolvedAs;
    for (const cand of candidates) {
      if (cand in mobileFound) {
        actual = mobileFound[cand];
        resolvedAs = cand;
        break;
      }
    }
    if (!actual) {
      rows.push({key, status: 'MISSING', expected: normHex(expected)});
    } else if (actual === normHex(expected)) {
      rows.push({
        key, status: 'MATCH', expected: normHex(expected), actual, resolvedAs,
      });
    } else {
      rows.push({
        key,
        status: 'MISMATCH',
        expected: normHex(expected),
        actual,
        resolvedAs,
      });
    }
  }
  return rows;
}

function diffWebsite(websiteFound) {
  const rows = [];
  for (const [key, expected] of Object.entries(canonicalColors)) {
    const actual = websiteFound[key];
    if (!actual) {
      rows.push({key, status: 'MISSING', expected: normHex(expected)});
    } else if (actual === normHex(expected)) {
      rows.push({key, status: 'MATCH', expected: normHex(expected), actual});
    } else {
      rows.push({
        key,
        status: 'MISMATCH',
        expected: normHex(expected),
        actual,
      });
    }
  }
  return rows;
}

function printReport(label, path, rows) {
  console.log(`\n${ANSI.bold}${label}${ANSI.reset}  ${ANSI.dim}${path}${ANSI.reset}`);
  for (const row of rows) {
    const tag =
      row.status === 'MATCH'    ? fmt('  MATCH   ', 'green') :
      row.status === 'MISMATCH' ? fmt('  MISMATCH', 'red') :
                                  fmt('  MISSING ', 'yellow');
    const detail =
      row.status === 'MATCH'    ? `${row.expected}${row.resolvedAs ? ` (as ${row.resolvedAs})` : ''}` :
      row.status === 'MISMATCH' ? `expected ${row.expected}, got ${row.actual}${row.resolvedAs ? ` (as ${row.resolvedAs})` : ''}` :
                                  `expected ${row.expected}`;
    console.log(`${tag}  ${row.key.padEnd(20)} ${detail}`);
  }
  const bad = rows.filter(r => r.status !== 'MATCH').length;
  console.log(
    bad === 0
      ? `  ${fmt('all clean', 'green')}`
      : `  ${fmt(`${bad} issue${bad === 1 ? '' : 's'}`, 'red')}`,
  );
  return bad;
}

// ---- website fixer -------------------------------------------------------

function buildAerisBlock() {
  // Pad keys to a consistent column so it diffs cleanly. We pad the
  // `--aeris-name:` portion (colon attached) and align the value, so the
  // result reads like a column-aligned table rather than `name        :`.
  const keys = Object.keys(canonicalColors);
  const maxLen = Math.max(...keys.map(k => `--aeris-${k}:`.length));
  return keys.map(k => {
    const head = `--aeris-${k}:`.padEnd(maxLen);
    return `  ${head} ${canonicalColors[k]};`;
  }).join('\n');
}

function buildAerisThemeInline() {
  // Re-export every canonical color as a Tailwind color utility under @theme.
  const keys = Object.keys(canonicalColors);
  const maxLen = Math.max(...keys.map(k => `--color-${k}:`.length));
  return keys.map(k => {
    const head = `--color-${k}:`.padEnd(maxLen);
    return `  ${head} var(--aeris-${k});`;
  }).join('\n');
}

function fixWebsite() {
  let src = readFileSync(WEBSITE_THEME_PATH, 'utf8');

  // Replace the first :root { --aeris-... } block. We assume it sits at the
  // top of the file (the comment-prefaced block we authored). We rewrite
  // the entire block contents so any drift (extra entries, reorder) is
  // normalised back to canonical order.
  const aerisBlockRe = /(:root\s*\{)([^}]*--aeris-[^}]*)(\})/;
  const newAerisBody = '\n' + buildAerisBlock() + '\n';
  if (aerisBlockRe.test(src)) {
    src = src.replace(aerisBlockRe, (_, open, _body, close) => open + newAerisBody + close);
  } else {
    console.error('verify.mjs: could not find :root { --aeris-* } block in website theme.css');
    process.exit(2);
  }

  // Replace the AERIS section inside @theme inline { ... }. We bracket it
  // with a comment marker so the rewrite is idempotent; if the marker is
  // missing we inject it just before the closing brace of @theme inline.
  const themeInlineRe = /@theme\s+inline\s*\{([\s\S]*?)\n\}/;
  const m = src.match(themeInlineRe);
  if (!m) {
    console.error('verify.mjs: could not find @theme inline { ... } in website theme.css');
    process.exit(2);
  }
  const inlineBody = m[1];
  const markerStart = '/* AERIS brand tokens — generated, do not edit by hand. */';
  const markerEnd   = '/* end AERIS brand tokens */';
  const escapeForRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = `\n  ${markerStart}\n${buildAerisThemeInline()}\n  ${markerEnd}\n`;
  // Match every marker pair (g flag) so multiple stale pairs get cleaned.
  const markerRe = new RegExp(
    `\\s*${escapeForRe(markerStart)}[\\s\\S]*?${escapeForRe(markerEnd)}\\s*`,
    'g',
  );
  let newInlineBody;
  if (markerRe.test(inlineBody)) {
    // Strip ALL existing marker pairs, then append one fresh block.
    const stripped = inlineBody.replace(markerRe, '\n');
    newInlineBody = stripped.replace(/\s*$/, '') + block;
  } else {
    // No marker yet. Strip any stale unmarked --color-{key}: var(--aeris-...)
    // lines we previously emitted (older versions of this script did that),
    // then append a fresh marked block.
    let stripped = inlineBody;
    for (const k of Object.keys(canonicalColors)) {
      const stale = new RegExp(
        `\\n?\\s*--color-${k}\\s*:\\s*var\\(--aeris-${k}\\)\\s*;`,
        'g',
      );
      stripped = stripped.replace(stale, '');
    }
    newInlineBody = stripped.replace(/\s*$/, '') + block;
  }

  src = src.replace(themeInlineRe, `@theme inline {${newInlineBody}\n}`);

  writeFileSync(WEBSITE_THEME_PATH, src, 'utf8');
}

// ---- main ----------------------------------------------------------------

function main() {
  let totalBad = 0;

  if (FIX_WEBSITE) {
    if (!existsSync(WEBSITE_THEME_PATH)) {
      console.error(`verify.mjs: website theme.css not found at ${WEBSITE_THEME_PATH}`);
      process.exit(2);
    }
    fixWebsite();
    console.log(`${fmt('fixed', 'green')} website --aeris-* block + @theme inline AERIS section`);
  }

  // Mobile
  if (existsSync(MOBILE_THEME_PATH)) {
    const mobileSrc = readFileSync(MOBILE_THEME_PATH, 'utf8');
    const mobileFound = extractMobileColors(mobileSrc);
    const mobileRows = diffMobile(mobileFound);
    totalBad += printReport('Mobile  theme.ts', MOBILE_THEME_PATH, mobileRows);
  } else {
    console.error(`${fmt('SKIP', 'yellow')} mobile theme.ts not found at ${MOBILE_THEME_PATH}`);
    totalBad += 1;
  }

  // Website
  if (existsSync(WEBSITE_THEME_PATH)) {
    const websiteSrc = readFileSync(WEBSITE_THEME_PATH, 'utf8');
    const websiteFound = extractWebsiteColors(websiteSrc);
    const websiteRows = diffWebsite(websiteFound);
    totalBad += printReport('Website theme.css', WEBSITE_THEME_PATH, websiteRows);
  } else {
    console.error(`${fmt('SKIP', 'yellow')} website theme.css not found at ${WEBSITE_THEME_PATH}`);
    totalBad += 1;
  }

  console.log('');
  if (totalBad === 0) {
    console.log(`${fmt('OK', 'green')} all consumers match canonical tokens`);
    process.exit(0);
  } else {
    console.log(`${fmt('FAIL', 'red')} ${totalBad} drift${totalBad === 1 ? '' : 's'} across consumers`);
    process.exit(1);
  }
}

main();
