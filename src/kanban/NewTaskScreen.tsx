/**
 * The new-task form (desktop `board.tsx` `NewTaskDialog`) as a pushed screen: title, description, priority,
 * workspace (the board's default kind, with an optional path override), assignee (the orchestration default,
 * any profile, or parked), skills, a parent and goal mode, with the auxiliary model's rough estimate on
 * request. A title-only create runs: "default" resolves to the dispatcher's default assignee, never silently
 * unassigned. The task lands in the lane it was asked for (create derives triage or ready; a different lane
 * is a follow-up move).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayScreen } from '../app/overlay.tsx';
import { gateway } from '../files/gateway.ts';
import { errorMessage } from '../files/rest.ts';
import { ActionButton, SegmentedControl } from '../settings/primitives.tsx';
import { Codicon } from '../ui/Codicon.tsx';
import { outcome, tick } from '../ui/haptics.ts';
import { KeyboardPaddedView } from '../ui/KeyboardPaddedView.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { compactNumber, splitSkills } from './model.ts';
import { createKanbanRest } from './rest.ts';
import { COMPLEXITY_TEXT, K, laneLabel } from './text.ts';
import type { BoardsResponse, KanbanProfile, TaskEstimate } from './types.ts';
import { Avatar, FieldLabel, ProfileSheet, type ProfileChoice } from './ui.tsx';
import { bumpKanbanVersion } from './version.ts';

const WORKSPACE_KINDS = ['scratch', 'worktree', 'dir'] as const;
type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

/** the assignee field: the resolved default, a named profile, or parked (won't run) */
type AssigneeChoice = { kind: 'default' } | { kind: 'profile'; name: string } | { kind: 'parked' };

export type NewTaskScreenProps = {
  board: string;
  lane: string;
  parents: ReadonlyArray<{ id: string; title: string }>;
  onClose: () => void;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const t = useTokens();
  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11, lineHeight: 15 }}>{hint}</Text> : null}
    </View>
  );
}

export default function NewTaskScreen({ board, lane, parents, onClose }: NewTaskScreenProps) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { api, profile } = gateway();
  const rest = useMemo(() => createKanbanRest(api, { profile, board: () => board }), [api, profile, board]);
  useEffect(() => () => rest.dispose(), [rest]);

  const [profiles, setProfiles] = useState<KanbanProfile[]>([]);
  const [boards, setBoards] = useState<BoardsResponse | null>(null);
  const [resolvedDefault, setResolvedDefault] = useState('default');
  useEffect(() => {
    let alive = true;
    void rest.profiles().then((r) => alive && setProfiles(r.profiles), () => undefined);
    void rest.boards().then((r) => alive && setBoards(r), () => undefined);
    void rest.orchestration().then((r) => alive && setResolvedDefault(r.resolved_default_assignee || 'default'), () => undefined);
    return () => {
      alive = false;
    };
  }, [rest]);

  // a task inherits the board's project directory and the kind it implies unless overridden here
  const currentBoard = boards?.boards.find((b) => b.slug === (board || boards.current));
  const boardKind = (WORKSPACE_KINDS as readonly string[]).includes(currentBoard?.default_workspace_kind ?? '') ? (currentBoard?.default_workspace_kind as WorkspaceKind) : 'scratch';
  const boardDir = currentBoard?.default_workdir || '';

  const isTriage = lane === 'triage';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('0');
  const [kind, setKind] = useState<WorkspaceKind | null>(null);
  const [path, setPath] = useState('');
  const [assignee, setAssignee] = useState<AssigneeChoice>({ kind: 'default' });
  const [skills, setSkills] = useState('');
  const [parent, setParent] = useState('');
  const [goalMode, setGoalMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<TaskEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [sheet, setSheet] = useState<'assignee' | 'parent' | null>(null);
  const workspaceKind = kind ?? boardKind;

  const assigneeLabel = assignee.kind === 'default' ? K.defaultOption(resolvedDefault) : assignee.kind === 'parked' ? K.parkedOption : assignee.name;
  const assigneeFace = assignee.kind === 'default' ? resolvedDefault : assignee.kind === 'profile' ? assignee.name : null;
  const parentTitle = parent ? (parents.find((p) => p.id === parent)?.title ?? parent) : K.noParent;

  const runEstimate = async () => {
    if (!title.trim() || estimating) return;
    setEstimating(true);
    try {
      const result = await rest.estimateNew(title.trim(), body.trim());
      if (result.ok) setEstimate(result);
      else setError(result.reason || K.couldNotEstimate);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setEstimating(false);
    }
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const skillList = splitSkills(skills);
      const { task, warning } = await rest.createTask({
        title: trimmed,
        body: body.trim() || undefined,
        assignee: assignee.kind === 'parked' ? undefined : assignee.kind === 'profile' ? assignee.name : resolvedDefault,
        priority: Number(priority) || 0,
        skills: skillList.length ? skillList : undefined,
        parents: parent ? [parent] : undefined,
        triage: isTriage,
        goal_mode: goalMode,
        workspace_kind: workspaceKind,
        // empty: the backend inherits the board's project directory
        workspace_path: workspaceKind !== 'scratch' && path.trim() ? path.trim() : undefined,
      });
      if (task && task.status !== lane) await rest.patchTask(task.id, { status: lane });
      outcome('submit');
      bumpKanbanVersion();
      onClose();
      // the dispatcher-presence warning ("this ready task will sit idle"): not an error, but worth knowing
      if (warning) Alert.alert(K.createTask, warning);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const input = [styles.input, { color: t.uiTextPrimary, backgroundColor: t.uiBgTertiary, borderRadius: t.radius['2xl'] }];
  const picker = (label: string, lead: ReactNode, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [...input, styles.picker, pressed && { opacity: 0.7 }]}>
      {lead}
      <Text numberOfLines={1} style={{ flex: 1, color: t.uiTextPrimary, fontSize: 15 }}>
        {label}
      </Text>
      <Codicon name="chevron-down" size={12} color={t.uiTextTertiary} />
    </Pressable>
  );

  const assigneeLeading: ProfileChoice[] = [{ key: 'default', label: K.defaultOption(resolvedDefault), profile: resolvedDefault }];
  const assigneeTrailing: ProfileChoice[] = [{ key: 'parked', label: K.parkedOption, profile: null }];

  return (
    <OverlayScreen title={K.newTaskIn(laneLabel(lane))} onBack={onClose}>
      <KeyboardPaddedView style={styles.flex}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            autoFocus
            value={title}
            onChangeText={setTitle}
            placeholder={isTriage ? K.titlePlaceholderTriage : K.titlePlaceholder}
            placeholderTextColor={t.uiTextQuaternary}
            returnKeyType="next"
            accessibilityLabel={K.titlePlaceholder}
            style={[...input, styles.title]}
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={K.descPlaceholder}
            placeholderTextColor={t.uiTextQuaternary}
            multiline
            textAlignVertical="top"
            accessibilityLabel={K.descPlaceholder}
            style={[...input, styles.body]}
          />

          <Field label={K.assignee}>{picker(assigneeLabel, assigneeFace ? <Avatar name={assigneeFace} size={20} /> : <Codicon name="circle-slash" size={14} color={t.uiTextTertiary} />, () => setSheet('assignee'))}</Field>

          <Field label={K.priority}>
            <TextInput value={priority} onChangeText={setPriority} keyboardType="number-pad" accessibilityLabel={K.priority} style={input} />
          </Field>

          <Field label={K.workspace} hint={workspaceKind === boardKind ? `${workspaceKind}${K.boardDefaultSuffix}` : undefined}>
            <SegmentedControl options={WORKSPACE_KINDS.map((id) => ({ id, label: id }))} value={workspaceKind} onChange={setKind} />
          </Field>
          {workspaceKind !== 'scratch' ? (
            <Field label={K.workspaceOverride} hint={boardDir ? K.workspaceInheritDir(boardDir) : K.workspaceInheritGeneric}>
              <TextInput
                value={path}
                onChangeText={setPath}
                placeholder={boardDir || K.workspaceInherit}
                placeholderTextColor={t.uiTextQuaternary}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={K.workspaceOverride}
                style={[...input, { fontFamily: MONO, fontSize: 13 }]}
              />
            </Field>
          ) : null}

          <Field label={K.skills}>
            <TextInput
              value={skills}
              onChangeText={setSkills}
              placeholder={K.skillsPlaceholder}
              placeholderTextColor={t.uiTextQuaternary}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={K.skills}
              style={input}
            />
          </Field>

          {parents.length > 0 ? <Field label={K.parent}>{picker(parentTitle, null, () => setSheet('parent'))}</Field> : null}

          <View style={styles.toggle}>
            <View style={styles.flex}>
              <Text style={{ color: t.uiTextPrimary, fontSize: 15 }}>{K.goalMode}</Text>
              <Text style={{ color: t.uiTextQuaternary, fontSize: 11.5, marginTop: 2 }}>{K.goalModeHint}</Text>
            </View>
            <Switch
              value={goalMode}
              accessibilityLabel={K.goalMode}
              onValueChange={(on) => {
                tick();
                setGoalMode(on);
              }}
              trackColor={{ false: t.uiBgQuaternary, true: t.uiAccent }}
            />
          </View>

          <View style={styles.estimate}>
            {estimate?.ok ? (
              <View style={styles.flex}>
                <Text style={{ color: t.uiTextSecondary, fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
                  ~{compactNumber(estimate.est_tokens)} {K.tokUnit}
                  {estimate.complexity ? ` · ${COMPLEXITY_TEXT[estimate.complexity] ?? estimate.complexity}` : ''}
                </Text>
                {estimate.rationale ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11.5, lineHeight: 16, marginTop: 2 }}>{estimate.rationale}</Text> : null}
              </View>
            ) : (
              <Text style={[styles.flex, { color: t.uiTextQuaternary, fontSize: 11.5, lineHeight: 16 }]}>{K.makesModelCall}</Text>
            )}
            <ActionButton
              label={estimating ? K.estimating : estimate?.ok ? K.reEstimate : K.estimate}
              icon="dashboard"
              variant="ghost"
              busy={estimating}
              disabled={!title.trim()}
              onPress={() => void runEstimate()}
            />
          </View>

          {error ? <Text style={{ color: t.dtDestructive, fontSize: 13 }}>{error}</Text> : null}
        </ScrollView>
        <View style={[styles.footer, { borderTopColor: t.uiStrokeQuaternary, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <ActionButton label={K.cancel} variant="ghost" onPress={onClose} />
          <ActionButton label={busy ? K.creating : K.createTask} busy={busy} disabled={!title.trim()} onPress={() => void submit()} />
        </View>
      </KeyboardPaddedView>

      <ProfileSheet
        visible={sheet === 'assignee'}
        title={K.assignee}
        profiles={profiles.filter((p) => p.name !== resolvedDefault)}
        current={assignee.kind === 'profile' ? assignee.name : null}
        leading={assigneeLeading}
        trailing={assigneeTrailing}
        onPick={(choice) => setAssignee(choice.key === 'default' ? { kind: 'default' } : choice.key === 'parked' ? { kind: 'parked' } : { kind: 'profile', name: choice.label })}
        onClose={() => setSheet(null)}
      />
      <Sheet visible={sheet === 'parent'} onClose={() => setSheet(null)}>
        <Text style={[styles.sheetTitle, { color: t.uiTextPrimary }]}>{K.parent}</Text>
        <ScrollView style={styles.sheetList}>
          {[{ id: '', title: K.noParent }, ...parents].map((option) => (
            <Pressable
              key={option.id || 'none'}
              onPress={() => {
                tick();
                setParent(option.id);
                setSheet(null);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: t.uiRowActiveBackground }]}
            >
              <Text numberOfLines={2} style={{ flex: 1, color: t.uiTextPrimary, fontSize: 15 }}>
                {option.title || option.id}
              </Text>
              {option.id === parent ? <Codicon name="check" size={14} color={t.uiTextSecondary} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </OverlayScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  input: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 10 },
  title: { fontSize: 16, fontWeight: '500' },
  body: { minHeight: 96 },
  field: { gap: 6 },
  picker: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  estimate: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 15, fontWeight: '600', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  sheetList: { maxHeight: 460 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 20, paddingVertical: 8 },
});
