// Aeris brand tokens — ported from mobile/src/constants/theme.ts and
// adapted for web (px-suffixed strings, CSS-friendly). The token shape
// matches the mobile app so screens can be cross-referenced without
// rename. global.css publishes these as CSS custom properties on :root.

const NAVY = '#003049';
const NAVY_LIGHT = '#1d3a52';
const CREAM = '#fdf0d5';
const CREAM_LIGHT = '#fff9ec';
const CRIMSON = '#c1121f';
const CRIMSON_DARK = '#900';

export const COLORS = {
  navy: NAVY,
  navyLight: NAVY_LIGHT,
  cream: CREAM,
  creamLight: CREAM_LIGHT,
  crimson: CRIMSON,
  crimsonDark: CRIMSON_DARK,

  primary: NAVY,
  primaryLight: NAVY_LIGHT,
  accent: CRIMSON,
  accentHover: CRIMSON_DARK,

  background: CREAM,
  surface: '#ffffff',
  surfaceHover: CREAM_LIGHT,
  surfaceBorder: 'rgba(0, 48, 73, 0.1)',
  surfaceBorderHover: 'rgba(0, 48, 73, 0.2)',
  modalBg: 'rgba(0, 48, 73, 0.92)',
  overlayBg: 'rgba(0, 48, 73, 0.85)',

  text: NAVY,
  textLight: NAVY_LIGHT,
  textMuted: '#5b7a8e',
  textDim: '#94a3b8',
  textOnDark: CREAM,

  success: '#16a34a',
  successDark: '#15803d',
  danger: CRIMSON,
  dangerLight: '#dc2626',
  warning: '#f59e0b',

  white: '#ffffff',
  black: '#000000',
  border: 'rgba(0, 48, 73, 0.15)',

  toolbarBg: NAVY,
  toolbarBtn: 'rgba(255, 255, 255, 0.12)',
  toolbarBtnHover: 'rgba(255, 255, 255, 0.2)',
  toolbarBtnBorder: 'rgba(255, 255, 255, 0.2)',

  inputBg: '#ffffff',
  inputBorder: 'rgba(0, 48, 73, 0.2)',
  inputFocusBorder: CRIMSON,
  inputFocusBg: '#ffffff',
  inputPlaceholder: 'rgba(0, 48, 73, 0.4)',
} as const;

// Numeric (CSS px assumed) — consumers append 'px' or use template literals
// (`${SPACING.md}px`). Matching the mobile token shape lets a screen-level
// port be largely mechanical.
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
  body: 13,
  tableCell: 13,
} as const;

export const BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const TABLE = {
  rowHeight: 36,
  headerHeight: 40,
  cellPaddingX: 12,
  cellPaddingY: 6,
} as const;

export const SHADOW = {
  card: '0 1px 2px rgba(0,48,73,0.04), 0 1px 3px rgba(0,48,73,0.06)',
  cardHover: '0 4px 12px rgba(0,48,73,0.10)',
  toolbar: '0 2px 8px rgba(0,48,73,0.12)',
} as const;

export const TRANSITION = {
  fast: '120ms ease',
  base: '200ms ease',
} as const;

export const px = (n: number): string => `${n}px`;
