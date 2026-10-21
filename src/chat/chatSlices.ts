/**
 * The slices of the chat snapshot each screen region subscribes to (see `useChatSelector`). A slice is
 * a flat object of references that streaming does not replace, so a region re-renders when its own
 * state moves and never because a token landed in the open transcript.
 */

import type { Bot } from '../bots/roster.ts';
import type { ModelSelection } from './models.ts';
import { shallowEqual } from './selector.ts';
import type { Transcript } from './transcript.ts';
import type { ChatEntry, ChatSnapshot } from './controller.ts';

/** the open chat: the entry the app is showing, or the draft before one exists */
export const openEntry = (snapshot: ChatSnapshot): ChatEntry => snapshot.entries[snapshot.openKey] ?? snapshot.entries.draft;

/**
 * What the app shell reads: the bots and profile for labels, the banner and the cold-boot overlay. The
 * roster's two lists, not the roster, so its `loading` flag flipping on each drawer open is not a shell render.
 */
export type ShellSlice = Pick<ChatSnapshot, 'profile' | 'link' | 'notice'> & { visibleBots: Bot[]; hiddenBots: Bot[]; openBot: string | null };

export const shellSlice = (snapshot: ChatSnapshot): ShellSlice => ({
  visibleBots: snapshot.roster.visible,
  hiddenBots: snapshot.roster.hidden,
  profile: snapshot.profile,
  link: snapshot.link,
  notice: snapshot.notice,
  openBot: openEntry(snapshot).bot,
});

/** the open chat's identity and coarse state; its message list is a separate subscription */
export type ChatMeta = {
  key: string;
  runtimeId: string | null;
  profile: string;
  title: string | null;
  isBotChat: boolean;
  loading: boolean;
  error: string | null;
  hasMessages: boolean;
  running: boolean;
  historyMore: boolean;
  loadingEarlier: boolean;
};

export function chatMeta(snapshot: ChatSnapshot): ChatMeta {
  const entry = openEntry(snapshot);
  return {
    key: entry.key,
    runtimeId: entry.runtimeId,
    profile: entry.profile,
    title: entry.title,
    isBotChat: entry.isBotChat,
    loading: entry.loading,
    error: entry.error,
    hasMessages: entry.transcript.messages.length > 0,
    running: entry.transcript.running,
    historyMore: entry.history.more,
    loadingEarlier: entry.history.loadingEarlier,
  };
}

export const openTranscript = (snapshot: ChatSnapshot): Transcript => openEntry(snapshot).transcript;

/** what the chat screen's chrome reads that is not about the open chat: the link, the model catalogue and settings */
export type ChatEnv = Pick<ChatSnapshot, 'link' | 'models' | 'personality' | 'defaultEffort' | 'reactionsEnabled' | 'openingBot'>;

export const chatEnv = (snapshot: ChatSnapshot): ChatEnv => ({
  link: snapshot.link,
  models: snapshot.models,
  personality: snapshot.personality,
  defaultEffort: snapshot.defaultEffort,
  reactionsEnabled: snapshot.reactionsEnabled,
  openingBot: snapshot.openingBot,
});

export const sameModel = (a: ModelSelection | null, b: ModelSelection | null): boolean => a === b || (a !== null && b !== null && shallowEqual(a, b));

/** what the settings sections read; they live in pushed overlays, so this subscribes only while one is open */
export type SettingsSlice = Pick<ChatSnapshot, 'link' | 'profile' | 'roster' | 'models' | 'reactionsEnabled'>;

export const settingsSlice = (snapshot: ChatSnapshot): SettingsSlice => ({
  link: snapshot.link,
  profile: snapshot.profile,
  roster: snapshot.roster,
  models: snapshot.models,
  reactionsEnabled: snapshot.reactionsEnabled,
});
