/** the faces every root loads (the app and the assistant card); text falls back to the platform faces until they arrive */

import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_400Regular_Italic } from '@expo-google-fonts/jetbrains-mono/400Regular_Italic';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';

export const APP_FONTS = {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  JetBrainsMono_400Regular_Italic,
  'Collapse-Bold': require('../../assets/fonts/Collapse-Bold.ttf'),
  codicon: require('../../assets/fonts/codicon.ttf'),
};
