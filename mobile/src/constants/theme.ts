// Aeris brand colors — matches desktop Electron app
export const COLORS = {
  // Primary palette
  primary: '#003049',        // Dark navy — toolbar, main background
  primaryLight: '#004a6e',   // Lighter navy variant
  accent: '#667eea',         // Purple — primary buttons, focus states, loading
  accentHover: '#5a67d8',    // Purple hover state
  crimson: '#c1121f',        // Red accent — active states, session borders, PIN focus
  crimsonDark: '#900',       // Red hover

  // Backgrounds
  background: '#003049',     // Main app background
  surface: 'rgba(255, 255, 255, 0.1)',      // Card/surface on dark bg (glassmorphism)
  surfaceHover: 'rgba(255, 255, 255, 0.15)', // Surface hover state
  surfaceBorder: 'rgba(255, 255, 255, 0.2)', // Surface borders
  surfaceBorderHover: 'rgba(255, 255, 255, 0.4)',
  modalBg: 'rgba(0, 48, 73, 0.95)',         // Modal overlay (backdrop blur)
  overlayBg: 'rgba(0, 0, 0, 0.8)',          // Dark overlay

  // Text
  text: '#fdf0d5',           // Cream — primary text on dark backgrounds
  textLight: '#e2e8f0',      // Light gray — secondary text
  textMuted: '#94a3b8',      // Medium slate — tertiary text
  textDim: '#64748b',        // Dimmed text

  // Status
  success: '#4ade80',        // Green — connected, success
  successDark: '#48bb78',    // Darker green — test button
  danger: '#dc2626',         // Red — error, disconnect, danger buttons
  dangerLight: '#ef4444',    // Lighter red — status dot
  warning: '#f59e0b',        // Amber — update notifications, locked

  // Neutrals
  white: '#ffffff',
  black: '#000000',
  border: 'rgba(255, 255, 255, 0.25)',  // Toolbar button borders
  transparent: 'transparent',

  // Toolbar specific
  toolbarBg: '#003049',
  toolbarBtn: 'rgba(255, 255, 255, 0.15)',
  toolbarBtnHover: 'rgba(255, 255, 255, 0.25)',
  toolbarBtnBorder: 'rgba(255, 255, 255, 0.25)',

  // Input specific
  inputBg: 'rgba(255, 255, 255, 0.1)',
  inputBorder: 'rgba(255, 255, 255, 0.2)',
  inputFocusBorder: '#c1121f',
  inputFocusBg: 'rgba(255, 255, 255, 0.15)',
  inputPlaceholder: 'rgba(253, 240, 213, 0.5)',
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
