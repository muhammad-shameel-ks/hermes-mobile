/**
 * Android's assistant card: the window it draws in (`AssistantActivity`), the assistant role it is
 * summoned through, and the edge glow. Absent on other platforms; there the app is never an assistant.
 */

import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** what the edge light is showing: the voice being heard, a turn before its reply, the reply arriving, or rest */
export type GlowPhase = 'idle' | 'listening' | 'thinking' | 'responding';

export type GlowProps = {
  /** 0..1 voice level; the native side eases toward it */
  level: number;
  phase: GlowPhase;
  /** four `#rrggbb` colours travelling round the edge */
  colors: readonly string[];
  style?: StyleProp<ViewStyle>;
  pointerEvents?: 'none';
};

type AssistantNative = {
  isDefaultAssistant(): boolean;
  openAssistantSettings(): boolean;
  whenUnlocked(): Promise<boolean>;
  dismiss(): void;
  openApp(): boolean;
  addListener(event: 'onSummon', listener: () => void): { remove(): void };
};

export const assistant = requireOptionalNativeModule<AssistantNative>('HermesAssistant');

/** the edge glow; resolved on first use, so the app's launch never loads the view manager */
let glowView: ComponentType<GlowProps> | null = null;
export function glowComponent(): ComponentType<GlowProps> {
  glowView ??= requireNativeView<GlowProps>('HermesAssistant');
  return glowView;
}
