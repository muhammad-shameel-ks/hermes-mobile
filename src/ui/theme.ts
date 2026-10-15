/**
 * Provisional palette for the pre-auth surfaces.
 *
 * The real theme layer resolves tokens at runtime from the vendored skin tables
 * (issue "Theme and typography emulation on React Native"); until that lands this
 * file carries a handful of values from the desktop's resolved dark ladder so the
 * screens do not invent a second look. Replace wholesale, do not extend.
 */
export const theme = {
  /** desktop chrome */
  background: '#0d1015',
  /** desktop elevated surface */
  surface: '#16181d',
  border: 'rgba(230, 237, 243, 0.12)',
  text: '#e6edf3',
  muted: 'rgba(230, 237, 243, 0.6)',
  danger: '#f87171',
  success: '#7ee787',
  /** monochrome until the accent token lands */
  primarySurface: '#e6edf3',
  primaryText: '#0d1015',
  font: 'monospace',
} as const;
