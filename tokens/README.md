# AERIS brand tokens

`aeris-brand.json` is the single source of truth for AERIS brand
colors, radii, and letter-spacing across the mobile app, the
Electron desktop client, and the marketing site.

## Why it lives here

Two repos ship AERIS brand decisions and they are NOT in a shared
workspace:

- `/Users/developersteve/devfiles/aeris_client` — this monorepo
  (mobile + shared + Electron client).
- `/Users/developersteve/devfiles/aeris_websitev3` — standalone
  marketing site.

Rather than introduce a publish/consume package boundary, both
sides hand-mirror values from `aeris-brand.json` and a verifier
script enforces parity.

## Consumers

### Mobile (`mobile/src/constants/theme.ts`)

Hand-mirrored as top-level `const NAVY = '#...'` declarations plus
the `COLORS = { ... }` map. A future codegen step may emit this
file from `aeris-brand.json`; for now it is human-maintained.

### Marketing site (`aeris_websitev3/styles/theme.css`)

Hand-mirrored under the `:root { --aeris-* }` block near the top
of `theme.css`, and re-exported into the `@theme inline { ... }`
block as `--color-*: var(--aeris-*)` so Tailwind utilities like
`bg-navy`, `text-crimson`, `border-cream-light` resolve.

### Desktop client (Aeris v2)

Today inherits the same palette via the shared CSS the renderer
ships. When that diverges, add a third entry to this README and
the verifier.

## Verifying parity

```bash
node tokens/verify.mjs
```

Reads `aeris-brand.json` and regex-extracts the consumer values,
then reports `MATCH` / `MISMATCH` / `MISSING` per token per
consumer. Exits non-zero on any mismatch — wire into CI when
ready.

Auto-fix the website side (only) with:

```bash
node tokens/verify.mjs --fix-website
```

Mobile is never auto-fixed; the mobile design phase owns
`theme.ts`.

## Updating a token

1. Open a PR against `tokens/aeris-brand.json`.
2. Run `node tokens/verify.mjs` — expect failures pointing at the
   consumers that still hold the old value.
3. Update each consumer:
   - mobile: edit `mobile/src/constants/theme.ts` by hand.
   - website: `node tokens/verify.mjs --fix-website` (or hand-edit
     `aeris_websitev3/styles/theme.css` if you want to control the
     formatting).
4. Re-run `node tokens/verify.mjs` until it reports clean.
5. Commit `tokens/` + the mobile change together. The website
   isn't a git repo so commit there separately if applicable.
