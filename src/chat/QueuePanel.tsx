/**
 * The queue as a status-stack section (desktop app/chat/composer/queue-panel).
 * Folded, it is one header carrying the count and the first entry's text;
 * opened, every entry shows its actions - delete, edit, steer, send - and a
 * parked queue offers Resume. The desktop edits an entry in the composer; here
 * the row itself becomes the editor, so the composer stays free for the next prompt.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Codicon } from '../ui/Codicon.tsx';
import { mixPct } from '../ui/color.ts';
import { useTokens } from '../ui/tokens.ts';
import { entryPreview, isSteerable, offersExpandedPreview, QUEUE_COPY, type QueueEntry, type QueueState } from './queue.ts';
import { MicroButton, ROW_TEXT, RowButton, StackIcon, StatusRow, StatusSection } from './StatusRows.tsx';

export type QueueActions = {
  remove: (id: string) => void;
  beginEdit: (id: string) => void;
  saveEdit: (id: string, text: string) => void;
  cancelEdit: () => void;
  sendNow: (id: string) => void;
  steerNow: (id: string) => void;
  resume: () => void;
};

export function QueuePanel({ queue, busy, actions }: { queue: QueueState; busy: boolean; actions: QueueActions }) {
  const t = useTokens();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const { entries, parked, editing } = queue;
  if (entries.length === 0) return null;

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const first = entries[0];
  return (
    <StatusSection
      label={parked ? QUEUE_COPY.queuedPaused(entries.length) : QUEUE_COPY.queued(entries.length)}
      icon={parked ? 'debug-pause' : 'layers'}
      accessory={parked ? <MicroButton label={QUEUE_COPY.resume} hint={QUEUE_COPY.resumeTip} onPress={actions.resume} /> : undefined}
      preview={
        <StatusRow leading={<Codicon name="comment" size={12.8} color={t.uiTextTertiary} />} last>
          <Text numberOfLines={1} style={[styles.text, { color: t.uiTextPrimary }]}>
            {entryPreview(first)}
          </Text>
        </StatusRow>
      }
    >
      {entries.map((entry, index) => (
        <QueueRow
          key={entry.id}
          entry={entry}
          busy={busy}
          editing={editing === entry.id}
          editLocked={editing !== null && editing !== entry.id}
          expanded={expanded.has(entry.id)}
          last={index === entries.length - 1}
          onToggle={() => toggle(entry.id)}
          actions={actions}
        />
      ))}
    </StatusSection>
  );
}

function QueueRow({
  entry,
  busy,
  editing,
  editLocked,
  expanded,
  last,
  onToggle,
  actions,
}: {
  entry: QueueEntry;
  busy: boolean;
  editing: boolean;
  editLocked: boolean;
  expanded: boolean;
  last: boolean;
  onToggle: () => void;
  actions: QueueActions;
}) {
  const t = useTokens();
  const preview = entryPreview(entry);
  const canExpand = offersExpandedPreview(preview);
  const canSteer = busy && isSteerable(entry.text);
  const [draft, setDraft] = useState(entry.text);
  useEffect(() => {
    if (editing) setDraft(entry.text);
  }, [editing, entry.text]);
  const ring = mixPct(t.uiComposerRing, 0.4, 'transparent');
  const iconColor = t.uiTextSecondary;

  if (editing) {
    return (
      <StatusRow
        last={last}
        highlighted
        leading={<Codicon name="comment" size={12.8} color={t.uiTextTertiary} />}
        trailing={
          <>
            <RowButton label={QUEUE_COPY.save} disabled={!draft.trim()} onPress={() => actions.saveEdit(entry.id, draft)}>
              <Codicon name="check" size={13} color={iconColor} />
            </RowButton>
            <RowButton label={QUEUE_COPY.cancel} onPress={actions.cancelEdit}>
              <Codicon name="close" size={13} color={iconColor} />
            </RowButton>
          </>
        }
      >
        <View style={[styles.editor, { borderColor: ring, borderRadius: t.radius.md }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            accessibilityLabel={QUEUE_COPY.edit}
            selectionColor={t.uiAccent}
            style={[styles.text, styles.input, { color: t.uiTextPrimary }]}
          />
        </View>
      </StatusRow>
    );
  }

  return (
    <StatusRow
      last={last}
      dismiss={{ label: QUEUE_COPY.delete, onDismiss: () => actions.remove(entry.id) }}
      leading={<Codicon name="comment" size={12.8} color={t.uiTextTertiary} />}
      trailing={
        <>
          {canExpand ? (
            <RowButton label={expanded ? QUEUE_COPY.collapse : QUEUE_COPY.expand} onPress={onToggle}>
              <Codicon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={iconColor} />
            </RowButton>
          ) : null}
          <RowButton label={QUEUE_COPY.edit} disabled={editLocked} onPress={() => actions.beginEdit(entry.id)}>
            <StackIcon name="pencil" size={12} color={iconColor} />
          </RowButton>
          {canSteer ? (
            <RowButton label={QUEUE_COPY.steer} onPress={() => actions.steerNow(entry.id)}>
              <StackIcon name="steer" size={12} color={iconColor} />
            </RowButton>
          ) : null}
          <RowButton label={busy ? QUEUE_COPY.sendNext : QUEUE_COPY.send} onPress={() => actions.sendNow(entry.id)}>
            <StackIcon name="send" size={12} color={iconColor} />
          </RowButton>
        </>
      }
    >
      <View style={styles.preview}>
        <Text numberOfLines={expanded ? 12 : 2} style={[styles.text, { color: t.uiTextPrimary }]}>
          {preview}
        </Text>
      </View>
    </StatusRow>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: ROW_TEXT, lineHeight: 16 },
  preview: { flex: 1, minWidth: 0 },
  editor: { flex: 1, minWidth: 0, borderWidth: 1, paddingHorizontal: 6 },
  input: { maxHeight: 120, paddingVertical: 2, paddingHorizontal: 0, textAlignVertical: 'top' },
});
