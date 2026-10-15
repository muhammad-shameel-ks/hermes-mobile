import type { ViewStyle } from 'react-native';

import type { Tokens } from '../../ui/tokens.ts';

/**
 * The desktop's WIDGET_SHELL_CLASS: the one panel every inline widget wears, so
 * they cannot drift apart - one radius above the composer, a mode-derived fill,
 * no border (`rounded-3xl bg-(--ui-widget-surface-background) px-3.5 py-3`).
 */
export function widgetShell(t: Tokens): ViewStyle {
  return { borderRadius: t.radius['3xl'], backgroundColor: t.uiWidgetSurfaceBackground, paddingHorizontal: 14, paddingVertical: 12 };
}
