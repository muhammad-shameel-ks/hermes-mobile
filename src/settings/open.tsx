/**
 * Entry points for the Settings overlay. They live apart from SettingsScreen and the section pages so
 * that the callers (the drawer, the approval card) load only this file at startup; the screen and its
 * sections load when Settings is first opened.
 */

import type { ReactNode } from 'react';

import { OverlayScreen, type OverlayApi } from '../app/overlay.tsx';
import { lazyScreen } from '../ui/lazy.tsx';

export const SETTINGS_OVERLAY_KEY = 'settings';

const SettingsScreen = lazyScreen(() => require('./SettingsScreen.tsx') as typeof import('./SettingsScreen.tsx'));
const CapabilitiesScreen = lazyScreen(() => require('./CapabilitiesScreen.tsx') as typeof import('./CapabilitiesScreen.tsx'));

export const sectionRoute = (section: { key: string; title: string; render: () => ReactNode }) =>
  [
    `${SETTINGS_OVERLAY_KEY}:${section.key}`,
    (close: () => void) => (
      <OverlayScreen title={section.title} onBack={close}>
        {section.render()}
      </OverlayScreen>
    ),
  ] as const;

export function pushSettings(overlay: Pick<OverlayApi, 'push'>) {
  overlay.push(SETTINGS_OVERLAY_KEY, (close) => <SettingsScreen onBack={close} />);
}

export function pushCapabilities(overlay: Pick<OverlayApi, 'push'>) {
  overlay.push('capabilities', (close) => <CapabilitiesScreen onBack={close} />);
}

/** open Settings with one section on top, so back lands on the section list */
export function openSettingsSection(overlay: Pick<OverlayApi, 'push'>, key: string) {
  const { SETTINGS_SECTIONS } = require('./sections.ts') as typeof import('./sections.ts');
  const section = SETTINGS_SECTIONS.find((entry) => entry.key === key);
  pushSettings(overlay);
  if (section) overlay.push(...sectionRoute(section));
}
