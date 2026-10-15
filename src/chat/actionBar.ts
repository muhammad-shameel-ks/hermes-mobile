/**
 * The pure half of the message action bar: which messages carry one, the copy
 * scopes, the stamp format and the Tapback reaction rules, all ported from the
 * desktop's assistant-ui thread (assistant-message.tsx, user-message.tsx,
 * message-hover-time.tsx, store/reactions.ts).
 */

import type { Message } from './transcript.ts';

/** one emoji reaction; the gateway keeps one per author */
export type Reaction = { emoji: string; author: string; at?: number | null };

/** desktop `QUICK_REACTIONS`: the six iOS Tapback defaults, in Apple's order */
export const QUICK_REACTIONS = ['❤️', '👍', '👎', '😂', '‼️', '❓'] as const;

/** desktop copy-button: how long the check mark stays after a copy */
export const COPIED_RESET_MS = 1_500;

export const messageText = (message: Message) =>
  message.parts
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('\n\n')
    .trim();

// ─── which messages carry a bar ──────────────────────────────────────────────

const hasText = (message: Message) => message.parts.some((part) => part.kind === 'text' && /\S/.test(part.text));

export type BarPlan =
  | {
      kind: 'user';
      /** the newest user turn */
      latest: boolean;
      /** the newest user turn of a running thread: Stop stands where Restore would */
      stop: boolean;
    }
  | {
      kind: 'assistant';
      /** the reply is still streaming: the bar holds its height but paints nothing, as the desktop's hidden bar does */
      live: boolean;
      /** the turn has more than one reply, so "copy full response" differs from "copy" */
      fullAvailable: boolean;
    };

/**
 * One pass over the transcript: the bar each message carries, keyed by message id. Interim
 * replies carry none (desktop `assistant-message.tsx` footer gate) unless one is the last
 * reply of its turn and the turn is over - a turn cut off after sealing a segment.
 */
export function planBars(messages: readonly Message[], running: boolean): Map<string, BarPlan> {
  const plans = new Map<string, BarPlan>();
  let latestUser = -1;
  for (let i = messages.length - 1; i >= 0 && latestUser < 0; i -= 1) if (messages[i].role === 'user') latestUser = i;

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (message.role === 'user') {
      if (hasText(message)) plans.set(message.id, { kind: 'user', latest: i === latestUser, stop: running && i === latestUser });
      continue;
    }
    if (message.role !== 'assistant') continue;
    let end = i;
    while (end + 1 < messages.length && messages[end + 1].role === 'assistant') end += 1;
    const replies = messages.slice(i, end + 1).filter(hasText);
    const lastId = replies.length ? replies[replies.length - 1].id : null;
    for (let at = i; at <= end; at += 1) {
      const reply = messages[at];
      if (reply.interim && (running || lastId !== reply.id)) continue;
      plans.set(reply.id, { kind: 'assistant', live: reply.status === 'streaming', fullAvailable: replies.length > 1 });
    }
    i = end;
  }
  return plans;
}

/** the whole turn's replies, blank-line joined: the explicit "full response" scope of copy */
export function fullResponseText(messages: readonly Message[], messageId: string): string {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return '';
  let start = index;
  while (start > 0 && messages[start - 1].role === 'assistant') start -= 1;
  const texts: string[] = [];
  for (let i = start; i < messages.length && messages[i].role === 'assistant'; i += 1) {
    const text = messageText(messages[i]);
    if (text) texts.push(text);
  }
  return texts.join('\n\n');
}

const samePlan = (a: BarPlan, b: BarPlan) => JSON.stringify(a) === JSON.stringify(b);

/** `next` with each plan swapped for its `previous` twin when unchanged, so memoised rows see the same object */
export function stablePlans(previous: Map<string, BarPlan>, next: Map<string, BarPlan>): Map<string, BarPlan> {
  for (const [id, plan] of next) {
    const before = previous.get(id);
    if (before && samePlan(before, plan)) next.set(id, before);
  }
  return next;
}

// ─── stamps ──────────────────────────────────────────────────────────────────

export type StampFormats = { clock: Intl.DateTimeFormat; dayTime: Intl.DateTimeFormat };

let defaultFormats: StampFormats | null = null;

function formats(): StampFormats {
  defaultFormats ??= {
    clock: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
    dayTime: new Intl.DateTimeFormat(undefined, { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short' }),
  };
  return defaultFormats;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** desktop `formatMessageTimestamp`: "3:27 PM", "Yesterday, 3:27 PM", "Sep 28, 3:27 PM"; empty without a usable time */
export function formatStamp(seconds: number | undefined, now: Date = new Date(), fmt: StampFormats = formats()): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return fmt.clock.format(date);
  if (days === 1) return `Yesterday, ${fmt.clock.format(date)}`;
  return fmt.dayTime.format(date);
}

/** desktop `formatElapsed` (components/chat/activity-timer) */
export function formatElapsed(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ─── reactions ───────────────────────────────────────────────────────────────

/** desktop `applyReaction`: one per author, the same emoji again retracts, null clears */
export function applyReaction(reactions: readonly Reaction[] | undefined, emoji: string | null, author: string, now = Date.now() / 1000): Reaction[] {
  const current = reactions ?? [];
  const previous = current.find((reaction) => reaction.author === author);
  const without = current.filter((reaction) => reaction.author !== author);
  if (!emoji || previous?.emoji === emoji) return without;
  return [...without, { emoji, author, at: now }];
}

export const userReaction = (reactions: readonly Reaction[] | undefined) => reactions?.find((reaction) => reaction.author === 'user')?.emoji;

/** an announced list from the gateway: the agent's reactions win, the reader's own click stays as painted */
export function withAgentReactions(existing: readonly Reaction[] | undefined, announced: readonly Reaction[]): Reaction[] {
  return [...(existing ?? []).filter((reaction) => reaction.author === 'user'), ...announced.filter((reaction) => reaction.author === 'agent')];
}

/** well-formed reactions out of a stored row's `display_metadata` (an object, or its JSON) */
export function reactionsFromMetadata(metadata: unknown): Reaction[] {
  let record: unknown = metadata;
  if (typeof record === 'string') {
    try {
      record = JSON.parse(record);
    } catch {
      return [];
    }
  }
  const list = typeof record === 'object' && record !== null ? (record as { reactions?: unknown }).reactions : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Reaction => typeof item === 'object' && item !== null && typeof (item as Reaction).emoji === 'string');
}

const EMOJI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0xa9, 0xa9],
  [0xae, 0xae],
  [0x203c, 0x203c],
  [0x2049, 0x2049],
  [0x2122, 0x2122],
  [0x2139, 0x2139],
  [0x2194, 0x21aa],
  [0x231a, 0x23ff],
  [0x24c2, 0x24c2],
  [0x25aa, 0x25fe],
  [0x2600, 0x27bf],
  [0x2934, 0x2935],
  [0x2b05, 0x2b55],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3299],
  [0x1f000, 0x1faff],
];

const isEmojiBase = (cp: number) => EMOJI_RANGES.some(([from, to]) => cp >= from && cp <= to);
const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isModifier = (cp: number) => cp === 0xfe0f || cp === 0xfe0e || cp === 0x20e3 || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f);

/**
 * The first emoji in what the reader typed or pasted into the picker's field: one
 * grapheme (flags, skin tones, keycaps and ZWJ sequences stay whole), or null when
 * the text holds none. The system emoji keyboard is the phone's full picker.
 */
export function firstEmoji(input: string): string | null {
  const points = Array.from(input.trim(), (char) => char.codePointAt(0) as number);
  let at = 0;
  while (at < points.length) {
    const cp = points[at];
    const keycap = (cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39)) && (points[at + 1] === 0x20e3 || (points[at + 1] === 0xfe0f && points[at + 2] === 0x20e3));
    if (!keycap && !isEmojiBase(cp)) {
      at += 1;
      continue;
    }
    let end = at + 1;
    if (isRegionalIndicator(cp) && points[end] !== undefined && isRegionalIndicator(points[end])) end += 1;
    for (;;) {
      while (end < points.length && isModifier(points[end])) end += 1;
      if (points[end] === 0x200d && end + 1 < points.length && (isEmojiBase(points[end + 1]) || isRegionalIndicator(points[end + 1]))) end += 2;
      else break;
    }
    return String.fromCodePoint(...points.slice(at, end));
  }
  return null;
}
