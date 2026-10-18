/**
 * Where the gateway's questions meet the phone: server requests (approval,
 * clarify, sudo, secret, the vault family) parked into each session's
 * `Requests`, the events that withdraw them, and the answers that go back.
 * Ported from the desktop's gateway-event/server-requests.ts and input-requests.ts
 * and its prompts/clarify stores.
 *
 * The live `ServerRequest` objects stay here, never in state. A request that
 * names a runtime the phone has not bound yet (a resume re-delivers open
 * requests before its result binds the runtime) is held and adopted on bind.
 * The vendored channel already sends `client.capabilities { server_requests }`
 * once per socket after `gateway.ready` and re-delivers `open_requests` on
 * every resume, so a reconnect brings pending questions back by itself.
 *
 * A request is answered in the app: its own chat's card, or the attention
 * banner over another chat (src/attention). While a turn streams or waits on
 * the reader, Android holds the socket open in the background so a request
 * still arrives and raises a system notification; otherwise the socket closes
 * with the app, the backend keeps the question until its own deadline
 * (`approvals.timeout`, 300s by default), and a resume re-surfaces whatever it
 * still holds. What it dropped meanwhile comes down: a clarify the resume
 * omits, an approval `approval.pending` no longer lists, a `request.cancel`
 * replayed from the event ring (which also leaves the timeout line in the
 * transcript).
 */

import type { RpcMethods, SessionResumeResult } from '../../vendor/hermes-shared/src/gateway-contract.generated.ts';
import { JSON_RPC_SESSION_NOT_SHOWN, type ServerRequest } from '../../vendor/hermes-shared/src/json-rpc-channel.ts';
import { APPROVAL_RESPOND_TIMEOUT_MS, type GatewayEvent } from '../../vendor/hermes-shared/src/json-rpc-gateway.ts';
import { errorText } from '../gateway/http.ts';
import {
  APPROVAL_COPY,
  CLARIFY_COPY,
  PROMPT_COPY,
  PROMPT_METHODS,
  PROMPT_REFUSAL,
  approvalByServerId,
  armClarify,
  clearApproval,
  clearClarify,
  clearPrompt,
  clearTurn,
  emptyRequests,
  forgetAnswered,
  lockClarify,
  parseApproval,
  parseClarify,
  parsePrompt,
  receiveApproval,
  reconcileApprovals,
  rememberAnswered,
  setClarify,
  setPrompt,
  settleClarifyTool,
  skippedResult,
  submittedResult,
  typedAnswer,
  type ApprovalChoice,
  type ClarifyRequest,
  type PromptRequest,
  type Requests,
} from './requests.ts';
import { addSystemNotice, type Transcript } from './transcript.ts';

type Rpc = <M extends keyof RpcMethods>(method: M, params: RpcMethods[M]['params'], timeoutMs?: number) => Promise<RpcMethods[M]['result']>;

export type RouterHost = {
  /** the chat a runtime id is bound to */
  keyFor(runtimeId: string): string | undefined;
  keys(): string[];
  runtimeId(key: string): string | null;
  profile(key: string): string;
  requests(key: string): Requests | undefined;
  setRequests(key: string, update: (requests: Requests) => Requests): void;
  updateTranscript(key: string, update: (transcript: Transcript) => Transcript): void;
  rpc: Rpc;
  online(): boolean;
  notify(text: string): void;
};

/** how long a request for a runtime the phone has not bound waits for the bind before it is refused */
const HELD_GRACE_MS = 10_000;
/** `approval.respond` takes the backend's whole approval window plus the write draining, as the desktop gives it */
const APPROVAL_RPC_TIMEOUT_MS = APPROVAL_RESPOND_TIMEOUT_MS + 30_000;

const REFUSED = 'Not shown on the phone';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const isTimeout = (error: unknown) => error instanceof Error && /request timed out/i.test(error.message);

export class RequestRouter {
  private readonly live = new Map<string, ServerRequest>();
  private readonly held = new Map<string, Array<{ request: ServerRequest; timer: ReturnType<typeof setTimeout> }>>();
  /** a request's typed answers lock one at a time, so a later one never lands without the earlier */
  private readonly chains = new Map<string, Promise<boolean>>();

  private readonly host: RouterHost;

  constructor(host: RouterHost) {
    this.host = host;
  }

  dispose() {
    for (const list of this.held.values()) for (const { timer } of list) clearTimeout(timer);
    this.held.clear();
  }

  // ─── intake ────────────────────────────────────────────────────────────────

  /** false for methods this router does not own, so another handler can take them */
  handle(request: ServerRequest): boolean {
    if (request.method !== 'approval' && request.method !== 'clarify' && !(request.method in PROMPT_METHODS)) return false;
    const runtimeId = str(request.params.session_id);
    const key = runtimeId ? this.host.keyFor(runtimeId) : undefined;
    if (key) this.park(key, request);
    else this.hold(runtimeId, request);
    return true;
  }

  /** a runtime just bound to its chat: take the requests that were waiting for it */
  adopt(runtimeId: string) {
    const waiting = this.held.get(runtimeId);
    if (!waiting) return;
    this.held.delete(runtimeId);
    const key = this.host.keyFor(runtimeId);
    for (const { request, timer } of waiting) {
      clearTimeout(timer);
      if (key) this.park(key, request);
      else this.refuse(request);
    }
  }

  private hold(runtimeId: string, request: ServerRequest) {
    if (!runtimeId) {
      this.refuse(request);
      return;
    }
    const timer = setTimeout(() => {
      const list = (this.held.get(runtimeId) ?? []).filter((entry) => entry.request !== request);
      if (list.length) this.held.set(runtimeId, list);
      else this.held.delete(runtimeId);
      this.refuse(request);
    }, HELD_GRACE_MS);
    this.held.set(runtimeId, [...(this.held.get(runtimeId) ?? []), { request, timer }]);
  }

  /** `decline` lets another client answer where the backend counts declines; the error settles it where it does not */
  private refuse(request: ServerRequest) {
    request.decline?.(REFUSED);
    request.fail(JSON_RPC_SESSION_NOT_SHOWN, REFUSED);
  }

  private park(key: string, request: ServerRequest) {
    const { host } = this;
    if (request.method === 'approval') {
      this.live.set(request.id, request);
      host.setRequests(key, (state) => receiveApproval(state, parseApproval(request.params, request.id)));
      return;
    }

    if (request.method === 'clarify') {
      const parsed = parseClarify(request.params, request.id, Date.now() / 1000);
      if (!parsed) {
        request.respond({});
        return;
      }
      this.live.set(request.id, request);
      let toolId: string | undefined;
      host.updateTranscript(key, (transcript) => {
        const armed = armClarify(transcript, parsed);
        toolId = armed.toolId;
        return armed.transcript;
      });
      host.setRequests(key, (state) => setClarify(state, { ...parsed, toolId }));
      return;
    }

    const prompt = parsePrompt(request.method, request.id, request.params);
    if (!prompt) {
      request.respond({});
      return;
    }
    this.live.set(request.id, request);
    host.setRequests(key, (state) => setPrompt(state, prompt));
  }

  // ─── events that withdraw requests ─────────────────────────────────────────

  /** `key` is the chat the event's session is bound to, when it names one */
  onEvent(key: string | undefined, event: GatewayEvent) {
    const type: string = event.type;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    // an id-keyed event with no session of its own is looked for in every chat
    const targets = () => (key ? [key] : this.host.keys());

    switch (type) {
      case 'request.cancel': {
        const id = str(payload.id);
        if (!id) return;
        this.live.delete(id);
        for (const target of targets()) this.withdraw(target, id, str(payload.reason));
        return;
      }
      case 'approval.settled':
      case 'clarify.settled': {
        // another client answered it (or the turn ended): only the parked card comes down
        const id = str(payload.prompt_id);
        if (!id) return;
        this.live.delete(id);
        for (const target of targets()) {
          this.host.setRequests(target, (state) => {
            if (type === 'clarify.settled') return clearClarify(state, id);
            const approval = approvalByServerId(state, id);
            return approval ? clearApproval(state, approval.requestId) : state;
          });
        }
        return;
      }
      case 'approval.cancelled': {
        // the backend dropped the session's pending approvals; the deny-resolve is otherwise silent
        if (!key) return;
        const ids = Array.isArray(payload.request_ids) ? payload.request_ids.map(String).filter(Boolean) : [];
        this.host.setRequests(key, (state) => {
          if (ids.length === 0) return { ...state, approvals: [], approvalTotal: 0, prompts: {} };
          return ids.reduce((next, id) => clearApproval(next, id), state);
        });
        return;
      }
      case 'message.complete':
      case 'error':
        if (key) this.host.setRequests(key, (state) => clearTurn(state, (id) => this.live.has(id)));
        return;
      case 'tool.complete':
        // a clarify's completion is the question resolving, whoever answered it
        if (key && str(payload.name) === 'clarify') this.host.setRequests(key, (state) => clearClarify(state));
        return;
      case 'session.reclaimed':
        if (key) this.host.setRequests(key, () => emptyRequests());
        return;
      default:
    }
  }

  /** `request.cancel`: take down whichever card carries `id` */
  private withdraw(key: string, id: string, reason: string) {
    const state = this.host.requests(key);
    if (!state) return;

    if (state.clarify?.requestId === id) {
      const { toolId } = state.clarify;
      this.host.setRequests(key, (current) => clearClarify(current, id));
      if (toolId) this.host.updateTranscript(key, (transcript) => settleClarifyTool(transcript, toolId));
      return;
    }

    const approval = approvalByServerId(state, id);
    if (approval) {
      this.host.setRequests(key, (current) => clearApproval(current, approval.requestId));
      // the card vanishing is all the reader would see; say what happened
      if (reason === 'timeout') this.host.updateTranscript(key, (transcript) => addSystemNotice(transcript, APPROVAL_COPY.timedOutSystemLine));
      return;
    }

    this.host.setRequests(key, (current) => clearPrompt(current, id));
  }

  // ─── resume ────────────────────────────────────────────────────────────────

  /** the transcript was replaced (history landed): the open clarify needs its row again */
  rearm(key: string) {
    const clarify = this.host.requests(key)?.clarify;
    if (!clarify) return;
    let toolId: string | undefined;
    this.host.updateTranscript(key, (transcript) => {
      const armed = armClarify(transcript, clarify);
      toolId = armed.toolId;
      return armed.transcript;
    });
    this.host.setRequests(key, (state) => (state.clarify?.requestId === clarify.requestId ? setClarify(state, { ...state.clarify, toolId }) : state));
  }

  /**
   * A resume answered. Its `open_requests` were re-delivered before this runs, so
   * a clarify the snapshot omits is one that ended while the phone was away - but
   * only a request received before the resume began, never one that arrived since.
   * Approvals are reconciled against the server's own queue.
   */
  onResumed(key: string, result: SessionResumeResult, startedAt: number) {
    const open = result.open_requests;
    const state = this.host.requests(key);
    const clarify = state?.clarify;
    if (Array.isArray(open) && clarify && clarify.receivedAt < startedAt && !open.some((entry) => entry.method === 'clarify')) {
      this.live.delete(clarify.requestId);
      this.host.setRequests(key, (current) => clearClarify(current, clarify.requestId));
      if (clarify.toolId) {
        const { toolId } = clarify;
        this.host.updateTranscript(key, (transcript) => settleClarifyTool(transcript, toolId));
      }
    }

    const pending = result.pending_approval;
    if (pending) this.host.setRequests(key, (current) => receiveApproval(current, parseApproval(pending as Record<string, unknown>)));
    if (pending || state?.approvals.length) void this.replayApprovals(key);
  }

  /** `approval.pending`: what the server still holds for the session, so a card it dropped (a timeout while away) comes down */
  async replayApprovals(key: string) {
    const runtimeId = this.host.runtimeId(key);
    if (!runtimeId || !this.host.online()) return;
    const before = this.host.requests(key)?.approvals;
    const profile = this.host.profile(key);
    try {
      const result = await this.host.rpc('approval.pending', { session_id: runtimeId, profile });
      if (!Array.isArray(result?.approvals)) return;
      // a card answered or withdrawn while this was in flight outranks the snapshot
      if (this.host.requests(key)?.approvals !== before) return;
      const pending = result.approvals.filter((item) => typeof item.request_id === 'string').map((item) => parseApproval(item));
      this.host.setRequests(key, (state) => reconcileApprovals(state, pending));
      for (const item of pending) {
        void this.host.rpc('approval.received', { session_id: runtimeId, profile, request_id: item.requestId! }).catch(() => undefined);
      }
    } catch {
      // the next resume or answer asks again
    }
  }

  /** ask the server to re-deliver the session's open requests; true when a clarify is parked afterwards */
  async redeliver(key: string): Promise<boolean> {
    const runtimeId = this.host.runtimeId(key);
    if (runtimeId && this.host.online()) {
      try {
        // no events come back from the end of the ring, but the channel hands `open_requests` to the handlers first
        await this.host.rpc('session.events.since', { session_id: runtimeId, profile: this.host.profile(key), last_seen: Number.MAX_SAFE_INTEGER });
      } catch {
        // an older backend or a dropped socket: the notice is still right
      }
    }
    return this.host.requests(key)?.clarify != null;
  }

  // ─── answers ───────────────────────────────────────────────────────────────

  /** true once the backend has the decision (or the card was already gone) */
  async answerApproval(key: string, requestId: string | undefined, choice: ApprovalChoice): Promise<boolean> {
    const approval = this.host.requests(key)?.approvals.find((item) => item.requestId === requestId);
    if (!approval) return true;
    if (!this.host.online()) {
      this.host.notify(APPROVAL_COPY.gatewayDisconnected);
      return false;
    }
    try {
      await this.sendApproval(key, approval.requestId, approval.serverRequestId, choice);
    } catch (error) {
      this.host.notify(`${APPROVAL_COPY.sendFailed}. ${errorText(error)}`);
      return false;
    }
    this.host.setRequests(key, (state) => clearApproval(state, approval.requestId));
    void this.replayApprovals(key);
    return true;
  }

  /**
   * The live request while it is open (the response goes back over the socket it
   * arrived on), else the queue-level RPC for a prompt restored from
   * `approval.pending`. `resolve` pops the queue entry before committing, so the
   * one retry after a deadline failure is harmless.
   */
  private async sendApproval(key: string, requestId: string | undefined, serverRequestId: string | undefined, choice: ApprovalChoice) {
    const live = serverRequestId ? this.live.get(serverRequestId) : undefined;
    if (live && serverRequestId) {
      this.live.delete(serverRequestId);
      live.respond({ choice });
      return;
    }
    const runtimeId = this.host.runtimeId(key);
    if (!runtimeId) throw new Error('The session is not attached to the gateway.');
    const params = { all: false, choice, ...(requestId ? { request_id: requestId } : {}), session_id: runtimeId, profile: this.host.profile(key) };
    try {
      await this.host.rpc('approval.respond', params, APPROVAL_RPC_TIMEOUT_MS);
    } catch (error) {
      if (!isTimeout(error)) throw error;
      await this.host.rpc('approval.respond', params, APPROVAL_RPC_TIMEOUT_MS);
    }
  }

  /** Skip: the card clears, the request is answered with no pick, and the row settles as skipped */
  skipClarify(key: string) {
    const clarify = this.host.requests(key)?.clarify;
    if (!clarify) return;
    const result = skippedResult(clarify);
    this.host.setRequests(key, (state) => {
      const cleared = clearClarify(state, clarify.requestId);
      return clarify.toolId ? rememberAnswered(cleared, clarify.toolId, result) : cleared;
    });
    this.live.get(clarify.requestId)?.respond({});
    this.live.delete(clarify.requestId);
  }

  /**
   * Confirm: every question's lock goes back-to-back and in order. The last lock
   * resolves the blocked request server-side, so no response frame is owed.
   */
  async confirmClarify(key: string, answers: ReadonlyArray<{ qid: string; answer: string | null }>): Promise<boolean> {
    const clarify = this.host.requests(key)?.clarify;
    if (!clarify) {
      this.host.notify(CLARIFY_COPY.notReady);
      return false;
    }
    if (!this.host.online()) {
      this.host.notify(CLARIFY_COPY.gatewayDisconnected);
      return false;
    }
    try {
      for (const { qid, answer } of answers) {
        await this.host.rpc('clarify.lock', { request_id: clarify.requestId, question_id: qid, answer, profile: this.host.profile(key) });
      }
    } catch (error) {
      this.host.notify(`${CLARIFY_COPY.sendFailed}. ${errorText(error)}`);
      return false;
    }
    this.live.delete(clarify.requestId);
    const result = submittedResult(clarify, Object.fromEntries(answers.map(({ qid, answer }) => [qid, answer])));
    this.host.setRequests(key, (state) => {
      const cleared = clearClarify(state, clarify.requestId);
      return clarify.toolId ? rememberAnswered(cleared, clarify.toolId, result) : cleared;
    });
    return true;
  }

  /** composer text while a clarify waits answers its first open question; false leaves it to be sent as a message */
  answerText(key: string, text: string): boolean {
    const clarify = this.host.requests(key)?.clarify;
    if (!clarify || !this.host.online()) return false;
    const question = clarify.questions.find((entry) => clarify.lockedAnswers?.[entry.qid] === undefined);
    if (!question) return false;

    const answer = typedAnswer(question, text);
    const locked = { ...clarify.lockedAnswers, [question.qid]: answer };
    const last = clarify.questions.every((entry) => locked[entry.qid] !== undefined);

    // the state moves before the RPC returns, so a second send locks the next question, not this one again
    if (last) {
      const result = submittedResult(clarify, locked);
      this.host.setRequests(key, (state) => {
        const cleared = clearClarify(state, clarify.requestId);
        return clarify.toolId ? rememberAnswered(cleared, clarify.toolId, result) : cleared;
      });
    } else {
      this.host.setRequests(key, (state) => lockClarify(state, clarify.requestId, locked));
    }

    const previous = this.chains.get(clarify.requestId) ?? Promise.resolve(true);
    const sent = previous.then(async (earlierSaved) => {
      if (earlierSaved) {
        try {
          const reply = await this.host.rpc('clarify.lock', {
            request_id: clarify.requestId,
            question_id: question.qid,
            answer,
            profile: this.host.profile(key),
          });
          // the last lock resolved the batch server-side, so no response frame is owed
          if (reply.status !== 'expired' && last) this.live.delete(clarify.requestId);
          return true;
        } catch (error) {
          this.host.notify(`${CLARIFY_COPY.sendFailed}. ${errorText(error)}`);
        }
      }
      this.rollBack(key, clarify, locked, question.qid, answer);
      return false;
    });
    this.chains.set(clarify.requestId, sent);
    void sent.then(() => {
      if (this.chains.get(clarify.requestId) === sent) this.chains.delete(clarify.requestId);
    });
    return true;
  }

  /** undo one failed lock without touching answers locked after it */
  private rollBack(key: string, clarify: ClarifyRequest, locked: Record<string, string | null>, qid: string, answer: string) {
    this.host.setRequests(key, (state) => {
      // the last answer cleared the card: bring it back while the server still waits
      const current = state.clarify?.requestId === clarify.requestId ? state.clarify : !state.clarify && this.live.has(clarify.requestId) ? { ...clarify, lockedAnswers: locked } : null;
      if (!current || current.lockedAnswers?.[qid] !== answer) return state;
      const kept = { ...current.lockedAnswers };
      delete kept[qid];
      const restored = setClarify(state, { ...current, lockedAnswers: kept });
      return current.toolId ? forgetAnswered(restored, current.toolId) : restored;
    });
  }

  /** an error to show in the sheet, or null once the answer is on its way */
  answerPrompt(key: string, prompt: PromptRequest, value: string): string | null {
    // refusing needs no socket: the backend withdraws a request whose client is gone
    if (!this.host.online() && value !== PROMPT_REFUSAL) return PROMPT_COPY.gatewayDisconnected;
    const live = this.live.get(prompt.requestId);
    this.live.delete(prompt.requestId);
    live?.respond({ value });
    this.host.setRequests(key, (state) => clearPrompt(state, prompt.requestId));
    return null;
  }
}
