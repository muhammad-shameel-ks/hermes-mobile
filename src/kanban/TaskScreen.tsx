/**
 * One task, as a pushed route: the phone's port of the desktop plugin's task modal (`drawer.tsx` `TaskDrawer`).
 * The desktop's two columns stack into one scroll: the hero (status, title, assignee, run clock, priority),
 * the callouts and diagnostics, description, result and summary, the sidebar's properties, dependencies,
 * estimate and attachments, then the feed (comments / activity / runs / worker log). The comment composer is
 * docked at the bottom and rides the keyboard. The detail polls every 5 s; the worker log only while its tab
 * is open. Every write refreshes the detail and bumps the board under this screen.
 */

import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverlayScreen } from '../app/overlay.tsx';
import { Markdown } from '../chat/Markdown.tsx';
import { gateway } from '../files/gateway.ts';
import { formatBytes } from '../files/path.ts';
import { mimeFor } from '../files/preview.ts';
import { errorMessage } from '../files/rest.ts';
import { downloadUrlToCache, shareFile, uploadMultipart, type UploadSource } from '../files/transfer.ts';
import { EmptyState, ErrorBanner, HeaderAction, Loading, useToast } from '../files/ui.tsx';
import { ActionButton, SegmentedControl } from '../settings/primitives.tsx';
import { Codicon } from '../ui/Codicon.tsx';
import { copyText } from '../ui/clipboard.ts';
import { mixPct } from '../ui/color.ts';
import { KeyboardPaddedView } from '../ui/KeyboardPaddedView.tsx';
import { GlyphSpinner } from '../ui/loaders/GlyphSpinner.tsx';
import { ActionSheet, type SheetAction } from '../ui/Sheet.tsx';
import { MONO, useTokens } from '../ui/tokens.ts';
import { LiveResource } from './live.ts';
import { ago, compactNumber, duration, eventText, isAdminSummary, runFailed, SEVERITY_TONE, shortId, wontRun } from './model.ts';
import { attachmentUploadUrl, attachmentUrl, createKanbanRest, type KanbanRest } from './rest.ts';
import { blockKindText, COMPLEXITY_TEXT, K, laneLabel } from './text.ts';
import type {
  Diagnostic,
  DiagnosticAction,
  KanbanAttachment,
  KanbanComment,
  KanbanEvent,
  KanbanProfile,
  KanbanRun,
  KanbanTaskDetail,
  KanbanTaskFull,
  TaskEstimate,
  WorkerLog,
} from './types.ts';
import { Avatar, Callout, LaneSheet, PriorityGlyph, ProfileSheet, RunClock, Section, StatusPill, useLive } from './ui.tsx';
import { bumpKanbanVersion } from './version.ts';

export type TaskScreenProps = {
  taskId: string;
  /** the board the task lives on ('' = the server's current board) */
  board: string;
  /** the board's lanes in order, for the status picker */
  columns: readonly string[];
  onClose: () => void;
  /** a dependency chip: push that task's screen */
  onOpenTask: (id: string) => void;
};

const DETAIL_POLL_MS = 5000;
/** desktop `refetchInterval` for the log: tight while a worker writes it, lazy otherwise */
const LOG_POLL_RUNNING_MS = 3000;
const LOG_POLL_IDLE_MS = 15000;

type FeedTab = 'comments' | 'activity' | 'runs' | 'log';

/** runs a write; the follow-up (refresh, bump, toast) is the caller's `write` wrapper's */
type Write = (run: () => Promise<unknown>, after?: { success?: string; close?: boolean }) => Promise<boolean>;

export default function TaskScreen({ taskId, board, columns, onClose, onOpenTask }: TaskScreenProps) {
  const t = useTokens();
  const toast = useToast();
  const showToast = toast.show;

  const rest = useMemo(() => createKanbanRest(gateway().api, { profile: gateway().profile, board: () => board }), [board]);
  useEffect(() => () => rest.dispose(), [rest]);

  const detail = useMemo(
    () => new LiveResource<KanbanTaskDetail>({ load: () => rest.task(taskId), intervalMs: () => DETAIL_POLL_MS }),
    [rest, taskId],
  );
  const log = useMemo(
    () =>
      new LiveResource<WorkerLog>({
        load: () => rest.log(taskId),
        intervalMs: () => (detail.getSnapshot().data?.task.status === 'running' ? LOG_POLL_RUNNING_MS : LOG_POLL_IDLE_MS),
      }),
    [rest, taskId, detail],
  );
  const snapshot = useLive(detail);
  const data = snapshot.data;
  const task = data?.task;

  // the assignee roster and the default assignee, read once (desktop: staleTime 60 s)
  const [profiles, setProfiles] = useState<readonly KanbanProfile[]>([]);
  /** desktop `useDefaultAssignee`; null until orchestration answers, so "won't run" never flashes */
  const [defaultAssignee, setDefaultAssignee] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    rest.profiles().then(
      (r) => live && setProfiles(r.profiles),
      () => undefined,
    );
    rest.orchestration().then(
      (o) => live && setDefaultAssignee((o.default_assignee ?? '').trim()),
      () => live && setDefaultAssignee(''),
    );
    return () => {
      live = false;
    };
  }, [rest]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [laneOpen, setLaneOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

  const write = useCallback<Write>(
    async (run, after) => {
      try {
        await run();
        bumpKanbanVersion();
        if (after?.close) {
          onClose();
          return true;
        }
        void detail.refresh();
        if (after?.success) showToast(after.success);
        return true;
      } catch (e) {
        showToast(errorMessage(e), 'error');
        return false;
      }
    },
    [detail, onClose, showToast],
  );

  /** desktop `moveMut`: paint the lane first, roll back on a refused transition */
  const move = useCallback(
    async (status: string) => {
      const previous = detail.update((d) => ({ ...d, task: { ...d.task, status } }));
      try {
        await rest.patchTask(taskId, { status });
        bumpKanbanVersion();
        void detail.refresh();
        showToast(K.moved(laneLabel(status)));
      } catch (e) {
        detail.restore(previous);
        showToast(errorMessage(e), 'error');
      }
    },
    [detail, rest, taskId, showToast],
  );

  const comment = useCallback((body: string) => write(() => rest.comment(taskId, body)), [write, rest, taskId]);
  /** desktop `requeueMut`: the note, then a reclaim so the task restarts with it in context */
  const requeue = useCallback(
    (body: string) =>
      write(
        async () => {
          await rest.comment(taskId, body);
          await rest.reclaim(taskId);
        },
        { success: K.notePosted },
      ),
    [write, rest, taskId],
  );

  const confirmDelete = (target: KanbanTaskFull) => {
    Alert.alert(`${K.delete} ${shortId(target.id)}?`, target.title || target.id, [
      { text: K.cancel, style: 'cancel' },
      { text: K.delete, style: 'destructive', onPress: () => void write(() => rest.deleteTask(target.id), { close: true }) },
    ]);
  };

  const taskActions: SheetAction[] = task
    ? [
        {
          label: K.copyTaskId,
          onPress: () => {
            void copyText(task.id);
            showToast(K.copiedId(task.id));
          },
        },
        {
          label: K.copyTitle,
          onPress: () => {
            void copyText(task.title || task.id);
            showToast(K.copiedTitle);
          },
        },
        { label: K.archive, onPress: () => void write(() => rest.patchTask(task.id, { status: 'archived' }), { close: true }) },
        { label: K.delete, destructive: true, onPress: () => confirmDelete(task) },
      ]
    : [];

  const nowSeconds = Math.floor(Date.now() / 1000);
  const error = snapshot.error ? errorMessage(snapshot.error) : null;

  let content: ReactNode;
  if (!data || !task) {
    content = error ? (
      <>
        <ErrorBanner text={error} />
        <EmptyState title={shortId(taskId)} body={error} primary={{ label: 'Retry', onPress: () => void detail.refresh(), disabled: snapshot.loading }} />
      </>
    ) : (
      <Loading label="Loading task…" />
    );
  } else {
    const running = task.status === 'running';
    content = (
      <>
        {error ? <ErrorBanner text={error} /> : null}
        <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.hero}>
            <StatusPill status={task.status} onPress={() => setLaneOpen(true)} />
            <Text selectable style={[styles.title, { color: t.uiTextPrimary }]}>
              {task.title || task.id}
            </Text>
            <View style={styles.meta}>
              <View style={styles.inline}>
                {task.assignee ? <Avatar name={task.assignee} size={18} /> : null}
                <Text numberOfLines={1} style={{ color: task.assignee ? t.uiTextSecondary : t.uiTextQuaternary, fontSize: 13 }}>
                  {task.assignee || K.unassigned}
                </Text>
              </View>
              {running ? <RunClock task={task} size={12} /> : null}
              {typeof task.priority === 'number' ? <PriorityGlyph priority={task.priority} size={12} /> : null}
            </View>
          </View>

          {defaultAssignee !== null && wontRun(task, defaultAssignee) ? (
            <Callout tone={SEVERITY_TONE.warning} title={K.readyUnassignedTitle}>
              <Text style={[styles.calloutBody, { color: t.uiTextSecondary }]}>{K.readyUnassignedBody}</Text>
            </Callout>
          ) : null}

          {task.diagnostics && task.diagnostics.length > 0 ? (
            <Section label={K.diagnosticsN(task.diagnostics.length)}>
              <Diagnostics
                items={task.diagnostics}
                onReclaim={() => void write(() => rest.reclaim(task.id))}
                onUnblock={() => void write(() => rest.patchTask(task.id, { status: 'ready' }), { success: K.unblockedMessage(shortId(task.id)) })}
                onCopied={() => showToast(K.commandCopied)}
              />
            </Section>
          ) : null}

          <DescriptionSection key={task.id} body={task.body} onSave={(body) => write(() => rest.patchTask(task.id, { body }))} />

          {task.result ? (
            <Section label={K.result}>
              <Markdown text={task.result} media={false} />
            </Section>
          ) : null}

          {task.latest_summary && !isAdminSummary(task.latest_summary) ? (
            <Section label={K.latestSummary}>
              <Markdown text={task.latest_summary} media={false} />
            </Section>
          ) : null}

          <Properties task={task} nowSeconds={nowSeconds} onAssignee={() => setAssigneeOpen(true)} onCopied={showToast} />

          <Links detail={data} onOpenTask={onOpenTask} />

          <EstimateSection rest={rest} taskId={task.id} onError={(text) => showToast(text, 'error')} />

          {Array.isArray(data.attachments) ? (
            <AttachmentsSection
              attachments={data.attachments}
              taskId={task.id}
              board={board}
              onUploaded={() => {
                bumpKanbanVersion();
                void detail.refresh();
                showToast(K.uploaded);
              }}
              onError={(text) => showToast(text, 'error')}
            />
          ) : null}

          <FeedTabs detail={data} log={log} running={running} nowSeconds={nowSeconds} />
        </ScrollView>
      </>
    );
  }

  return (
    <OverlayScreen
      title={shortId(taskId)}
      onBack={onClose}
      trailing={<HeaderAction icon="ellipsis" label={K.taskActions} onPress={() => setActionsOpen(true)} disabled={!task} />}
    >
      <KeyboardPaddedView style={styles.flex}>
        <View style={styles.flex}>
          {content}
          {toast.node}
        </View>
        {task ? <Composer running={task.status === 'running'} onSend={comment} onRequeue={requeue} /> : null}
      </KeyboardPaddedView>

      <ActionSheet visible={actionsOpen} title={task ? task.title || task.id : undefined} actions={taskActions} onClose={() => setActionsOpen(false)} />
      <LaneSheet
        visible={laneOpen}
        title={K.moveToShort}
        columns={columns}
        current={task?.status ?? null}
        onPick={(lane) => void move(lane)}
        onClose={() => setLaneOpen(false)}
      />
      <ProfileSheet
        visible={assigneeOpen}
        title={K.assignee}
        profiles={profiles}
        current={task?.assignee ?? null}
        onPick={(choice) => {
          const name = choice.profile;
          if (task && name) void write(() => rest.reassign(task.id, name));
        }}
        onClose={() => setAssigneeOpen(false)}
      />
    </OverlayScreen>
  );
}

// ─── diagnostics ──────────────────────────────────────────────────────────────

/**
 * desktop `Diagnostics`: severity-toned callouts with the backend's recovery actions as buttons. `reassign`
 * is skipped, as on the desktop: the Assignee property is that action.
 */
function Diagnostics({ items, onReclaim, onUnblock, onCopied }: { items: Diagnostic[]; onReclaim: () => void; onUnblock: () => void; onCopied: () => void }) {
  const t = useTokens();
  const act = (action: DiagnosticAction) => {
    if (action.kind === 'reclaim') onReclaim();
    else if (action.kind === 'unblock') onUnblock();
    else if (action.kind === 'cli_hint') {
      void copyText(String(action.payload?.command ?? action.label));
      onCopied();
    }
  };
  return (
    <View style={styles.stack}>
      {items.map((diag) => {
        const actions = diag.actions.filter((a) => a.kind === 'reclaim' || a.kind === 'unblock' || a.kind === 'cli_hint');
        return (
          <Callout key={`${diag.kind}-${diag.last_seen_at}`} tone={SEVERITY_TONE[diag.severity] ?? SEVERITY_TONE.warning} title={`${diag.title}${diag.count > 1 ? ` ×${diag.count}` : ''}`}>
            {diag.detail ? <Text style={[styles.calloutBody, { color: t.uiTextSecondary }]}>{diag.detail}</Text> : null}
            {actions.length > 0 ? (
              <View style={styles.buttons}>
                {actions.map((action) => (
                  <ActionButton
                    key={`${action.kind}-${action.label}`}
                    label={action.label}
                    icon={action.kind === 'cli_hint' ? 'copy' : undefined}
                    variant={action.suggested ? 'secondary' : 'ghost'}
                    onPress={() => act(action)}
                  />
                ))}
              </View>
            ) : null}
          </Callout>
        );
      })}
    </View>
  );
}

// ─── description ──────────────────────────────────────────────────────────────

/** desktop `DescriptionSection`: markdown, with an edit toggle that swaps in a plain multiline field */
function DescriptionSection({ body, onSave }: { body: string | null | undefined; onSave: (body: string) => Promise<boolean> }) {
  const t = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <Section
      label={K.description}
      action={
        editing ? null : (
          <Pressable
            onPress={() => {
              setDraft(body ?? '');
              setEditing(true);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={K.editDescription}
          >
            <Codicon name="edit" size={14} color={t.uiTextTertiary} />
          </Pressable>
        )
      }
    >
      {editing ? (
        <View style={styles.stack}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            editable={!saving}
            placeholder={K.descPlaceholder}
            placeholderTextColor={t.uiTextQuaternary}
            textAlignVertical="top"
            accessibilityLabel={K.description}
            style={[styles.editor, { color: t.uiTextPrimary, backgroundColor: t.uiBgEditor, borderColor: t.uiStrokeSecondary, borderRadius: t.radius['2xl'] }]}
          />
          <View style={styles.buttonsEnd}>
            <ActionButton label={K.cancel} variant="ghost" disabled={saving} onPress={() => setEditing(false)} />
            <ActionButton label={K.save} variant="secondary" busy={saving} onPress={() => void save()} />
          </View>
        </View>
      ) : body ? (
        <Markdown text={body} media={false} />
      ) : (
        <Text style={{ color: t.uiTextQuaternary, fontSize: 14 }}>{K.noDescription}</Text>
      )}
    </Section>
  );
}

// ─── properties ───────────────────────────────────────────────────────────────

/** desktop `MetaRow`, laid out as a label column and a wrapping value: the sidebar folded into the scroll */
function PropRow({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  const t = useTokens();
  return (
    <View style={[styles.prop, { borderBottomColor: t.uiStrokeQuaternary }]}>
      <Text style={[styles.propLabel, { color: t.uiTextTertiary }]}>{label}</Text>
      <View style={styles.propValue}>
        {children}
        {caption ? <Text style={[styles.caption, { color: t.uiTextQuaternary }]}>{caption}</Text> : null}
      </View>
    </View>
  );
}

/** the read-only model line: the override and its provider / effort, else the profile's own */
function modelText(task: KanbanTaskFull): string {
  const parts = [task.model_override, task.provider_override, task.reasoning_effort].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length ? parts.join(' · ') : K.modelInherit;
}

function Properties({ task, nowSeconds, onAssignee, onCopied }: { task: KanbanTaskFull; nowSeconds: number; onAssignee: () => void; onCopied: (text: string) => void }) {
  const t = useTokens();
  const value = { color: t.uiTextSecondary, fontSize: 13 };
  const created = ago(task.created_at, nowSeconds);
  const running = task.status === 'running';
  const path = task.workspace_path;
  const copyPath = () => {
    if (!path) return;
    void copyText(path);
    onCopied('Copied path');
  };
  return (
    <Section label={K.properties}>
      <View>
        <PropRow label={K.assignee}>
          <Pressable onPress={onAssignee} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${K.assignee}: ${task.assignee || K.unassigned}`} style={styles.inline}>
            {task.assignee ? <Avatar name={task.assignee} size={18} /> : null}
            <Text numberOfLines={1} style={{ color: task.assignee ? t.uiTextPrimary : t.uiTextQuaternary, fontSize: 13 }}>
              {task.assignee || K.unassigned}
            </Text>
            <Codicon name="chevron-down" size={11} color={t.uiTextQuaternary} />
          </Pressable>
        </PropRow>
        {typeof task.priority === 'number' ? (
          <PropRow label={K.metaPriority}>
            <PriorityGlyph priority={task.priority} size={13} />
          </PropRow>
        ) : null}
        {task.tenant ? (
          <PropRow label={K.metaTenant}>
            <Text selectable style={value}>
              {task.tenant}
            </Text>
          </PropRow>
        ) : null}
        {task.status === 'blocked' && task.block_kind ? (
          <PropRow label={K.blockReason} caption={blockKindText(task.block_kind)}>
            <Text style={{ color: t.dtDestructive, fontSize: 13 }}>{task.block_kind}</Text>
          </PropRow>
        ) : null}
        {typeof task.block_recurrences === 'number' && task.block_recurrences > 0 ? (
          <PropRow label={K.blockRecurrences} caption={K.blockRecurrencesHint}>
            <Text style={value}>×{task.block_recurrences}</Text>
          </PropRow>
        ) : null}
        {typeof task.consecutive_failures === 'number' && task.consecutive_failures > 0 ? (
          <PropRow label={K.consecutiveFailures}>
            <Text style={value}>{task.consecutive_failures}</Text>
          </PropRow>
        ) : null}
        {task.last_failure_error ? (
          <PropRow label={K.lastFailureError}>
            <Text selectable style={[styles.mono, { color: t.uiTextTertiary }]}>
              {task.last_failure_error}
            </Text>
          </PropRow>
        ) : null}
        {path ? (
          <PropRow label={K.workspace}>
            <Pressable onPress={copyPath} onLongPress={copyPath} accessibilityRole="button" accessibilityHint="Copies the path" style={styles.workspace}>
              <View style={styles.workspaceText}>
                {task.workspace_kind && task.workspace_kind !== 'dir' ? (
                  <View style={[styles.badge, { backgroundColor: t.uiBgQuaternary, borderRadius: t.radius.sm }]}>
                    <Text style={[styles.badgeText, { color: t.uiTextSecondary }]}>{task.workspace_kind}</Text>
                  </View>
                ) : null}
                <Text style={[styles.mono, { color: t.uiTextTertiary }]}>{path}</Text>
              </View>
              <Codicon name="copy" size={13} color={t.uiTextQuaternary} />
            </Pressable>
          </PropRow>
        ) : null}
        <PropRow label={K.model}>
          <Text selectable style={value}>
            {modelText(task)}
          </Text>
        </PropRow>
        {task.created_by ? (
          <PropRow label={K.metaCreatedBy}>
            <Text selectable style={value}>
              {task.created_by}
            </Text>
          </PropRow>
        ) : null}
        {created ? (
          <PropRow label={K.metaCreated}>
            <Text style={value}>{created}</Text>
          </PropRow>
        ) : null}
        {running && task.worker_pid ? (
          <PropRow label={K.metaWorkerPid}>
            <Text selectable style={[value, styles.tabular]}>
              {task.worker_pid}
            </Text>
          </PropRow>
        ) : null}
      </View>
    </Section>
  );
}

// ─── dependencies ─────────────────────────────────────────────────────────────

/** desktop `LinkChips`: Blocked by = parents, Blocks = children, titled from `link_tasks`, else the short id */
function Links({ detail, onOpenTask }: { detail: KanbanTaskDetail; onOpenTask: (id: string) => void }) {
  const titles = useMemo(() => new Map((detail.link_tasks ?? []).map((linked) => [linked.id, linked.title])), [detail.link_tasks]);
  const { parents, children } = detail.links;
  if (parents.length === 0 && children.length === 0) return null;
  return (
    <>
      {parents.length > 0 ? (
        <Section label={K.blockedBy}>
          <LinkChips ids={parents} titles={titles} onOpen={onOpenTask} />
        </Section>
      ) : null}
      {children.length > 0 ? (
        <Section label={K.blocks}>
          <LinkChips ids={children} titles={titles} onOpen={onOpenTask} />
        </Section>
      ) : null}
    </>
  );
}

function LinkChips({ ids, titles, onOpen }: { ids: string[]; titles: ReadonlyMap<string, string>; onOpen: (id: string) => void }) {
  const t = useTokens();
  return (
    <View style={styles.chips}>
      {ids.map((id) => {
        const label = titles.get(id) || shortId(id);
        return (
          <Pressable
            key={id}
            onPress={() => onOpen(id)}
            accessibilityRole="link"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? t.uiRowActiveBackground : t.uiBgQuaternary, borderRadius: t.radius.sm }]}
          >
            <Text numberOfLines={1} style={{ color: t.uiTextSecondary, fontSize: 12.5 }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── estimate ─────────────────────────────────────────────────────────────────

/** desktop `EstimateSection`: tokens and complexity from the auxiliary model, only behind an explicit tap */
function EstimateSection({ rest, taskId, onError }: { rest: KanbanRest; taskId: string; onError: (text: string) => void }) {
  const t = useTokens();
  const [result, setResult] = useState<TaskEstimate | null>(null);
  const [pending, setPending] = useState(false);

  const estimate = async () => {
    setPending(true);
    try {
      const r = await rest.estimateTask(taskId);
      if (r.ok) setResult(r);
      else onError(r.reason || K.couldNotEstimate);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Section
      label={K.estimate}
      action={
        result?.ok ? (
          <Pressable onPress={() => void estimate()} disabled={pending} hitSlop={10} accessibilityRole="button" accessibilityLabel={K.reEstimate}>
            {pending ? <GlyphSpinner size={13} color={t.uiTextTertiary} /> : <Codicon name="refresh" size={14} color={t.uiTextTertiary} />}
          </Pressable>
        ) : null
      }
    >
      {result?.ok ? (
        <View style={styles.stackTight}>
          <Text style={{ color: t.uiTextSecondary, fontSize: 14 }}>
            <Text style={[styles.tabular, styles.strong]}>
              ~{compactNumber(result.est_tokens)} {K.tokUnit}
            </Text>
            {result.complexity ? <Text style={{ color: t.uiTextTertiary }}> · {COMPLEXITY_TEXT[result.complexity] ?? result.complexity}</Text> : null}
          </Text>
          {result.rationale ? <Text style={[styles.caption, { color: t.uiTextQuaternary }]}>{result.rationale}</Text> : null}
        </View>
      ) : (
        <View style={styles.stackTight}>
          <ActionButton
            label={pending ? K.estimating : K.estimateEffort}
            icon="dashboard"
            variant="secondary"
            busy={pending}
            onPress={() => void estimate()}
            style={styles.selfStart}
          />
          <Text style={[styles.caption, { color: t.uiTextQuaternary }]}>{K.makesModelCall}</Text>
        </View>
      )}
    </Section>
  );
}

// ─── attachments ──────────────────────────────────────────────────────────────

/** desktop `AttachmentsSection`: a tap downloads into the cache and hands the file to the share sheet */
function AttachmentsSection({
  attachments,
  taskId,
  board,
  onUploaded,
  onError,
}: {
  attachments: KanbanAttachment[];
  taskId: string;
  board: string;
  onUploaded: () => void;
  onError: (text: string) => void;
}) {
  const t = useTokens();
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const open = async (attachment: KanbanAttachment) => {
    const { auth, profile } = gateway();
    setOpening(String(attachment.id));
    try {
      const file = await downloadUrlToCache(attachmentUrl(auth.baseUrl, attachment.id, board, profile()), attachment.filename);
      await shareFile(file.uri, mimeFor(attachment.filename), attachment.filename);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setOpening(null);
    }
  };

  const upload = async (sources: UploadSource[]) => {
    if (!sources.length) return;
    const { auth, profile } = gateway();
    setUploading(true);
    try {
      for (const source of sources) await uploadMultipart(attachmentUploadUrl(auth.baseUrl, taskId, board, profile()), source);
      onUploaded();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  // native pickers load on first use (docs/performance.md: native modules used only in an action stay off the launch path)
  const pickFiles = async () => {
    const DocumentPicker = await import('expo-document-picker');
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    await upload(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType })));
  };

  const pickPhotos = async () => {
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true });
    if (result.canceled) return;
    await upload(result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName || asset.uri.split('/').pop() || 'upload', mimeType: asset.mimeType })));
  };

  const pickers: SheetAction[] = [
    { label: 'Files', onPress: () => void pickFiles() },
    { label: 'Photos and videos', onPress: () => void pickPhotos() },
  ];

  return (
    <Section
      label={attachments.length ? `${K.attachments} · ${attachments.length}` : K.attachments}
      action={
        <Pressable onPress={() => setPickerOpen(true)} disabled={uploading} hitSlop={10} accessibilityRole="button" accessibilityLabel={K.uploadAttachment}>
          {uploading ? <GlyphSpinner size={13} color={t.uiTextTertiary} /> : <Codicon name="cloud-upload" size={15} color={t.uiTextTertiary} />}
        </Pressable>
      }
    >
      {attachments.length > 0 ? (
        <View>
          {attachments.map((attachment) => {
            const busy = opening === String(attachment.id);
            return (
              <Pressable
                key={attachment.id}
                onPress={() => void open(attachment)}
                disabled={opening !== null}
                accessibilityRole="button"
                accessibilityLabel={attachment.filename}
                style={({ pressed }) => [styles.attachment, pressed && { backgroundColor: t.uiRowActiveBackground }]}
              >
                {busy ? <GlyphSpinner size={13} color={t.uiTextTertiary} /> : <Codicon name="cloud-download" size={14} color={t.uiTextTertiary} />}
                <Text numberOfLines={1} style={[styles.flexText, { color: t.uiTextSecondary, fontSize: 13 }]}>
                  {attachment.filename}
                </Text>
                {attachment.size != null ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11 }}>{formatBytes(attachment.size)}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={{ color: t.uiTextQuaternary, fontSize: 13 }}>{K.noAttachments}</Text>
      )}
      <ActionSheet visible={pickerOpen} title={K.uploadAttachment} actions={pickers} onClose={() => setPickerOpen(false)} />
    </Section>
  );
}

// ─── the feed ─────────────────────────────────────────────────────────────────

/**
 * desktop `FeedTabs`: Comments, then Activity, Runs and the worker log when they have something to show. The
 * desktop knows the log exists because it always reads it; the phone reads it only while its tab is open, so
 * the tab shows once a worker has run (a run on record, a pid, or the task running now).
 */
function FeedTabs({ detail, log, running, nowSeconds }: { detail: KanbanTaskDetail; log: LiveResource<WorkerLog>; running: boolean; nowSeconds: number }) {
  const t = useTokens();
  const [tab, setTab] = useState<FeedTab>('comments');
  const { comments, events, runs } = detail;
  const hasLog = running || runs.length > 0 || Boolean(detail.task.worker_pid);

  const tabs: Array<{ id: FeedTab; label: string }> = [{ id: 'comments', label: comments.length ? `${K.comments} · ${comments.length}` : K.comments }];
  if (events.length > 0) tabs.push({ id: 'activity', label: `${K.activity} · ${events.length}` });
  if (runs.length > 0) tabs.push({ id: 'runs', label: `${K.runs} · ${runs.length}` });
  if (hasLog) tabs.push({ id: 'log', label: K.workerLog });
  // a tab whose content went away falls back to the comments
  const active: FeedTab = tabs.some((option) => option.id === tab) ? tab : 'comments';

  let body: ReactNode;
  if (active === 'activity') {
    body = (
      <View style={styles.stackTight}>
        {events.map((event) => (
          <EventRow key={event.id} event={event} age={ago(event.created_at, nowSeconds)} />
        ))}
      </View>
    );
  } else if (active === 'runs') {
    body = (
      <View style={styles.stack}>
        {runs.map((run) => (
          <RunRow key={run.id} run={run} age={ago(run.ended_at ?? run.started_at, nowSeconds)} />
        ))}
      </View>
    );
  } else if (active === 'log') {
    body = <LogBody log={log} />;
  } else {
    body = (
      <View style={styles.stack}>
        {comments.length > 0 ? (
          comments.map((c) => <CommentRow key={c.id} comment={c} age={ago(c.created_at, nowSeconds)} />)
        ) : (
          <Text style={{ color: t.uiTextQuaternary, fontSize: 13 }}>{K.noComments}</Text>
        )}
        <Text style={[styles.caption, { color: t.uiTextQuaternary }]}>{running ? K.commentsHelpRunning : K.commentsHelp}</Text>
      </View>
    );
  }

  // with something to switch to, the control is the heading (desktop: a label above it only repeated the tab)
  if (tabs.length < 2) return <Section label={K.comments}>{body}</Section>;
  return (
    <View style={styles.section}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        <SegmentedControl options={tabs} value={active} onChange={setTab} />
      </ScrollView>
      {body}
    </View>
  );
}

const CommentRow = memo(function CommentRow({ comment, age }: { comment: KanbanComment; age: string | null }) {
  const t = useTokens();
  return (
    <View style={styles.stackTight}>
      <View style={styles.inline}>
        <Avatar name={comment.author} size={16} />
        <Text style={{ color: t.uiTextSecondary, fontSize: 13, fontWeight: '500' }}>{comment.author}</Text>
        {age ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11 }}>{age}</Text> : null}
      </View>
      <Markdown text={comment.body} media={false} />
    </View>
  );
});

const EventRow = memo(function EventRow({ event, age }: { event: KanbanEvent; age: string | null }) {
  const t = useTokens();
  const { label, detail } = eventText(event);
  return (
    <View style={styles.eventRow}>
      <View style={styles.flexText}>
        <Text style={{ color: t.uiTextSecondary, fontSize: 13 }}>{label}</Text>
        {detail ? (
          <Text numberOfLines={2} style={{ color: t.uiTextQuaternary, fontSize: 11.5, marginTop: 1 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {age ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11 }}>{age}</Text> : null}
    </View>
  );
});

const RunRow = memo(function RunRow({ run, age }: { run: KanbanRun; age: string | null }) {
  const t = useTokens();
  const failed = runFailed(run);
  const length = duration(run.started_at, run.ended_at);
  const note = run.error ?? run.summary;
  const badgeTone = failed ? t.dtDestructive : t.uiTextSecondary;
  return (
    <View style={styles.stackTight}>
      <View style={styles.inline}>
        <View style={[styles.badge, { backgroundColor: failed ? mixPct(t.dtDestructive, 0.15, 'transparent') : t.uiBgQuaternary, borderRadius: t.radius.sm }]}>
          <Text style={[styles.badgeText, { color: badgeTone }]}>{run.outcome ?? run.status}</Text>
        </View>
        {run.profile ? <Text style={{ color: t.uiTextTertiary, fontSize: 12.5 }}>{run.profile}</Text> : null}
        {length ? <Text style={{ color: t.uiTextQuaternary, fontSize: 12 }}>{length}</Text> : null}
        <View style={styles.flexText} />
        {age ? <Text style={{ color: t.uiTextQuaternary, fontSize: 11 }}>{age}</Text> : null}
      </View>
      {note ? (
        <Text numberOfLines={2} style={{ color: run.error ? t.dtDestructive : t.uiTextQuaternary, fontSize: 12, lineHeight: 17 }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
});

/** the worker log tail; mounting this is what starts the log's polling, so it reads only while the tab shows */
function LogBody({ log }: { log: LiveResource<WorkerLog> }) {
  const t = useTokens();
  const snapshot = useLive(log);
  const data = snapshot.data;
  if (!data) {
    if (snapshot.error) return <Text style={{ color: t.dtDestructive, fontSize: 12.5 }}>{errorMessage(snapshot.error)}</Text>;
    return <GlyphSpinner size={13} color={t.uiTextTertiary} />;
  }
  if (!data.exists || !data.content) return <Text style={{ color: t.uiTextQuaternary, fontSize: 13 }}>{K.noLog}</Text>;
  return (
    <View style={[styles.log, { backgroundColor: t.uiBgTertiary, borderColor: t.uiStrokeTertiary, borderRadius: t.radius['2xl'] }]}>
      <Text selectable style={[styles.mono, { color: t.uiTextSecondary }]}>
        {data.content}
      </Text>
    </View>
  );
}

// ─── composer ─────────────────────────────────────────────────────────────────

/**
 * desktop `CommentComposer`, docked. On a running task the worker folds a new note into its live turn, so
 * the plain send reaches it mid-run; "Requeue with note" is the heavier option: the note, then a restart.
 */
const Composer = memo(function Composer({ running, onSend, onRequeue }: { running: boolean; onSend: (body: string) => Promise<boolean>; onRequeue: (body: string) => Promise<boolean> }) {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const trimmed = text.trim();
  const empty = !trimmed || pending;

  const submit = async (send: (body: string) => Promise<boolean>) => {
    if (empty) return;
    setPending(true);
    const ok = await send(trimmed);
    setPending(false);
    if (ok) setText('');
  };

  const sendLabel = running ? K.send : K.comment;
  return (
    <View style={[styles.composer, { borderTopColor: t.uiStrokeSecondary, backgroundColor: t.uiChatSurfaceBackground, paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={[styles.composerField, { backgroundColor: t.uiBgEditor, borderColor: t.uiComposerBorder, borderRadius: t.radius['2xl'] }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          editable={!pending}
          placeholder={running ? K.messageWorker : K.addComment}
          placeholderTextColor={t.uiTextQuaternary}
          selectionColor={t.uiAccent}
          accessibilityLabel={running ? K.messageWorker : K.addComment}
          style={[styles.composerInput, { color: t.uiTextPrimary }]}
        />
        <Pressable
          onPress={() => void submit(onSend)}
          disabled={empty}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
          accessibilityState={{ disabled: empty, busy: pending }}
          style={[styles.send, { backgroundColor: empty ? t.uiBgQuaternary : t.dtPrimarySolid }]}
        >
          {pending ? (
            <GlyphSpinner size={12} color={t.uiTextTertiary} />
          ) : (
            <Codicon name="arrow-up" size={14} color={empty ? t.uiTextQuaternary : t.dtPrimarySolidForeground} />
          )}
        </Pressable>
      </View>
      {running ? (
        <ActionButton label={K.requeueWithNote} icon="debug-restart" variant="ghost" disabled={empty} onPress={() => void submit(onRequeue)} style={styles.requeue} />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexText: { flex: 1, minWidth: 0 },
  scroll: { padding: 16, paddingBottom: 24, gap: 20 },
  hero: { gap: 10 },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '600' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 },
  calloutBody: { fontSize: 12.5, lineHeight: 18 },
  stack: { gap: 12 },
  stackTight: { gap: 6 },
  section: { gap: 12 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  buttonsEnd: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  editor: { minHeight: 120, maxHeight: 320, fontSize: 14, lineHeight: 20, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, borderWidth: StyleSheet.hairlineWidth },
  prop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  propLabel: { width: 118, fontSize: 12.5, lineHeight: 18 },
  propValue: { flex: 1, minWidth: 0, gap: 4, minHeight: 18, justifyContent: 'center' },
  caption: { fontSize: 11.5, lineHeight: 16 },
  mono: { fontFamily: MONO, fontSize: 11.5, lineHeight: 16 },
  tabular: { fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '600' },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  workspaceText: { flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' },
  badge: { paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6 },
  selfStart: { alignSelf: 'flex-start' },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 4 },
  tabs: { paddingRight: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  log: { padding: 10, borderWidth: StyleSheet.hairlineWidth },
  composer: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  composerField: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: StyleSheet.hairlineWidth, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 },
  composerInput: { flex: 1, minHeight: 28, maxHeight: 140, fontSize: 15, lineHeight: 20, paddingTop: 4, paddingBottom: 4 },
  send: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  requeue: { alignSelf: 'flex-end', minHeight: 34 },
});
