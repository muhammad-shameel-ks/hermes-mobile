/**
 * Settings → Assistant (Android only): whether Hermes is the phone's digital assistant, and the way
 * to make it one. An app cannot take the assistant role itself; Android's own picker grants it.
 */

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { assistant } from '../../modules/hermes-assistant/index.ts';
import { ActionButton, ListRow, SettingsContent, SettingsSection } from './primitives.tsx';

const isHeld = () => assistant?.isDefaultAssistant() ?? false;

export default function AssistantSection() {
  const [held, setHeld] = useState(isHeld);

  // the role changes in Android's settings: read it again on the way back
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setHeld(isHeld());
    });
    return () => sub.remove();
  }, []);

  return (
    <SettingsContent>
      <SettingsSection title="Digital assistant" icon="sparkle" meta={held ? 'On' : 'Off'}>
        <ListRow
          title={held ? 'Hermes is your assistant' : 'Use Hermes as your assistant'}
          description={
            held
              ? 'Long-press the power button or swipe in from a bottom corner to ask Hermes over any app. The mic opens as the card rises; tap outside it or swipe it down to close.'
              : 'Choose Hermes as the digital assistant app in Android settings. Where the power button opens something else, set "Press and hold power button" to the digital assistant under System › Gestures.'
          }
          action={
            <ActionButton
              label={held ? 'Change in Android settings' : 'Open Android settings'}
              variant={held ? 'secondary' : 'default'}
              icon="link-external"
              onPress={() => assistant?.openAssistantSettings()}
            />
          }
        />
      </SettingsSection>
    </SettingsContent>
  );
}
