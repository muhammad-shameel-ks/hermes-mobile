/**
 * The signed-in app's chat state, shared by the drawer and the transcript.
 *
 * Owns the socket link, one transcript per session the phone has opened (keyed by
 * stored id), and the routing of live events to them by runtime id - so a run in
 * a session the reader has left keeps streaming into its own transcript and the
 * drawer can show it as active. A fresh chat is a draft until the first send
 * creates its session lazily, as the desktop does.
 *
 * The active profile scopes the sessions list and new sessions, and follows the
 * bot whose chat is open (issue "Bot Mode surface design on a phone"). The legacy
 * gateway reads `profile` per call, so one socket serves every profile; every RPC
 * and REST call names its profile explicitly.
 */

import type {
  ModelOptionProvider,
  ProfileRow,
  RpcMethods,
  SessionListRow,
  SessionLiveInfo,
  SessionResumeResult,
} from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import type { GatewayEvent } from '../../vendor/hermes-shared/src/json-rpc-gateway.ts';
import type { ServerRequest } from '../../vendor/hermes-shared/src/json-rpc-channel.ts';
import {
  BOT_CHAT_TITLE,
  BOT_KICKOFF,
  BOT_META_NAMESPACE,
  buildRoster,
  isBotChatRow,
  readBotMeta,
  slugifyProfileName,
  type Bot,
  type BotMeta,
  type Roster,
} from '../bots/roster.ts';
import { ApiError, type GatewayApi } from '../gateway/api.ts';
import { errorText } from '../gateway/http.ts';
import type { GatewayLink, LinkState } from '../gateway/link.ts';
import { DraftStore, FRESH_DRAFT_KEY } from '../store/drafts.ts';
import type { Persistence } from '../store/index.ts';
import { evictions, Recency, SESSION_STATE_LRU } from '../store/lru.ts';
import {
  graftTail,
  HISTORY_LIMIT,
  historyFromPage,
  NO_HISTORY,
  prependOlder,
  unhideOpeningUserRows,
  type HistoryState,
  type MessagesPage,
} from './history.ts';
import { normalizePersonality } from './intro.ts';
import type { ModelSelection } from './models.ts';
import {
  addSystemNotice,
  addUserMessage,
  applyEvent,
  emptyTranscript,
  fromHistory,
  type SessionMessage,
  type Transcript,
} from './transcript.ts';

export const DRAFT_KEY = FRESH_DRAFT_KEY;
const SESSION_LIST_LIMIT = 60;
/** the notice a replay gap leaves where the transcript was reloaded from saved history */
export const REPLAY_GAP_NOTICE = 'Some updates were missed while the connection was down. The conversation was reloaded from its saved history.';
const PROMPT_TIMEOUT_MS = 1_800_000;
/** desktop `use-session-list-actions.ts`: sources that never list as conversations */
const UNLISTED_SOURCES = new Set(['acp', 'cron', 'kanban', 'oneshot', 'subagent', 'tool']);

export type SessionInfo = {
  id: string;
  title: string | null;
  preview: string | null;
  started_at: number;
  last_active?: number | null;
  message_count?: number;
  pinned?: boolean;
  source?: string | null;
  profile?: string | null;
};

export type ChatEntry = {
  key: string;
  runtimeId: string | null;
  profile: string;
  title: string | null;
  isBotChat: boolean;
  /** the bot this chat belongs to, when opened from the roster */
  bot: string | null;
  transcript: Transcript;
  loading: boolean;
  error: string | null;
  /** the session's live model, or the draft's pick before its session exists */
  model: ModelSelection | null;
  /** how far back the history has been paged */
  history: HistoryState;
};

export type ModelCatalog = {
  profile: string;
  providers: ModelOptionProvider[];
  /** the profile's configured model, from `model.options` */
  current: ModelSelection | null;
  loading: boolean;
  error: string | null;
};

/** what a model switch came back with; `confirm` carries the gateway's expensive-model question */
export type ModelSwitchOutcome = { kind: 'ok'; deferred: boolean } | { kind: 'confirm'; message: string } | { kind: 'failed' };

export type ChatSnapshot = {
  link: LinkState;
  profile: string;
  openKey: string;
  entries: Record<string, ChatEntry>;
  sessions: { items: SessionInfo[]; loading: boolean; error: string | null };
  roster: Roster & { loaded: boolean; loading: boolean; error: string | null };
  /** a bot whose chat is being looked up or created */
  openingBot: string | null;
  notice: { text: string; at: number } | null;
  models: ModelCatalog;
  /** the active profile's `display.personality`, which picks the intro copy */
  personality: string;
  /** the profile's `agent.reasoning_effort`, the effort a session starts with unless picked */
  defaultEffort: string | null;
};

export type BotDraft = { label: string; description: string };

type Rpc = <M extends keyof RpcMethods>(method: M, params: RpcMethods[M]['params'], timeoutMs?: number) => Promise<RpcMethods[M]['result']>;

const listable = (session: SessionInfo) => !UNLISTED_SOURCES.has((session.source ?? '').toLowerCase());

const newEntry = (key: string, profile: string, extra: Partial<ChatEntry> = {}): ChatEntry => ({
  key,
  runtimeId: null,
  profile,
  title: null,
  isBotChat: false,
  bot: null,
  transcript: emptyTranscript(),
  loading: false,
  error: null,
  model: null,
  history: NO_HISTORY,
  ...extra,
});

function selectionFromInfo(info: SessionLiveInfo | null | undefined, previous: ModelSelection | null): ModelSelection | null {
  if (!info?.model) return previous;
  return {
    model: info.model,
    provider: info.provider || previous?.provider || '',
    effort: info.reasoning_effort ?? previous?.effort ?? null,
  };
}

export class ChatController {
  private snapshot: ChatSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly runtimeToKey = new Map<string, string>();
  /** events for a session whose history is still loading, applied once it lands */
  private readonly buffered = new Map<string, GatewayEvent[]>();
  private readonly unsubscribe: Array<() => void> = [];
  private readonly rpc: Rpc;
  private listTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly link: GatewayLink;
  private readonly api: GatewayApi;
  private readonly persistence: Persistence | null;
  private readonly recency = new Recency();
  /** the transcript last handed to the tail writer, so unrelated entry updates do not rewrite it */
  private readonly saved = new Map<string, unknown>();
  readonly drafts: DraftStore;

  constructor(link: GatewayLink, api: GatewayApi, initialProfile = 'default', persistence: Persistence | null = null) {
    this.link = link;
    this.api = api;
    this.persistence = persistence;
    this.drafts = persistence?.drafts ?? new DraftStore(null, '');
    this.rpc = (method, params, timeoutMs) =>
      this.link.client.request(method, params as unknown as Record<string, unknown>, timeoutMs);
    this.snapshot = {
      link: link.current,
      profile: initialProfile,
      openKey: DRAFT_KEY,
      entries: { [DRAFT_KEY]: newEntry(DRAFT_KEY, initialProfile) },
      sessions: { items: [], loading: false, error: null },
      roster: { visible: [], hidden: [], loaded: false, loading: false, error: null },
      openingBot: null,
      notice: null,
      models: { profile: initialProfile, providers: [], current: null, loading: false, error: null },
      personality: '',
      defaultEffort: null,
    };
    this.unsubscribe.push(
      link.onState((state) => this.set({ link: state })),
      link.onOpen(() => this.onLinkOpen()),
      link.client.onAny((event) => this.onEvent(event)),
      link.client.onRequest((request) => this.onServerRequest(request)),
    );
  }

  // ─── store plumbing ────────────────────────────────────────────────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<ChatSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private entry(key: string): ChatEntry | undefined {
    return this.snapshot.entries[key];
  }

  private putEntry(entry: ChatEntry) {
    this.set({ entries: { ...this.snapshot.entries, [entry.key]: entry } });
    this.recency.touch(entry.key);
    this.saveTail(entry);
  }

  /** a settled transcript is written to the warm tail once it has been quiet */
  private saveTail(entry: ChatEntry) {
    const { messages, running } = entry.transcript;
    if (!this.persistence || entry.key === DRAFT_KEY || entry.loading || running || messages.length === 0) return;
    if (this.saved.get(entry.key) === messages) return;
    this.saved.set(entry.key, messages);
    this.persistence.tails.schedule(entry.profile, entry.key, messages);
  }

  /** drop the settled sessions beyond the retention cap; their warm tails stay on disk */
  private prune() {
    const entries = this.snapshot.entries;
    const keys = Object.keys(entries);
    if (keys.length <= SESSION_STATE_LRU) return;
    for (const key of keys) if (!this.recency.has(key)) this.recency.touch(key);
    const held = (key: string) => {
      const entry = entries[key];
      return (
        key === DRAFT_KEY ||
        key === this.snapshot.openKey ||
        entry.loading ||
        this.buffered.has(key) ||
        entry.transcript.running ||
        entry.transcript.messages.some((m) => m.status === 'streaming')
      );
    };
    const drop = evictions(this.recency.keys().filter((key) => key in entries), held, SESSION_STATE_LRU);
    if (drop.length === 0) return;
    const next = { ...entries };
    for (const key of drop) {
      delete next[key];
      this.recency.forget(key);
      this.saved.delete(key);
      for (const [runtime, mapped] of this.runtimeToKey) if (mapped === key) this.runtimeToKey.delete(runtime);
    }
    this.set({ entries: next });
  }

  private updateEntry(key: string, update: (entry: ChatEntry) => ChatEntry) {
    const current = this.entry(key);
    if (current) this.putEntry(update(current));
  }

  private updateTranscript(key: string, update: (t: Transcript) => Transcript) {
    this.updateEntry(key, (entry) => ({ ...entry, transcript: update(entry.transcript) }));
  }

  private bindRuntime(key: string, runtimeId: string) {
    for (const [runtime, mapped] of this.runtimeToKey) if (mapped === key && runtime !== runtimeId) this.runtimeToKey.delete(runtime);
    this.runtimeToKey.set(runtimeId, key);
    this.updateEntry(key, (entry) => ({ ...entry, runtimeId }));
  }

  notify(text: string) {
    this.set({ notice: { text, at: Date.now() } });
  }

  start() {
    this.link.resume();
  }

  /** the app left the foreground: the socket closes and redials on return */
  pause() {
    this.link.pause();
    void this.persistence?.flush();
  }

  clearNotice = () => {
    this.set({ notice: null });
  };

  dispose() {
    for (const off of this.unsubscribe) off();
    if (this.listTimer) clearTimeout(this.listTimer);
    this.link.pause();
    void this.persistence?.flush();
  }

  // ─── link + events ─────────────────────────────────────────────────────────

  private onLinkOpen() {
    void this.refreshRoster();
    void this.refreshSessions();
    void this.refreshModels();
    void this.refreshPersonality();
    // live events reach a socket only after it resumes a session; a redial rebinds every bound chat
    for (const entry of Object.values(this.snapshot.entries)) {
      if (entry.key !== DRAFT_KEY && entry.runtimeId) void this.resume(entry.key, { rebind: true });
    }
    const open = this.entry(this.snapshot.openKey);
    if (open && open.key !== DRAFT_KEY && !open.runtimeId && !open.loading) void this.load(open.key);
  }

  private onEvent(event: GatewayEvent) {
    if (event.type === 'session.title') {
      const payload = event.payload as { session_id?: string; title?: string } | undefined;
      if (payload?.session_id && typeof payload.title === 'string') this.retitle(payload.session_id, payload.title);
      return;
    }
    if (event.type === 'sessions.changed') {
      this.scheduleListRefresh();
      return;
    }
    if (event.type === 'session.replay_gap') {
      const key = event.session_id ? this.runtimeToKey.get(event.session_id) : undefined;
      if (key) void this.load(key, { gap: true });
      return;
    }
    const key = event.session_id ? this.runtimeToKey.get(event.session_id) : undefined;
    if (!key) return;
    if (this.buffered.has(key)) {
      this.buffered.get(key)!.push(event);
      return;
    }
    const wasRunning = this.entry(key)?.transcript.running;
    if (event.type === 'session.info') {
      const info = event.payload as SessionLiveInfo | undefined;
      if (info?.model) this.updateEntry(key, (e) => ({ ...e, model: selectionFromInfo(info, e.model) }));
    }
    this.updateTranscript(key, (t) => applyEvent(t, event));
    if (event.type === 'message.complete' || (wasRunning && !this.entry(key)?.transcript.running)) {
      this.scheduleListRefresh();
      this.prune();
    }
  }

  /** Approvals and other server questions are not shown on the phone yet: decline them visibly. */
  private onServerRequest(request: ServerRequest): boolean {
    const key = request.params.session_id ? this.runtimeToKey.get(request.params.session_id) : undefined;
    const what =
      request.method === 'approval'
        ? `approval to run ${typeof request.params.command === 'string' ? `\`${request.params.command}\`` : 'a tool'}`
        : request.method === 'clarify'
          ? 'a clarifying answer'
          : `a ${request.method} answer`;
    if (key) {
      this.updateTranscript(key, (t) => addSystemNotice(t, `Hermes asked for ${what}. The phone cannot answer that yet, so it was declined.`));
    }
    // `decline` lets another client answer, but only reaches a backend that counts declines;
    // elsewhere it is silent, and the run would sit blocked, so an explicit answer follows
    // (the channel drops it if the decline was already sent).
    request.decline?.('Not shown on the phone');
    if (request.method === 'approval') request.respond({ choice: 'deny' });
    else request.fail(4404, 'Not shown on the phone');
    return true;
  }

  private retitle(storedId: string, title: string) {
    const entry = this.entry(storedId);
    if (entry) this.putEntry({ ...entry, title });
    this.set({
      sessions: {
        ...this.snapshot.sessions,
        items: this.snapshot.sessions.items.map((s) => (s.id === storedId ? { ...s, title } : s)),
      },
    });
  }

  private scheduleListRefresh() {
    if (this.listTimer) clearTimeout(this.listTimer);
    this.listTimer = setTimeout(() => {
      this.listTimer = null;
      void this.refreshSessions();
      void this.refreshRoster();
    }, 600);
  }

  // ─── drawer data ───────────────────────────────────────────────────────────

  async refreshSessions() {
    const profile = this.snapshot.profile;
    this.set({ sessions: { ...this.snapshot.sessions, loading: true } });
    try {
      const result = await this.api.get<{ sessions?: SessionInfo[] }>('/api/sessions', {
        limit: SESSION_LIST_LIMIT,
        offset: 0,
        archived: 'exclude',
        order: 'recent',
        profile,
      });
      if (profile !== this.snapshot.profile) return;
      this.set({ sessions: { items: (result?.sessions ?? []).filter(listable), loading: false, error: null } });
    } catch (error) {
      this.set({ sessions: { ...this.snapshot.sessions, loading: false, error: errorText(error) } });
    }
  }

  async refreshRoster() {
    if (this.link.current.kind !== 'open') return;
    this.set({ roster: { ...this.snapshot.roster, loading: true } });
    try {
      const result = await this.rpc('profiles.list', {});
      const roster = buildRoster(result.profiles ?? [], Math.floor(Date.now() / 1000));
      this.set({ roster: { ...roster, loaded: true, loading: false, error: null } });
    } catch (error) {
      this.set({ roster: { ...this.snapshot.roster, loading: false, error: errorText(error) } });
    }
  }

  // ─── opening chats ─────────────────────────────────────────────────────────

  /** a fresh chat in the active profile; created on first send */
  newChat() {
    const profile = this.snapshot.profile;
    const draft = this.entry(DRAFT_KEY);
    const reusable = draft && draft.profile === profile && !draft.bot && draft.transcript.messages.length === 0;
    if (!reusable) this.putEntry(newEntry(DRAFT_KEY, profile));
    this.set({ openKey: DRAFT_KEY });
  }

  /** open a listed session of the active profile */
  openSession(session: Pick<SessionInfo, 'id' | 'title'>) {
    const existing = this.entry(session.id);
    if (!existing) this.putEntry(newEntry(session.id, this.snapshot.profile, { title: session.title }));
    this.set({ openKey: session.id });
    if (!existing || (!existing.runtimeId && !existing.loading)) void this.load(session.id);
  }

  private setProfile(profile: string) {
    if (profile === this.snapshot.profile) return;
    this.set({ profile, sessions: { items: [], loading: true, error: null }, personality: '', defaultEffort: null });
    void this.refreshSessions();
    void this.refreshModels();
    void this.refreshPersonality();
  }

  /** a roster tap: the active profile follows the bot, and its one Bot Chat opens (or is created) */
  async openBot(bot: Pick<Bot, 'name' | 'label'>, options: { kickoff?: boolean } = {}) {
    if (this.snapshot.openingBot) return;
    this.setProfile(bot.name);
    this.set({ openingBot: bot.name });
    try {
      const found = await this.findBotChat(bot.name);
      if (found) {
        this.openBotChat(bot.name, found);
        return;
      }
      await this.createBotChat(bot.name, options.kickoff === true);
    } catch (error) {
      this.notify(`Could not open ${bot.label}’s chat. ${errorText(error)}`);
    } finally {
      this.set({ openingBot: null });
    }
  }

  private openBotChat(botName: string, storedId: string) {
    const existing = this.entry(storedId);
    if (!existing) this.putEntry(newEntry(storedId, botName, { title: BOT_CHAT_TITLE, isBotChat: true, bot: botName }));
    this.set({ openKey: storedId });
    if (!existing || (!existing.runtimeId && !existing.loading)) void this.load(storedId);
  }

  /** exact-title lookup through the hidden registry; fails closed rather than minting a second chat */
  private async findBotChat(profile: string): Promise<string | null> {
    const result = await this.rpc('session.list', { profile, title: BOT_CHAT_TITLE, limit: 200, include_hidden: true });
    const row = (result.sessions as Array<SessionListRow & { root_title?: string | null }>).find(isBotChatRow);
    return row ? row.resolved_id || row.id : null;
  }

  private async createBotChat(profile: string, kickoff: boolean) {
    const created = await this.rpc('session.create', { profile, title: BOT_CHAT_TITLE, hidden: true, follow_profile_config: true });
    try {
      await this.rpc('session.title', { session_id: created.session_id, profile, title: BOT_CHAT_TITLE });
    } catch (error) {
      if (/already in use/i.test(errorText(error))) {
        // another client minted it first: adopt the winner instead of keeping a second chat
        void this.rpc('session.close', { session_id: created.session_id, profile }).catch(() => undefined);
        const winner = await this.findBotChat(profile);
        if (winner) {
          this.openBotChat(profile, winner);
          return;
        }
      }
      throw error;
    }
    const key = created.stored_session_id;
    this.putEntry(newEntry(key, profile, { title: BOT_CHAT_TITLE, isBotChat: true, bot: profile, model: selectionFromInfo(created.info, null) }));
    this.bindRuntime(key, created.session_id);
    this.set({ openKey: key });
    if (kickoff) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await this.submit(key, BOT_KICKOFF);
    }
  }

  /**
   * history over REST plus a resume that binds live events; events that race the history are held.
   * The warm tail paints first, and a refreshed page keeps the older pages the reader pulled in.
   * `gap` marks a reload after the replay could not cover what the socket missed.
   */
  private async load(key: string, { gap = false }: { gap?: boolean } = {}) {
    const entry = this.entry(key);
    if (!entry || key === DRAFT_KEY) return;
    this.updateEntry(key, (e) => ({ ...e, loading: true, error: null }));
    this.buffered.set(key, []);
    if (this.persistence && entry.transcript.messages.length === 0) void this.paintWarmTail(key);
    try {
      const resumed = this.link.current.kind === 'open' ? await this.resume(key, { rebind: false }) : null;
      const page = await this.api.get<MessagesPage>(`/api/sessions/${encodeURIComponent(key)}/messages`, {
        limit: HISTORY_LIMIT,
        order: 'latest',
        include_compacted: true,
        profile: entry.profile,
      });
      const held = this.entry(key) ?? entry;
      const refreshed = fromHistory(page?.messages ?? []);
      const messages = graftTail(held.transcript.messages, refreshed);
      const paged = historyFromPage(page, held.history);
      const history = messages.length > refreshed.length ? { ...paged, nextOffset: Math.max(paged.nextOffset, held.history.nextOffset) } : paged;
      let transcript: Transcript = { ...emptyTranscript(), messages };
      if (gap) transcript = addSystemNotice(transcript, REPLAY_GAP_NOTICE);
      if (resumed?.running) transcript = withInflight(transcript, resumed);
      for (const event of this.buffered.get(key) ?? []) transcript = applyEvent(transcript, event);
      this.updateEntry(key, (e) => ({ ...e, transcript, history, loading: false }));
    } catch (error) {
      if (isSessionGone(error)) {
        this.dropGone(key);
        return;
      }
      this.updateEntry(key, (e) => ({ ...e, loading: false, error: errorText(error) }));
    } finally {
      this.buffered.delete(key);
      this.prune();
    }
  }

  /** the cached tail fills an empty transcript until the server's history lands */
  private async paintWarmTail(key: string) {
    const entry = this.entry(key);
    const tail = entry ? await this.persistence?.tails.load(entry.profile, key) : null;
    const current = this.entry(key);
    if (!tail || !current?.loading || current.transcript.messages.length > 0) return;
    this.updateTranscript(key, (t) => ({ ...t, messages: tail }));
  }

  /** "Show earlier": the page immediately older than the rows held, counted back from the newest row */
  async showEarlier(key: string) {
    const entry = this.entry(key);
    if (!entry || key === DRAFT_KEY || !entry.history.more || entry.history.loadingEarlier) return;
    const requested = entry.history;
    this.updateEntry(key, (e) => ({ ...e, history: { ...e.history, loadingEarlier: true } }));
    const read = (query: Record<string, string | number | boolean>) =>
      this.api.get<MessagesPage>(`/api/sessions/${encodeURIComponent(key)}/messages`, { ...query, include_compacted: true, profile: entry.profile });
    try {
      const page = await read({ limit: HISTORY_LIMIT, offset: requested.nextOffset, order: 'latest' });
      let older = fromHistory(unhideOpeningUserRows(page?.messages ?? []));
      const history = historyFromPage(page, requested);
      // paging can reach the top while the opening user turn stays missing (hidden by compaction): read it once
      if (!history.more && !older.some((m) => m.role === 'user')) {
        try {
          const origin = await read({ limit: 20, offset: 0, order: 'oldest' });
          older = prependOlder(older, fromHistory(unhideOpeningUserRows(origin?.messages ?? [])));
        } catch {
          // the older page that landed stays
        }
      }
      const current = this.entry(key);
      // a reload while the page was in flight owns the history now
      if (!current || current.history.nextOffset !== requested.nextOffset) return;
      this.updateEntry(key, (e) => ({ ...e, transcript: { ...e.transcript, messages: prependOlder(e.transcript.messages, older) }, history }));
    } catch {
      // the pill stays for another try
      this.updateEntry(key, (e) => ({ ...e, history: { ...e.history, loadingEarlier: false } }));
    }
  }

  /** a session that no longer exists: the open chat falls back to a fresh one and keeps its unsent text */
  private dropGone(key: string) {
    const entry = this.entry(key);
    if (!entry) return;
    void this.persistence?.tails.drop(entry.profile, key);
    this.drafts.adoptGone(entry.profile, key);
    const { [key]: _gone, ...entries } = this.snapshot.entries;
    for (const [runtime, mapped] of this.runtimeToKey) if (mapped === key) this.runtimeToKey.delete(runtime);
    this.recency.forget(key);
    this.saved.delete(key);
    const wasOpen = this.snapshot.openKey === key;
    this.set({ entries });
    if (wasOpen) this.newChat();
    void this.refreshSessions();
  }

  private async resume(key: string, { rebind }: { rebind: boolean }): Promise<SessionResumeResult | null> {
    const entry = this.entry(key);
    if (!entry) return null;
    try {
      const result = await this.rpc('session.resume', {
        session_id: key,
        profile: entry.profile,
        cols: 96,
        omit_messages: true,
        source: 'desktop',
      });
      this.bindRuntime(key, result.session_id);
      if (result.info?.model) this.updateEntry(key, (e) => ({ ...e, model: selectionFromInfo(result.info, e.model) }));
      if (rebind && !result.running && entry.transcript.running) {
        this.updateTranscript(key, (t) => applyEvent(t, { type: 'session.info', payload: { running: false } }));
      }
      return result;
    } catch (error) {
      if (!rebind) throw error;
      return null;
    }
  }

  // ─── composing ─────────────────────────────────────────────────────────────

  async send(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const key = this.snapshot.openKey;
    const entry = this.entry(key);
    if (!entry) return;

    if (/^\/(new|reset)\s*$/.test(text)) {
      if (entry.isBotChat) {
        this.notify('This chat never resets. Bot chats are one continuous conversation, so it is compacting instead.');
        await this.compact(key);
      } else {
        this.newChat();
      }
      return;
    }
    if (/^\/(compact|compress)\s*$/.test(text) && key !== DRAFT_KEY) {
      await this.compact(key);
      return;
    }

    if (entry.transcript.running && entry.runtimeId) {
      // Send while busy steers the running turn (issue "Transcript and composer parity on touch")
      this.updateTranscript(key, (t) => addUserMessage(t, text));
      try {
        const result = await this.rpc('session.redirect', { session_id: entry.runtimeId, profile: entry.profile, text });
        if (result.status === 'rejected') this.updateTranscript(key, (t) => addSystemNotice(t, 'The running turn could not take that message.'));
      } catch (error) {
        this.updateTranscript(key, (t) => addSystemNotice(t, `Could not steer the running turn: ${errorText(error)}`));
      }
      return;
    }

    if (key === DRAFT_KEY) {
      await this.sendFromDraft(entry, text);
      return;
    }
    await this.submit(key, text);
  }

  private async sendFromDraft(draft: ChatEntry, text: string) {
    this.updateTranscript(DRAFT_KEY, (t) => addUserMessage(t, text));
    try {
      const pick = this.entry(DRAFT_KEY)?.model ?? draft.model;
      const created = await this.rpc('session.create', {
        profile: draft.profile,
        source: 'desktop',
        cols: 96,
        ...(pick ? { model: pick.model, provider: pick.provider } : {}),
        ...(pick?.effort ? { reasoning_effort: pick.effort } : {}),
      });
      const key = created.stored_session_id;
      const moved = this.entry(DRAFT_KEY) ?? draft;
      this.set({
        entries: {
          ...this.snapshot.entries,
          [key]: { ...moved, key, model: selectionFromInfo(created.info, moved.model) },
          [DRAFT_KEY]: newEntry(DRAFT_KEY, draft.profile, { model: pick }),
        },
        openKey: this.snapshot.openKey === DRAFT_KEY ? key : this.snapshot.openKey,
      });
      this.bindRuntime(key, created.session_id);
      await this.submit(key, text, { optimistic: false });
      this.scheduleListRefresh();
    } catch (error) {
      this.updateTranscript(DRAFT_KEY, (t) => ({ ...addSystemNotice(t, `Could not start the session: ${errorText(error)}`), running: false }));
    }
  }

  private async submit(key: string, text: string, { optimistic = true } = {}) {
    const entry = this.entry(key);
    if (!entry) return;
    if (optimistic) this.updateTranscript(key, (t) => addUserMessage(t, text));
    try {
      if (!entry.runtimeId) await this.resume(key, { rebind: false });
      const runtimeId = this.entry(key)?.runtimeId;
      if (!runtimeId) throw new Error('The session is not attached to the gateway.');
      await this.rpc('prompt.submit', { session_id: runtimeId, profile: entry.profile, text }, PROMPT_TIMEOUT_MS);
    } catch (error) {
      this.updateTranscript(key, (t) => ({ ...addSystemNotice(t, `The message was not sent: ${errorText(error)}`), running: false, liveId: null }));
    }
  }

  async stop() {
    const entry = this.entry(this.snapshot.openKey);
    if (!entry?.runtimeId || !entry.transcript.running) return;
    try {
      const result = await this.rpc('session.interrupt', { session_id: entry.runtimeId, profile: entry.profile });
      if (result.status === 'not_interrupted') {
        this.updateTranscript(entry.key, (t) => applyEvent(t, { type: 'session.info', payload: { running: false } }));
      }
    } catch (error) {
      this.notify(`Could not stop the turn: ${errorText(error)}`);
    }
  }

  private async compact(key: string) {
    const entry = this.entry(key);
    if (!entry || key === DRAFT_KEY) return;
    try {
      if (!entry.runtimeId) await this.resume(key, { rebind: false });
      const runtimeId = this.entry(key)?.runtimeId;
      if (!runtimeId) throw new Error('The session is not attached to the gateway.');
      this.updateTranscript(key, (t) => ({ ...t, running: true, status: 'Compacting…' }));
      const result = await this.rpc('session.compress', { session_id: runtimeId, profile: entry.profile }, 600_000);
      const messages = Array.isArray(result.messages) ? fromHistory(result.messages as SessionMessage[]) : null;
      this.updateTranscript(key, (t) => ({ ...t, messages: messages ?? t.messages, running: false, status: null }));
      if (messages) this.updateEntry(key, (e) => ({ ...e, history: NO_HISTORY }));
      this.updateTranscript(key, (t) => addSystemNotice(t, result.message || 'Conversation compacted.'));
    } catch (error) {
      this.updateTranscript(key, (t) => ({ ...addSystemNotice(t, `Compacting failed: ${errorText(error)}`), running: false, status: null }));
    }
  }

  // ─── models ────────────────────────────────────────────────────────────────

  /** the profile's catalog over `model.options`; `refresh` asks the gateway to re-probe its providers */
  async refreshModels(refresh = false) {
    if (this.link.current.kind !== 'open') return;
    const profile = this.snapshot.profile;
    const keep = this.snapshot.models.profile === profile;
    this.set({ models: { ...(keep ? this.snapshot.models : { providers: [], current: null }), profile, loading: true, error: null } });
    try {
      const open = this.entry(this.snapshot.openKey);
      const result = await this.rpc(
        'model.options',
        { profile, session_id: open?.runtimeId ?? null, explicit_only: true, ...(refresh ? { refresh: true } : {}) },
        refresh ? 60_000 : undefined,
      );
      if (profile !== this.snapshot.profile) return;
      const current = result.model ? { model: result.model, provider: result.provider ?? '' } : null;
      this.set({ models: { profile, providers: result.providers ?? [], current, loading: false, error: null } });
    } catch (error) {
      if (profile !== this.snapshot.profile) return;
      this.set({ models: { ...this.snapshot.models, loading: false, error: errorText(error) } });
    }
  }

  /** the profile's display and agent config: personality for the intro, effort for the picker */
  private async refreshPersonality() {
    const profile = this.snapshot.profile;
    try {
      const config = await this.api.get<{ display?: { personality?: unknown }; agent?: { reasoning_effort?: unknown } }>('/api/config', { profile });
      if (profile !== this.snapshot.profile) return;
      const effort = config?.agent?.reasoning_effort;
      this.set({
        personality: normalizePersonality(config?.display?.personality),
        defaultEffort: typeof effort === 'string' && effort.trim() ? effort.trim().toLowerCase() : null,
      });
    } catch {
      // the intro falls back to the neutral copy
    }
  }

  /** the open chat's model: its live session's, else the draft's pick, else the profile default */
  currentModel(): ModelSelection | null {
    const open = this.entry(this.snapshot.openKey);
    const current = open?.model ?? this.snapshot.models.current;
    return current ? { ...current, effort: current.effort ?? this.snapshot.defaultEffort } : null;
  }

  /**
   * Switch the open chat's model. A draft keeps the pick for `session.create`; a
   * live session takes it over `config.set` as the desktop sends it. Expensive
   * models come back as a question the caller answers with `confirm`.
   */
  async selectModel(selection: ModelSelection, { confirm = false } = {}): Promise<ModelSwitchOutcome> {
    const key = this.snapshot.openKey;
    const entry = this.entry(key);
    if (!entry) return { kind: 'failed' };
    const previous = entry.model;
    const effort = selection.effort ?? previous?.effort ?? null;
    this.updateEntry(key, (e) => ({ ...e, model: { model: selection.model, provider: selection.provider, effort } }));
    if (!entry.runtimeId) return { kind: 'ok', deferred: false };
    try {
      const result = await this.rpc('config.set', {
        session_id: entry.runtimeId,
        profile: entry.profile,
        key: 'model',
        value: `${selection.model} --provider ${selection.provider}`,
        ...(confirm ? { confirm_expensive_model: true } : {}),
      });
      if (result.confirm_required) {
        this.updateEntry(key, (e) => ({ ...e, model: previous }));
        return { kind: 'confirm', message: result.confirm_message || 'This model is expensive. Switch anyway?' };
      }
      if (result.info?.model) this.updateEntry(key, (e) => ({ ...e, model: selectionFromInfo(result.info, e.model) }));
      if (result.warning) this.notify(result.warning);
      return { kind: 'ok', deferred: result.deferred === true };
    } catch (error) {
      this.updateEntry(key, (e) => ({ ...e, model: previous }));
      this.notify(`Could not switch the model. ${errorText(error)}`);
      return { kind: 'failed' };
    }
  }

  /** reasoning effort for the open chat; `none` turns thinking off */
  async setEffort(effort: string) {
    const key = this.snapshot.openKey;
    const entry = this.entry(key);
    if (!entry) return;
    const base = this.currentModel();
    const previous = entry.model;
    if (base) this.updateEntry(key, (e) => ({ ...e, model: { ...base, effort } }));
    if (!entry.runtimeId) return;
    try {
      await this.rpc('config.set', { session_id: entry.runtimeId, profile: entry.profile, key: 'reasoning', value: effort });
    } catch (error) {
      this.updateEntry(key, (e) => ({ ...e, model: previous }));
      this.notify(`Could not change the reasoning effort. ${errorText(error)}`);
    }
  }

  // ─── bots ──────────────────────────────────────────────────────────────────

  /** persist a patch to the bot's `ui_meta` namespace with the desktop's compare-and-swap, three attempts */
  private async patchBotMeta(name: string, patch: Partial<BotMeta>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const list = await this.rpc('profiles.list', { include_sessions: false });
      const row = (list.profiles ?? []).find((p: ProfileRow) => p.name === name);
      if (!row) throw new Error(`No profile named ${name}.`);
      const revision = row.ui_meta_revisions?.[BOT_META_NAMESPACE];
      try {
        await this.rpc('profiles.configure', {
          name,
          ui_meta: { [BOT_META_NAMESPACE]: { ...readBotMeta(row), ...patch } },
          ...(revision !== undefined ? { ui_meta_expected_revisions: { [BOT_META_NAMESPACE]: revision } } : {}),
        });
        return;
      } catch (error) {
        if (attempt === 2 || !/revision|conflict/i.test(errorText(error))) throw error;
      }
    }
  }

  async setBotFlag(bot: Bot, flag: 'pinned' | 'hidden', value: boolean) {
    try {
      await this.patchBotMeta(bot.name, { [flag]: value });
      await this.refreshRoster();
    } catch (error) {
      this.notify(`Could not update ${bot.label}. ${errorText(error)}`);
    }
  }

  async createBot(draft: BotDraft): Promise<boolean> {
    const label = draft.label.trim();
    const name = slugifyProfileName(label);
    if (!name) {
      this.notify('Give the bot a name with at least one letter or digit.');
      return false;
    }
    const description = draft.description.trim();
    try {
      const soul = [`# ${label}`, '', description ? `**Mission:** ${description}` : null, '',
        `You are ${label}, a persistent named agent (profile \`${name}\`) on this machine.`,
        'You keep your own memory, skills, and conversation history across sessions.']
        .filter((line) => line !== null)
        .join('\n');
      await this.rpc('profiles.create', { name, description: description || null, clone_from: 'default', soul });
      await this.rpc('profiles.configure', {
        name,
        ui_meta: { [BOT_META_NAMESPACE]: { title: label, shape: 'blobatar', imageKind: 'shape', created: Date.now() } },
      });
      await this.refreshRoster();
      await this.openBot({ name, label }, { kickoff: true });
      return true;
    } catch (error) {
      this.notify(`Could not create ${label}. ${errorText(error)}`);
      return false;
    }
  }

  async editBot(bot: Bot, draft: BotDraft): Promise<boolean> {
    try {
      const description = draft.description.trim();
      await this.rpc('profiles.configure', { name: bot.name, description });
      await this.patchBotMeta(bot.name, { title: draft.label.trim() || undefined, custom: bot.meta.custom });
      await this.refreshRoster();
      return true;
    } catch (error) {
      this.notify(`Could not save ${bot.label}. ${errorText(error)}`);
      return false;
    }
  }

  async deleteBot(bot: Bot): Promise<boolean> {
    if (bot.isDefault) {
      this.notify('The default profile cannot be deleted.');
      return false;
    }
    try {
      await this.api.del(`/api/profiles/${encodeURIComponent(bot.name)}`);
      if (this.snapshot.profile === bot.name) {
        this.setProfile('default');
        this.newChat();
      }
      await this.refreshRoster();
      return true;
    } catch (error) {
      this.notify(`Could not delete ${bot.label}. ${errorText(error)}`);
      return false;
    }
  }

  async avatarData(name: string): Promise<string | null> {
    try {
      const result = await this.rpc('profiles.get_asset', { name, asset: 'avatar' });
      return result.found && result.data ? result.data : null;
    } catch {
      return null;
    }
  }

  /** stable reference for avatar components */
  avatarDataFn = (name: string) => this.avatarData(name);

  retryLink() {
    this.link.retryNow();
  }

  /** switch the active profile without opening a bot, from the drawer's profile chip */
  useProfile(profile: string) {
    this.setProfile(profile);
    this.newChat();
  }
}

/** a deleted session answers its history with a 404 */
function isSessionGone(error: unknown): boolean {
  return (error instanceof ApiError && error.status === 404) || /session not found/i.test(errorText(error));
}

/** a run already under way when the session opened: show what it has streamed so far */
function withInflight(transcript: Transcript, resumed: SessionResumeResult): Transcript {
  const inflight = resumed.inflight;
  let next = { ...transcript, running: true };
  const lastUser = [...next.messages].reverse().find((m) => m.role === 'user');
  const lastUserText = lastUser?.parts[0]?.kind === 'text' ? lastUser.parts[0].text : '';
  if (inflight?.user && inflight.user !== lastUserText) next = addUserMessage(next, inflight.user);
  next = applyEvent(next, { type: 'message.start', payload: {} });
  if (inflight?.assistant) next = applyEvent(next, { type: 'message.delta', payload: { text: inflight.assistant } });
  return next;
}
