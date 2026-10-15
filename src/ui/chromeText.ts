/**
 * Makes `allowFontScaling` default to off for every Text and TextInput.
 *
 * Issue "Theme and typography emulation on React Native": Chat Text Size and
 * the platform's font scale multiply only the five conversation tokens, so
 * chrome type never moves. The tokens carry the platform scale themselves
 * (`ThemeSpec.fontScale`), which leaves native scaling free to be off
 * everywhere; a call site that passes `allowFontScaling` still wins. (Android's
 * Bold text is cleared natively instead; see plugins/with-android-bold-text.js.)
 *
 * React 19 ignores `defaultProps` on function components, so this swaps the
 * `Text` and `TextInput` getters on the `react-native` exports for thin
 * wrappers. The modules' own `default` exports can't be swapped: Metro compiles
 * them to read-only getters. App code reads `Text` off the shared exports object
 * at render time, so the wrappers reach it, as long as this runs before the
 * first component renders - import it first in index.ts.
 */

import { fontScalingOff, wrapExport } from './chromeTextWrap.ts';

export function installChromeTextDefaults(): void {
  const exports = require('react-native') as object;
  for (const name of ['Text', 'TextInput']) {
    if (!wrapExport(exports, name, fontScalingOff) && __DEV__) {
      console.warn(`chromeText: could not wrap react-native's ${name}; native font scaling stays on.`);
    }
  }
}

installChromeTextDefaults();
