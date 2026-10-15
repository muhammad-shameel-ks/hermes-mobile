/**
 * App-wide defaults for every Text and TextInput.
 *
 * `allowFontScaling` defaults to off. Issue "Theme and typography emulation on
 * React Native": Chat Text Size and the platform's font scale multiply only the
 * five conversation tokens, so chrome type never moves. The tokens carry the
 * platform scale themselves (`ThemeSpec.fontScale`), which leaves native scaling
 * free to be off everywhere; a call site that passes `allowFontScaling` still
 * wins.
 *
 * On Android, outermost text also defaults to `fontFamily: 'Roboto'`. OEM
 * system fonts (OnePlus Sans, OPPO Sans and others) render wider than React
 * Native measures them, so single-line text loses its last word ("Thought" →
 * "Though", "Used 2 tools" → "Used 2") and trailing meta sits in a gap
 * (facebook/react-native#15114). Naming a family makes measuring and drawing
 * agree. Nested text is skipped so it keeps inheriting its parent's family,
 * and a style that names its own family still wins.
 *
 * React 19 ignores `defaultProps` on function components, so this swaps the
 * default export of RN's Text and TextInput modules for thin wrappers. It must
 * run before the first component renders, so import it first in index.ts.
 */

import { createElement, useContext, type ComponentType, type Context } from 'react';
import { Platform } from 'react-native';

type TextLikeProps = { allowFontScaling?: boolean; style?: unknown };
type TextLike = ComponentType<TextLikeProps> & { displayName?: string };
type ModuleWithDefault<T> = { default: T };

const ANDROID_FONT = Platform.OS === 'android' ? { fontFamily: 'Roboto' } : null;

/** `nested` tells nested text apart; `undefined` means the component never nests, `null` that it can't be told */
function wrapDefaults(module: ModuleWithDefault<TextLike>, nested: Context<boolean> | null | undefined): void {
  const original = module.default;
  const wrapped = (props: TextLikeProps) => {
    // `nested` is fixed per wrapper, so the hook runs on every render or none
    const insideText = nested ? useContext(nested) : nested === null;
    const style = ANDROID_FONT && !insideText ? [ANDROID_FONT, props.style] : props.style;
    return createElement(original, { ...props, style, allowFontScaling: props.allowFontScaling ?? false });
  };
  Object.assign(wrapped, original);
  wrapped.displayName = original.displayName;
  module.default = wrapped;
}

export function installChromeTextDefaults(): void {
  let ancestor: Context<boolean> | null = null;
  try {
    ancestor = (require('react-native/Libraries/Text/TextAncestorContext') as ModuleWithDefault<Context<boolean>>).default;
  } catch {
    // without the ancestor context, nested text cannot be told apart; leave the family alone
  }
  try {
    wrapDefaults(require('react-native/Libraries/Text/Text') as ModuleWithDefault<TextLike>, ancestor);
    wrapDefaults(require('react-native/Libraries/Components/TextInput/TextInput') as ModuleWithDefault<TextLike>, undefined);
  } catch {
    // a module that does not expose a writable default keeps the platform defaults
  }
}

installChromeTextDefaults();
