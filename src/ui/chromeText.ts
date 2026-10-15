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
 * On Android, outermost text also defaults to `fontWeight: '400'`. Android's
 * Bold text setting (`Configuration.fontWeightAdjustment`) makes TextView draw
 * weightless text heavier, but React Native 0.86 measures it at the plain
 * weight, so a label is drawn wider than its box and loses its last letters or
 * word ("Archive" → "Archiv", "Used 2 tools" → "Used 2";
 * facebook/react-native#54931, upstream fix #57118). A named weight becomes a
 * style span that measuring and drawing both apply, so they agree. Like font
 * scaling, chrome weight then stays the app's own. Nested text is skipped so it
 * keeps inheriting its parent's weight, and a style that names a weight wins.
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

const ANDROID_WEIGHT = Platform.OS === 'android' ? { fontWeight: '400' as const } : null;

/**
 * `nested` tells nested text apart: a context for Text, `undefined` for
 * TextInput (which never nests), `null` when Text nesting can't be detected.
 */
function wrapDefaults(module: ModuleWithDefault<TextLike>, nested: Context<boolean> | null | undefined): void {
  const original = module.default;
  const wrapped = (props: TextLikeProps) => {
    // `nested` is fixed per wrapper, so the hook runs on every render or on none
    const insideText = nested ? useContext(nested) : nested === null;
    const style = ANDROID_WEIGHT && !insideText ? [ANDROID_WEIGHT, props.style] : props.style;
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
    // without the ancestor context nested text can't be told apart, so Text keeps its weight untouched
  }
  try {
    wrapDefaults(require('react-native/Libraries/Text/Text') as ModuleWithDefault<TextLike>, ancestor);
    wrapDefaults(require('react-native/Libraries/Components/TextInput/TextInput') as ModuleWithDefault<TextLike>, undefined);
  } catch {
    // a module that does not expose a writable default keeps the platform defaults
  }
}

installChromeTextDefaults();
