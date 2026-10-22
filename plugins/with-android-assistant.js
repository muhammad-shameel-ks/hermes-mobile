/**
 * The assistant card's window theme (modules/hermes-assistant): the app theme, so the card's text and
 * inputs get the same fixes as the app's (with-android-text-metrics.js, React Native's edit text
 * background), made transparent and translucent so the app the card was summoned over stays on
 * screen, with no system animation (the card animates itself). It overrides the module's own
 * fallback style of the same name.
 */

const { withAndroidStyles } = require('expo/config-plugins');

const APP_THEME = 'AppTheme';
const STYLE_NAME = 'Theme.Hermes.Assistant';
const ITEMS = {
  'android:windowIsTranslucent': 'true',
  'android:windowBackground': '@android:color/transparent',
  'android:windowNoTitle': 'true',
  'android:backgroundDimEnabled': 'false',
  'android:windowAnimationStyle': '@null',
  'android:statusBarColor': '@android:color/transparent',
  'android:navigationBarColor': '@android:color/transparent',
};

module.exports = function withAndroidAssistant(config) {
  return withAndroidStyles(config, (mod) => {
    const resources = (mod.modResults.resources ??= {});
    const styles = (resources.style ??= []);
    if (!styles.some((entry) => entry?.$?.name === APP_THEME)) {
      throw new Error(`with-android-assistant: the generated styles.xml has no ${APP_THEME} theme.`);
    }
    const items = Object.entries(ITEMS).map(([name, value]) => ({ _: value, $: { name } }));
    const style = { $: { name: STYLE_NAME, parent: APP_THEME }, item: items };
    const index = styles.findIndex((entry) => entry?.$?.name === STYLE_NAME);
    if (index === -1) styles.push(style);
    else styles[index] = style;
    return mod;
  });
};
