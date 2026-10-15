/**
 * Appearance switches the backend also has to know about (desktop
 * store/display-toggles.ts): `display.message_reactions` decides whether the
 * agent's `react_to_message` tool exists at all, so it travels to the gateway as
 * `config.set`, scoped to the profile, with the value spelled `true` or `false`.
 */

export const MESSAGE_REACTIONS_KEY = 'display.message_reactions';

export function displayToggleParams(key: string, enabled: boolean, profile: string): { key: string; value: string; profile: string } {
  return { key, value: enabled ? 'true' : 'false', profile };
}

export const reactionsParams = (enabled: boolean, profile: string) => displayToggleParams(MESSAGE_REACTIONS_KEY, enabled, profile);
