/**
 * Settings → Model → Main model (desktop app/settings/model-settings.tsx): the
 * model new sessions start with. The desktop's provider and model selects plus
 * Apply collapse into one searchable picker sheet; choosing a row applies it.
 * The composer's model pill still switches the open chat alone.
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { buildModelGroups, modelDisplayParts, type ModelSelection } from '../chat/models.ts';
import { errorText } from '../gateway/http.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useTokens } from '../ui/tokens.ts';
import { useSettings } from './context.tsx';
import { assignmentRequest, interpretAssignment, MODEL_ASSIGNMENT_COPY, type ModelAssignmentResponse } from './model-default.ts';
import { ActionButton, ListRow, SettingsContent, SettingsSection } from './primitives.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';

/** desktop `settings.model*` */
const COPY = {
  main: 'Main model',
  applies: 'Applies to new sessions. Use the model picker in the composer to hot-swap the active chat.',
  provider: 'Provider',
  model: 'Model',
  loading: 'Loading model configuration...',
  loadFailed: 'Could not load models',
  appliedTitle: 'Main model updated',
  applied: (model: string) => `New sessions will use ${model}.`,
  chooseModel: 'Choose a model',
  search: 'Search models',
  noMatch: 'No models match.',
};

export default function ModelsSection() {
  const t = useTokens();
  const { controller, snapshot } = useSettings();
  const { models } = snapshot;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!models.providers.length || models.error) void controller.refreshModels();
  }, [controller]);

  const current = models.current;
  const provider = models.providers.find((p) => p.slug === current?.provider);
  const display = current ? modelDisplayParts(current.model) : null;

  const save = async (selection: ModelSelection, confirm = false): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await controller.api.post<ModelAssignmentResponse>('/api/model/set', assignmentRequest(selection, confirm), { profile: snapshot.profile });
      const outcome = interpretAssignment(result, confirm);
      if (outcome.kind === 'confirm') {
        setBusy(false);
        Alert.alert(MODEL_ASSIGNMENT_COPY.confirmTitle, outcome.message || MODEL_ASSIGNMENT_COPY.confirmDetail, [
          { text: 'Cancel', style: 'cancel', onPress: () => setStatus({ ok: false, text: MODEL_ASSIGNMENT_COPY.declined }) },
          { text: MODEL_ASSIGNMENT_COPY.confirmAction, onPress: () => void save(selection, true) },
        ]);
        return;
      }
      if (outcome.kind === 'failed') {
        setStatus({ ok: false, text: outcome.message });
      } else {
        setStatus({ ok: true, text: `${COPY.appliedTitle}. ${COPY.applied(modelDisplayParts(selection.model).name)}` });
        await controller.refreshModels();
      }
    } catch (error) {
      setStatus({ ok: false, text: errorText(error) });
    }
    setBusy(false);
  };

  return (
    <SettingsContent refreshing={models.loading} onRefresh={() => void controller.refreshModels(true)}>
      <SettingsSection title={COPY.main} icon="chip">
        <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption, lineHeight: t.type.captionLineHeight, marginBottom: 4 }}>{COPY.applies}</Text>
        {models.loading && !models.providers.length ? (
          <View style={styles.loading}>
            <GlyphSpinner size={14} color={t.uiTextTertiary} />
            <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{COPY.loading}</Text>
          </View>
        ) : models.error && !models.providers.length ? (
          <ListRow
            title={COPY.loadFailed}
            description={models.error}
            action={<ActionButton label="Retry" icon="sync" variant="secondary" onPress={() => void controller.refreshModels(true)} />}
          />
        ) : (
          <>
            <ListRow title={COPY.provider} description={provider?.name || current?.provider || '—'} />
            <ListRow
              title={COPY.model}
              description={display ? (display.tag ? `${display.name} · ${display.tag}` : display.name) : 'No model'}
              onPress={() => setPicking(true)}
              disabled={busy}
              trailing={busy ? <GlyphSpinner size={14} color={t.uiTextTertiary} /> : <Codicon name="chevron-right" size={14} color={t.uiTextQuaternary} />}
            />
          </>
        )}
        {status ? (
          <Text accessibilityLiveRegion="polite" style={{ color: status.ok ? t.uiSuccess : t.dtDestructive, fontSize: t.type.caption, marginTop: 8 }}>
            {status.text}
          </Text>
        ) : null}
      </SettingsSection>
      <ModelSheet
        visible={picking}
        providers={models.providers}
        current={current}
        onClose={() => setPicking(false)}
        onPick={(selection) => {
          setPicking(false);
          void save(selection);
        }}
      />
    </SettingsContent>
  );
}

function ModelSheet({
  visible,
  providers,
  current,
  onClose,
  onPick,
}: {
  visible: boolean;
  providers: Parameters<typeof buildModelGroups>[0];
  current: ModelSelection | null;
  onClose: () => void;
  onPick: (selection: ModelSelection) => void;
}) {
  const t = useTokens();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);
  const groups = useMemo(() => buildModelGroups(providers, { favorites: [], current, query }), [providers, current, query]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.sheetHeader}>
        <Text style={{ color: t.uiTextPrimary, fontSize: 15, fontWeight: '600' }}>{COPY.chooseModel}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={COPY.search}
          placeholderTextColor={t.uiTextQuaternary}
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={COPY.search}
          style={[styles.search, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }]}
        />
      </View>
      <ScrollView style={{ maxHeight: height * 0.5 }} keyboardShouldPersistTaps="handled">
        {groups.length === 0 ? <Text style={[styles.empty, { color: t.uiTextTertiary }]}>{COPY.noMatch}</Text> : null}
        {groups.map((group) => (
          <View key={group.id}>
            <Text style={[styles.group, { color: t.uiTextQuaternary }]}>{group.label.toUpperCase()}</Text>
            {group.rows.map((row) => (
              <Pressable
                key={`${group.id}:${row.key}`}
                onPress={() => onPick({ model: row.model, provider: row.provider })}
                accessibilityRole="button"
                accessibilityState={{ selected: row.current }}
                style={({ pressed }) => [styles.modelRow, pressed && { backgroundColor: t.uiRowActiveBackground }]}
              >
                <Text numberOfLines={1} style={{ flex: 1, color: t.uiTextPrimary, fontSize: 14 }}>
                  {row.name}
                  {row.tag ? <Text style={{ color: t.uiTextTertiary }}>{` · ${row.tag}`}</Text> : null}
                </Text>
                {row.current ? <Codicon name="check" size={14} color={t.uiAccent} /> : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  sheetHeader: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 10 },
  search: { fontSize: 14, paddingHorizontal: 12, minHeight: 40 },
  group: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, marginTop: 10, marginBottom: 2, paddingHorizontal: 20 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 20 },
  empty: { fontSize: 13, paddingHorizontal: 20, paddingVertical: 16 },
});
