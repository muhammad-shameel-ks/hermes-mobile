/**
 * Adopts the UIKit scene life cycle, which apps built with the iOS 27 SDK must do
 * or UIKit refuses to launch them. Expo ships the scene delegate
 * (`EXExpoAppSceneDelegate`) but its prebuild template still starts React Native
 * from the app delegate, so this rewires the generated project: the Info.plist
 * names the scene delegate, and the AppDelegate hands it the factory instead of
 * creating a window itself. Fails loudly if the template no longer matches.
 */

const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const PROVIDER = 'ExpoReactNativeFactoryProvider';
const CLASS_LINE = /class AppDelegate: ExpoAppDelegate \{/;
const WINDOW_START =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function adoptProvider(contents) {
  if (contents.includes(PROVIDER)) return contents;
  if (!CLASS_LINE.test(contents) || !WINDOW_START.test(contents)) {
    throw new Error('with-ios-scene-lifecycle: the generated AppDelegate.swift no longer matches the expected template.');
  }
  return contents.replace(CLASS_LINE, `class AppDelegate: ExpoAppDelegate, ${PROVIDER} {`).replace(WINDOW_START, '\n');
}

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return mod;
  });

  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-lifecycle: expected a Swift AppDelegate.');
    }
    mod.modResults.contents = adoptProvider(mod.modResults.contents);
    return mod;
  });
};
