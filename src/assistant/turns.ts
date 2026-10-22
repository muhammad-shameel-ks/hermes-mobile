/**
 * What the assistant card shows of its chat: each prompt with the reply text it got, and what the
 * live turn is doing before its text arrives. The card's chat is a fresh one per summon, so a pass
 * over its messages stays short; each message's text is still joined once per message object.
 */

import type { Message } from '../chat/transcript.ts';
import { toolPresentVerb } from '../chat/toolView.ts';
import type { GlowPhase } from '../../modules/hermes-assistant/index.ts';

/** `waiting`: sent, nothing back yet; `thinking`/`working`: reasoning or a tool before the reply's text */
export type TurnState = 'waiting' | 'thinking' | 'working' | 'streaming' | 'done' | 'failed';

export type AssistantTurn = {
  id: string;
  prompt: string;
  reply: string;
  state: TurnState;
  /** the live turn's activity line ("Thinking", "Running"); empty once text is arriving */
  activity: string;
  error: string | null;
};

const joined = new WeakMap<Message, string>();

/** a message's text parts; tools between them break the text into separate paragraphs */
function textOf(message: Message): string {
  let text = joined.get(message);
  if (text === undefined) {
    text = '';
    for (const part of message.parts) {
      if (part.kind !== 'text' || !part.text.trim()) continue;
      text = text ? `${text}\n\n${part.text}` : part.text;
    }
    joined.set(message, text);
  }
  return text;
}

/** the live turn's state from its newest reply message, if it has one */
function liveState(reply: Message | null, text: string): Pick<AssistantTurn, 'state' | 'activity'> {
  const last = reply?.parts.at(-1);
  if (!last) return { state: 'waiting', activity: 'Thinking' };
  if (last.kind === 'tool' && last.status === 'running') return { state: 'working', activity: toolPresentVerb(last.name) };
  if (last.kind === 'text' && text) return { state: 'streaming', activity: '' };
  return { state: 'thinking', activity: 'Thinking' };
}

export function assistantTurns(messages: readonly Message[], running: boolean): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  let index = 0;
  while (index < messages.length) {
    const prompt = messages[index];
    index += 1;
    if (prompt.role !== 'user') continue;
    let reply = '';
    let error: string | null = null;
    while (index < messages.length && messages[index].role !== 'user') {
      const message = messages[index];
      index += 1;
      if (message.role !== 'assistant') continue;
      const text = textOf(message);
      if (text) reply = reply ? `${reply}\n\n${text}` : text;
      if (message.status === 'error') error = message.error ?? 'Hermes could not answer.';
    }
    turns.push({ id: prompt.id, prompt: textOf(prompt), reply, error, state: error ? 'failed' : 'done', activity: '' });
  }
  const live = turns.at(-1);
  const newest = messages.at(-1);
  // the newest turn is live while the chat runs, and between its send and the turn starting
  if (live && !live.error && newest && (running || newest.role === 'user')) {
    Object.assign(live, liveState(newest.role === 'assistant' ? newest : null, live.reply));
  }
  return turns;
}

/** the edge light for the chat alone (the voice outranks it); O(1): only the newest message is read */
export function replyPhase(messages: readonly Message[], running: boolean): GlowPhase {
  const newest = messages.at(-1);
  if (!newest) return 'idle';
  if (newest.role === 'user') return 'thinking';
  if (!running) return 'idle';
  const last = newest.parts.at(-1);
  return last?.kind === 'text' && last.text.trim() ? 'responding' : 'thinking';
}
