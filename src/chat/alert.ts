/**
 * GitHub-style alert blockquotes (`> [!NOTE]`). The desktop reads the marker
 * from the rendered children; the mobile renderer does the same over elements.
 * This is the pure half: the marker, the five kinds and their copy.
 */

export type AlertType = 'caution' | 'important' | 'note' | 'tip' | 'warning';

export const ALERT_MARKER_RE = /^\s*\[!(note|tip|important|warning|caution)\]\s*\n?/i;

export const ALERT_LABEL: Record<AlertType, string> = {
  caution: 'Caution',
  important: 'Important',
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
};

/** tailwind's 600 (light) and 400 (dark) steps the desktop tints each kind with */
export const ALERT_ACCENT: Record<AlertType, { light: string; dark: string }> = {
  caution: { light: '#e11d48', dark: '#fb7185' },
  important: { light: '#7c3aed', dark: '#a78bfa' },
  note: { light: '#2563eb', dark: '#60a5fa' },
  tip: { light: '#059669', dark: '#34d399' },
  warning: { light: '#d97706', dark: '#fbbf24' },
};

export function alertTypeOf(text: string): AlertType | null {
  const match = ALERT_MARKER_RE.exec(text);
  return match ? (match[1].toLowerCase() as AlertType) : null;
}
