/**
 * The avatar editor shared by New bot and Edit: Bot (silhouettes, seed lock,
 * classic shapes and colours), Generate, Upload and Pet tabs, ported from the
 * desktop's avatar-picker.tsx and pet.tsx. The caller owns shape, colour and
 * image; this only edits them.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { Codicon, type CodiconName } from '../ui/Codicon.tsx';
import { useTokens, type Tokens } from '../ui/tokens.ts';
import { errorText } from '../gateway/http.ts';
import { rankPets, type AvatarApi, type PetEntry } from './avatarApi.ts';
import { generatedAsDataUrl, pickImageFromDevice } from './avatarImage.ts';
import { BotAvatar } from './BotAvatar.tsx';
import {
  AVATAR_PICKER_SHAPES,
  avatarColor,
  BLOB_KINDS,
  blobShapeString,
  defaultShapeFor,
  isBlobShape,
  parseBlobShape,
  PROFILE_SWATCHES,
} from './face.ts';
import { avatarImageError, customAvatarPrompt, generatedAvatarPrompt } from './look.ts';

type Props = {
  api: AvatarApi;
  /** `null` is no explicit pick: the name's own hue */
  color: string | null;
  image: string | null;
  shape: string;
  onColor: (color: string | null) => void;
  onImage: (image: string | null) => void;
  onShape: (shape: string) => void;
  /** feeds the Generate tab when the description is left blank */
  seed: { name: string; title?: string; description?: string };
};

type TabId = 'bot' | 'generate' | 'upload' | 'pet';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'bot', label: 'Bot' },
  { id: 'generate', label: 'Generate' },
  { id: 'upload', label: 'Upload' },
  { id: 'pet', label: 'Pet' },
];

const CELL = 44;
const noMeta = {};

export default function AvatarPicker({ api, color, image, shape, onColor, onImage, onShape, seed }: Props) {
  const t = useTokens();
  const pickerName = seed.name || 'agent';
  const [tab, setTab] = useState<TabId>('bot');
  const [error, setError] = useState<string | null>(null);

  const goTab = (id: TabId) => {
    setTab(id);
    setError(null);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.tabs, { borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]} accessibilityRole="tablist">
        {TABS.map(({ id, label }) => {
          const active = id === tab;
          return (
            <Pressable
              key={id}
              onPress={() => goTab(id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.tab, active && { backgroundColor: t.uiRowActiveBackground, borderRadius: t.radius['2xl'] }]}
            >
              <Text style={{ color: active ? t.uiTextPrimary : t.uiTextTertiary, fontSize: 12, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {image && tab !== 'generate' ? (
        <GhostButton t={t} label="Remove image — use shape" onPress={() => onImage(null)} />
      ) : null}

      {tab === 'bot' ? (
        isBlobShape(shape) ? (
          <BlobControls t={t} shape={shape} name={pickerName} image={image} onShape={onShape} onImage={onImage} />
        ) : (
          <ClassicControls t={t} shape={shape} color={color} name={pickerName} image={image} onShape={onShape} onColor={onColor} onImage={onImage} />
        )
      ) : null}
      {tab === 'generate' ? <GenerateTab t={t} api={api} seed={seed} onImage={onImage} onError={setError} /> : null}
      {tab === 'upload' ? <UploadTab t={t} onImage={onImage} onError={setError} /> : null}
      {tab === 'pet' ? <PetTab t={t} api={api} image={image} onImage={onImage} onError={setError} /> : null}

      {error ? (
        <Text style={{ color: t.dtDestructive, fontSize: 12, textAlign: 'center', lineHeight: 17 }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function GhostButton({ t, label, icon, onPress, muted }: { t: Tokens; label: string; icon?: CodiconName; onPress: () => void; muted?: boolean }) {
  const color = muted ? t.uiTextTertiary : t.uiTextSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [styles.ghost, { borderRadius: t.radius['2xl'] }, pressed && { backgroundColor: t.uiRowActiveBackground }]}
    >
      {icon ? <Codicon name={icon} size={13} color={color} style={{ marginRight: 4 }} /> : null}
      <Text style={{ color, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function WideButton({ t, label, icon, busy, onPress }: { t: Tokens; label: string; icon: CodiconName; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [
        styles.wide,
        { backgroundColor: t.uiBgSecondary, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] },
        (busy || pressed) && { opacity: 0.6 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={t.uiTextSecondary} /> : <Codicon name={icon} size={13} color={t.uiTextSecondary} />}
      <Text style={{ color: t.uiTextPrimary, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

function Cell({ t, selected, label, onPress, children }: { t: Tokens; selected: boolean; label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.cell,
        { borderRadius: t.radius.md },
        selected && { borderWidth: 1, borderColor: t.uiAccent },
        pressed && { backgroundColor: t.uiRowActiveBackground },
      ]}
    >
      {children}
    </Pressable>
  );
}

const noImage = async () => null;

function Face({ name, shape, color, size = 32 }: { name: string; shape: string; color?: string; size?: number }) {
  return (
    <BotAvatar
      name={name}
      meta={color ? { shape, color, custom: true } : { shape, custom: true }}
      hasAvatar={false}
      image={null}
      size={size}
      loadImage={noImage}
    />
  );
}

/** Auto (the name decides) and the ten silhouettes, then randomize / lock */
function BlobControls({
  t,
  shape,
  name,
  image,
  onShape,
  onImage,
}: {
  t: Tokens;
  shape: string;
  name: string;
  image: string | null;
  onShape: (shape: string) => void;
  onImage: (image: string | null) => void;
}) {
  const { seedPart, kind } = parseBlobShape(shape, name);
  const locked = Boolean(seedPart);
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        {['', ...BLOB_KINDS].map((k) => (
          <Cell
            key={k || 'auto'}
            t={t}
            selected={k === kind && !image}
            label={k || 'Auto — the name decides'}
            onPress={() => {
              onImage(null);
              onShape(blobShapeString(seedPart, k));
            }}
          >
            {k ? <Face name={name} shape={blobShapeString(seedPart, k)} /> : <Text style={{ color: t.uiTextTertiary, fontSize: 10 }}>Auto</Text>}
          </Cell>
        ))}
      </View>
      <View style={styles.row}>
        <GhostButton
          t={t}
          icon="refresh"
          label="Randomize"
          onPress={() => {
            onImage(null);
            onShape(blobShapeString(Math.random().toString(36).slice(2, 10), kind));
          }}
        />
        <GhostButton t={t} icon={locked ? 'unlock' : 'lock'} label={locked ? 'Unlock' : 'Lock face'} onPress={() => onShape(blobShapeString(locked ? '' : name, kind))} />
      </View>
      <Text style={[styles.hint, { color: t.uiTextQuaternary }]}>{locked ? 'Face locked — renaming won’t change it.' : 'Face follows the name.'}</Text>
      <GhostButton t={t} muted label="Classic shapes" onPress={() => onShape(defaultShapeFor(name))} />
    </View>
  );
}

/** the flat shapes (and a way back to blobatar) with the colour swatches */
function ClassicControls({
  t,
  shape,
  color,
  name,
  image,
  onShape,
  onColor,
  onImage,
}: {
  t: Tokens;
  shape: string;
  color: string | null;
  name: string;
  image: string | null;
  onShape: (shape: string) => void;
  onColor: (color: string | null) => void;
  onImage: (image: string | null) => void;
}) {
  const body = avatarColor(color, name);
  return (
    <View style={styles.stack}>
      <View style={styles.grid}>
        {['blobatar', ...AVATAR_PICKER_SHAPES].map((s) => (
          <Cell
            key={s}
            t={t}
            selected={s === shape && !image}
            label={s === 'blobatar' ? 'Blob face — drawn from the bot’s name' : s}
            onPress={() => {
              onImage(null);
              onShape(s);
            }}
          >
            <Face name={name} shape={s} color={body} />
          </Cell>
        ))}
      </View>
      <View style={styles.swatches}>
        {PROFILE_SWATCHES.map((swatch) => (
          <Pressable
            key={swatch}
            onPress={() => onColor(swatch)}
            accessibilityRole="button"
            accessibilityLabel={swatch}
            accessibilityState={{ selected: swatch === color }}
            hitSlop={5}
            style={[
              styles.swatch,
              { backgroundColor: swatch },
              swatch === color && { borderWidth: 2, borderColor: t.uiBgElevated, outlineColor: swatch, outlineWidth: 1.5, outlineStyle: 'solid', outlineOffset: 0 },
            ]}
          />
        ))}
      </View>
      <GhostButton t={t} muted icon="circle-slash" label="Match the name" onPress={() => onColor(null)} />
    </View>
  );
}

function GenerateTab({
  t,
  api,
  seed,
  onImage,
  onError,
}: {
  t: Tokens;
  api: AvatarApi;
  seed: Props['seed'];
  onImage: (image: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [describe, setDescribe] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  // the gateway may have restarted with image.generate since a stale "unavailable"
  useEffect(() => {
    alive.current = true;
    void api.probeImagen(true).then((ok) => alive.current && setAvailable(ok));
    return () => {
      alive.current = false;
    };
  }, [api]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      const custom = describe.trim();
      const prompt = custom ? customAvatarPrompt(custom) : generatedAvatarPrompt(seed.name || 'agent', seed.title, seed.description);
      const image = await generatedAsDataUrl(await api.generate(prompt));
      const refused = avatarImageError(image);
      if (refused) throw new Error(refused);
      if (alive.current) onImage(image);
    } catch (error) {
      if (alive.current) onError(`Avatar generation failed. ${errorText(error)}`);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (!available) {
    return (
      <Text style={[styles.note, { color: t.uiTextTertiary }]}>
        {available === false
          ? 'No image model available. If you just enabled one (or updated Hermes), restart the gateway, then come back to this tab.'
          : 'Checking image backend…'}
      </Text>
    );
  }
  return (
    <View style={styles.stackWide}>
      <TextInput
        value={describe}
        onChangeText={setDescribe}
        placeholder="Describe your avatar…"
        placeholderTextColor={t.uiTextQuaternary}
        multiline
        editable={!busy}
        accessibilityLabel="Describe your avatar"
        style={[styles.describe, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]}
      />
      <WideButton t={t} icon="sparkle" label={busy ? 'Generating…' : 'Generate'} busy={busy} onPress={() => void generate()} />
      {describe.trim() ? null : <Text style={[styles.hint, { color: t.uiTextQuaternary }]}>Leave blank to generate from the bot’s name and description.</Text>}
    </View>
  );
}

function UploadTab({ t, onImage, onError }: { t: Tokens; onImage: (image: string | null) => void; onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    setBusy(true);
    onError(null);
    try {
      const picked = await pickImageFromDevice();
      if (!picked) return;
      if ('error' in picked) onError(picked.error);
      else onImage(picked.image);
    } catch (error) {
      onError(`Could not open your photos. ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.stackWide}>
      <WideButton t={t} icon="device-camera" label="Choose an image…" busy={busy} onPress={() => void choose()} />
    </View>
  );
}

const PAGE = 24;
const SCROLL_PAD = 120;

function PetTab({
  t,
  api,
  image,
  onImage,
  onError,
}: {
  t: Tokens;
  api: AvatarApi;
  image: string | null;
  onImage: (image: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [pets, setPets] = useState<PetEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.petGallery().then(
      (list) => live && setPets(list),
      () => live && setPets([]),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const ranked = rankPets(pets ?? [], query);
  const visible = ranked.slice(0, limit);

  const onScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = nativeEvent;
      if (contentOffset.y + layoutMeasurement.height >= contentSize.height - SCROLL_PAD) setLimit((n) => (n < ranked.length ? Math.min(n + PAGE, ranked.length) : n));
    },
    [ranked.length],
  );

  const pick = (pet: PetEntry) => {
    // the pet is the profile picture: the server-cropped first frame, saved with the rest
    setSelected(pet.slug);
    onError(null);
    void api.petThumb(pet.slug, pet.spritesheetUrl).then((icon) => {
      if (icon) {
        onImage(icon);
      } else {
        setSelected(null);
        onError('Could not load that pet — try another.');
      }
    });
  };

  if (pets === null) {
    return (
      <View style={styles.note}>
        <ActivityIndicator size="small" color={t.uiTextTertiary} />
      </View>
    );
  }
  if (!pets.length) {
    return <Text style={[styles.note, { color: t.uiTextTertiary }]}>No pets in the petdex gallery. Run `hermes pets` to explore.</Text>;
  }

  return (
    <View style={styles.stackWide}>
      <Text style={[styles.hint, { color: t.uiTextQuaternary }]}>Pick a pet as this bot’s profile picture.</Text>
      <TextInput
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setLimit(PAGE);
        }}
        placeholder={`Search ${pets.length} pets…`}
        placeholderTextColor={t.uiTextQuaternary}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search pets"
        style={[styles.search, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]}
      />
      {image && selected ? (
        <GhostButton
          t={t}
          label="Remove — back to shape avatar"
          onPress={() => {
            setSelected(null);
            onImage(null);
          }}
        />
      ) : null}
      {ranked.length === 0 ? (
        <Text style={[styles.hint, { color: t.uiTextQuaternary, paddingVertical: 12 }]}>No pets match.</Text>
      ) : (
        <ScrollView style={styles.petScroll} nestedScrollEnabled onScroll={onScroll} scrollEventThrottle={100} keyboardShouldPersistTaps="handled">
          <View style={styles.petGrid}>
            {visible.map((pet) => (
              <Pressable
                key={pet.slug}
                onPress={() => pick(pet)}
                accessibilityRole="button"
                accessibilityLabel={pet.displayName}
                accessibilityState={{ selected: selected === pet.slug }}
                style={({ pressed }) => [
                  styles.petTile,
                  { borderRadius: t.radius.md },
                  selected === pet.slug && { borderWidth: 1, borderColor: t.uiAccent },
                  pressed && { backgroundColor: t.uiRowActiveBackground },
                ]}
              >
                <PetThumb t={t} api={api} slug={pet.slug} spriteUrl={pet.spritesheetUrl} />
                <Text numberOfLines={1} style={{ color: t.uiTextTertiary, fontSize: 10, alignSelf: 'stretch', textAlign: 'center' }}>
                  {pet.displayName}
                </Text>
              </Pressable>
            ))}
          </View>
          {limit < ranked.length ? (
            <Text style={[styles.hint, { color: t.uiTextQuaternary, paddingVertical: 8 }]}>{`Scroll for more (${limit} of ${ranked.length})`}</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/** one tile image: the server-cropped first frame, resolved lazily through the gallery cache */
function PetThumb({ t, api, slug, spriteUrl }: { t: Tokens; api: AvatarApi; slug: string; spriteUrl?: string | null }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api.petThumb(slug, spriteUrl).then((url) => live && setIcon(url));
    return () => {
      live = false;
    };
  }, [api, slug, spriteUrl]);
  const box = { width: 40, height: 40, borderRadius: 6 };
  return icon ? <Image source={{ uri: icon }} style={box} resizeMode="contain" /> : <View style={[box, { backgroundColor: t.uiControlHoverBackground }]} />;
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 12 },
  tabs: { flexDirection: 'row', alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, padding: 2 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 32 },
  stack: { alignItems: 'center', gap: 12 },
  stackWide: { alignSelf: 'stretch', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, width: CELL * 4 + 6 * 3 },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ghost: { flexDirection: 'row', alignItems: 'center', minHeight: 32, paddingHorizontal: 10 },
  wide: { minHeight: 46, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  hint: { fontSize: 11, textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 8, paddingVertical: 12 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, width: 6 * 22 + 5 * 12 },
  swatch: { width: 22, height: 22, borderRadius: 11 },
  describe: { minHeight: 76, maxHeight: 140, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, textAlignVertical: 'top' },
  search: { minHeight: 36, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13 },
  petScroll: { maxHeight: 220 },
  petGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 2 },
  petTile: { width: '31%', alignItems: 'center', gap: 4, padding: 6 },
});
