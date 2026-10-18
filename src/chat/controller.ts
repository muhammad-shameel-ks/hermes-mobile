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
import { looksLikeSlashCommand } from '../../vendor/hermes-shared/src/slash.ts';
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
import { metaOfLook, type LookPatch } from '../bots/look.ts';
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
import { nextFinishedAway } from '../drawer/sessionStatus.ts';
import { emptySessions, SessionsFeed, type SessionsState } from '../drawer/sessionsFeed.ts';
import { applyReaction } from './actionBar.ts';
import { ATTACH_WHILE_RUNNING, bubbleText, detachImages, promptText, stageAttachments, type AttachRpc, type ComposerAttachment } from './attachments.ts';
import { normalizePersonality } from './intro.ts';
import type { ModelSelection } from './models.ts';
import { runSlash, type SlashEnv } from './slashRun.ts';
import {
  durableRowIds,
  isDeepTruncateRefusal,
  isSessionBusyError,
  isStaleTargetError,
  matchDurableRowId,
  planRewind,
  RecentInterrupts,
  rebindRowIds,
  retryWhileBusy,
  rewindOptimistic,
  stampUserRowId,
  survivorRowIdsFrom,
  truncateParams,
  type RewindPlan,
} from './rewind.ts';
import { noteTurnStart, startedTurnCwds } from '../review/turn-base.ts';
import { NotifyThrottle, type ThrottleClock } from './notifyThrottle.ts';
import { busySendAction } from './queue.ts';
import { QueueDriver } from './queueDrain.ts';
import { reactionsParams } from '../settings/display-toggles.ts';
import { emptyStack, persistedStack, restoreStack, StatusSync, type PersistedStack, type SessionStack, type StackStore } from './statusSync.ts';
import { RequestRouter } from './requestRouter.ts';
import { awaitingInput, emptyRequests, hasBlockingPrompt, type Requests } from './requests.ts';
import {
  addSystemNotice,
  addUserMessage,
  applyEvent,
  emptyTranscript,
  findLast,
  fromHistory,
  type SessionMessage,
  type Transcript,
} from './transcript.ts';
import { idleWait } from './turnActivity.ts';

export const DRAFT_KEY = FRESH_DRAFT_KEY;
/** the notice a replay gap leaves where the transcript was reloaded from saved history */
export const REPLAY_GAP_NOTICE = 'Some updates were missed while the connection was down. The conversation was reloaded from its saved history.';
const PROMPT_TIMEOUT_MS = 1_800_000;

/**
 * The events a reply streams by the dozen a second, none of which the reader needs to see within
 * the frame: they reach the state at once but wake the subscribers on a paced beat.
 * Everything else (a tool starting or finishing, an error, a send, a navigation) notifies on the spot.
 */
const PACED_EVENTS: ReadonlySet<string> = new Set([
  'message.delta',
  'reasoning.delta',
  'reasoning.available',
  'thinking.delta',
  'tool.generating',
  'subagent.progress',
  'subagent.thinking',
  'subagent.tool',
]);

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
  /** the backend's read watermark: activity postdates the last time it was opened */
  unread?: boolean;
  model?: string | null;
  cwd?: string | null;
  git_branch?: string | null;
  /** the original root of a compression chain: stable across compressions */
  _lineage_root_id?: string | null;
  /** `'compression'`: this row continues a sealed earlier segment, it is not a fresh conversation */
  continuation_kind?: 'compression';
  parent_session_id?: string | null;
  /** predecessor of a /new or idle reset: a sibling, never a fork */
  _reset_from?: string | null;
  /** parent of a genuine /branch fork: the only nesting */
  _branched_from?: string | null;
};

export type ChatEntry = {
  key: string;
  runtimeId: string | null;
  profile: string;
  title: string | null;
  isBotChat: boolean;
  /** the bot this chat belongs to, when opened from the roster */
  bot: string | null;
  /** the session's working directory, from the gateway's session info; the Review surface's repository */
  cwd: string | null;
  transcript: Transcript;
  loading: boolean;
  error: string | null;
  /** the session's live model, or the draft's pick before its session exists */
  model: ModelSelection | null;
  /** how far back the history has been paged */
  history: HistoryState;
  /** the status stack's rows, the queue and the stack's folded choice */
  stack: SessionStack;
  /** approvals, clarify and prompts the gateway has the session blocked on */
  requests: Requests;
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
  sessions: SessionsState;
  /** sessions whose turn finished while another chat was on screen, until the reader opens them: the list's unread dot */
  finishedAway: Readonly<Record<string, true>>;
  roster: Roster & { loaded: boolean; loading: boolean; error: string | null };
  /** a bot whose chat is being looked up or created */
  openingBot: string | null;
  notice: { text: string; at: number } | null;
  models: ModelCatalog;
  /** the active profile's `display.personality`, which picks the intro copy */
  personality: string;
  /** the profile's `agent.reasoning_effort`, the effort a session starts with unless picked */
  defaultEffort: string | null;
  /** `display.message_reactions`: whether the action bar offers the reaction slot */
  reactionsEnabled: boolean;
};

/** the stack's durable copy rides the store's per-session queue row, as a one-element list */
function stackStoreOver(persistence: Persistence, profileOf: (key: string) => string): StackStore {
  return {
    load: async (key) => (await persistence.queue.load<PersistedStack>(profileOf(key), key))[0] ?? null,
    save: (key, stack) => void persistence.queue.save(profileOf(key), key, stack.queue.length || stack.hidden ? [stack] : []),
  };
}

/** a rewind's answer: `confirm` is the gateway refusing a cut that archives later user turns until the reader agrees */
export type RewindOutcome = 'ok' | 'confirm' | 'failed';

export type BotDraft = { label: string; description: string };
/** the look a new bot is created with; `image` is a data URL for the profile's asset store */
export type NewBotLook = { shape: string; color: string | null; image: string | null };

type Rpc = <M extends keyof RpcMethods>(method: M, params: RpcMethods[M]['params'], timeoutMs?: number) => Promise<RpcMethods[M]['result']>;

const newEntry = (key: string, profile: string, extra: Partial<ChatEntry> = {}): ChatEntry => ({
  key,
  runtimeId: null,
  profile,
  title: null,
  isBotChat: false,
  bot: null,
  cwd: null,
  transcript: emptyTranscript(),
  loading: false,
  error: null,
  model: null,
  history: NO_HISTORY,
  stack: emptyStack(),
  requests: emptyRequests(),
  ...extra,
});

const cwdFromInfo = (info: SessionLiveInfo | null | undefined, previous: string | null): string | null => info?.cwd?.trim() || previous;

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
  readonly rpc: Rpc;
  private listTimer: ReturnType<typeof setTimeout> | null = null;
  /** set when the app backgrounds: the next time the socket opens, the open chat is re-read */
  private reloadOpenOnLinkOpen = false;
  private readonly interrupts = new RecentInterrupts();
  private readonly link: GatewayLink;
  readonly api: GatewayApi;
  private readonly persistence: Persistence | null;
  private readonly recency = new Recency();
  /** the transcript last handed to the tail writer, so unrelated entry updates do not rewrite it */
  private readonly saved = new Map<string, unknown>();
  readonly drafts: DraftStore;
  private creatingBot: Promise<boolean> | null = null;
  readonly queue: QueueDriver;
  readonly status: StatusSync;
  private readonly sessionsFeed: SessionsFeed;
  /** where queued prompts and the folded choice survive an app kill; set by the app shell */
  stackStore: StackStore | null = null;
  /** the gateway's approval, clarify and prompt requests, parked into each chat's `requests` */
  readonly serverRequests: RequestRouter;
  private readonly beat: NotifyThrottle;
  /** set while a paced event is being applied, so the writes it causes may wait for the beat */
  private pacing = false;
  private modelMemo: { from: ModelSelection; defaultEffort: string | null; value: ModelSelection } | null = null;

  constructor(link: GatewayLink, api: GatewayApi, initialProfile = 'default', persistence: Persistence | null = null, clock?: ThrottleClock) {
    this.link = link;
    this.beat = new NotifyThrottle(() => {
      for (const listener of this.listeners) listener();
    }, clock);
    this.api = api;
    this.persistence = persistence;
    this.drafts = persistence?.drafts ?? new DraftStore(null, '');
    if (persistence) this.stackStore = stackStoreOver(persistence, (key) => this.entry(key)?.profile ?? this.snapshot.profile);
    this.rpc = (method, params, timeoutMs) =>
      this.link.client.request(method, params as unknown as Record<string, unknown>, timeoutMs);
    this.serverRequests = new RequestRouter({
      keyFor: (runtimeId) => this.runtimeToKey.get(runtimeId),
      keys: () => Object.keys(this.snapshot.entries),
      runtimeId: (key) => this.entry(key)?.runtimeId ?? null,
      profile: (key) => this.entry(key)?.profile ?? this.snapshot.profile,
      requests: (key) => this.entry(key)?.requests,
      setRequests: (key, update) => this.updateEntry(key, (e) => ({ ...e, requests: update(e.requests) })),
      updateTranscript: (key, update) => this.updateTranscript(key, update),
      rpc: this.rpc,
      online: () => this.link.current.kind === 'open',
      notify: (text) => this.notify(text),
    });
    this.sessionsFeed = new SessionsFeed(api, {
      profile: () => this.snapshot.profile,
      get: () => this.snapshot.sessions,
      set: (sessions) => this.set({ sessions }),
    });
    this.snapshot = {
      link: link.current,
      profile: initialProfile,
      openKey: DRAFT_KEY,
      entries: { [DRAFT_KEY]: newEntry(DRAFT_KEY, initialProfile) },
      sessions: emptySessions(),
      finishedAway: {},
      roster: { visible: [], hidden: [], loaded: false, loading: false, error: null },
      openingBot: null,
      notice: null,
      models: { profile: initialProfile, providers: [], current: null, loading: false, error: null },
      personality: '',
      defaultEffort: null,
      reactionsEnabled: false,
    };
    const after = (ms: number, run: () => void) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    };
    this.status = new StatusSync({
      get: (key) => this.entry(key)?.stack.status,
      set: (key, update) => {
        const entry = this.entry(key);
        if (!entry) return;
        const status = update(entry.stack.status);
        if (status !== entry.stack.status) this.putEntry({ ...entry, stack: { ...entry.stack, status } });
      },
      runtimeId: (key) => this.entry(key)?.runtimeId ?? null,
      profile: (key) => this.entry(key)?.profile ?? this.snapshot.profile,
      ready: () => this.link.current.kind === 'open',
      request: this.rpc,
      notify: (text) => this.notify(text),
      after,
      now: Date.now,
    });
    this.queue = new QueueDriver({
      queue: (key) => this.entry(key)?.stack.queue,
      setQueue: (key, update) => {
        const entry = this.entry(key);
        if (!entry) return;
        const queue = update(entry.stack.queue);
        if (queue === entry.stack.queue) return;
        const stack = { ...entry.stack, queue };
        this.putEntry({ ...entry, stack });
        if (key !== DRAFT_KEY) this.stackStore?.save(key, persistedStack(stack));
      },
      busy: (key) => this.entry(key)?.transcript.running ?? false,
      ready: (key) => {
        const entry = this.entry(key);
        return Boolean(entry && key !== DRAFT_KEY && !entry.loading && this.link.current.kind === 'open');
      },
      send: (key, text, display) => this.submitQueued(key, text, display),
      steer: (key, text) => this.steerRunning(key, text),
      interrupt: (key) => this.interrupt(key),
      notify: (text) => this.notify(text),
      after,
      now: Date.now,
    });
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

  /**
   * `paced`: the change is a stream's text or progress, which touches nothing a turn's edges, the
   * queue or the unread marks look at. The snapshot is current at once; subscribers hear on the beat.
   */
  private set(patch: Partial<ChatSnapshot>, paced = false) {
    const before = this.snapshot.entries;
    this.snapshot = { ...this.snapshot, ...patch };
    if (paced) {
      this.beat.request();
      return;
    }
    const finishedAway = nextFinishedAway(this.snapshot.finishedAway, before, this.snapshot.entries, this.snapshot.openKey);
    if (finishedAway !== this.snapshot.finishedAway) this.snapshot = { ...this.snapshot, finishedAway };
    for (const cwd of startedTurnCwds(before, this.snapshot.entries)) void noteTurnStart(cwd, this.api);
    this.beat.flush();
    // the queue drains whenever its session is idle, not only on the edge a turn ends
    for (const entry of Object.values(this.snapshot.entries)) if (entry.stack.queue.entries.length) this.queue.sweep(entry.key);
  }

  private entry(key: string): ChatEntry | undefined {
    return this.snapshot.entries[key];
  }

  private putEntry(entry: ChatEntry) {
    const previous = this.entry(entry.key);
    // a streamed write that leaves the turn's edges alone has nothing for the queue or the unread marks to react to
    const paced = this.pacing && previous !== undefined && previous.transcript.running === entry.transcript.running && previous.cwd === entry.cwd && previous.stack.queue === entry.stack.queue;
    this.set({ entries: { ...this.snapshot.entries, [entry.key]: entry } }, paced);
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
        entry.stack.queue.entries.length > 0 ||
        awaitingInput(entry.requests) ||
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
      this.status.forget(key);
      for (const [runtime, mapped] of this.runtimeToKey) if (mapped === key) this.runtimeToKey.delete(runtime);
    }
    this.set({ entries: next });
  }

  private updateEntry(key: string, update: (entry: ChatEntry) => ChatEntry) {
    const current = this.entry(key);
    if (!current) return;
    const next = update(current);
    if (next !== current) this.putEntry(next);
  }

  /** an update that changes nothing writes nothing: no new snapshot, no wake-up */
  private updateTranscript(key: string, update: (t: Transcript) => Transcript) {
    this.updateEntry(key, (entry) => {
      const transcript = update(entry.transcript);
      return transcript === entry.transcript ? entry : { ...entry, transcript };
    });
  }

  private bindRuntime(key: string, runtimeId: string) {
    for (const [runtime, mapped] of this.runtimeToKey) if (mapped === key && runtime !== runtimeId) this.runtimeToKey.delete(runtime);
    this.runtimeToKey.set(runtimeId, key);
    this.updateEntry(key, (entry) => ({ ...entry, runtimeId }));
    this.serverRequests.adopt(runtimeId);
  }

  notify(text: string) {
    this.set({ notice: { text, at: Date.now() } });
  }

  start() {
    this.link.resume();
  }

  /** the app left the foreground: the socket closes and redials on return, and the open chat is re-read once it does */
  pause() {
    this.reloadOpenOnLinkOpen = true;
    this.link.pause();
    void this.persistence?.flush();
  }

  clearNotice = () => {
    this.set({ notice: null });
  };

  dispose() {
    for (const off of this.unsubscribe) off();
    if (this.listTimer) clearTimeout(this.listTimer);
    this.beat.cancel();
    this.queue.dispose();
    this.status.dispose();
    this.serverRequests.dispose();
    this.link.pause();
    void this.persistence?.flush();
  }

  // ─── link + events ─────────────────────────────────────────────────────────

  private onLinkOpen() {
    const returning = this.reloadOpenOnLinkOpen;
    this.reloadOpenOnLinkOpen = false;
    const open = this.entry(this.snapshot.openKey);
    // a turn still streaming is caught up by the resume's replay; every other open chat may have moved
    // on another device while this one was away, so its newest page is read again
    const reloadOpen = Boolean(returning && open && open.key !== DRAFT_KEY && !open.loading && !open.transcript.running);
    void this.refreshRoster();
    void this.refreshSessions();
    void this.refreshModels();
    void this.refreshPersonality();
    // live events reach a socket only after it resumes a session; a redial rebinds every bound chat
    // (a reload resumes the open chat itself)
    for (const entry of Object.values(this.snapshot.entries)) {
      if (reloadOpen && entry.key === open?.key) continue;
      if (entry.key !== DRAFT_KEY && entry.runtimeId) void this.resume(entry.key, { rebind: true });
    }
    if (open && open.key !== DRAFT_KEY && !open.loading && (reloadOpen || !open.runtimeId)) void this.load(open.key);
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
    this.serverRequests.onEvent(key, event);
    if (!key) return;
    this.pacing = PACED_EVENTS.has(event.type);
    try {
      this.route(key, event);
    } finally {
      this.pacing = false;
    }
  }

  private route(key: string, event: GatewayEvent) {
    this.status.observe(key, event);
    const held = this.buffered.get(key);
    if (held) {
      held.push(event);
      return;
    }
    const wasRunning = this.entry(key)?.transcript.running;
    if (event.type === 'session.info') {
      const info = event.payload as SessionLiveInfo | undefined;
      if (info?.model || info?.cwd) this.updateEntry(key, (e) => ({ ...e, model: selectionFromInfo(info, e.model), cwd: cwdFromInfo(info, e.cwd) }));
    }
    this.updateTranscript(key, (t) => applyEvent(t, event));
    if (event.type === 'message.complete' || (wasRunning && !this.entry(key)?.transcript.running)) {
      this.scheduleListRefresh();
      this.prune();
    }
  }

  /** approvals, clarify and the prompts park into their chat; other methods fall to the next handler */
  private onServerRequest(request: ServerRequest): boolean {
    return this.serverRequests.handle(request);
  }

  private retitle(storedId: string, title: string) {
    const entry = this.entry(storedId);
    if (entry) this.putEntry({ ...entry, title });
    this.sessionsFeed.retitle(storedId, title);
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

  refreshSessions() {
    return this.sessionsFeed.refresh();
  }

  /** the list's "Load more": the recents window widens by a page */
  loadMoreSessions() {
    return this.sessionsFeed.loadMore();
  }

  /** the platform sections' "Load more" once their rows run past the messaging window */
  loadMoreMessaging() {
    return this.sessionsFeed.loadMoreMessaging();
  }

  /** the drawer's full-text search, over every session of the active profile */
  searchSessions(query: string) {
    return this.sessionsFeed.search(query);
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
    this.syncScope();
  }

  /** pull-to-refresh on the open chat: the newest page is re-read and re-anchored onto older pages the reader pulled in */
  refreshOpen(key: string = this.snapshot.openKey) {
    const entry = this.entry(key);
    if (!entry || key === DRAFT_KEY || entry.loading || entry.transcript.running) return Promise.resolve();
    // a refresh replays the newest page; `load` already keeps older pages it covers out of the way
    return this.load(key);
  }

  /** open a listed session of the active profile */
  openSession(session: Pick<SessionInfo, 'id' | 'title'>) {
    const existing = this.entry(session.id);
    if (!existing) this.putEntry(newEntry(session.id, this.snapshot.profile, { title: session.title }));
    this.set({ openKey: session.id });
    if (!existing || (!existing.runtimeId && !existing.loading)) void this.load(session.id);
    this.syncScope();
  }

  /** the profile the open chat speaks as: a Bot Chat's bot, else the active profile */
  private scopeProfile(): string {
    return this.entry(this.snapshot.openKey)?.profile ?? this.snapshot.profile;
  }

  /** the model catalog and display config follow the open chat's profile in and out of a Bot Chat */
  private syncScope() {
    if (this.snapshot.models.profile === this.scopeProfile()) return;
    void this.refreshModels();
    void this.refreshPersonality();
  }

  private setProfile(profile: string) {
    if (profile === this.snapshot.profile) return;
    this.set({ profile, personality: '', defaultEffort: null });
    this.sessionsFeed.reset();
    void this.refreshSessions();
    void this.refreshModels();
    void this.refreshPersonality();
  }

  /**
   * a roster tap: its one Bot Chat opens (or is created). The active profile stays put, as on the
   * desktop, where a Bot Chat opened in place keeps it; the chat's own calls carry the bot's profile.
   */
  async openBot(bot: Pick<Bot, 'name' | 'label'>, options: { kickoff?: boolean } = {}) {
    if (this.snapshot.openingBot) return;
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
    this.syncScope();
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
    this.putEntry(newEntry(key, profile, { title: BOT_CHAT_TITLE, isBotChat: true, bot: profile, model: selectionFromInfo(created.info, null), cwd: cwdFromInfo(created.info, null) }));
    this.bindRuntime(key, created.session_id);
    this.set({ openKey: key });
    this.syncScope();
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
      const saved = await this.stackStore?.load(key).catch(() => null);
      this.updateEntry(key, (e) => ({ ...e, transcript, history, loading: false, ...(saved ? { stack: restoreStack(e.stack, saved) } : {}) }));
      this.serverRequests.rearm(key);
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
    this.status.forget(key);
    const wasOpen = this.snapshot.openKey === key;
    this.set({ entries });
    if (wasOpen) this.newChat();
    void this.refreshSessions();
  }

  private async resume(key: string, { rebind }: { rebind: boolean }): Promise<SessionResumeResult | null> {
    const entry = this.entry(key);
    if (!entry) return null;
    const startedAt = Date.now() / 1000;
    try {
      const result = await this.rpc('session.resume', {
        session_id: key,
        profile: entry.profile,
        cols: 96,
        omit_messages: true,
        source: 'desktop',
      });
      this.bindRuntime(key, result.session_id);
      this.status.hydrate(key, result);
      this.serverRequests.onResumed(key, result, startedAt);
      if (result.info?.model || result.info?.cwd) this.updateEntry(key, (e) => ({ ...e, model: selectionFromInfo(result.info, e.model), cwd: cwdFromInfo(result.info, e.cwd) }));
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

  /** reads a picked attachment's bytes as base64; the device implementation loads on first use so the pure paths never touch it */
  readAttachment = async (uri: string) => (await import('./attachmentFiles.ts')).readBase64(uri);

  async send(rawText: string, attachments: ComposerAttachment[] = []) {
    const text = rawText.trim();
    if (!text && attachments.length === 0) return;
    const key = this.snapshot.openKey;
    const entry = this.entry(key);
    if (!entry) return;

    if (attachments.length === 0 && (await runSlash(this.slashEnv(key), text))) return;

    // text typed while a clarify waits answers it rather than steering the blocked turn
    if (key !== DRAFT_KEY && this.serverRequests.answerText(key, text)) return;

    if (entry.transcript.running && entry.runtimeId && attachments.length > 0) {
      this.notify(ATTACH_WHILE_RUNNING);
      return;
    }
    if (entry.transcript.running) {
      await this.sendWhileRunning(key, entry, text);
      return;
    }

    if (key === DRAFT_KEY) {
      await this.sendFromDraft(entry, text, attachments);
      return;
    }
    await this.submit(key, text, { attachments });
  }

  /** Send mid-turn steers; text a steer cannot carry, or that the turn declines, queues so no words are lost. */
  private async sendWhileRunning(key: string, entry: ChatEntry, text: string) {
    const action = busySendAction({ text, runtimeBound: Boolean(entry.runtimeId), blockingPrompt: hasBlockingPrompt(entry.requests) });
    if (action === 'steer' && (await this.steerRunning(key, text))) return;
    this.queue.enqueue(key, text);
  }

  /** the queue control: hold the text until the running turn ends */
  queueMessage(text: string) {
    const key = this.snapshot.openKey;
    if (!this.entry(key)?.transcript.running) return void this.send(text);
    this.queue.enqueue(key, text);
  }

  /** redirect the running turn; the correction shows as a user message only once the turn accepts it */
  private async steerRunning(key: string, text: string): Promise<boolean> {
    const entry = this.entry(key);
    if (!entry?.runtimeId) return false;
    this.updateTranscript(key, (t) => addUserMessage(t, text));
    const messageId = this.entry(key)?.transcript.messages.at(-1)?.id;
    try {
      const result = await this.rpc('session.redirect', { session_id: entry.runtimeId, profile: entry.profile, text });
      if (result.status !== 'rejected') return true;
    } catch {
      // the caller queues it
    }
    this.updateTranscript(key, (t) => ({ ...t, messages: t.messages.filter((m) => m.id !== messageId) }));
    return false;
  }

  /** a queued prompt as a new turn; a refusal leaves nothing behind so the drain can try again */
  private async submitQueued(key: string, text: string, display?: string): Promise<boolean> {
    const entry = this.entry(key);
    if (!entry || key === DRAFT_KEY) return false;
    // a command parked with the Queue control runs when its turn comes, as the desktop's drain routes it through the slash dispatcher
    if (!display && looksLikeSlashCommand(text) && (await runSlash(this.slashEnv(key), text.trim()))) return true;
    this.updateTranscript(key, (t) => addUserMessage(t, display ?? text));
    const messageId = this.entry(key)?.transcript.messages.at(-1)?.id;
    try {
      if (!entry.runtimeId) await this.resume(key, { rebind: false });
      const runtimeId = this.entry(key)?.runtimeId;
      if (!runtimeId) throw new Error('The session is not attached to the gateway.');
      await this.rpc('prompt.submit', { session_id: runtimeId, profile: entry.profile, text }, PROMPT_TIMEOUT_MS);
      return true;
    } catch {
      this.updateTranscript(key, (t) => ({ ...t, messages: t.messages.filter((m) => m.id !== messageId), running: false, liveId: null }));
      return false;
    }
  }

  /** fold the status stack away or bring it back; the choice outlives the session being closed */
  setStackHidden(key: string, hidden: boolean) {
    const entry = this.entry(key);
    if (!entry || entry.stack.hidden === hidden) return;
    const stack = { ...entry.stack, hidden };
    this.putEntry({ ...entry, stack });
    if (key !== DRAFT_KEY) this.stackStore?.save(key, persistedStack(stack));
  }

  private async sendFromDraft(draft: ChatEntry, text: string, attachments: ComposerAttachment[] = []) {
    this.updateTranscript(DRAFT_KEY, (t) => addUserMessage(t, bubbleText(text, attachments)));
    try {
      const key = await this.createFromDraft(draft);
      await this.submit(key, text, { optimistic: false, attachments });
      this.scheduleListRefresh();
    } catch (error) {
      this.updateTranscript(DRAFT_KEY, (t) => ({ ...addSystemNotice(t, `Could not start the session: ${errorText(error)}`), running: false }));
    }
  }

  /** create the draft's session and move the draft's transcript into it; the draft is fresh again */
  private async createFromDraft(draft: ChatEntry): Promise<string> {
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
        [key]: { ...moved, key, model: selectionFromInfo(created.info, moved.model), cwd: cwdFromInfo(created.info, moved.cwd) },
        [DRAFT_KEY]: newEntry(DRAFT_KEY, draft.profile, { model: pick }),
      },
      openKey: this.snapshot.openKey === DRAFT_KEY ? key : this.snapshot.openKey,
    });
    this.bindRuntime(key, created.session_id);
    return key;
  }

  private async submit(key: string, text: string, { optimistic = true, attachments = [] as ComposerAttachment[] } = {}) {
    const entry = this.entry(key);
    if (!entry) return;
    if (optimistic) this.updateTranscript(key, (t) => addUserMessage(t, bubbleText(text, attachments)));
    let staged: { prompt: string; imagePaths: string[] } | null = null;
    try {
      if (!entry.runtimeId) await this.resume(key, { rebind: false });
      const runtimeId = this.entry(key)?.runtimeId;
      if (!runtimeId) throw new Error('The session is not attached to the gateway.');
      staged = attachments.length ? await this.stageAttachments(runtimeId, entry.profile, text, attachments) : null;
      const result = await this.rpc('prompt.submit', { session_id: runtimeId, profile: entry.profile, text: staged?.prompt ?? text }, PROMPT_TIMEOUT_MS);
      if (typeof result?.user_row_id === 'number') this.updateTranscript(key, (t) => stampUserRowId(t, result.user_row_id as number));
    } catch (error) {
      const live = this.entry(key)?.runtimeId;
      if (staged?.imagePaths.length && live) void detachImages(this.attachRpc, { sessionId: live, profile: entry.profile }, staged.imagePaths);
      this.updateTranscript(key, (t) => ({ ...addSystemNotice(t, `The message was not sent: ${errorText(error)}`), running: false, liveId: null }));
    }
  }

  private attachRpc: AttachRpc = (method, params, timeoutMs) => this.rpc(method, params as never, timeoutMs);

  /** uploads the attachments into the live session and returns the prompt text that carries their refs */
  private async stageAttachments(runtimeId: string, profile: string, text: string, attachments: ComposerAttachment[]) {
    const staged = await stageAttachments(this.attachRpc, { sessionId: runtimeId, profile }, attachments, this.readAttachment);
    return { prompt: promptText(text, staged, attachments.some((attachment) => attachment.kind === 'image')), imagePaths: staged.imagePaths };
  }

  /** Stop: parks the queue, so the end of the turn does not roll into the next prompt, then interrupts */
  async stop() {
    const entry = this.entry(this.snapshot.openKey);
    if (!entry?.runtimeId || !entry.transcript.running) return;
    this.queue.park(entry.key);
    await this.interrupt(entry.key);
  }

  private async interrupt(key: string) {
    const entry = this.entry(key);
    if (!entry?.runtimeId || !entry.transcript.running) return;
    this.interrupts.mark(entry.runtimeId);
    try {
      const result = await this.rpc('session.interrupt', { session_id: entry.runtimeId, profile: entry.profile });
      if (result.status === 'not_interrupted') {
        this.updateTranscript(entry.key, (t) => applyEvent(t, { type: 'session.info', payload: { running: false } }));
      }
    } catch (error) {
      this.notify(`Could not stop the turn: ${errorText(error)}`);
    }
  }

  // ─── message actions ───────────────────────────────────────────────────────

  /** the reader's Tapback on a message of the open chat: painted at once, then persisted, rolled back if refused */
  async react(messageId: string, emoji: string | null) {
    const key = this.snapshot.openKey;
    const entry = this.entry(key);
    const message = entry?.transcript.messages.find((m) => m.id === messageId);
    if (!entry || !message || key === DRAFT_KEY) return;
    const previous = message.reactions;
    const paint = (reactions: typeof previous, rowId?: number) =>
      this.updateTranscript(key, (t) => ({
        ...t,
        messages: t.messages.map((m) => (m.id === messageId ? { ...m, reactions, ...(rowId !== undefined ? { rowId } : {}) } : m)),
      }));
    paint(applyReaction(previous, emoji, 'user'));
    try {
      if (!entry.runtimeId) await this.resume(key, { rebind: false });
      const result = await this.rpc('message.react', {
        session_id: this.entry(key)?.runtimeId ?? key,
        profile: entry.profile,
        ...(message.rowId === undefined ? { newest_role: message.role } : { row_id: message.rowId }),
        emoji,
        author: 'user',
      });
      paint(result.reactions ?? [], result.row_id);
    } catch (error) {
      paint(previous);
      this.notify(`Could not react. ${errorText(error)}`);
    }
  }

  /**
   * Rewind the open chat to the user turn at (or answered by) `messageId` and run it again:
   * retry and restore resubmit the same prompt, edit submits `options.text`. Everything after
   * the turn is dropped, interrupting a live turn first.
   */
  async rewind(messageId: string, options: { text?: string; confirmDeep?: boolean } = {}, retried = false): Promise<RewindOutcome> {
    const key = this.snapshot.openKey;
    const entry = this.entry(key);
    if (!entry || key === DRAFT_KEY) return 'failed';
    const plan = planRewind(entry.transcript.messages, messageId, options.text);
    if (!plan) {
      this.notify('Could not find the message to restore.');
      return 'failed';
    }
    const before = entry.transcript;
    try {
      if (!entry.runtimeId) await this.resume(key, { rebind: false });
      const runtimeId = this.entry(key)?.runtimeId;
      if (!runtimeId) throw new Error('The session is not attached to the gateway.');
      this.status.resetBackground(key);
      const interruptFirst = this.interrupts.shouldInterruptFirst({ busy: before.running, sessionId: runtimeId });
      this.updateTranscript(key, (t) => rewindOptimistic(t, plan));
      const result = await this.submitRewind(entry, runtimeId, plan, interruptFirst, options.confirmDeep === true);
      const survivors = survivorRowIdsFrom(result);
      if (survivors) this.updateTranscript(key, (t) => ({ ...t, messages: rebindRowIds(t.messages, survivors) }));
      if (typeof result.user_row_id === 'number') this.updateTranscript(key, (t) => stampUserRowId(t, result.user_row_id as number));
      return 'ok';
    } catch (error) {
      this.updateTranscript(key, () => before);
      if (isDeepTruncateRefusal(error) && !options.confirmDeep) return 'confirm';
      if (isStaleTargetError(error) && !retried) {
        // the row ids went stale (a compaction or another client): re-read the history and aim once more
        await this.load(key);
        return this.rewind(messageId, options, true);
      }
      this.notify(`Could not rewind the conversation. ${errorText(error)}`);
      return 'failed';
    }
  }

  private async submitRewind(entry: ChatEntry, runtimeId: string, plan: RewindPlan, interruptFirst: boolean, confirmDeep: boolean) {
    const profile = entry.profile;
    let rowId = plan.rowId;
    if (rowId === undefined) {
      try {
        const history = await this.rpc('session.history', { session_id: runtimeId, profile });
        rowId = matchDurableRowId(history.messages ?? [], plan.sourceText, plan.targetIsLast);
      } catch {
        // no durable address: the prompt is resubmitted plainly, never with a guessed cut
      }
    }
    const rebind = durableRowIds(entry.transcript.messages);
    const params = {
      session_id: runtimeId,
      profile,
      text: plan.text,
      ...(rowId !== undefined ? { ...truncateParams(rowId, confirmDeep), ...(rebind.length ? { rebind_survivor_row_ids: rebind } : {}) } : {}),
    };
    const interrupt = async () => {
      this.interrupts.mark(runtimeId);
      try {
        await this.rpc('session.interrupt', { session_id: runtimeId, profile });
      } catch {
        // best effort: the submit still gates on the gateway's own state
      }
    };
    const submit = () => this.rpc('prompt.submit', params, PROMPT_TIMEOUT_MS);
    if (interruptFirst) await interrupt();
    try {
      return await submit();
    } catch (error) {
      if (!isSessionBusyError(error)) throw error;
      await interrupt();
      return retryWhileBusy(submit);
    }
  }

  private async compact(key: string, focusTopic = '') {
    const entry = this.entry(key);
    if (!entry || key === DRAFT_KEY) return;
    // mid-turn the gateway refuses (or defers) a compress, and the live turn's own running flag is not this method's to clear
    let flagged = false;
    try {
      if (!entry.runtimeId) await this.resume(key, { rebind: false });
      const runtimeId = this.entry(key)?.runtimeId;
      if (!runtimeId) throw new Error('The session is not attached to the gateway.');
      flagged = !this.entry(key)?.transcript.running;
      if (flagged) this.updateTranscript(key, (t) => ({ ...t, running: true, wait: { ...t.wait, compacting: true } }));
      const result = await this.rpc('session.compress', { session_id: runtimeId, profile: entry.profile, ...(focusTopic ? { focus_topic: focusTopic } : {}) }, 600_000);
      const messages = Array.isArray(result.messages) ? fromHistory(result.messages as SessionMessage[]) : null;
      this.updateTranscript(key, (t) => ({ ...t, messages: messages ?? t.messages, ...(flagged ? { running: false, wait: idleWait() } : {}) }));
      if (messages) this.updateEntry(key, (e) => ({ ...e, history: NO_HISTORY }));
      this.updateTranscript(key, (t) => addSystemNotice(t, result.message || 'Conversation compacted.'));
    } catch (error) {
      this.updateTranscript(key, (t) => ({ ...addSystemNotice(t, `Compacting failed: ${errorText(error)}`), ...(flagged ? { running: false, wait: idleWait() } : {}) }));
    }
  }

  /** the gateway surface `runSlash` works against; a draft gets its session only when a command needs one */
  private slashEnv(initialKey: string): SlashEnv {
    let key = initialKey;
    const entry = this.entry(key);
    return {
      isBotChat: entry?.isBotChat ?? false,
      running: entry?.transcript.running ?? false,
      hasSession: key !== DRAFT_KEY,
      request: (method, params, timeoutMs) => {
        const profile = this.entry(key)?.profile ?? this.snapshot.profile;
        return this.link.client.request(method, { profile, ...params }, timeoutMs);
      },
      sessionId: async () => {
        try {
          const open = this.entry(key);
          if (!open) return null;
          if (key === DRAFT_KEY) key = await this.createFromDraft(open);
          if (!this.entry(key)?.runtimeId) await this.resume(key, { rebind: false });
          return this.entry(key)?.runtimeId ?? null;
        } catch {
          return null;
        }
      },
      runtimeId: () => this.entry(key)?.runtimeId ?? null,
      say: (text) => this.updateTranscript(key, (t) => addSystemNotice(t, text)),
      notify: (text) => this.notify(text),
      newChat: () => this.newChat(),
      enqueue: (text, display) => this.queue.enqueue(key, text, display) !== null,
      compact: (focusTopic) => this.compact(key, focusTopic),
      stop: () => this.stop(),
      setEffort: (effort) => this.setEffort(effort),
      retitle: (title) => {
        this.updateEntry(key, (e) => ({ ...e, title: title || null }));
        this.scheduleListRefresh();
      },
      submit: async (text, display) => {
        if (key === DRAFT_KEY) {
          const draft = this.entry(DRAFT_KEY);
          if (!draft) return;
          this.updateTranscript(DRAFT_KEY, (t) => addUserMessage(t, display ?? text));
          try {
            key = await this.createFromDraft(draft);
          } catch (error) {
            this.updateTranscript(DRAFT_KEY, (t) => ({ ...addSystemNotice(t, `Could not start the session: ${errorText(error)}`), running: false }));
            return;
          }
          await this.submit(key, text, { optimistic: false });
          this.scheduleListRefresh();
          return;
        }
        if (display && display !== text) this.updateTranscript(key, (t) => addUserMessage(t, display));
        await this.submit(key, text, { optimistic: !display || display === text });
      },
    };
  }

  /** a raw gateway call for the composer's completions (src/chat/SlashSheet.tsx, MentionSheet.tsx) */
  request = <T>(method: string, params: Record<string, unknown>): Promise<T> => this.link.client.request<T>(method, params);

  // ─── models ────────────────────────────────────────────────────────────────

  /** the profile's catalog over `model.options`; `refresh` asks the gateway to re-probe its providers */
  async refreshModels(refresh = false) {
    if (this.link.current.kind !== 'open') return;
    const profile = this.scopeProfile();
    const keep = this.snapshot.models.profile === profile;
    this.set({ models: { ...(keep ? this.snapshot.models : { providers: [], current: null }), profile, loading: true, error: null } });
    try {
      const open = this.entry(this.snapshot.openKey);
      const result = await this.rpc(
        'model.options',
        { profile, session_id: open?.runtimeId ?? null, explicit_only: true, ...(refresh ? { refresh: true } : {}) },
        refresh ? 60_000 : undefined,
      );
      if (profile !== this.scopeProfile()) return;
      const current = result.model ? { model: result.model, provider: result.provider ?? '' } : null;
      this.set({ models: { profile, providers: result.providers ?? [], current, loading: false, error: null } });
    } catch (error) {
      if (profile !== this.scopeProfile()) return;
      this.set({ models: { ...this.snapshot.models, loading: false, error: errorText(error) } });
    }
  }

  /** the profile's display and agent config: personality for the intro, effort for the picker */
  private async refreshPersonality() {
    const profile = this.scopeProfile();
    try {
      const config = await this.api.get<{ display?: { personality?: unknown; message_reactions?: unknown }; agent?: { reasoning_effort?: unknown } }>('/api/config', { profile });
      if (profile !== this.scopeProfile()) return;
      const effort = config?.agent?.reasoning_effort;
      this.set({
        personality: normalizePersonality(config?.display?.personality),
        defaultEffort: typeof effort === 'string' && effort.trim() ? effort.trim().toLowerCase() : null,
        reactionsEnabled: config?.display?.message_reactions === true,
      });
    } catch {
      // the intro falls back to the neutral copy
    }
  }

  /** the open chat's working directory, when the gateway has told us; where the Review surface looks */
  openCwd(): string | null {
    return this.entry(this.snapshot.openKey)?.cwd ?? null;
  }

  /**
   * Settings → Appearance → Message Reactions: show the change at once, write
   * `display.message_reactions` as the desktop does, then re-read the profile's
   * config so the flag is the server's word. A failed write puts the old value back.
   */
  async setReactionsEnabled(enabled: boolean) {
    const profile = this.scopeProfile();
    const previous = this.snapshot.reactionsEnabled;
    this.set({ reactionsEnabled: enabled });
    try {
      await this.rpc('config.set', reactionsParams(enabled, profile));
    } catch (error) {
      if (profile === this.snapshot.profile) this.set({ reactionsEnabled: previous });
      this.notify(`Could not change message reactions. ${errorText(error)}`);
      return;
    }
    await this.refreshPersonality();
  }

  /** the open chat's model: its live session's, else the draft's pick, else the profile default */
  currentModel(): ModelSelection | null {
    const open = this.entry(this.snapshot.openKey);
    const current = open?.model ?? this.snapshot.models.current;
    if (!current) return null;
    const { defaultEffort } = this.snapshot;
    // the same inputs answer with the same object, so a memoised reader downstream sees no change
    if (this.modelMemo?.from !== current || this.modelMemo.defaultEffort !== defaultEffort) {
      this.modelMemo = { from: current, defaultEffort, value: { ...current, effort: current.effort ?? defaultEffort } };
    }
    return this.modelMemo.value;
  }

  /**
   * Switch the open chat's model. A draft keeps the pick for `session.create`; a
   * live session takes it over `config.set` as the desktop sends it. Expensive
   * models come back as a question the caller answers with `confirm`. An
   * `effort` on the selection is applied to the live session after the switch.
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
      // the switch carries only the model; an effort picked with it goes over `reasoning`, as the desktop's `applyPreset` does
      if (selection.effort) await this.setEffort(selection.effort);
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

  /** single-flighted: a second Create while the first is under way joins it */
  createBot(draft: BotDraft, look: NewBotLook = { shape: 'blobatar', color: null, image: null }): Promise<boolean> {
    if (!this.creatingBot) {
      this.creatingBot = this.materializeBot(draft, look).finally(() => {
        this.creatingBot = null;
      });
    }
    return this.creatingBot;
  }

  private async materializeBot(draft: BotDraft, look: NewBotLook): Promise<boolean> {
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
        ui_meta: {
          [BOT_META_NAMESPACE]: {
            title: label,
            shape: look.shape,
            ...(look.color ? { color: look.color } : {}),
            imageKind: look.image ? 'photo' : 'shape',
            created: Date.now(),
          },
        },
      });
      if (look.image) {
        await this.storeAvatar(name, look.image).catch((error) =>
          this.notify(`Created ${label}, but its picture was not saved. ${errorText(error)}`),
        );
      }
      await this.refreshRoster();
      await this.openBot({ name, label }, { kickoff: true });
      return true;
    } catch (error) {
      this.notify(`Could not create ${label}. ${errorText(error)}`);
      return false;
    }
  }

  /** `look` carries only what the editor changed (title, shape, colour, image) */
  async editBot(bot: Bot, draft: BotDraft, look: LookPatch | null): Promise<boolean> {
    try {
      const description = draft.description.trim();
      await this.rpc('profiles.configure', { name: bot.name, description });
      if (look) {
        const meta = metaOfLook(look);
        if (Object.keys(meta).length > 0) await this.patchBotMeta(bot.name, meta);
        if ('image' in look) await this.storeAvatar(bot.name, look.image ?? null);
      }
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

  /** the picture lives in the profile's asset store, never in `ui_meta`; null clears it */
  private async storeAvatar(name: string, image: string | null) {
    await this.rpc('profiles.set_asset', image ? { name, asset: 'avatar', data: image } : { name, asset: 'avatar', clear: true });
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
  const lastUser = findLast(next.messages, (m) => m.role === 'user');
  const lastUserText = lastUser?.parts[0]?.kind === 'text' ? lastUser.parts[0].text : '';
  if (inflight?.user && inflight.user !== lastUserText) next = addUserMessage(next, inflight.user);
  next = applyEvent(next, { type: 'message.start', payload: {} });
  if (inflight?.assistant) next = applyEvent(next, { type: 'message.delta', payload: { text: inflight.assistant } });
  return next;
}
