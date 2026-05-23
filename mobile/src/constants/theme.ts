// Aeris brand tokens — locked palette per
// docs/AERIS_Visual_Brand_Guidelines_v0.3_DRAFT.md §04. Five colours total:
// Royal Red (primary, hero/destructive), Red Dirt Red (accent, CTAs/eyebrow),
// Loyal Navy (primary, default text + chrome), Dusty Blue (secondary accent,
// muted/charts), Clermont Cream (neutral background). Token names are kept
// stable so every screen that already references COLORS.background /
// COLORS.surface / etc. inherits the palette without per-screen edits.
const ROYAL_RED = '#780000';       // PRIMARY — hero panels, destructive states
const CRIMSON = '#c1121f';         // ACCENT — Red Dirt Red, CTAs/eyebrow
const NAVY = '#003049';            // PRIMARY — Loyal Navy, default text/chrome
const DUSTY_BLUE = '#669bbc';      // SECONDARY ACCENT — supporting/muted/charts
const CREAM = '#fdf0d5';           // NEUTRAL — Clermont Cream, default bg
const NAVY_DEEP = '#002239';       // card scrim variant (darker navy)
const NAVY_INK = '#14212b';        // near-black panel + nav bar bg variant
const NAVY_LIGHT = '#1d3a52';
const CREAM_LIGHT = '#fff9ec';     // slightly lighter for elevated cards on cream
const CRIMSON_DARK = '#900';
const CRIMSON_INK = '#6e0000';     // dark-red card variant (legacy alias)
// Body copy is Loyal Navy per Brand Guidelines v0.3 §04 default pairing
// ("Loyal Navy text on Clermont Cream — the high-readability default for
// long-form reading"). Previously this was near-black #171717; flipped to
// navy so headings + body share the same colour and the page reads as one.
// Kept as a literal (not `NAVY`) so tokens/verify.mjs's regex extractor
// resolves it without const-to-const indirection.
const TEXT_BODY = '#003049';

export const COLORS = {
  // --- Brand (v0.3 palette) ---
  royal: ROYAL_RED,
  navy: NAVY,
  navyDeep: NAVY_DEEP,
  navyInk: NAVY_INK,
  navyLight: NAVY_LIGHT,
  blue: DUSTY_BLUE,
  cream: CREAM,
  creamLight: CREAM_LIGHT,
  crimson: CRIMSON,
  crimsonDark: CRIMSON_DARK,
  crimsonInk: CRIMSON_INK,

  // --- Primary / accent (semantic aliases) ---
  primary: NAVY,            // navy chrome (toolbar, tab bar, modal scrim)
  primaryLight: NAVY_LIGHT,
  accent: CRIMSON,          // primary action colour (Red Dirt Red)
  accentHover: CRIMSON_DARK,
  destructive: ROYAL_RED,   // irreversible actions — Royal Red per §10

  // --- Backgrounds: page is CREAM per Brand Guidelines v0.3 §04 default
  // pairing ("Loyal Navy text on Clermont Cream — the high-readability
  // default for long-form reading"). Elevated cards sit on white surface,
  // not cream-on-cream. Accent cards previously using `cream` against the
  // old PAPER body must shift to `surface` (white) to retain contrast.
  background: CREAM,                              // main app body
  surface: '#ffffff',                             // elevated card on cream
  surfaceHover: CREAM_LIGHT,                      // card hover
  surfaceBorder: 'rgba(0, 48, 73, 0.1)',          // Loyal Navy @ 10%
  surfaceBorderHover: 'rgba(0, 48, 73, 0.2)',     // Loyal Navy @ 20%
  modalBg: 'rgba(0, 48, 73, 0.92)',               // navy scrim under modals
  overlayBg: 'rgba(0, 48, 73, 0.85)',             // navy overlay (loading)

  // --- Text ---
  // `text` keeps NAVY for headings/labels/emphasis. `textBody` is the new
  // near-black body-copy colour used across the web for paragraph text.
  text: NAVY,
  textBody: TEXT_BODY,
  textLight: NAVY_LIGHT,
  textMuted: '#5b7a8e',     // muted navy/slate for secondary text
  textDim: '#94a3b8',
  // Inverse text (for use on navy chrome / crimson buttons)
  textOnDark: CREAM,
  textOnDarkMuted: '#cce5f7',  // pastel blue for subdued chrome subtext

  // --- Status ---
  success: '#16a34a',       // slightly darker green: legible on cream
  successDark: '#15803d',
  danger: CRIMSON,          // align "danger" with brand crimson
  dangerLight: '#dc2626',
  warning: '#f59e0b',
  // Amber alert palette (warning banners / expired-session card). Promoted
  // from LoginScreen's private LOGIN constants so any screen can use them.
  warningBg: '#fef3c7',     // amber-100; chip backdrop
  warningBorder: '#f59e0b', // amber-500; warm border
  warningText: '#92400e',   // amber-900; readable on cream
  warningTextDark: '#b45309', // amber-700; icon tint

  // --- Neutrals ---
  white: '#ffffff',
  black: '#000000',
  border: 'rgba(0, 48, 73, 0.15)',  // Loyal Navy @ 15%
  transparent: 'transparent',

  // --- Toolbar (NAVY chrome — kept dark to match desktop's top bar) ---
  toolbarBg: NAVY,
  toolbarBtn: 'rgba(255, 255, 255, 0.12)',
  toolbarBtnHover: 'rgba(255, 255, 255, 0.2)',
  toolbarBtnBorder: 'rgba(255, 255, 255, 0.2)',

  // --- Inputs (white field on cream) ---
  inputBg: '#ffffff',
  inputBorder: 'rgba(0, 48, 73, 0.2)',  // Loyal Navy @ 20%
  inputFocusBorder: CRIMSON,
  inputFocusBg: '#ffffff',
  inputPlaceholder: 'rgba(0, 48, 73, 0.4)',  // Loyal Navy @ 40%
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const FONT_SIZE = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  title: 32,
  // Display ladder from the web (Figma export): 28 / 36 / 43. These are
  // exposed for Phase 3 components (PillButton + MotionCard + dashboard /
  // login titles); existing screens continue to use `title` until then.
  display: 28,
  displayLg: 36,
  displayXl: 43,
  // Eyebrow labels — Poppins SemiBold all-caps, 12-14px digital per §06.
  eyebrow: 12,
} as const;

// Poppins-based font-family tokens — the four weights specified by Brand
// Guidelines v0.3 §05. Mobile loads these via expo-font (see App.tsx +
// app.json plugin entry). Use these instead of `fontWeight` props so weight
// and family land together — on Android the `fontWeight` numeric fallback
// silently snaps to the closest installed family weight, which produces
// inconsistent rendering across devices.
export const FONT_FAMILY = {
  regular: 'Poppins-Regular',     // 400 — body, nav labels, default text
  medium: 'Poppins-Medium',       // 500 — H3, body emphasis, sub-section titles
  semibold: 'Poppins-SemiBold',   // 600 — H2, buttons, eyebrow labels
  bold: 'Poppins-Bold',           // 700 — display / H1, dominant headings
} as const;

// Display tracking from the web. Negative values tighten headings the way
// the marketing site's display type does; `wideSm` is for caps / eyebrow
// labels. `eyebrow` = 4% of 14px (the spec's lower bound, §06).
export const LETTER_SPACING = {
  tightXl: -1.29,
  tightLg: -0.84,
  tightMd: -0.6,
  tightSm: -0.42,
  wideSm: 0.1,
  eyebrow: 0.56,
} as const;

export const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  // Signature web card radius (`rounded-[24px]`, 56× in the export). Per
  // §07 cards use 24-32px; xxxl is the upper bound for hero panels.
  xxl: 24,
  xxxl: 32,
  full: 9999,
} as const;

// Shadow tokens for elevation/cardness — RN takes both elevation (Android)
// and shadow* (iOS); pre-bake the cross-platform pair so screens don't
// reinvent it.
export const SHADOW = {
  card: {
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  cardElevated: {
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.10,
    shadowRadius: 8,
  },
  toolbar: {
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
} as const;

// Animation timing tokens (ms). fast = press feedback / chip toggles;
// base = list/card transitions.
export const TRANSITION = {fast: 150, base: 220} as const;

// Standardised icon-size tokens for Ionicons across the app.
// action: inline buttons / row icons. hero: empty-state / dashboard cards.
// stat: the big number above a stat label.
export const ICON_SIZE = {action: 18, hero: 24, stat: 28} as const;

// Standardised square button sizes for compact toolbars and toolbar-rail
// affordances. Use these instead of hard-coding 36/44.
export const BUTTON_SIZE = {sm: 36, md: 40, lg: 44} as const;
