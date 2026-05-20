// Aeris brand tokens — match the marketing website's Figma export (canonical
// source of truth) and the Electron desktop app. The website uses navy
// `#002a40` consistently (26 Figma occurrences), so this is now the brand
// primary even though earlier versions of the mobile app and the Tailwind
// config used the slightly cooler `#003049`. Token NAMES are preserved from
// the prior theme so every existing screen using COLORS.background /
// COLORS.surface / etc. auto-cascades onto the new palette without per-
// screen edits.
const NAVY = '#002a40';            // canonical brand navy (Figma export)
const NAVY_DEEP = '#002239';       // card scrim variant from web
const NAVY_INK = '#14212b';        // near-black panel + nav bar bg variant
const NAVY_LIGHT = '#1d3a52';
const BLUE_ACCENT = '#346e95';     // mid-blue accent card
const CREAM = '#fdf0d5';           // wheat cream — chip/badge surfaces ONLY
const CREAM_LIGHT = '#fff9ec';     // slightly lighter for elevated cards on cream
const PAPER = '#f7f2ef';           // cooler off-white — page background (web)
const CRIMSON = '#c1121f';
const CRIMSON_DARK = '#900';
const CRIMSON_INK = '#6e0000';     // dark-red card variant
const TEXT_BODY = '#171717';       // near-black body copy (web standard)

export const COLORS = {
  // --- Brand ---
  navy: NAVY,
  navyDeep: NAVY_DEEP,
  navyInk: NAVY_INK,
  navyLight: NAVY_LIGHT,
  blueAccent: BLUE_ACCENT,
  cream: CREAM,
  creamLight: CREAM_LIGHT,
  paper: PAPER,
  crimson: CRIMSON,
  crimsonDark: CRIMSON_DARK,
  crimsonInk: CRIMSON_INK,

  // --- Primary / accent (semantic aliases) ---
  primary: NAVY,            // navy chrome (toolbar, tab bar, modal scrim)
  primaryLight: NAVY_LIGHT,
  accent: CRIMSON,          // primary action color (was purple #667eea — retired)
  accentHover: CRIMSON_DARK,

  // --- Backgrounds: flipped from navy → cream to match web/desktop ---
  // NOTE: `background` keeps CREAM for now to preserve current screen look;
  // Phase 3 will migrate page surfaces to `paper` and reserve `cream` for
  // chip/badge surfaces only — easy to confuse, hence the two distinct
  // tokens here.
  background: CREAM,                              // main app body
  surface: '#ffffff',                             // elevated card on cream
  surfaceHover: CREAM_LIGHT,                      // card hover
  surfaceBorder: 'rgba(0, 42, 64, 0.1)',          // navy 10%
  surfaceBorderHover: 'rgba(0, 42, 64, 0.2)',     // navy 20%
  modalBg: 'rgba(0, 42, 64, 0.92)',               // navy scrim under modals
  overlayBg: 'rgba(0, 42, 64, 0.85)',             // navy overlay (loading)

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
  border: 'rgba(0, 42, 64, 0.15)',
  transparent: 'transparent',

  // --- Toolbar (NAVY chrome — kept dark to match desktop's top bar) ---
  toolbarBg: NAVY,
  toolbarBtn: 'rgba(255, 255, 255, 0.12)',
  toolbarBtnHover: 'rgba(255, 255, 255, 0.2)',
  toolbarBtnBorder: 'rgba(255, 255, 255, 0.2)',

  // --- Inputs (white field on cream) ---
  inputBg: '#ffffff',
  inputBorder: 'rgba(0, 42, 64, 0.2)',
  inputFocusBorder: CRIMSON,
  inputFocusBg: '#ffffff',
  inputPlaceholder: 'rgba(0, 42, 64, 0.4)',
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
} as const;

// Display tracking from the web. Negative values tighten headings the way
// the marketing site's display type does; `wideSm` is for caps / eyebrow
// labels.
export const LETTER_SPACING = {
  tightXl: -1.29,
  tightLg: -0.84,
  tightMd: -0.6,
  tightSm: -0.42,
  wideSm: 0.1,
} as const;

export const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  // Signature web card radius (`rounded-[24px]`, 56× in the export).
  xxl: 24,
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
