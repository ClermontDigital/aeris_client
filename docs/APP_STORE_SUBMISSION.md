# AERIS Mobile — App Store Submission Checklist

Step-by-step prep for shipping the AERIS iOS app from TestFlight to public App
Store release. Pair this doc with the latest TestFlight build (currently
`v1.3.20`, ASC App ID `6762179693`, bundle `com.aeris.erp`, Team `6SWY68AFK6`).

The companion docs are:

- `docs/AERIS_Visual_Brand_Guidelines_v0.3_DRAFT.md` — locked design language.
- `mobile/CLAUDE.md` (if present) — build/run instructions.
- `mobile/eas.json` — EAS Build + Submit profile.

---

## 1. Pre-submission code checklist

Run these once before tagging a release build.

- [ ] `cd mobile && npx tsc --noEmit` — typecheck clean.
- [ ] `cd mobile && npm test` — 31 suites pass.
- [ ] `node tokens/verify.mjs` — mobile + website tokens match canonical.
- [ ] `grep -rn "console.log" mobile/src/services mobile/src/stores` — only
  `__DEV__`-gated entries.
- [ ] No `TODO: remove before ship` or `FIXME:` survivors in the diff.
- [ ] `mobile/package.json` versions in sync with `mobile/app.json` `version`.

## 2. App Store Connect — questionnaire answers

### Export compliance

**App uses encryption?** Yes.

**Does it qualify for an exemption?** Yes — uses only standard cryptography
from iOS (Keychain via `expo-secure-store`, HTTPS via the system network
stack). No proprietary or non-exempt crypto. `ITSAppUsesNonExemptEncryption:
false` in `app.json` aligns with this answer.

### Privacy — data types collected

| Data type | Linked to user | Used for tracking? | Purpose |
|---|---|---|---|
| Contact info (email, name) | Yes | No | Auth / app functionality |
| User-ID (server-issued) | Yes | No | Auth / app functionality |
| Business records (sales the merchant rings up) | No | No | Merchant business records, not end-user purchase history |

**Tracking: No.** No advertising SDKs, no IDFA reads, no cross-app
identifiers. `NSPrivacyTracking: false` in `app.json` is honest — verified by
the App Review specialist pass (Section 3).

### App categorisation

- **Primary**: Business
- **Secondary**: Productivity
- **Age rating**: 4+ (no objectionable content; embedded WebView only loads
  the merchant's own admin panel in Direct mode).

### Pricing & availability

- **Price tier**: Free (B2B distribution; merchants are admin-provisioned via
  the AERIS workspace).
- **Availability**: Worldwide (or restrict per business need).

### Content rights

- [ ] Confirm we own / license all assets shipped (logos, fonts: Poppins is
  SIL OFL, free for commercial use; icons: Lucide is ISC, permissive).

### EULA

- [ ] Use Apple's standard EULA unless legal has a custom one.

### Contact

- **App Review Contact**: `shared@clermontdigital.com.au` (verified in
  `mobile/eas.json:submit.production.ios.appleId`).
- Confirm this inbox is actively monitored — Apple sometimes emails
  clarifying questions and 48h silence triggers rejection.

## 3. App Review notes (paste into ASC field)

Use this verbatim as a starting point — tweak per submission:

```
AERIS is a B2B point-of-sale client for merchants who already have an AERIS
ERP account provisioned by their administrator. Self-service signup is not
supported.

Demo account credentials:
  Connection mode: Direct
  Server URL: [insert demo server URL]
  Email: [insert demo email]
  Password: [insert demo password]
  Sample products with barcodes: [insert SKU + barcode pairs]

ATS exceptions justification:

1. NSAllowsLocalNetworking + NSExceptionDomains["aeris.local"]
   The "Direct connection" mode (opt-in toggle in Settings) supports
   self-hosted merchants whose AERIS server lives on the LAN. aeris.local
   is a Bonjour/mDNS LAN hostname that never resolves to a public host.
   Production default is the relay endpoint https://api.aeris.team (HTTPS).

2. NSAllowsArbitraryLoadsInWebContent
   The embedded WebView (ERPScreen) is active in Direct mode only and loads
   the merchant's self-hosted Laravel admin UI. We cannot know each
   merchant's deployment hostname at build time, so a per-host exception
   list is not feasible. The WebView is locked down via origin/scheme
   policing (mobile/src/components/WebViewContainer.tsx).

Account deletion:
  Tap Settings > Delete account. The app opens
  https://aeris.team/account/delete in the browser; the request is
  processed by the workspace administrator. AERIS accounts are
  admin-provisioned, so deletion is admin-mediated (per Apple guideline
  5.1.1(v)).

In-app purchases: None. The app processes payments at the physical POS
between merchant and customer; settlement happens via the merchant's own
payment terminal hardware. Not subject to guideline 3.1.1.
```

## 4. Required artefacts

### Screenshots

iPhone 6.7" (iPhone 15/16 Pro Max sizing) — required:

- [ ] Login screen (clean, brand visible, "Keep me signed in" checked)
- [ ] Dashboard (with sample sales data — not a "Quiet so far" empty state)
- [ ] QuickSale product grid
- [ ] Cart with at least one line item
- [ ] Checkout / payment-method selection
- [ ] Barcode scanner active (camera viewfinder with overlay)
- [ ] Transactions list (default "All" filter, populated)
- [ ] Receipt view (with line items + totals)

iPhone 6.5" (iPhone 11/XS Max sizing) — required:

- [ ] Same eight screens at 6.5" sizing.

iPad — required because `app.json` has `supportsTablet: true`:

- [ ] Login
- [ ] Dashboard
- [ ] QuickSale or Cart
- [ ] Settings (or another representative screen)

### App preview videos (optional but recommended)

- [ ] 15–30s walkthrough: Login → Dashboard → QuickSale → Cart → Checkout →
  Receipt.

### App icon

- [ ] 1024×1024 PNG, square, no alpha, no rounded corners (Apple applies the
  mask).

### Marketing copy

- [ ] **App name**: AERIS (already locked).
- [ ] **Subtitle** (30 chars): e.g. "Point of sale, built for work."
- [ ] **Description**: 1–2 paragraphs. Lead with the value, name the
  audience, list 3–5 capabilities. Sentence case per `§05` of the
  brand guidelines.
- [ ] **Keywords**: 100 chars, comma-separated, no spaces, no plurals if
  the singular already covers it (e.g. "POS,retail,inventory,barcode,
  receipt,payments,POS,iPad,merchant,sale").
- [ ] **Promotional text** (170 chars, can be updated without new build):
  current release notes.
- [ ] **Support URL**, **Marketing URL**, **Privacy Policy URL**: confirm
  these are live before submission. `https://aeris.team/privacy` is the
  expected privacy URL.

## 5. Build profile — EAS

Profile: `production` in `mobile/eas.json`. Locked to `sdk-55` image (Xcode
26.2 / Swift 6.2). Builds run **locally** via:

```bash
cd /Users/developersteve/devfiles/aeris_client/mobile
rm -rf ~/Library/Developer/Xcode/DerivedData ~/Library/Caches/CocoaPods/*
eas build --platform ios --profile production --local --non-interactive
eas submit --platform ios --profile production \
  --path build-<TIMESTAMP>.ipa --non-interactive
```

The cloud-CI workflow is **disabled** (`.github/workflows/build-release.yml`
is in `disabled_manually` state — known to fail in EAS Free quota).

## 6. Pre-submission verification — manual smoke test

Run these on a **real iPhone** after the TestFlight build is processed.

- [ ] Fresh install: launch → splash hands off to Login (no flash, no stuck
  splash).
- [ ] Login with demo creds → Dashboard renders, no console errors.
- [ ] **"Keep me signed in" checked (default)** — kill app, relaunch → land
  on Dashboard directly (token restored from Keychain).
- [ ] **"Keep me signed in" unchecked** — kill app, relaunch → land on
  Login (token not persisted).
- [ ] Cold-start with an **expired token in Keychain** → app routes to
  Login without flashing the "Authentication expired. Retry" banner.
  This is the v1.3.20 fix; before that, the banner flickered briefly.
- [ ] Tap Settings → Delete account → "Continue" → browser opens
  `https://aeris.team/account/delete`.
- [ ] Camera permission hard-deny → "Open Settings" button works.
- [ ] Face ID prompt on AppLockScreen — biometric unlock works.
- [ ] Background the app for 60s, foreground → no surprise logout.
- [ ] Run a full sale: scan barcode → add to cart → checkout → success →
  print receipt PDF preview.
- [ ] **Double-tap "Complete Sale"** — only ONE sale gets created (the
  v1.3.20 submit-lock guard).
- [ ] Sign out → land on Login → cookies cleared (v1.3.19 follow-up).
- [ ] Sign back in with a different account → workspace persists between
  attempts.

## 7. Privacy manifest — verified against actual usage

`app.json` declares the following `NSPrivacyAccessedAPITypes`:

| API category | Reason code | Why we use it |
|---|---|---|
| `UserDefaults` | `CA92.1` | `expo-secure-store` + AsyncStorage internals |
| `FileTimestamp` | `C617.1`, `0A2A.1`, `3B52.1` | AsyncStorage + expo-secure-store reading mtimes on init |
| `SystemBootTime` | `35F9.1` | `expo-application`/`expo-device` uptime fingerprint |
| `DiskSpace` | `E174.1`, `85F4.1` | AsyncStorage internals call `volumeAvailableCapacity` |

`NSPrivacyTracking: false`. `NSPrivacyCollectedDataTypes: []` (no analytics
SDKs ship; the data the app sends to AERIS is documented in Section 2 of
this doc — flows directly to the merchant's own AERIS server).

## 8. Known questions Apple may ask

- **Why the WebView?** ERPScreen embeds the merchant's self-hosted Laravel
  admin UI (Direct mode only). All navigation off-host opens in the system
  browser via `Linking.openURL` (`WebViewContainer.tsx`).
- **Why both Relay and Direct modes?** Relay is the SaaS path
  (`https://api.aeris.team`); Direct is for on-premises deployments. Both
  are first-party AERIS infrastructure.
- **What's `aeris.local`?** Bonjour LAN hostname for self-hosted deployments
  on the merchant's local network. Never a public host.

## 9. Submission day checklist

In order, no skips:

1. [ ] Bump `mobile/package.json` + `mobile/app.json` `version` to the next
   `X.Y.Z`. EAS Build auto-increments `ios.buildNumber` via
   `appVersionSource: remote` in `eas.json`.
2. [ ] Verify section 1 (code checklist) passes.
3. [ ] Build + submit per Section 5.
4. [ ] Wait for TestFlight email — 5–10 minutes Apple processing.
5. [ ] Internal TestFlight smoke test (Section 6) on a real device.
6. [ ] In App Store Connect: select the build → fill out Section 2
   questionnaire → upload Section 4 artefacts → paste Section 3 review notes.
7. [ ] Submit for review.
8. [ ] Monitor `shared@clermontdigital.com.au` for reviewer questions.
9. [ ] On approval: release to App Store (manual or automatic per setting).

## 10. Version trail (current state)

| Version | Notes | Status |
|---|---|---|
| 1.3.17 | Session/cookie hardening | TestFlight (build 66) |
| 1.3.18 | Brand pass v0.3 phase 1 | TestFlight |
| 1.3.19 | Brand pass v0.3 phase 2 (cream body, Lucide migration, CookieManager) | TestFlight |
| 1.3.20 | 401-flicker fix, "Keep me signed in" toggle, ship-block remediations | Pending |

After v1.3.20 lands cleanly on TestFlight + survives Section 6 smoke test,
this is the recommended candidate for App Store submission.
