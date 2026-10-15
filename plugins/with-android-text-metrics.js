/**
 * Stops Android 15+ dropping the last word of a Text (facebook/react-native
 * #53286, #56402; upstream fix pending in #58280).
 *
 * Apps targeting API 35+ get `useBoundsForWidth=true` in every TextView: lines
 * break on glyph ink bounds. React Native measures text with a StaticLayout that
 * breaks on glyph advances, but paints it with ReactTextView's own TextView
 * layout. For a font whose ink overhangs its advance (several OEM system fonts,
 * bold weights, emoji fallbacks) the painted layout wraps a word the measured
 * one kept, the wrapped line falls outside the measured height, and the word
 * vanishes while its space stays ("Used 2 tools" → "Used 2", trailing meta
 * floating in a gap). React Native 0.86 still ships the reverted fix, so this
 * gives every TextView the pre-15 metrics through the theme's `textViewStyle`.
 *
 * ReactTextView is created with the theme's default `textViewStyle`, so the
 * style reaches every Text. Remove this once React Native measures and paints
 * with the same line breaking.
 */

const { withAndroidStyles } = require('expo/config-plugins');

const APP_THEME = 'AppTheme';
const STYLE_NAME = 'Widget.Hermes.TextView';
const ITEMS = {
  'android:useBoundsForWidth': 'false',
  'android:elegantTextHeight': 'false',
  'android:useLocalePreferredLineHeightForMinimum': 'false',
};

function upsertItem(style, name, value) {
  style.item = style.item ?? [];
  const existing = style.item.find((item) => item?.$?.name === name);
  if (existing) existing._ = value;
  else style.item.push({ _: value, $: { name } });
}

module.exports = function withAndroidTextMetrics(config) {
  return withAndroidStyles(config, (mod) => {
    const resources = (mod.modResults.resources ??= {});
    const styles = (resources.style ??= []);

    let style = styles.find((entry) => entry?.$?.name === STYLE_NAME);
    if (!style) {
      style = { $: { name: STYLE_NAME, parent: 'Widget.AppCompat.TextView' }, item: [] };
      styles.push(style);
    }
    for (const [name, value] of Object.entries(ITEMS)) upsertItem(style, name, value);

    const theme = styles.find((entry) => entry?.$?.name === APP_THEME);
    if (!theme) throw new Error(`with-android-text-metrics: the generated styles.xml has no ${APP_THEME} theme.`);
    upsertItem(theme, 'android:textViewStyle', `@style/${STYLE_NAME}`);
    return mod;
  });
};
