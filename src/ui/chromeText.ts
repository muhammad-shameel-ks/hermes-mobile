/**
 * Makes `allowFontScaling` default to off for every Text and TextInput.
 *
 * Issue "Theme and typography emulation on React Native": Chat Text Size and
 * the platform's font scale multiply only the five conversation tokens, so
 * chrome type never moves. The tokens carry the platform scale themselves
 * (`ThemeSpec.fontScale`), which leaves native scaling free to be off
 * everywhere; a call site that passes `allowFontScaling` still wins.
 *
 * React 19 ignores `defaultProps` on function components, so this swaps the
 * default export of RN's Text and TextInput modules for thin wrappers. It must
 * run before the first component renders, so import it first in index.ts.
 */

import { createElement, type ComponentType } from 'react';

type Scalable = ComponentType<{ allowFontScaling?: boolean }> & { displayName?: string };
type ModuleWithDefault = { default: Scalable };

function defaultFontScalingOff(module: ModuleWithDefault): void {
  const original = module.default;
  const wrapped = (props: { allowFontScaling?: boolean }) =>
    createElement(original, { ...props, allowFontScaling: props.allowFontScaling ?? false });
  Object.assign(wrapped, original);
  wrapped.displayName = original.displayName;
  module.default = wrapped;
}

export function installChromeTextDefaults(): void {
  try {
    defaultFontScalingOff(require('react-native/Libraries/Text/Text') as ModuleWithDefault);
    defaultFontScalingOff(require('react-native/Libraries/Components/TextInput/TextInput') as ModuleWithDefault);
  } catch {
    // a module that does not expose a writable default keeps native scaling
  }
}

installChromeTextDefaults();
