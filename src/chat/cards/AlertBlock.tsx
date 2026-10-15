/**
 * A GitHub-style alert (`> [!NOTE]`, tip, important, warning, caution) as the
 * desktop's callout: a tinted heading over the quote's body. The marker is read
 * from the rendered children the way the desktop reads it, and stripped from the
 * first text that carries it.
 */

import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Codicon, type CodiconName } from '../../ui/Codicon.tsx';
import { mixPct } from '../../ui/color.ts';
import { useTokens } from '../../ui/tokens.ts';
import { AlertGlyph } from '../../ui/ToolIcon.tsx';
import { ALERT_ACCENT, ALERT_LABEL, ALERT_MARKER_RE, alertTypeOf, type AlertType } from '../alert.ts';

function firstText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    for (const child of node) {
      const text = firstText(child);
      if (text.trim()) return text;
    }
    return '';
  }
  if (isValidElement(node)) return firstText((node.props as { children?: ReactNode }).children);
  return '';
}

function stripMarker(node: ReactNode, state: { done: boolean }): ReactNode {
  if (state.done) return node;
  if (typeof node === 'string') {
    const replaced = node.replace(ALERT_MARKER_RE, '');
    if (replaced !== node) state.done = true;
    return replaced;
  }
  if (Array.isArray(node)) return node.map((child) => stripMarker(child, state));
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    if (children == null) return node;
    return cloneElement(node, undefined, ...Children.toArray(stripMarker(children, state)));
  }
  return node;
}

/** the alert a blockquote's rendered children spell out, with the marker removed from the body; null for a plain quote */
export function extractAlert(children: ReactNode): { type: AlertType; body: ReactNode } | null {
  const type = alertTypeOf(firstText(children));
  return type ? { type, body: stripMarker(children, { done: false }) } : null;
}

const ICON: Record<AlertType, CodiconName | null> = { caution: 'warning', important: null, note: 'info', tip: 'zap', warning: 'warning' };

export function AlertBlock({ type, children }: { type: AlertType; children: ReactNode }) {
  const t = useTokens();
  const accent = ALERT_ACCENT[type][t.renderedMode];
  const icon = ICON[type];
  return (
    <View
      style={[
        styles.box,
        { borderColor: t.uiStrokeTertiary, backgroundColor: mixPct(t.uiTextPrimary, 0.06, 'transparent'), borderRadius: t.radius['3xl'] },
      ]}
    >
      <View style={styles.head}>
        {icon ? <Codicon name={icon} size={16} color={accent} /> : <AlertGlyph size={16} color={accent} />}
        <Text style={{ color: accent, fontSize: 13, fontWeight: '600' }}>{ALERT_LABEL[type]}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
});
