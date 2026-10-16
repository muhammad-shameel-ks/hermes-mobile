/**
 * The two pending-action cards above the composer: a command waiting on the reader's approval, and a
 * turn the driver left indeterminate after a disconnect. Mirrors ApprovalCard's surface and RequestButton
 * so a room's approval reads the same as a chat's; copy follows the desktop's `group.*` i18n strings.
 */
import { memo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { RequestButton } from '../../chat/requestUi.tsx';
import { Codicon } from '../../ui/Codicon.tsx';
import { MONO, useTokens, type Tokens } from '../../ui/tokens.ts';
import type { GroupMember, PendingAction } from '../rooms.ts';

const surface = (t: Tokens) => ({
  borderRadius: t.radius.xl,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: t.uiStrokeSecondary,
  backgroundColor: t.uiChatSurfaceBackground,
});

type ApprovalAction = Extract<PendingAction, { kind: 'approval' }>;
type RetryAction = Extract<PendingAction, { kind: 'retry' }>;

type Props = {
  action: PendingAction;
  members: readonly GroupMember[];
  busy: boolean;
  onApprove: (action: ApprovalAction, choice: 'once' | 'deny') => void;
  onRetryTask: (taskId: string) => void;
};

function PendingActionCardImpl({ action, members, busy, onApprove, onRetryTask }: Props) {
  const t = useTokens();
  if (action.kind === 'retry') return <RetryCard t={t} action={action} busy={busy} onRetryTask={onRetryTask} />;
  const member = members.find((candidate) => candidate.memberId === action.memberId) ?? null;
  return <ApprovalCard t={t} action={action} member={member} busy={busy} onApprove={onApprove} />;
}

function ApprovalCard({ t, action, member, busy, onApprove }: { t: Tokens; action: ApprovalAction; member: GroupMember | null; busy: boolean; onApprove: Props['onApprove'] }) {
  const [choosing, setChoosing] = useState<'once' | 'deny' | null>(null);
  const handle = member?.handle ?? action.memberId;

  const choose = (choice: 'once' | 'deny') => {
    setChoosing(choice);
    onApprove(action, choice);
  };

  return (
    <View style={[surface(t), styles.card]}>
      <View style={styles.header}>
        <Codicon name="terminal" size={14} color={t.uiTextSecondary} />
        {/* desktop i18n.ts group.wantsToRunCommand */}
        <Text style={[styles.headerText, { color: t.uiTextSecondary }]}>{`@${handle} wants to run a command:`}</Text>
      </View>
      {action.command ? (
        <Text numberOfLines={6} selectable style={[styles.command, { color: t.uiTextPrimary }]}>
          {action.command}
        </Text>
      ) : null}
      {action.description ? <Text style={[styles.description, { color: t.uiTextTertiary }]}>{action.description}</Text> : null}
      <View style={styles.actions}>
        <RequestButton label="Deny" variant="text" disabled={busy} busy={busy && choosing === 'deny'} onPress={() => choose('deny')} />
        <RequestButton label="Allow once" disabled={busy} busy={busy && choosing === 'once'} onPress={() => choose('once')} />
      </View>
    </View>
  );
}

function RetryCard({ t, action, busy, onRetryTask }: { t: Tokens; action: RetryAction; busy: boolean; onRetryTask: (taskId: string) => void }) {
  const confirm = () => {
    Alert.alert('Retry this turn?', 'Side effects may already have occurred; retrying does not undo them.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Retry', onPress: () => onRetryTask(action.taskId) },
    ]);
  };
  return (
    <View style={[surface(t), styles.card]}>
      <Text style={[styles.description, { color: t.uiTextSecondary }]}>{"A bot's turn did not finish. Side effects may already have happened."}</Text>
      <View style={styles.actions}>
        <RequestButton label="Retry" disabled={busy} onPress={confirm} />
      </View>
    </View>
  );
}

export const PendingActionCard = memo(PendingActionCardImpl);

const styles = StyleSheet.create({
  card: { marginTop: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  headerText: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  command: { fontFamily: MONO, fontSize: 12, lineHeight: 12 * 1.5, marginBottom: 4 },
  description: { fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 8 },
});
