/**
 * Settings → Appearance: mode preference, skin, accent override and Chat Text
 * Size. Self-contained: it reads and writes through `useAppearance()` and paints
 * from `useTokens()`, so the Settings screen only mounts it. Ported from the
 * desktop's appearance-settings.tsx; UI Scale, translucency and the Marketplace
 * skin search have no phone counterpart.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { CHAT_TEXT_SCALE_PRESETS } from '../ui/appearance.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { mixPct, normalizeHex, readableInk } from '../ui/color.ts';
import { accentsFor, baseColors, SKINS, type SkinName } from '../ui/skins.ts';
import { MONO, useTokens, type Tokens } from '../ui/tokens.ts';
import { useAppearance } from '../ui/ThemeProvider.tsx';

const MODES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const;

const tick = () => void Haptics.selectionAsync().catch(() => {});

export function AppearanceSection({ heading = true }: { heading?: boolean }) {
  const t = useTokens();
  const appearance = useAppearance();
  const { mode, skin, accent, chatTextScale, resolvedMode, renderedMode } = appearance;

  return (
    <View style={styles.section}>
      {heading ? (
        <Text accessibilityRole="header" style={[styles.heading, { color: t.uiTextTertiary }]}>
          Appearance
        </Text>
      ) : null}

      <Row t={t} title="Mode" description="Pick a fixed mode or follow the system setting.">
        <Segmented
          t={t}
          options={MODES}
          value={mode}
          onChange={(next) => {
            tick();
            appearance.setMode(next);
          }}
        />
      </Row>

      <Row t={t} title="Skin" description="The palette and chrome Hermes paints with.">
        <View style={styles.grid}>
          {SKINS.map((entry) => (
            <SkinCard
              key={entry.name}
              t={t}
              name={entry.name}
              label={entry.label}
              description={entry.description}
              mode={resolvedMode}
              active={entry.name === skin}
              onPress={() => {
                tick();
                appearance.setSkin(entry.name);
              }}
            />
          ))}
        </View>
      </Row>

      <Row t={t} title="Accent" description="Recolours the skin's accent and the surfaces mixed from it. Choosing another skin clears it.">
        <AccentPicker
          t={t}
          skin={skin}
          resolvedMode={resolvedMode}
          renderedMode={renderedMode}
          accent={accent}
          onChange={(next) => {
            tick();
            appearance.setAccent(next);
          }}
        />
      </Row>

      <Row t={t} title="Chat Text Size" description="Scales conversation text and the message editor. Menus and controls stay the same size.">
        <Segmented
          t={t}
          options={CHAT_TEXT_SCALE_PRESETS.map((value) => ({ id: String(value), label: `${value}%` }))}
          value={String(chatTextScale)}
          onChange={(next) => {
            tick();
            appearance.setChatTextScale(Number(next));
          }}
        />
        <View style={[styles.sample, { backgroundColor: t.uiChatBubbleBackground, borderColor: t.dtUserBubbleBorder, borderRadius: t.radius['3xl'] }]}>
          <Text style={{ color: t.uiTextPrimary, fontSize: t.type.text, lineHeight: t.type.lineHeight }}>
            The quick brown fox jumps over the lazy dog.
          </Text>
          <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight, marginTop: 4 }}>
            {chatTextScale}% · caption
          </Text>
        </View>
      </Row>
    </View>
  );
}

function Row({ t, title, description, children }: { t: Tokens; title: string; description: string; children: ReactNode }) {
  return (
    <View style={[styles.row, { borderBottomColor: t.uiStrokeQuaternary }]}>
      <Text style={{ color: t.uiTextPrimary, fontSize: t.type.base, fontWeight: '500' }}>{title}</Text>
      <Text style={{ color: t.uiTextTertiary, fontSize: 12, lineHeight: 16, marginTop: 4 }}>{description}</Text>
      <View style={styles.control}>{children}</View>
    </View>
  );
}

/** desktop SegmentedControl: a tinted track with a raised active pill */
function Segmented<T extends string>({
  t,
  options,
  value,
  onChange,
}: {
  t: Tokens;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View style={[styles.track, { backgroundColor: t.uiBgTertiary }]}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.id)}
            style={[styles.segment, active && { backgroundColor: t.uiBgChrome }]}
          >
            <Text numberOfLines={1} style={{ color: active ? t.uiTextPrimary : t.uiTextTertiary, fontSize: 12, fontWeight: '500' }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SkinCard({
  t,
  name,
  label,
  description,
  mode,
  active,
  onPress,
}: {
  t: Tokens;
  name: SkinName;
  label: string;
  description: string;
  mode: 'light' | 'dark';
  active: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.cardCell}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${label}. ${description}`}
        onPress={onPress}
        style={[
          styles.ring,
          { borderRadius: t.radius.lg + 2, borderColor: active ? mixPct(t.dtPrimary, 0.2, 'transparent') : 'transparent' },
        ]}
      >
        <View
          style={[
            styles.card,
            {
              borderRadius: t.radius.lg,
              borderColor: active ? t.dtPrimary : t.uiStrokeTertiary,
              backgroundColor: active ? mixPct(t.dtPrimary, 0.06, 'transparent') : t.uiBgQuinary,
            },
          ]}
        >
          <SkinPreview t={t} name={name} mode={mode} />
          <Text numberOfLines={1} style={{ color: t.uiTextPrimary, fontSize: t.type.base, fontWeight: '500', marginTop: 10 }}>
            {label}
          </Text>
          <Text numberOfLines={2} style={{ color: t.uiTextTertiary, fontSize: 11, lineHeight: 14, marginTop: 2 }}>
            {description}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

/** A miniature of the skin in the mode being painted: sidebar, two text lines and a bubble. */
function SkinPreview({ t, name, mode }: { t: Tokens; name: SkinName; mode: 'light' | 'dark' }) {
  const c = baseColors(name, mode);
  return (
    <View style={[styles.preview, { backgroundColor: c.background, borderColor: c.border, borderRadius: t.radius.xl }]}>
      <View style={[styles.previewSide, { backgroundColor: c.sidebarBackground ?? c.muted, borderRightColor: c.sidebarBorder ?? c.border }]} />
      <View style={styles.previewBody}>
        <View style={[styles.line, { width: 40, height: 6, backgroundColor: c.foreground }]} />
        <View style={[styles.line, { width: 60, height: 5, backgroundColor: c.mutedForeground }]} />
        <View style={styles.previewBubbleRow}>
          <View style={[styles.line, { width: 40, height: 12, backgroundColor: c.userBubble ?? c.muted, borderColor: c.userBubbleBorder ?? c.border, borderWidth: StyleSheet.hairlineWidth }]} />
        </View>
      </View>
    </View>
  );
}

function AccentPicker({
  t,
  skin,
  resolvedMode,
  renderedMode,
  accent,
  onChange,
}: {
  t: Tokens;
  skin: SkinName;
  resolvedMode: 'light' | 'dark';
  renderedMode: 'light' | 'dark';
  accent: string | null;
  onChange: (accent: string | null) => void;
}) {
  const swatches = accentsFor(renderedMode);
  const own = baseColors(skin, resolvedMode).primary;
  const custom = accent !== null && !swatches.some((swatch) => swatch.hex.toLowerCase() === accent);
  const [draft, setDraft] = useState('');
  const draftHex = normalizeHex(draft);

  const submit = () => {
    if (draftHex) {
      onChange(draftHex);
      setDraft('');
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.swatches}>
        <Swatch t={t} name="Skin default" hex={own} active={accent === null} onPress={() => onChange(null)} />
        {swatches.map((swatch) => (
          <Swatch key={swatch.id} t={t} name={swatch.name} hex={swatch.hex} active={accent === swatch.hex.toLowerCase()} onPress={() => onChange(swatch.hex)} />
        ))}
        {custom ? <Swatch t={t} name="Custom" hex={accent} active onPress={() => onChange(accent)} /> : null}
      </View>
      <View style={styles.customRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder="#rrggbb"
          placeholderTextColor={t.uiTextQuaternary}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          maxLength={9}
          returnKeyType="done"
          selectionColor={t.uiAccent}
          accessibilityLabel="Custom accent colour"
          style={[
            styles.hexInput,
            {
              color: t.uiTextPrimary,
              backgroundColor: t.uiBgEditor,
              borderColor: draft !== '' && !draftHex ? t.dtDestructive : t.uiStrokeSecondary,
              borderRadius: t.radius['3xl'],
              fontFamily: MONO,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !draftHex }}
          disabled={!draftHex}
          onPress={submit}
          style={[styles.apply, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius['3xl'], opacity: draftHex ? 1 : 0.5 }]}
        >
          <Text style={{ color: t.uiTextPrimary, fontSize: 12, fontWeight: '500' }}>Apply</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Swatch({ t, name, hex, active, onPress }: { t: Tokens; name: string; hex: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={4}
      style={[styles.swatch, { backgroundColor: hex, borderColor: active ? t.uiTextPrimary : t.uiStrokeSecondary, borderWidth: active ? 2 : StyleSheet.hairlineWidth }]}
    >
      {active ? <Codicon name="check" size={14} color={readableInk(hex)} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingBottom: 16 },
  heading: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', paddingVertical: 12 },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  control: { marginTop: 12 },
  track: { flexDirection: 'row', alignSelf: 'flex-start', padding: 2, gap: 2, borderRadius: 5 },
  segment: { minHeight: 32, minWidth: 52, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  cardCell: { width: '50%', padding: 4 },
  ring: { borderWidth: 2 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 8 },
  preview: { height: 80, overflow: 'hidden', flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth },
  previewSide: { width: 36, borderRightWidth: StyleSheet.hairlineWidth },
  previewBody: { flex: 1, padding: 10, gap: 6 },
  previewBubbleRow: { marginTop: 'auto', alignItems: 'flex-end' },
  line: { borderRadius: 9999 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hexInput: { width: 128, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, borderWidth: StyleSheet.hairlineWidth },
  apply: { minHeight: 40, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  sample: { marginTop: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
});
