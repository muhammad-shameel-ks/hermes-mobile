/**
 * The Settings section registry: one entry per page, in the order the root
 * screen lists them, in the desktop's order. A section's `render` returns its
 * whole page body; it reads live app state through `useSettings()`.
 */

import { createElement, type ReactNode } from 'react';

import type { CodiconName } from '../ui/Codicon.tsx';
import AboutSection from './AboutSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import ConnectionSection from './ConnectionSection.tsx';
import ModelsSection from './ModelsSection.tsx';
import ProfilesSection from './ProfilesSection.tsx';

export type SettingsSectionEntry = {
  key: string;
  title: string;
  /** one line under the title on the root list */
  detail?: string;
  icon?: CodiconName;
  render: () => ReactNode;
};

export const SETTINGS_SECTIONS: readonly SettingsSectionEntry[] = [
  { key: 'models', title: 'Model', detail: 'Default model for new sessions', icon: 'chip', render: () => createElement(ModelsSection) },
  { key: 'appearance', title: 'Appearance', detail: 'Skin, mode, accent and Chat Text Size', icon: 'symbol-color', render: () => createElement(AppearanceSection, { heading: false }) },
  { key: 'connection', title: 'Connection', detail: 'Gateway, sign-in and sign out', icon: 'server', render: () => createElement(ConnectionSection) },
  { key: 'profiles', title: 'Profiles', detail: 'The active profile', icon: 'account', render: () => createElement(ProfilesSection) },
  { key: 'about', title: 'About', detail: 'Version and build', icon: 'info', render: () => createElement(AboutSection) },
];
