/**
 * Stops Android's Bold text setting clipping labels ("Archive" → "Archiv",
 * "Backend ready" → "Backen read"; facebook/react-native#54931, upstream fix
 * #57118, not in React Native 0.86).
 *
 * Bold text sets `Configuration.fontWeightAdjustment` (+300). TextView reads it
 * and draws text with no named weight heavier, but React Native measures that
 * text at the plain weight, so it is drawn wider than its box and the end is
 * cut. MainActivity now hands its views a configuration with the adjustment
 * cleared: measuring and drawing agree for every Text, TextInput and built-in
 * component. Like the system font scale (see src/ui/chromeText.ts), the app's
 * type weight then stays its own. Remove this once React Native measures with
 * the adjustment.
 */

const { withMainActivity } = require('expo/config-plugins');

const MARKER = 'fontWeightAdjustment = 0';
const CLASS_LINE = /class MainActivity : ReactActivity\(\) \{\n/;
const IMPORTS = ['import android.content.Context', 'import android.content.res.Configuration'];

const OVERRIDE = `class MainActivity : ReactActivity() {
  /**
   * React Native measures text without Android's Bold text adjustment but
   * TextView draws with it, clipping labels; see plugins/with-android-bold-text.js.
   */
  override fun attachBaseContext(newBase: Context) {
    val config = newBase.resources.configuration
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        config.fontWeightAdjustment != 0 &&
        config.fontWeightAdjustment != Configuration.FONT_WEIGHT_ADJUSTMENT_UNDEFINED) {
      val plain = Configuration(config).apply { ${MARKER} }
      super.attachBaseContext(newBase.createConfigurationContext(plain))
    } else {
      super.attachBaseContext(newBase)
    }
  }

`;

function clearBoldText(contents) {
  if (contents.includes(MARKER)) return contents;
  if (!CLASS_LINE.test(contents) || !contents.includes('import android.os.Build')) {
    throw new Error('with-android-bold-text: the generated MainActivity.kt no longer matches the expected template.');
  }
  const missing = IMPORTS.filter((line) => !contents.includes(line));
  return contents
    .replace('import android.os.Build', [...missing, 'import android.os.Build'].join('\n'))
    .replace(CLASS_LINE, OVERRIDE);
}

module.exports = function withAndroidBoldText(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('with-android-bold-text: expected a Kotlin MainActivity.');
    }
    mod.modResults.contents = clearBoldText(mod.modResults.contents);
    return mod;
  });
};
