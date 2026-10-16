/**
 * Room activity, the pure half: the group chat's turn lifecycle as a readable feed, derived from the
 * already-polled room log (no new RPCs). The desktop's collapsible Activity view
 * (apps/desktop/src/plugins/hermes-bots/group-chat-view.tsx `activityPanel`, fed by the local
 * round-robin engine's `recordGroupActivity`) cannot move to the phone: the phone reads
 * gateway-hosted rooms, whose driver runs on the gateway. But the durable room log already emits the
 * equivalent lifecycle (`gateway/hosted_room_discussion.py`: terminal `turn.*` events, `room.activity`,
 * `turn.reassigned`, `member.unavailable`), and the phone's timeline drops most of it.
 *
 * Each row names who did what this run: replied, passed, hit an error, was interrupted, is waiting,
 * or was stopped at the cap. Live "who is working now" is not on the wire (per-member frames go only
 * to the gateway's `on_room_member_activity` plugin hook, never the log), so the panel says the room
 * is working while `driver.working` holds rather than naming a member it cannot see.
 *
 * Parity deviations from the desktop: no run epochs (nothing analogues them on the wire; rows are the
 * newest 50, newest first).
 */

import type { RoomEvent } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { compactAge } from '../bots/roster.ts';
import type { CodiconName } from '../ui/Codicon.tsx';
import type { GroupMember } from './rooms.ts';

export type ActivityTone = 'work' | 'info' | 'error';

export type ActivityRow = {
  key: string;
  /** epoch seconds, the event's own stamp */
  at: number;
  /** the member this row is about, '' for room-level rows */
  member: string;
  text: string;
  tone: ActivityTone;
  glyph: CodiconName;
};

/** newest-first rows kept, the desktop's `GROUP_ACTIVITY_LIMIT` */
const ACTIVITY_LIMIT = 50;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const payloadText = (event: RoomEvent, key: string) => text(event.payload?.[key]);

/** how a turn event's member is named: the roster row, else what the event itself carries */
function speakerOf(event: RoomEvent, members: readonly GroupMember[]): string {
  const id = payloadText(event, 'member_id') || text(event.actor?.id);
  const member = members.find((m) => m.memberId === id);
  if (member) return member.label;
  const named = text((event.actor as { display_name?: unknown } | undefined)?.display_name);
  return named || id || 'A bot';
}

const clip = (value: string, max = 200) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/**
 * The turn lifecycle in the log as activity rows, ascending by seq: what each member's turn did, and
 * the room-level stops and caps. `turn.started` is never logged durably, so live work reads from the
 * driver, not here. `events` is ascending by seq.
 */
export function buildActivity(events: readonly RoomEvent[], members: readonly GroupMember[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const event of events) {
    const key = `${event.seq}`;
    const at = event.created_at ?? 0;
    const member = speakerOf(event, members);
    switch (event.kind) {
      case 'turn.settled': {
        if (payloadText(event, 'message_event_id')) rows.push({ key, at, member, text: `${member} replied`, tone: 'work', glyph: 'check' });
        else if (event.payload?.passed === true) rows.push({ key, at, member, text: `${member} passed`, tone: 'info', glyph: 'circle-slash' });
        break;
      }
      case 'turn.failed': {
        const why = payloadText(event, 'error');
        rows.push({
          key,
          at,
          member,
          text: clip(why ? `${member} hit an error — ${why}` : `${member} hit an error`),
          tone: 'error',
          glyph: 'error',
        });
        break;
      }
      case 'turn.cancelled': {
        const reason = payloadText(event, 'reason');
        rows.push({
          key,
          at,
          member,
          text: reason === 'superseded_by_newer_user_event' ? `${member} was interrupted by a newer message` : `${member} was interrupted`,
          tone: 'info',
          glyph: 'close',
        });
        break;
      }
      case 'turn.deferred': {
        const why = payloadText(event, 'reason');
        rows.push({
          key,
          at,
          member,
          text: clip(why ? `${member} is waiting: ${why}` : `${member} is waiting`),
          tone: 'info',
          glyph: 'debug-pause',
        });
        break;
      }
      case 'turn.reassigned':
        rows.push({ key, at, member, text: `${member}'s turn moved to another member`, tone: 'info', glyph: 'sync' });
        break;
      case 'member.unavailable':
        rows.push({ key, at, member, text: `${member} is unavailable`, tone: 'info', glyph: 'circle-slash' });
        break;
      case 'room.activity': {
        const status = payloadText(event, 'status');
        if (status === 'bounded') rows.push({ key, at, member: '', text: 'Turn stopped at the round/message cap', tone: 'info', glyph: 'debug-pause' });
        else if (status === 'settled') rows.push({ key, at, member: '', text: 'Turn settled', tone: 'info', glyph: 'check' });
        break;
      }
      case 'room.stop_requested':
        rows.push({ key, at, member: '', text: 'Stopped. The bots on turn were interrupted.', tone: 'info', glyph: 'close' });
        break;
      default:
        break;
    }
  }
  return rows.slice(-ACTIVITY_LIMIT);
}

/**
 * The collapsed summary: while the room works, that; else the newest row; else nothing. Mirrors the
 * desktop's rule that a member left in failure keeps the warning once the room goes quiet
 * (`group-chat-view.tsx` unresolved-failures): a member's error pins until that member succeeds.
 */
export function summarizeActivity(rows: readonly ActivityRow[], working: boolean, nowSeconds: number): string | null {
  if (working) return 'The room is working…';
  if (rows.length === 0) return null;
  const failed: Record<string, ActivityRow> = {};
  for (const row of rows) {
    if (!row.member) continue;
    if (row.tone === 'error') failed[row.member] = row;
    else if (row.text.endsWith(' replied')) delete failed[row.member];
  }
  const pinned = Object.values(failed).at(-1) ?? rows[rows.length - 1];
  const age = compactAge(pinned.at, nowSeconds) || 'now';
  return `${pinned.text} · ${age}`;
}
