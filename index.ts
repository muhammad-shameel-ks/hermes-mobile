import './src/ui/chromeText.ts';
import { registerRootComponent } from 'expo';
import { AppRegistry, Platform } from 'react-native';

import App from './App';

registerRootComponent(App);

// Android's assistant card (modules/hermes-assistant): a second root on the same runtime, loaded only when summoned
if (Platform.OS === 'android') {
  AppRegistry.registerComponent('HermesAssistant', () => (require('./src/assistant/AssistantApp.tsx') as typeof import('./src/assistant/AssistantApp.tsx')).default);
}
