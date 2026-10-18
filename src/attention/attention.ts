/**
 * Attention: a chat's open request the reader has to answer (an approval, a
 * clarify, a sudo, secret or vault prompt), lifted out of that chat so it can
 * be seen from anywhere - the attention banner over another chat, or an
 * attention notification from the system while the app is away.
 *
 * Pure: everything here reads the controller's snapshot and nothing else, so
 * the lifecycle replays in tests the way the socket delivers it.
 */

import type { ChatEntry, ChatSnapshot } from '../chat/controller.ts';
import { PROMPT_COPY, activePrompt, approvalDetails, awaitingInput, type ApprovalRequest, type PromptKind, type Requests } from '../chat/requests.ts';
import { UNTITLED_SESSION } from '../drawer/sessionIndex.ts';

export type AttentionKind = 'approval' | 'clarify' | PromptKind;

/** what reopens the chat an attention belongs to, even after the app was killed and the chat is no longer held */
export type AttentionTarget = { key: string; profile: string; title: string | null; bot: string | null };

export type Attention = {
  /** one per open request: a second approval after the first is answered is a new attention */
  id: string;
  key: string;
  kind: AttentionKind;
  /** the chat's name, as its app bar shows it */
  chat: string;
  headline: string;
  detail: string;
  /** the approval Run and Reject answer; every other kind needs its chat to be answered */
  approval: ApprovalRequest | null;
  target: AttentionTarget;
};

export const ATTENTION_COPY = {
  headline: {
    approval: 'Approval needed',
    clarify: 'Question for you',
    sudo: 'Password needed',
    secret: 'Secret needed',
    'vault-unlock': 'Unlock needed',
    'vault-save': 'Login needed',
    'vault-code': 'Code needed',
  } satisfies Record<AttentionKind, string>,
  open: 'Open',
  dismiss: 'Dismiss',
  more: (count: number) => `+${count} more`,
  holdTitle: 'Hermes is still working',
  holdWaiting: (chats: number) => (chats === 1 ? 'Waiting for your answer in 1 chat' : `Waiting for your answer in ${chats} chats`),
  holdRunning: (chats: number) => (chats === 1 ? 'Working in 1 chat' : `Working in ${chats} chats`),
} as const;

/** the chat's name as ChatScreen titles it: a Bot Chat goes by its bot */
export function chatLabel(entry: Pick<ChatEntry, 'isBotChat' | 'bot' | 'title'>, botLabel: (name: string) => string | undefined): string {
  if (entry.isBotChat && entry.bot) return botLabel(entry.bot) ?? entry.bot;
  return entry.title?.trim() || UNTITLED_SESSION;
}

function describe(requests: Requests): Pick<Attention, 'id' | 'kind' | 'headline' | 'detail' | 'approval'> | null {
  const { approvals, clarify } = requests;
  const { headline } = ATTENTION_COPY;
  const approval = approvals[0];
  if (approval) {
    const handle = approval.requestId ?? approval.serverRequestId ?? approval.command;
    return { id: `approval:${handle}`, kind: 'approval', headline: headline.approval, detail: approvalDetails(approval).text, approval };
  }
  if (clarify) {
    const open = clarify.questions.find((question) => clarify.lockedAnswers?.[question.qid] === undefined) ?? clarify.questions[0];
    return { id: `clarify:${clarify.requestId}`, kind: 'clarify', headline: headline.clarify, detail: open?.question ?? '', approval: null };
  }
  const prompt = activePrompt(requests);
  if (!prompt) return null;
  const base = { id: `prompt:${prompt.requestId}`, kind: prompt.kind, headline: headline[prompt.kind], approval: null };
  switch (prompt.kind) {
    case 'sudo':
      return { ...base, detail: prompt.command.trim() || PROMPT_COPY.sudoTitle };
    case 'secret':
      return { ...base, detail: prompt.prompt.trim() || prompt.envVar || PROMPT_COPY.secretDesc };
    case 'vault-unlock':
      return { ...base, detail: PROMPT_COPY.vaultUnlockTitle(prompt.displayName) };
    case 'vault-save':
      return { ...base, detail: PROMPT_COPY.vaultSaveTitle(prompt.site) };
    case 'vault-code':
      return { ...base, detail: PROMPT_COPY.vaultCodeTitle(prompt.site) };
  }
}

/** a chat's requests move rarely while its transcript streams; its item is rebuilt only when they or its name change */
const memo = new WeakMap<Requests, { chat: string; key: string; item: Attention | null }>();

/** the request a chat blocks on first: its front approval, else its clarify, else its prompts in sheet order */
export function attentionOf(entry: ChatEntry, chat: string): Attention | null {
  const cached = memo.get(entry.requests);
  if (cached && cached.chat === chat && cached.key === entry.key) return cached.item;
  const described = describe(entry.requests);
  const item = described && {
    ...described,
    id: `${entry.key}:${described.id}`,
    key: entry.key,
    chat,
    target: { key: entry.key, profile: entry.profile, title: entry.title, bot: entry.isBotChat ? entry.bot : null },
  };
  memo.set(entry.requests, { chat, key: entry.key, item });
  return item;
}

/** every chat's front request, O(chats) */
export function collectAttention(snapshot: Pick<ChatSnapshot, 'entries' | 'roster'>): Attention[] {
  const bots = [...snapshot.roster.visible, ...snapshot.roster.hidden];
  const items: Attention[] = [];
  for (const entry of Object.values(snapshot.entries)) {
    const item = attentionOf(entry, chatLabel(entry, (name) => bots.find((bot) => bot.name === name)?.label));
    if (item) items.push(item);
  }
  return items;
}

/** what keeps the socket worth holding while the app is away: turns streaming, and turns blocked on the reader */
export function liveWork(snapshot: Pick<ChatSnapshot, 'entries'>): { running: number; waiting: number } {
  let running = 0;
  let waiting = 0;
  for (const entry of Object.values(snapshot.entries)) {
    if (awaitingInput(entry.requests)) waiting += 1;
    else if (entry.transcript.running) running += 1;
  }
  return { running, waiting };
}

/** the held connection's ongoing notification line; null once nothing is left to wait for */
export function holdText({ running, waiting }: { running: number; waiting: number }): string | null {
  if (waiting > 0) return ATTENTION_COPY.holdWaiting(waiting);
  if (running > 0) return ATTENTION_COPY.holdRunning(running);
  return null;
}

/**
 * The open attentions in the order they arrived. Each look reports what is new
 * and what went away (answered here or elsewhere, withdrawn, timed out): what
 * the banner queues and the system notifications post and take down.
 */
export class AttentionBoard {
  private readonly items = new Map<string, Attention>();

  get list(): Attention[] {
    return [...this.items.values()];
  }

  update(next: readonly Attention[]): { arrived: Attention[]; left: Attention[] } {
    const arrived: Attention[] = [];
    const seen = new Set<string>();
    for (const item of next) {
      seen.add(item.id);
      if (!this.items.has(item.id)) arrived.push(item);
      // a renamed chat keeps its place in the queue
      this.items.set(item.id, item);
    }
    const left: Attention[] = [];
    for (const [id, item] of this.items) {
      if (seen.has(id)) continue;
      left.push(item);
      this.items.delete(id);
    }
    return { arrived, left };
  }
}
