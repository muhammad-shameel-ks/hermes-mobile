/**
 * Group chats, the pure half: the gateway-hosted room as the phone reads it (apps/desktop/src/plugins/
 * hermes-bots/canonical-groups.ts and the gateway's `gateway/hosted_room_discussion.py`). A room is an
 * ordered, append-only event log owned by the gateway; the gateway's driver runs the members' turns, so
 * the phone only reads the log, appends user messages and answers the driver's pending actions.
 *
 * Nothing here touches the socket or React: the room store, the roster and the screens build on it.
 */

import type { Room, RoomDriverStatus, RoomEvent, RoomMember, RoomMemberInput } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { cleanPreview, type Bot } from '../bots/roster.ts';

/** `validate_roster`: a frozen roster of two to six profiles */
export const MIN_GROUP_MEMBERS = 2;
export const MAX_GROUP_MEMBERS = 6;
/** the desktop's name field limit */
export const MAX_GROUP_NAME = 64;
/** the mentions that address the whole room, so no member may hold them as a handle */
export const EVERYONE_HANDLES: readonly string[] = ['all', 'everyone'];
/** `hosted_room_discussion._MENTION_RE`, shared by the gateway's own parsing */
const MENTION_RE = /@([A-Za-z0-9][A-Za-z0-9._:-]*)/g;
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type GroupMember = {
  memberId: string;
  profile: string;
  /** what `@` addresses */
  handle: string;
  label: string;
};

export type GroupRoom = {
  id: string;
  name: string;
  members: GroupMember[];
  /** epoch seconds */
  createdAt: number;
  /** epoch seconds of the room's newest change; the gateway lists rooms by it */
  updatedAt: number;
  /** the newest event's seq, when the gateway reported it */
  latestSeq: number | null;
  disbanded: boolean;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** the label a member shows: the roster's current name for the profile, else the one the room stored */
export type LabelOf = (profile: string) => string | undefined;

export function toGroupMember(raw: RoomMember, labelOf?: LabelOf): GroupMember | null {
  const memberId = text(raw.member_id);
  const profile = text(raw.profile);
  const handle = text(raw.handle);
  if (!memberId || !profile || !handle) return null;
  const fallback = profile.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { memberId, profile, handle, label: labelOf?.(profile) || text(raw.display_name) || fallback };
}

export function toGroupRoom(room: Room, labelOf?: LabelOf): GroupRoom {
  const members: GroupMember[] = [];
  for (const raw of room.members ?? []) {
    const member = toGroupMember(raw, labelOf);
    if (member) members.push(member);
  }
  return {
    id: room.room_id,
    name: text(room.name) || 'Group chat',
    members,
    createdAt: room.created_at ?? 0,
    updatedAt: room.updated_at ?? 0,
    latestSeq: room.latest_seq ?? null,
    disbanded: room.disbanded_at != null,
  };
}

// ─── creation ───────────────────────────────────────────────────────────────

/** `botHandle`: the default profile answers to `@hermes`, every other profile to its own name */
export const botMentionHandle = (bot: Pick<Bot, 'name'>): string => (bot.name.trim().toLowerCase() === 'default' ? 'hermes' : bot.name);

/** the roster row `groups.create` takes: a local member, identified by its profile */
export function memberInput(bot: Pick<Bot, 'name' | 'label'>): RoomMemberInput {
  return {
    member_id: bot.name,
    profile: bot.name,
    handle: botMentionHandle(bot),
    target: { kind: 'local', profile: bot.name },
    ...(bot.label.trim() ? { display_name: bot.label.trim() } : {}),
  };
}

/** the name a group gets when none is typed: its members' names, as the desktop's placeholder reads */
export const defaultGroupName = (bots: ReadonlyArray<Pick<Bot, 'label'>>): string => bots.map((bot) => bot.label).join(', ').slice(0, MAX_GROUP_NAME);

/** why a draft cannot be created yet, or null; `groups.create` enforces the same rules and owns the exact ones */
export function newGroupProblem(bots: ReadonlyArray<Pick<Bot, 'name' | 'label'>>): string | null {
  if (bots.length < MIN_GROUP_MEMBERS) return `Pick at least ${MIN_GROUP_MEMBERS} bots.`;
  if (bots.length > MAX_GROUP_MEMBERS) return `A group holds at most ${MAX_GROUP_MEMBERS} bots.`;
  const seen = new Set<string>(EVERYONE_HANDLES);
  for (const bot of bots) {
    const handle = botMentionHandle(bot);
    if (!HANDLE_RE.test(handle)) return `${bot.label} cannot be mentioned by name (@${handle}).`;
    if (seen.has(handle.toLowerCase())) return `Two bots would share the mention @${handle}.`;
    seen.add(handle.toLowerCase());
  }
  return null;
}

// ─── the log as a transcript ────────────────────────────────────────────────

export type TimelineRow =
  | { kind: 'user'; key: string; at: number; text: string; files: string[] }
  | { kind: 'member'; key: string; at: number; member: GroupMember | null; speaker: string; text: string; files: string[] }
  | { kind: 'note'; key: string; at: number; tone: 'info' | 'error'; text: string };

const NOTE_CLIP = 240;
const clip = (value: string, max = NOTE_CLIP) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

const payloadText = (event: RoomEvent, key: string) => text(event.payload?.[key]);

function fileNames(event: RoomEvent): string[] {
  const list = event.payload?.attachments;
  if (!Array.isArray(list)) return [];
  const names: string[] = [];
  for (const item of list) {
    const name = text((item as { name?: unknown } | null)?.name);
    if (name) names.push(name);
  }
  return names;
}

/** how a member is named for an event: the roster row, else what the event itself carries */
function speakerOf(event: RoomEvent, members: readonly GroupMember[]): { member: GroupMember | null; speaker: string } {
  const id = payloadText(event, 'member_id') || text(event.actor?.id);
  const member = members.find((m) => m.memberId === id) ?? null;
  if (member) return { member, speaker: member.label };
  const named = text((event.actor as { display_name?: unknown } | undefined)?.display_name);
  return { member: null, speaker: named || id || 'A bot' };
}

/**
 * The events a reader sees, in order: user and member messages, and the few control events that explain
 * why a bot said nothing - a failed turn, a stop, a rename. Turn bookkeeping (settled, passed, the
 * authority claims) stays out; a bot that passes leaves no row. `events` is ascending by seq.
 */
export function buildTimeline(events: readonly RoomEvent[], members: readonly GroupMember[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const event of events) {
    const key = `${event.seq}`;
    const at = event.created_at ?? 0;
    switch (event.kind) {
      case 'message.user': {
        const body = payloadText(event, 'text');
        const files = fileNames(event);
        if (body || files.length) rows.push({ kind: 'user', key, at, text: body, files });
        break;
      }
      case 'message.member': {
        const body = payloadText(event, 'text');
        const files = fileNames(event);
        if (body || files.length) rows.push({ kind: 'member', key, at, ...speakerOf(event, members), text: body, files });
        break;
      }
      case 'turn.failed': {
        const { speaker } = speakerOf(event, members);
        const why = payloadText(event, 'error');
        rows.push({ kind: 'note', key, at, tone: 'error', text: clip(why ? `${speaker} could not reply: ${why}` : `${speaker} could not reply.`) });
        break;
      }
      case 'turn.deferred': {
        const { speaker } = speakerOf(event, members);
        const why = payloadText(event, 'reason');
        rows.push({ kind: 'note', key, at, tone: 'info', text: clip(why ? `${speaker} is waiting: ${why}` : `${speaker} is waiting.`) });
        break;
      }
      case 'room.stop_requested':
        rows.push({ kind: 'note', key, at, tone: 'info', text: 'Stopped. The bots on turn were interrupted.' });
        break;
      case 'room.renamed': {
        const name = payloadText(event, 'name');
        if (name) rows.push({ kind: 'note', key, at, tone: 'info', text: `Renamed to “${clip(name, 80)}”.` });
        break;
      }
      case 'room.created':
        rows.push({ kind: 'note', key, at, tone: 'info', text: 'Group created.' });
        break;
      default:
        break;
    }
  }
  return rows;
}

/** the roster's preview line: the newest message, led by who said it */
export function roomPreview(events: readonly RoomEvent[], members: readonly GroupMember[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.kind !== 'message.user' && event.kind !== 'message.member') continue;
    const body = cleanPreview(payloadText(event, 'text')) || (fileNames(event).length ? 'Attachment' : '');
    if (!body) continue;
    return `${event.kind === 'message.user' ? 'You' : speakerOf(event, members).speaker}: ${body}`;
  }
  return '';
}

/** newest-last merge of a page into a log, by seq; the same array comes back when nothing is new */
export function mergeEvents(existing: readonly RoomEvent[], incoming: readonly RoomEvent[]): readonly RoomEvent[] {
  if (incoming.length === 0) return existing;
  const bySeq = new Map<number, RoomEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  let added = false;
  for (const event of incoming) {
    if (!bySeq.has(event.seq)) added = true;
    bySeq.set(event.seq, event);
  }
  if (!added) return existing;
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

// ─── mentions ───────────────────────────────────────────────────────────────

export type MentionOption = { handle: string; label: string; everyone: boolean };

/** the `@token` being typed at the end of `value`, or null */
export function mentionAtEnd(value: string): { query: string; start: number } | null {
  const match = /(^|\s)@([A-Za-z0-9._:-]*)$/.exec(value);
  if (!match) return null;
  return { query: match[2], start: match.index + match[1].length };
}

/** `@everyone` and the members whose handle or name starts with what was typed */
export function mentionOptions(members: readonly GroupMember[], query: string): MentionOption[] {
  const needle = query.toLowerCase();
  const options: MentionOption[] = [{ handle: 'everyone', label: 'Every bot in the room', everyone: true }];
  for (const member of members) options.push({ handle: member.handle, label: member.label, everyone: false });
  if (!needle) return options;
  return options.filter((option) => option.handle.toLowerCase().startsWith(needle) || option.label.toLowerCase().startsWith(needle));
}

/** completes the token at the end of `value` to `@handle `, leaving the rest as typed */
export function completeMention(value: string, handle: string): string {
  const token = mentionAtEnd(value);
  return `${token ? value.slice(0, token.start) : value}@${handle} `;
}

export type MentionSegment = { text: string; mention: boolean };

/** `value` cut into plain runs and the `@handle`s that address a member or the room */
export function splitMentions(value: string, members: readonly GroupMember[]): MentionSegment[] {
  const addressed = new Set<string>([...EVERYONE_HANDLES, ...members.map((m) => m.handle.toLowerCase())]);
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const match of value.matchAll(MENTION_RE)) {
    if (!addressed.has(match[1].toLowerCase())) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: value.slice(last, start), mention: false });
    segments.push({ text: match[0], mention: true });
    last = start + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last), mention: false });
  return segments;
}

// ─── what the driver waits on ───────────────────────────────────────────────

export type PendingAction =
  | { kind: 'approval'; key: string; memberId: string; taskId: string; generation: number; requestId: string; command: string; description: string }
  | { kind: 'retry'; key: string; taskId: string };

/**
 * `HostedRoomService.status().pending_actions`: a command awaiting approval (`kind: approval`, answered by
 * its exact request id and execution generation) or a turn left indeterminate (`kind: retry`). A row that
 * lacks the identity its answer needs is dropped rather than guessed at.
 */
export function pendingActions(status: RoomDriverStatus | null | undefined): PendingAction[] {
  const actions: PendingAction[] = [];
  for (const raw of status?.pending_actions ?? []) {
    const taskId = text(raw.task_id);
    if (!taskId) continue;
    if (raw.kind === 'retry') {
      actions.push({ kind: 'retry', key: `retry:${taskId}`, taskId });
    } else if (raw.kind === 'approval') {
      const generation = raw.execution_generation;
      const requestId = text(raw.request_id);
      const memberId = text(raw.member_id);
      if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1 || !requestId || !memberId) continue;
      const approval = (raw.approval ?? {}) as { command?: unknown; description?: unknown };
      actions.push({
        kind: 'approval',
        key: `approval:${taskId}:${generation}:${requestId}`,
        memberId,
        taskId,
        generation,
        requestId,
        command: text(approval.command),
        description: text(approval.description),
      });
    }
  }
  return actions;
}
