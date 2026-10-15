import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrastRatio } from '../vendor/hermes-shared/src/color.ts';
import { THEME_PRESET_PALETTES } from '../vendor/hermes-shared/src/theme-presets.ts';
import { DEFAULT_PREFS, normalizeChatTextScale, normalizePrefs, parsePrefs } from '../src/ui/appearance.ts';
import { ensureContrastOklch, hexToOklch, mixOklab, mixPct, normalizeHex, oklchToHex, readableInk, transparentOf, withHue } from '../src/ui/color.ts';
import { retintPalette } from '../src/ui/retint.ts';
import { accentsFor, baseColors, normalizeModePreference, normalizeSkin, paletteWithAccent, renderedModeFor, resolveMode, SKINS } from '../src/ui/skins.ts';
import { resolveTheme, resolveTokens } from '../src/ui/tokens.ts';

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const colorKeys = (tokens: Record<string, unknown>) =>
  Object.entries(tokens).filter(([, value]) => typeof value === 'string' && value.startsWith('#')) as [string, string][];

test('every shipped skin resolves in both modes to concrete colours', () => {
  assert.equal(SKINS.length, 11);
  assert.deepEqual(
    SKINS.map((skin) => skin.name).sort(),
    Object.keys(THEME_PRESET_PALETTES).sort(),
  );
  for (const { name } of SKINS) {
    for (const mode of ['light', 'dark'] as const) {
      const tokens = resolveTheme({ skin: name, mode });
      assert.equal(tokens.skin, name);
      for (const [key, value] of colorKeys(tokens)) assert.match(value.toLowerCase(), COLOR, `${name} ${mode} ${key}`);
    }
  }
});

test('nous dark and light keep the ladder values the app shipped with', () => {
  const dark = resolveTokens('dark');
  assert.equal(dark.uiBgChrome, '#0d1015');
  assert.equal(dark.uiBgSidebar, '#010409');
  assert.equal(dark.uiBgEditor, '#0e0f12');
  assert.equal(dark.uiBgElevated, '#16181d');
  assert.equal(dark.uiTextPrimary, '#e6edf3f0');
  assert.equal(dark.uiAccent, '#4a84fe');
  assert.equal(dark.dtPrimarySolid, '#3b6acb');
  const light = resolveTokens('light');
  assert.equal(light.uiBgChrome, '#fefefe');
  assert.equal(light.uiBgSidebar, '#f6f8fa');
  assert.equal(light.uiAccent, '#0053fd');
  assert.equal(light.renderedMode, 'light');
});

test('mode preference resolves against the system appearance only for system', () => {
  assert.equal(resolveMode('system', true), 'dark');
  assert.equal(resolveMode('system', false), 'light');
  assert.equal(resolveMode('light', true), 'light');
  assert.equal(resolveMode('dark', false), 'dark');
  assert.equal(normalizeModePreference('sepia'), 'system');
  assert.equal(normalizeModePreference(undefined), 'system');
});

test('the rendered mode follows the background, not the preference', () => {
  assert.equal(renderedModeFor({ background: '#ffffff' }, 'dark'), 'light');
  assert.equal(renderedModeFor({ background: '#101010' }, 'light'), 'dark');
  assert.equal(renderedModeFor({ background: 'not a colour' }, 'dark'), 'dark');
  // a skin without a dark palette paints its one palette in dark, and a synthesised twin in light
  assert.equal(resolveTheme({ skin: 'midnight', mode: 'dark' }).renderedMode, 'dark');
  assert.equal(resolveTheme({ skin: 'midnight', mode: 'light' }).renderedMode, 'light');
  assert.equal(resolveTheme({ skin: 'mono', mode: 'light' }).renderedMode, 'light');
  assert.equal(resolveTheme({ skin: 'nous-alt', mode: 'dark' }).renderedMode, 'dark');
});

test('a dark-only skin gets the synthesised light twin in light mode', () => {
  const light = baseColors('ember', 'light');
  assert.equal(light.background, '#ffffff');
  assert.equal(light.foreground, '#161616');
  assert.equal(light.primary, THEME_PRESET_PALETTES.ember.colors.ring);
  assert.equal(baseColors('ember', 'dark'), THEME_PRESET_PALETTES.ember.colors);
  assert.equal(baseColors('nous', 'dark'), THEME_PRESET_PALETTES.nous.darkColors);
  assert.equal(baseColors('nous', 'light'), THEME_PRESET_PALETTES.nous.colors);
});

test('unknown and retired skin names fall back to nous', () => {
  assert.equal(normalizeSkin('catppuccin'), 'catppuccin');
  for (const name of ['classic', 'default', 'gold', 'nous-light', 'toString', '', null, 3]) assert.equal(normalizeSkin(name), 'nous');
});

test('the accent override moves the accent family and nothing else', () => {
  const plain = resolveTheme({ mode: 'dark' });
  const pink = resolveTheme({ mode: 'dark', accent: '#e0218a' });
  assert.notEqual(pink.uiAccent, plain.uiAccent);
  assert.notEqual(pink.dtPrimary, plain.dtPrimary);
  assert.equal(pink.dtBorder, plain.dtBorder);
  assert.equal(pink.dtForeground, plain.dtForeground);
  assert.equal(pink.uiBgSidebar, plain.uiBgSidebar);
  // the skin's own accent, an absent override and junk all paint the skin as authored
  for (const accent of [null, '#0053fd', '#0053FD', 'nope']) assert.equal(resolveTheme({ mode: 'light', accent }).uiAccent, resolveTheme({ mode: 'light' }).uiAccent);
});

test('an accent override stays readable on the sidebar in every skin and mode', () => {
  for (const { name } of SKINS) {
    for (const mode of ['light', 'dark'] as const) {
      const colors = paletteWithAccent(name, mode, '#ff6a00');
      const ratio = contrastRatio(colors.primary, colors.sidebarBackground ?? colors.background) ?? 0;
      assert.ok(ratio >= 4.4 || colors === baseColors(name, mode), `${name} ${mode} ${ratio}`);
    }
  }
});

test('retinting a palette with its own accent is the identity', () => {
  for (const { name } of SKINS) {
    const colors = baseColors(name, 'dark');
    assert.equal(retintPalette(colors, colors.primary), colors);
  }
  const nous = THEME_PRESET_PALETTES.nous.colors;
  const teal = retintPalette(nous, withHue(nous.primary, 195));
  assert.equal(teal.ring, teal.primary);
  assert.equal(teal.midground, teal.primary);
  assert.equal(teal.composerRing, teal.primary);
  for (const key of ['background', 'foreground', 'card', 'border', 'muted', 'mutedForeground'] as const) assert.equal(teal[key], nous[key]);
  assert.equal(retintPalette(nous, 'not a colour'), nous);
});

test('Chat Text Size multiplies only the five conversation tokens', () => {
  const normal = resolveTheme({ mode: 'dark', chatTextScale: 1 });
  const big = resolveTheme({ mode: 'dark', chatTextScale: 1.5 });
  assert.equal(normal.type.text, 15);
  assert.equal(big.type.text, 22.5);
  assert.equal(big.type.tool, 12 * 1.5);
  assert.equal(big.type.caption, 13 * 1.5);
  assert.equal(big.type.lineHeight, 22 * 1.5);
  assert.equal(big.type.captionLineHeight, 18 * 1.5);
  assert.equal(big.type.base, 15);
  assert.deepEqual(big.radius, normal.radius);
  assert.equal(big.uiBgChrome, normal.uiBgChrome);
  // the default is the desktop's 110%
  assert.ok(Math.abs(resolveTokens('dark').type.text - 16.5) < 1e-9);
  assert.ok(Math.abs(resolveTokens('dark').type.lineHeight - 24.2) < 1e-9);
});

test('the platform font scale rides the same five tokens', () => {
  const scaled = resolveTheme({ mode: 'dark', chatTextScale: 1.1, fontScale: 1.3 });
  assert.ok(Math.abs(scaled.type.text - 15 * 1.1 * 1.3) < 1e-9);
  assert.equal(scaled.type.base, 15);
});

test('stored appearance normalises per key and keeps the translucency book', () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('{not json'), DEFAULT_PREFS);
  assert.deepEqual(normalizePrefs({ skin: 'classic', mode: 'sepia', accent: 'blue', chatTextScale: 117 }), {
    ...DEFAULT_PREFS,
    translucency: DEFAULT_PREFS.translucency,
  });
  const stored = normalizePrefs({ skin: 'slate', mode: 'dark', accent: '#E0218A', chatTextScale: '125', translucency: { base: { intensity: 40 } } });
  assert.equal(stored.skin, 'slate');
  assert.equal(stored.mode, 'dark');
  assert.equal(stored.accent, '#e0218a');
  assert.equal(stored.chatTextScale, 125);
  assert.equal(stored.translucency.base.intensity, 40);
  assert.deepEqual(parsePrefs(JSON.stringify(stored)), stored);
  assert.equal(normalizeChatTextScale(175), 175);
  assert.equal(normalizeChatTextScale(200), 110);
});

test('accent swatches follow the rendered mode', () => {
  assert.equal(accentsFor('light')[0].hex, '#000000');
  assert.equal(accentsFor('dark')[0].hex, '#ffffff');
  assert.equal(accentsFor('dark').length, 8);
});

test('OKLCH round trips and holds hue and lightness', () => {
  for (const hex of ['#0053fd', '#4f9e5e', '#e0218a', '#8b80e8', '#808080']) {
    const lch = hexToOklch(hex)!;
    assert.ok(contrastRatio(oklchToHex(lch), hex)! < 1.03, hex);
  }
  const base = hexToOklch('#0053fd')!;
  for (const hue of [0, 90, 180, 270]) {
    const moved = hexToOklch(withHue('#0053fd', hue))!;
    assert.ok(Math.abs(moved.l - base.l) < 0.02, `L at ${hue}`);
    assert.ok(moved.c <= base.c + 0.005, `C at ${hue}`);
  }
});

test('OKLCH contrast repair moves lightness only and gives up cleanly', () => {
  const fixed = ensureContrastOklch('#0053fd', '#0d1117', 4.5);
  assert.ok(contrastRatio(fixed, '#0d1117')! >= 4.5);
  assert.ok(Math.abs(hexToOklch(fixed)!.h - hexToOklch('#0053fd')!.h) < 3);
  assert.equal(ensureContrastOklch('#ffffff', '#000000', 4.5), '#ffffff');
});

test('colour helpers', () => {
  assert.equal(normalizeHex('#abc'), '#aabbcc');
  assert.equal(normalizeHex('FFFFFF80', '#000000'), '#808080');
  assert.equal(normalizeHex('rgb(1,2,3)'), null);
  assert.equal(mixOklab('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixOklab('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(readableInk('#ffffff'), '#161616');
  assert.equal(readableInk('#0d1117'), '#ffffff');
  assert.equal(mixPct('#ffffff', 0.5, 'transparent'), '#ffffff80');
});

test('a fade target keeps the surface colour at zero alpha', () => {
  assert.equal(transparentOf('#0d1015'), '#0d101500');
  assert.equal(transparentOf('#0d1015f0'), '#0d101500');
  assert.equal(transparentOf('nope'), '#00000000');
});

test('diff tints are the desktop green and red at 12%, foregrounds mix toward the page', () => {
  const dark = resolveTokens('dark');
  const light = resolveTokens('light');
  assert.equal(light.uiGreen, '#1f8a65');
  assert.equal(dark.uiGreen, '#55a583');
  assert.equal(light.uiDiffAddBackground, '#1f8a651f');
  assert.equal(dark.uiDiffRemoveBackground, '#e75e781f');
  assert.equal(light.uiDiffAddBorder, light.uiGreen);
  assert.notEqual(light.uiDiffAddForeground, dark.uiDiffAddForeground);
});
