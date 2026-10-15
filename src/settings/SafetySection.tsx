/**
 * Settings → Safety (desktop app/settings config section `safety`): approval
 * mode and timeout, MCP reload confirmation and the command allowlist, the
 * privacy and network guards, and file checkpoints. The desktop's three child
 * pages become three headed groups on one screen. Values come from
 * `GET /api/config` and each change is the one key sent over `PUT /api/config`
 * (deep-merged on the server), as the desktop's autosave does. Shared metrics,
 * a desktop telemetry consent, has no phone counterpart.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { errorText } from '../gateway/http.ts';
import { Codicon } from '../ui/Codicon.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { useTokens } from '../ui/tokens.ts';
import { useSettings } from './context.tsx';
import { ActionButton, ListRow, SegmentedControl, SettingsContent, SettingsSection, ToggleRow } from './primitives.tsx';
import {
  allowlistWith,
  allowlistWithout,
  APPROVAL_MODES,
  describeTimeout,
  parseTimeout,
  readSafety,
  SAFETY_COPY,
  SAFETY_GROUPS,
  saveBody,
  type ConfigRecord,
  type SafetyKey,
  type SafetyValues,
} from './safety.ts';

/** desktop `settings.config.*` */
const COPY = {
  failedLoad: 'Failed to load settings',
  autosaveFailed: 'Autosave failed',
  loading: 'Loading settings...',
  notSet: 'Not set',
  seconds: 'seconds',
  invalidTimeout: 'Enter a whole number of seconds.',
  allowlistEmpty: 'Nothing is always allowed.',
  addPlaceholder: 'Add a command pattern',
  add: 'Add',
  remove: (entry: string) => `Remove ${entry}`,
};

type Patch = Partial<SafetyValues>;

export default function SafetySection() {
  const t = useTokens();
  const { controller, snapshot } = useSettings();
  const profile = snapshot.profile;
  const [values, setValues] = useState<SafetyValues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [entry, setEntry] = useState('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const live = useRef(true);
  const current = useRef<SafetyValues | null>(null);
  current.current = values;

  useEffect(() => () => void (live.current = false), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const config = await controller.api.get<ConfigRecord>('/api/config', { profile });
      if (!live.current) return;
      const next = readSafety(config ?? {});
      setValues(next);
      setDraft(String(next.approvalTimeout));
    } catch (error) {
      if (live.current) setLoadError(errorText(error));
    }
  }, [controller, profile]);

  useEffect(() => {
    setValues(null);
    void load();
  }, [load]);

  /** apply now, write the one key, and put the old value back if the write fails */
  const save = (key: SafetyKey, value: unknown, patch: Patch) => {
    const previous = current.current;
    if (!previous) return;
    const revert = Object.fromEntries(Object.keys(patch).map((k) => [k, previous[k as keyof SafetyValues]])) as Patch;
    setSaveError(null);
    setValues({ ...previous, ...patch });
    queue.current = queue.current.then(async () => {
      try {
        await controller.api.put('/api/config', saveBody(key, value), { profile });
      } catch (error) {
        if (!live.current) return;
        setValues((now) => (now ? { ...now, ...revert } : now));
        if ('approvalTimeout' in revert) setDraft(String(revert.approvalTimeout));
        setSaveError(`${COPY.autosaveFailed}. ${errorText(error)}`);
      }
    });
  };

  const commitTimeout = () => {
    if (!values) return;
    const seconds = parseTimeout(draft);
    if (seconds === null) {
      setDraft(String(values.approvalTimeout));
      setSaveError(COPY.invalidTimeout);
      return;
    }
    setDraft(String(seconds));
    if (seconds !== values.approvalTimeout) save('approvals.timeout', seconds, { approvalTimeout: seconds });
  };

  const addEntry = () => {
    if (!values) return;
    const next = allowlistWith(values.allowlist, entry);
    setEntry('');
    if (next.length !== values.allowlist.length) save('command_allowlist', next, { allowlist: next });
  };

  if (!values) {
    return (
      <SettingsContent>
        {loadError ? (
          <ListRow
            title={COPY.failedLoad}
            description={loadError}
            action={<ActionButton label="Retry" icon="refresh" variant="secondary" onPress={() => void load()} />}
          />
        ) : (
          <View style={styles.loading}>
            <GlyphSpinner size={14} color={t.uiTextTertiary} />
            <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{COPY.loading}</Text>
          </View>
        )}
      </SettingsContent>
    );
  }

  const copy = (key: SafetyKey) => SAFETY_COPY[key];
  const toggle = (key: SafetyKey, on: boolean, patch: Patch) => save(key, on, patch);

  const rows: Record<SafetyKey, () => ReactNode> = {
    'approvals.mode': () => (
      <ListRow
        key="approvals.mode"
        title={copy('approvals.mode').label}
        description={copy('approvals.mode').description}
        action={
          <SegmentedControl
            options={APPROVAL_MODES}
            value={values.approvalMode}
            onChange={(mode) => save('approvals.mode', mode, { approvalMode: mode })}
          />
        }
      />
    ),
    'approvals.timeout': () => (
      <ListRow
        key="approvals.timeout"
        title={copy('approvals.timeout').label}
        description={`${copy('approvals.timeout').description} Currently ${describeTimeout(values.approvalTimeout)}.`}
        action={
          <View style={styles.timeout}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onBlur={commitTimeout}
              onSubmitEditing={commitTimeout}
              keyboardType="number-pad"
              returnKeyType="done"
              placeholder={COPY.notSet}
              placeholderTextColor={t.uiTextQuaternary}
              selectionColor={t.uiAccent}
              accessibilityLabel={copy('approvals.timeout').label}
              style={[styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]}
            />
            <Text style={{ color: t.uiTextTertiary, fontSize: t.type.caption }}>{COPY.seconds}</Text>
          </View>
        }
      />
    ),
    'approvals.mcp_reload_confirm': () => (
      <ToggleRow
        key="approvals.mcp_reload_confirm"
        label={copy('approvals.mcp_reload_confirm').label}
        description={copy('approvals.mcp_reload_confirm').description}
        checked={values.mcpReloadConfirm}
        onChange={(on) => toggle('approvals.mcp_reload_confirm', on, { mcpReloadConfirm: on })}
      />
    ),
    command_allowlist: () => (
      <ListRow
        key="command_allowlist"
        title={copy('command_allowlist').label}
        description={copy('command_allowlist').description}
        action={
          <View style={styles.list}>
            {values.allowlist.length === 0 ? <Text style={{ color: t.uiTextQuaternary, fontSize: t.type.caption }}>{COPY.allowlistEmpty}</Text> : null}
            {values.allowlist.map((item) => (
              <View key={item} style={[styles.entry, { backgroundColor: t.uiBgSecondary, borderRadius: t.radius['2xl'] }]}>
                <Text selectable style={{ flex: 1, color: t.uiTextPrimary, fontSize: t.type.base }}>
                  {item}
                </Text>
                <Pressable
                  onPress={() => save('command_allowlist', allowlistWithout(values.allowlist, item), { allowlist: allowlistWithout(values.allowlist, item) })}
                  accessibilityRole="button"
                  accessibilityLabel={COPY.remove(item)}
                  hitSlop={10}
                  style={styles.remove}
                >
                  <Codicon name="close" size={14} color={t.uiTextTertiary} />
                </Pressable>
              </View>
            ))}
            <View style={styles.addRow}>
              <TextInput
                value={entry}
                onChangeText={setEntry}
                onSubmitEditing={addEntry}
                placeholder={COPY.addPlaceholder}
                placeholderTextColor={t.uiTextQuaternary}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="done"
                selectionColor={t.uiAccent}
                accessibilityLabel={COPY.addPlaceholder}
                style={[styles.input, styles.grow, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['3xl'] }]}
              />
              <ActionButton label={COPY.add} variant="secondary" disabled={entry.trim() === ''} onPress={addEntry} />
            </View>
          </View>
        }
      />
    ),
    'security.redact_secrets': () => (
      <ToggleRow
        key="security.redact_secrets"
        label={copy('security.redact_secrets').label}
        description={copy('security.redact_secrets').description}
        checked={values.redactSecrets}
        onChange={(on) => toggle('security.redact_secrets', on, { redactSecrets: on })}
      />
    ),
    'security.allow_private_urls': () => (
      <ToggleRow
        key="security.allow_private_urls"
        label={copy('security.allow_private_urls').label}
        description={copy('security.allow_private_urls').description}
        checked={values.allowPrivateUrls}
        onChange={(on) => toggle('security.allow_private_urls', on, { allowPrivateUrls: on })}
      />
    ),
    'checkpoints.enabled': () => (
      <ToggleRow
        key="checkpoints.enabled"
        label={copy('checkpoints.enabled').label}
        description={copy('checkpoints.enabled').description}
        checked={values.checkpoints}
        onChange={(on) => toggle('checkpoints.enabled', on, { checkpoints: on })}
      />
    ),
  };

  return (
    <SettingsContent>
      {saveError ? (
        <Text accessibilityLiveRegion="polite" style={{ color: t.dtDestructive, fontSize: t.type.caption, marginBottom: 12 }}>
          {saveError}
        </Text>
      ) : null}
      {SAFETY_GROUPS.map((group) => (
        <SettingsSection key={group.id} title={group.title}>
          {group.keys.map((key) => rows[key]())}
        </SettingsSection>
      ))}
    </SettingsContent>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  timeout: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { minWidth: 96, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, borderWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  list: { width: '100%', gap: 8 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingVertical: 6, minHeight: 40 },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
