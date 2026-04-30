// Aeris brand tokens — match Aeris2 web (tailwind.config.js: aeris-navy /
// aeris-cream / aeris-crimson) and the Electron desktop app (navy chrome,
// cream content). Token NAMES are preserved from the prior dark-glass theme
// so every existing screen using COLORS.background / COLORS.surface / etc.
// auto-cascades onto the new palette without per-screen edits.
const NAVY = '#003049';
const NAVY_LIGHT = '#1d3a52';
const CREAM = '#fdf0d5';
const CREAM_LIGHT = '#fff9ec'; // slightly lighter for elevated cards on cream
const CRIMSON = '#c1121f';
const CRIMSON_DARK = '#900';

export const COLORS = {
  // --- Brand ---
  navy: NAVY,
  navyLight: NAVY_LIGHT,
  cream: CREAM,
  creamLight: CREAM_LIGHT,
  crimson: CRIMSON,
  crimsonDark: CRIMSON_DARK,

  // --- Primary / accent (semantic aliases) ---
  primary: NAVY,            // navy chrome (toolbar, tab bar, modal scrim)
  primaryLight: NAVY_LIGHT,
  accent: CRIMSON,          // primary action color (was purple #667eea — retired)
  accentHover: CRIMSON_DARK,

  // --- Backgrounds: flipped from navy → cream to match web/desktop ---
  background: CREAM,                              // main app body
  surface: '#ffffff',                             // elevated card on cream
  surfaceHover: CREAM_LIGHT,                      // card hover
  surfaceBorder: 'rgba(0, 48, 73, 0.1)',          // navy 10%
  surfaceBorderHover: 'rgba(0, 48, 73, 0.2)',     // navy 20%
  modalBg: 'rgba(0, 48, 73, 0.92)',               // navy scrim under modals
  overlayBg: 'rgba(0, 48, 73, 0.85)',             // navy overlay (loading)

  // --- Text: navy on cream now (was cream on navy) ---
  text: NAVY,
  textLight: NAVY_LIGHT,
  textMuted: '#5b7a8e',     // muted navy/slate for secondary text
  textDim: '#94a3b8',
  // Inverse text (for use on navy chrome / crimson buttons)
  textOnDark: CREAM,

  // --- Status ---
  success: '#16a34a',       // slightly darker green: legible on cream
  successDark: '#15803d',
  danger: CRIMSON,          // align "danger" with brand crimson
  dangerLight: '#dc2626',
  warning: '#f59e0b',

  // --- Neutrals ---
  white: '#ffffff',
  black: '#000000',
  border: 'rgba(0, 48, 73, 0.15)',
  transparent: 'transparent',

  // --- Toolbar (NAVY chrome — kept dark to match desktop's top bar) ---
  toolbarBg: NAVY,
  toolbarBtn: 'rgba(255, 255, 255, 0.12)',
  toolbarBtnHover: 'rgba(255, 255, 255, 0.2)',
  toolbarBtnBorder: 'rgba(255, 255, 255, 0.2)',

  // --- Inputs (white field on cream) ---
  inputBg: '#ffffff',
  inputBorder: 'rgba(0, 48, 73, 0.2)',
  inputFocusBorder: CRIMSON,
  inputFocusBg: '#ffffff',
  inputPlaceholder: 'rgba(0, 48, 73, 0.4)',
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
} as const;

export const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;
