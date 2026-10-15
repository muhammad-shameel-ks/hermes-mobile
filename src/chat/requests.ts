/**
 * The questions the gateway blocks a turn on: approvals, clarify and the sudo,
 * secret and vault prompts. Pure state and helpers, so the lifecycle can be
 * replayed in tests the way the socket delivers it. Ported from the desktop's
 * store/prompts.ts and store/clarify.ts, the clarify and approval components'
 * parsing, and `restorePendingClarifyToolCall` (lib/chat-messages/tool-parts.ts).
 *
 * The live socket objects that answer these never enter this state; the router
 * keeps them. What lives here is what the cards draw from.
 */

import { isRecord, parseObject, type Json } from './json.ts';
import type { Message, Part, ToolPart, Transcript } from './transcript.ts';

// ─── copy (desktop en.ts assistant.approval / prompts, en_clarify.ts) ────────

export const APPROVAL_COPY = {
  gatewayDisconnected:
    'Hermes is offline right now. The command is still waiting for your answer (until the approval timeout). Reconnect, then send it again.',
  sendFailed: 'Could not send your answer',
  timedOutSystemLine:
    'Approval timed out — the command was not run. Ask Hermes to try again, or raise the limit in Settings → Safety → Approval timeout.',
  openSafetySettings: 'Open Safety settings',
  run: 'Run',
  command: 'Command',
  commandDetails: 'Command details',
  moreOptions: 'More approval options',
  allowSession: 'Allow this session',
  alwaysAllowMenu: 'Always allow…',
  jumpToApproval: 'Approval needed',
  reject: 'Reject',
  alwaysTitle: 'Always allow this command?',
  alwaysDescription: (pattern: string) =>
    `This adds the “${pattern}” pattern to your permanent allowlist (~/.hermes/config.yaml). Hermes won’t ask again for commands like this — in this session or any future one.`,
  alwaysAllow: 'Always allow',
  cancel: 'Cancel',
} as const;

export const CLARIFY_COPY = {
  notReady: 'Clarify request is not ready yet',
  gatewayDisconnected: 'Hermes is offline right now. Reconnect, then send it again.',
  sendFailed: 'Could not send clarify response',
  loadingQuestion: 'Loading question…',
  other: 'Other (type your answer)',
  placeholder: 'Type your answer…',
  skip: 'Skip',
  skipped: 'Skipped',
  noAnswer: 'No answer',
  confirmAndContinueLabel: 'Confirm and continue',
  singleSelectHint: 'Pick one',
  multiSelectHint: 'Select all that apply',
  oneQuestion: '1 question',
  questionProgress: (answered: number, total: number) => `${answered} of ${total} answered`,
  notDelivered: "This question didn't reach the app, so it can't be answered here. Press Stop to end the turn, then reply in chat.",
} as const;

export const PROMPT_COPY = {
  gatewayDisconnected: 'Hermes is offline right now. Reconnect, then send it again.',
  sudoSendFailed: 'Could not send sudo password',
  secretSendFailed: 'Could not send secret',
  sudoTitle: 'Administrator password',
  sudoDesc: 'Review the command before entering your sudo password. Your password is sent to the agent running it and cached for this session.',
  sudoCommandUnavailable: 'This agent did not provide the command. Cancel if you cannot verify it in the conversation.',
  sudoPlaceholder: 'sudo password',
  secretTitle: 'Secret required',
  secretDesc: 'Hermes needs a credential to continue.',
  secretPlaceholder: 'secret value',
  vaultUnlockSendFailed: 'Could not send master password',
  vaultUnlockTitle: (name: string) => `Unlock ${name}`,
  vaultUnlockDesc: (name: string) =>
    `The agent wants to sign into a site with a login saved in ${name}. Enter your master password to unlock it for this session — it goes straight to ${name} on this machine and is never stored or shown to the agent.`,
  vaultUnlockPlaceholder: 'Master password',
  vaultUnlockKeepLocked: 'Keep locked',
  vaultUnlockConfirm: 'Unlock',
  vaultSaveSendFailed: 'Could not save the login',
  vaultSaveTitle: (site: string) => `Save your ${site} login?`,
  vaultSaveDesc: (origin: string) =>
    `Hermes reached a sign-in page at ${origin} and has no login for it. Enter it once here; it is encrypted on this machine and filled into the page without the model ever seeing the password.`,
  vaultSaveIdentifierLabel: 'Email or username',
  vaultSaveIdentifierPlaceholder: 'you@example.com',
  vaultSavePasswordPlaceholder: 'Password',
  vaultSaveFootnote: 'Manage saved logins in Settings → Passwords & Logins.',
  vaultSaveDecline: "Don't save",
  vaultSaveConfirm: 'Save & sign in',
  vaultCodeSendFailed: 'Could not send the code',
  vaultCodeTitle: (site: string) => `Verification code for ${site}`,
  vaultCodeDesc: (site: string) =>
    `${site} is asking for a one-time code (text message, email or authenticator app). Enter it here and Hermes types it into the page; the model never sees it.`,
  vaultCodeLabel: 'Code',
  vaultCodeFootnote: 'Tip: save the authenticator key with this login in Settings → Passwords & Logins and Hermes enters codes for you.',
  vaultCodeSkip: 'Skip',
  vaultCodeConfirm: 'Enter code',
  cancel: 'Cancel',
  send: 'Send',
} as const;

// ─── approvals ───────────────────────────────────────────────────────────────

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

/**
 * `requestId` is the approval queue entry's id (what `approval.pending` and
 * `approval.respond` key on); `serverRequestId` is the live `approval` server
 * request, present only while this client holds it open.
 */
export type ApprovalRequest = {
  requestId?: string;
  serverRequestId?: string;
  command: string;
  description: string;
  /** false only when the backend forbids a permanent allow */
  allowPermanent: boolean;
  choices?: string[];
  smartDenied: boolean;
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const isString = (value: unknown): value is string => typeof value === 'string';

/** from an `approval` server request's params, or one `approval.pending` entry (null fields read as absent) */
export function parseApproval(params: Record<string, unknown>, serverRequestId?: string): ApprovalRequest {
  return {
    allowPermanent: params.allow_permanent !== false,
    choices: Array.isArray(params.choices) ? params.choices.filter(isString) : undefined,
    command: str(params.command),
    description: str(params.description) || 'dangerous command',
    requestId: str(params.request_id) || undefined,
    serverRequestId,
    smartDenied: params.smart_denied === true,
  };
}

/** what the "more options" menu offers: the backend's own choices win, else smart-denied narrows to once/deny */
export function approvalOptions(request: ApprovalRequest): { session: boolean; always: boolean } {
  const choices = request.choices ?? (request.smartDenied ? ['once', 'deny'] : undefined);
  return { session: choices ? choices.includes('session') : true, always: choices ? choices.includes('always') : request.allowPermanent };
}

/** a plugin `approve` rule escalates with a synthetic `<tool> (plugin approval rule)` target */
const SYNTHETIC_COMMAND = /^<[^>]+> \(/;

/** the card's header and body: the command, or the description when the command is missing or synthetic */
export function approvalDetails(request: ApprovalRequest): { showsDescription: boolean; text: string } {
  const command = request.command.trim();
  const showsDescription = command.length === 0 || SYNTHETIC_COMMAND.test(command);
  return { showsDescription, text: showsDescription ? request.description.trim() : command };
}

// ─── clarify ─────────────────────────────────────────────────────────────────

export type ClarifyQuestion = { qid: string; question: string; choices: string[] | null; multiSelect: boolean };

export type ClarifyRequest = {
  requestId: string;
  /** local receipt time, epoch seconds: a resume snapshot only withdraws older requests */
  receivedAt: number;
  questions: ClarifyQuestion[];
  /** answers the server already holds (reconnect replay): qid → answer, null = skipped */
  lockedAnswers?: Record<string, string | null>;
  /** the transcript's clarify tool row this request answers */
  toolId?: string;
};

/** the backend tags the agent's recommended option by appending this to the first choice */
export const RECOMMENDED_LABEL = '(Recommended)';

export const bareChoice = (choice: string): string => (choice.endsWith(RECOMMENDED_LABEL) ? choice.slice(0, -RECOMMENDED_LABEL.length).trim() : choice);

/** per-choice cap, `tools/clarify_tool.py::MAX_CHOICE_CHARS` */
export const MAX_CHOICE_CHARS = 8000;

/** non-blank strings within the cap; nothing usable leaves the question open-ended */
export function normalizeChoices(choices: unknown): string[] {
  if (!Array.isArray(choices)) return [];
  return choices.filter((c): c is string => typeof c === 'string' && c.trim().length > 0 && bareChoice(c).length <= MAX_CHOICE_CHARS);
}

export function normalizeQuestions(questions: unknown): ClarifyQuestion[] {
  if (!Array.isArray(questions)) return [];
  const out: ClarifyQuestion[] = [];
  for (const entry of questions) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const qid = typeof row.qid === 'string' ? row.qid.trim() : '';
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    if (!qid || !question) continue;
    const choices = normalizeChoices(row.choices);
    out.push({ qid, question, choices: choices.length > 0 ? choices : null, multiSelect: row.multi_select === true && choices.length > 0 });
  }
  return out;
}

/** null when no question is usable: the caller answers `{}` instead of parking an unanswerable card */
export function parseClarify(params: Record<string, unknown>, requestId: string, now: number): ClarifyRequest | null {
  const questions = normalizeQuestions(params.questions);
  if (questions.length === 0) return null;
  const answers = typeof params.answers === 'object' && params.answers !== null ? (params.answers as Record<string, unknown>) : undefined;
  const lockedAnswers = answers
    ? Object.fromEntries(Object.entries(answers).filter((entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === 'string'))
    : undefined;
  return { requestId, receivedAt: now, questions, lockedAnswers };
}

export type ClarifyArgs = { questions?: Array<{ question: string; choices: string[] | null; multiSelect: boolean }> };

/** the questions as the tool call carried them: display only, with no qids to answer under */
export function readClarifyArgs(args: unknown): ClarifyArgs {
  const row = parseObject(args);
  if (!Array.isArray(row.questions)) return {};
  const questions = row.questions.flatMap((entry) => {
    const item = parseObject(entry);
    if (typeof item.question !== 'string' || !item.question) return [];
    const choices = normalizeChoices(item.choices);
    return [{ question: item.question, choices: choices.length > 0 ? choices : null, multiSelect: item.multi_select === true && choices.length > 0 }];
  });
  return questions.length > 0 ? { questions } : {};
}

export type ClarifyResponse = { question?: string; answer?: string | string[]; unanswered: boolean };

/** the clarify tool's JSON result: an `outcome` and one `responses` row per question */
export function readClarifyResult(result: unknown): { outcome?: string; responses: ClarifyResponse[] } {
  const row = parseObject(result);
  if (!Array.isArray(row.responses)) return { responses: [] };
  const outcome = typeof row.outcome === 'string' ? row.outcome : undefined;
  const responses = row.responses.map((entry): ClarifyResponse => {
    const item = parseObject(entry);
    const answer = item.user_response;
    return {
      answer: Array.isArray(answer) ? answer.map(String) : typeof answer === 'string' ? answer : undefined,
      question: typeof item.question === 'string' ? item.question : undefined,
      unanswered: item.status === 'unanswered',
    };
  });
  return { outcome, responses };
}

export type ClarifyResult = {
  outcome: 'cancelled' | 'submitted';
  responses: Array<{ question: string; status: 'answered' | 'unanswered' | 'skipped'; user_response: string | string[] | null }>;
};

/** a locked answer as the server's result carries it: a multi-select answer is a JSON list */
function lockedValue(question: ClarifyQuestion, raw: string): string | string[] {
  if (!question.multiSelect) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : raw;
  } catch {
    return raw;
  }
}

/** Skip: answers already locked server-side stand, the rest read as unanswered (desktop `skipClarify`) */
export function skippedResult(request: ClarifyRequest): ClarifyResult {
  return {
    outcome: 'cancelled',
    responses: request.questions.map((question) => {
      const locked = request.lockedAnswers?.[question.qid];
      return locked
        ? { question: question.question, status: 'answered', user_response: lockedValue(question, locked) }
        : { question: question.question, status: 'unanswered', user_response: null };
    }),
  };
}

export function submittedResult(request: ClarifyRequest, answers: Record<string, string | null | undefined>): ClarifyResult {
  return {
    outcome: 'submitted',
    responses: request.questions.map((question) => {
      const answer = answers[question.qid];
      return answer
        ? { question: question.question, status: 'answered', user_response: lockedValue(question, answer) }
        : { question: question.question, status: 'skipped', user_response: null };
    }),
  };
}

/** a withdrawn card, settled from the tool call's own questions (desktop `skippedClarifyResult`) */
export function skippedFromArgs(args: unknown): ClarifyResult {
  const questions = readClarifyArgs(args).questions ?? [];
  return { outcome: 'cancelled', responses: questions.map((q) => ({ question: q.question, status: 'unanswered', user_response: null })) };
}

// ─── staging answers on the live card ────────────────────────────────────────

/** one question's picks and free text, held locally until the single confirm */
export type Stage = { choices: string[]; draft: string };

export const emptyStage: Stage = { choices: [], draft: '' };

/** the answer to send, or null while the question is unanswered */
export function stagedAnswer(question: ClarifyQuestion, stage: Stage = emptyStage): string | null {
  const draft = stage.draft.trim();
  if (question.multiSelect) {
    // the typed text is an additional answer, not a replacement for the staged choices
    const combined = [...stage.choices.map(bareChoice), ...(draft ? [draft] : [])];
    return combined.length > 0 ? JSON.stringify(combined) : null;
  }
  if (stage.choices.length > 0) return bareChoice(stage.choices[0]);
  return draft ? draft : null;
}

export function toggleChoice(question: ClarifyQuestion, stage: Stage | undefined, choice: string): Stage {
  const current = stage ?? emptyStage;
  const choices = question.multiSelect
    ? current.choices.includes(choice)
      ? current.choices.filter((value) => value !== choice)
      : [...current.choices, choice]
    : [choice];
  // multi-select keeps the typed text beside the toggled choices; single-select stays exclusive
  return { choices, draft: question.multiSelect ? current.draft : '' };
}

export function setDraft(question: ClarifyQuestion, stage: Stage | undefined, draft: string): Stage {
  return { choices: question.multiSelect ? (stage ?? emptyStage).choices : [], draft };
}

/**
 * Stage the answers a reconnect replay locked. A newly locked answer replaces
 * what the card staged, so Confirm never re-sends an older pick; one seen before
 * is left alone, so a later edit on the card stands.
 */
export function stageLocked(
  questions: readonly ClarifyQuestion[],
  locked: Record<string, string | null>,
  seen: Record<string, string | null>,
  staged: Record<string, Stage>,
): Record<string, Stage> {
  const next = { ...staged };
  for (const question of questions) {
    const answer = locked[question.qid];
    if (answer === undefined || answer === null || seen[question.qid] === answer) continue;
    const options = question.choices ?? [];
    let replayed = [answer];
    if (question.multiSelect) {
      try {
        const parsed: unknown = JSON.parse(answer);
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) replayed = parsed;
      } catch {
        // an older, non-JSON reply stays a one-value replay
      }
    }
    // words that name no choice (typed in the composer) go to the free-text field as words
    next[question.qid] = {
      choices: options.filter((choice) => replayed.includes(bareChoice(choice))),
      draft: replayed.filter((value) => !options.some((choice) => bareChoice(choice) === value)).join(', '),
    };
  }
  return next;
}

/** the choice typed text names (any case), else the words themselves */
export function typedAnswer(question: ClarifyQuestion, text: string): string {
  const typed = text.toLowerCase();
  const answer = question.choices?.map(bareChoice).find((choice) => choice.toLowerCase() === typed) ?? text;
  return question.multiSelect ? JSON.stringify([answer]) : answer;
}

// ─── prompts: sudo, secret and the vault family ──────────────────────────────

export type PromptRequest =
  | { kind: 'sudo'; requestId: string; command: string }
  | { kind: 'secret'; requestId: string; envVar: string; prompt: string }
  | { kind: 'vault-unlock'; requestId: string; backend: string; displayName: string }
  | { kind: 'vault-save'; requestId: string; origin: string; site: string }
  | { kind: 'vault-code'; requestId: string; site: string; hint: string };

export type PromptKind = PromptRequest['kind'];

/** the order a session's open prompts take the sheet in; a turn blocks on one at a time */
export const PROMPT_ORDER: readonly PromptKind[] = ['sudo', 'secret', 'vault-unlock', 'vault-save', 'vault-code'];

/** the server-request methods that raise a prompt, and the kind each becomes */
export const PROMPT_METHODS: Record<string, PromptKind> = {
  sudo: 'sudo',
  secret: 'secret',
  'vault.unlock_prompt': 'vault-unlock',
  'vault.save_login': 'vault-save',
  'vault.code': 'vault-code',
};

export function parsePrompt(method: string, requestId: string, params: Record<string, unknown>): PromptRequest | null {
  switch (PROMPT_METHODS[method]) {
    case 'sudo':
      return { kind: 'sudo', requestId, command: str(params.command) };
    case 'secret':
      return { kind: 'secret', requestId, envVar: str(params.env_var), prompt: str(params.prompt) };
    case 'vault-unlock': {
      const backend = str(params.backend);
      return { kind: 'vault-unlock', requestId, backend, displayName: str(params.display_name) || backend };
    }
    case 'vault-save': {
      const origin = str(params.origin);
      return { kind: 'vault-save', requestId, origin, site: str(params.site) || origin };
    }
    case 'vault-code':
      return { kind: 'vault-code', requestId, site: str(params.site), hint: str(params.hint) };
    default:
      return null;
  }
}

/** the sheet's cancel answer: an empty value is a refusal on every prompt, so silence is never consent */
export const PROMPT_REFUSAL = '';

/** a second-factor code is sent without the spaces and dashes it was typed with */
export const cleanVaultCode = (code: string): string => code.replace(/[\s-]/g, '');

// ─── one session's open requests ─────────────────────────────────────────────

export type Requests = {
  /** the approval queue, oldest first */
  approvals: ApprovalRequest[];
  /** how many approvals the current stack has held: the "n / total" counter */
  approvalTotal: number;
  clarify: ClarifyRequest | null;
  prompts: Partial<Record<PromptKind, PromptRequest>>;
  /** clarify results the phone knows for rows it answered, by tool row id, until the tool's own result lands */
  answered: Record<string, ClarifyResult>;
};

export const emptyRequests = (): Requests => ({ approvals: [], approvalTotal: 0, clarify: null, prompts: {}, answered: {} });

/** an approval from a live request or a replay; a replay never clobbers the live request carrying the same queue id */
export function receiveApproval(state: Requests, request: ApprovalRequest): Requests {
  const index = state.approvals.findIndex((item) => item.requestId === request.requestId);
  const current = state.approvals[index];
  if (current?.requestId && current.serverRequestId && !request.serverRequestId) return state;
  if (index < 0) return { ...state, approvals: [...state.approvals, request], approvalTotal: state.approvalTotal + 1 };
  const approvals = [...state.approvals];
  approvals[index] = request;
  return { ...state, approvals };
}

/** one approval by queue id (a mismatch is a no-op, so a stale answer never wipes a newer prompt); no id clears the queue */
export function clearApproval(state: Requests, requestId?: string): Requests {
  const approvals = requestId ? state.approvals.filter((item) => item.requestId !== requestId) : [];
  if (approvals.length === state.approvals.length) return state;
  return { ...state, approvals, approvalTotal: approvals.length ? state.approvalTotal : 0 };
}

export const approvalByServerId = (state: Requests, serverRequestId: string): ApprovalRequest | undefined =>
  state.approvals.find((item) => item.serverRequestId === serverRequestId);

/** make the queue match `approval.pending`: drop what the server no longer holds, take what it does */
export function reconcileApprovals(state: Requests, pending: readonly ApprovalRequest[]): Requests {
  const ids = new Set(pending.map((item) => item.requestId));
  let next = state;
  for (const item of state.approvals) if (item.requestId && !ids.has(item.requestId)) next = clearApproval(next, item.requestId);
  for (const item of pending) if (item.requestId) next = receiveApproval(next, item);
  return next;
}

export const setClarify = (state: Requests, clarify: ClarifyRequest): Requests => ({ ...state, clarify });

export function clearClarify(state: Requests, requestId?: string): Requests {
  if (!state.clarify || (requestId && state.clarify.requestId !== requestId)) return state;
  return { ...state, clarify: null };
}

export function lockClarify(state: Requests, requestId: string, locked: Record<string, string | null>): Requests {
  if (state.clarify?.requestId !== requestId) return state;
  return { ...state, clarify: { ...state.clarify, lockedAnswers: locked } };
}

export const rememberAnswered = (state: Requests, toolId: string, result: ClarifyResult): Requests => ({
  ...state,
  answered: { ...state.answered, [toolId]: result },
});

export function forgetAnswered(state: Requests, toolId: string): Requests {
  if (!(toolId in state.answered)) return state;
  const answered = { ...state.answered };
  delete answered[toolId];
  return { ...state, answered };
}

export function setPrompt(state: Requests, prompt: PromptRequest): Requests {
  return { ...state, prompts: { ...state.prompts, [prompt.kind]: prompt } };
}

export function clearPrompt(state: Requests, requestId: string): Requests {
  const kind = PROMPT_ORDER.find((k) => state.prompts[k]?.requestId === requestId);
  if (!kind) return state;
  const prompts = { ...state.prompts };
  delete prompts[kind];
  return { ...state, prompts };
}

export const activePrompt = (state: Requests): PromptRequest | null => {
  for (const kind of PROMPT_ORDER) {
    const prompt = state.prompts[kind];
    if (prompt) return prompt;
  }
  return null;
};

/** a turn ended: nothing it was blocked on can still be open, except a clarify whose request the server still holds */
export function clearTurn(state: Requests, holdsOpen: (requestId: string) => boolean): Requests {
  const clarify = state.clarify && holdsOpen(state.clarify.requestId) ? state.clarify : null;
  if (!state.approvals.length && !Object.keys(state.prompts).length && clarify === state.clarify) return state;
  return { ...state, approvals: [], approvalTotal: 0, prompts: {}, clarify };
}

/** an approval or a prompt: nothing typed into the composer can answer these */
export const hasBlockingPrompt = (state: Requests): boolean => state.approvals.length > 0 || activePrompt(state) !== null;

/** the turn is parked on the user, not working; also the drawer's needs-input signal */
export const awaitingInput = (state: Requests): boolean => hasBlockingPrompt(state) || state.clarify !== null;

/** terminal and code calls render as activity, not as file diffs or other deliverable cards */
const APPROVAL_ACTIVITY_TOOLS = new Set(['terminal', 'execute_code']);

/** the current turn's terminal and code calls: the run the approval stack summarises above its card */
export function approvalActivity(messages: readonly Message[]): ToolPart[] {
  let start = messages.length - 1;
  while (start >= 0 && messages[start].role !== 'user') start -= 1;
  return messages
    .slice(start + 1)
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts.filter((part): part is ToolPart => part.kind === 'tool' && APPROVAL_ACTIVITY_TOOLS.has(part.name)));
}

// ─── the clarify tool row in the transcript ──────────────────────────────────

const toolArgs = (request: ClarifyRequest) => ({
  questions: request.questions.map((q) => ({ question: q.question, ...(q.choices ? { choices: q.choices } : {}), ...(q.multiSelect ? { multi_select: true } : {}) })),
});

const isOpenClarify = (part: Part): part is ToolPart => part.kind === 'tool' && part.name === 'clarify' && part.result === undefined;

/**
 * Arm the transcript's clarify row for a request. A resume may already have
 * hydrated the row (a provider can persist it with or without its text), and the
 * request id is not the provider's tool-call id, so the row is matched by its
 * question text, else as the one clarify still running. With no row at all the
 * call is added to the trailing assistant message, or opens one.
 */
export function armClarify(transcript: Transcript, request: ClarifyRequest): { transcript: Transcript; toolId: string } {
  const texts = new Set(request.questions.map((q) => q.question));
  let sole: { message: number; part: number } | null = null;
  let running = 0;
  let found: { message: number; part: number } | null = null;

  scan: for (let m = transcript.messages.length - 1; m >= 0; m -= 1) {
    const parts = transcript.messages[m].parts;
    for (let p = parts.length - 1; p >= 0; p -= 1) {
      const part = parts[p];
      if (!isOpenClarify(part)) continue;
      if (part.id === request.requestId || (readClarifyArgs(part.args).questions ?? []).some((q) => texts.has(q.question))) {
        found = { message: m, part: p };
        break scan;
      }
      if (part.status === 'running') {
        running += 1;
        sole = { message: m, part: p };
      }
    }
  }

  // a sealed call (the turn stopped on it unanswered) is history, so it is only re-armed by a real match
  const at = found ?? (running === 1 ? sole : null);
  if (at) {
    const message = transcript.messages[at.message];
    const part = message.parts[at.part] as ToolPart;
    const parts = [...message.parts];
    parts[at.part] = { ...part, status: 'running', args: toolArgs(request) };
    const messages = [...transcript.messages];
    messages[at.message] = { ...message, parts };
    return { transcript: { ...transcript, messages }, toolId: part.id };
  }

  const tool: ToolPart = { kind: 'tool', id: request.requestId, name: 'clarify', context: '', args: toolArgs(request), status: 'running' };
  const tail = transcript.messages[transcript.messages.length - 1];
  if (tail?.role === 'assistant') {
    const messages = [...transcript.messages];
    messages[messages.length - 1] = { ...tail, parts: [...tail.parts, tool] };
    return { transcript: { ...transcript, messages, breakText: true }, toolId: tool.id };
  }
  const message = { id: `clarify-message-${request.requestId}`, role: 'assistant' as const, parts: [tool], status: 'complete' as const, timestamp: Math.floor(Date.now() / 1000) };
  return { transcript: { ...transcript, messages: [...transcript.messages, message] }, toolId: tool.id };
}

/** close a clarify row whose request was withdrawn, with the skipped result the desktop writes (`settlePendingClarifyToolCall`) */
export function settleClarifyTool(transcript: Transcript, toolId: string): Transcript {
  let changed = false;
  const messages = transcript.messages.map((message) => {
    const at = message.parts.findIndex((part) => part.kind === 'tool' && part.id === toolId && part.name === 'clarify' && part.result === undefined);
    if (at < 0) return message;
    changed = true;
    const part = message.parts[at] as ToolPart;
    const parts = [...message.parts];
    parts[at] = { ...part, status: 'done', result: JSON.stringify(skippedFromArgs(part.args)) };
    return { ...message, parts };
  });
  return changed ? { ...transcript, messages } : transcript;
}
