import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activePrompt,
  approvalActivity,
  approvalByServerId,
  approvalDetails,
  approvalOptions,
  armClarify,
  awaitingInput,
  bareChoice,
  clearApproval,
  clearClarify,
  clearPrompt,
  clearTurn,
  cleanVaultCode,
  emptyRequests,
  hasBlockingPrompt,
  normalizeChoices,
  normalizeQuestions,
  parseApproval,
  parseClarify,
  parsePrompt,
  readClarifyArgs,
  readClarifyResult,
  receiveApproval,
  reconcileApprovals,
  setClarify,
  setDraft,
  setPrompt,
  settleClarifyTool,
  skippedResult,
  stageLocked,
  stagedAnswer,
  submittedResult,
  toggleChoice,
  typedAnswer,
  type ClarifyQuestion,
} from '../src/chat/requests.ts';
import { emptyTranscript, type Message, type ToolPart, type Transcript } from '../src/chat/transcript.ts';

const approval = (requestId: string, extra: Record<string, unknown> = {}) => parseApproval({ request_id: requestId, command: `cmd ${requestId}`, ...extra }, `srv-${requestId}`);

test('an approval reads its params the way the desktop does', () => {
  assert.deepEqual(parseApproval({ command: 'rm -rf build', request_id: 'a1', allow_permanent: false, choices: ['once', 'deny', 7], smart_denied: true }, 'srv-1'), {
    allowPermanent: false,
    choices: ['once', 'deny'],
    command: 'rm -rf build',
    description: 'dangerous command',
    requestId: 'a1',
    serverRequestId: 'srv-1',
    smartDenied: true,
  });
  // a queue entry from approval.pending carries nulls for what it lacks
  const pending = parseApproval({ request_id: 'a2', command: null, description: null, allow_permanent: null, choices: null });
  assert.equal(pending.command, '');
  assert.equal(pending.description, 'dangerous command');
  assert.equal(pending.allowPermanent, true);
  assert.equal(pending.choices, undefined);
});

test('the menu offers what the backend allows', () => {
  assert.deepEqual(approvalOptions(approval('a')), { session: true, always: true });
  assert.deepEqual(approvalOptions(approval('a', { allow_permanent: false })), { session: true, always: false });
  assert.deepEqual(approvalOptions(approval('a', { smart_denied: true })), { session: false, always: false });
  assert.deepEqual(approvalOptions(approval('a', { choices: ['once', 'always', 'deny'] })), { session: false, always: true });
});

test('a synthetic plugin target shows its description instead of the command', () => {
  assert.deepEqual(approvalDetails(parseApproval({ command: 'ls -la', description: 'list' })), { showsDescription: false, text: 'ls -la' });
  assert.deepEqual(approvalDetails(parseApproval({ command: '<write_file> (plugin approval rule)', description: ' edits notes.md ' })), { showsDescription: true, text: 'edits notes.md' });
  assert.deepEqual(approvalDetails(parseApproval({ command: '  ', description: 'run a thing' })), { showsDescription: true, text: 'run a thing' });
});

test('the approval queue keeps order, counts the stack and resets when it empties', () => {
  let state = receiveApproval(emptyRequests(), approval('a'));
  state = receiveApproval(state, approval('b'));
  assert.deepEqual(state.approvals.map((a) => a.requestId), ['a', 'b']);
  assert.equal(state.approvalTotal, 2);

  // the same queue id replaces in place and does not count twice
  state = receiveApproval(state, approval('a', { command: 'changed' }));
  assert.equal(state.approvals[0].command, 'changed');
  assert.equal(state.approvalTotal, 2);

  state = clearApproval(state, 'a');
  assert.equal(state.approvalTotal, 2, 'the stack still remembers how many it held');
  assert.equal(clearApproval(state, 'zzz'), state, 'a stale id is a no-op');
  state = clearApproval(state, 'b');
  assert.deepEqual(state.approvals, []);
  assert.equal(state.approvalTotal, 0);
});

test('a replayed approval never clobbers the live request carrying the same queue id', () => {
  const live = receiveApproval(emptyRequests(), approval('a'));
  const replayed = parseApproval({ request_id: 'a', command: 'cmd a' });
  assert.equal(receiveApproval(live, replayed), live);
  assert.equal(approvalByServerId(live, 'srv-a')?.requestId, 'a');
});

test('reconciling with approval.pending drops what the server no longer holds and takes what it does', () => {
  let state = receiveApproval(receiveApproval(emptyRequests(), approval('a')), approval('b'));
  state = reconcileApprovals(state, [parseApproval({ request_id: 'b' }), parseApproval({ request_id: 'c', command: 'new' })]);
  assert.deepEqual(state.approvals.map((a) => a.requestId), ['b', 'c']);
  assert.equal(state.approvals[0].serverRequestId, 'srv-b', 'the live request survives its own replay');
});

test('choices keep non-blank strings within the cap, and the recommended tag is bare-able', () => {
  assert.deepEqual(normalizeChoices(['A', '  ', 3, 'B (Recommended)', 'x'.repeat(8001)]), ['A', 'B (Recommended)']);
  assert.deepEqual(normalizeChoices('nope'), []);
  assert.equal(bareChoice('Use the cache (Recommended)'), 'Use the cache');
  assert.equal(bareChoice('Plain'), 'Plain');
});

test('questions need a qid and text; multi-select needs choices', () => {
  const questions = normalizeQuestions([
    { qid: 'q1', question: ' Which? ', choices: ['A', 'B'], multi_select: true },
    { qid: 'q2', question: 'Why?', choices: [], multi_select: true },
    { qid: '', question: 'no id' },
    { qid: 'q3' },
    'junk',
  ]);
  assert.deepEqual(questions, [
    { qid: 'q1', question: 'Which?', choices: ['A', 'B'], multiSelect: true },
    { qid: 'q2', question: 'Why?', choices: null, multiSelect: false },
  ]);
});

test('a clarify with no usable question parks nothing; replayed locks ride along', () => {
  assert.equal(parseClarify({ questions: [] }, 'r1', 1), null);
  const request = parseClarify({ questions: [{ qid: 'q1', question: 'A?' }], answers: { q1: 'yes', q2: null, q3: 4 } }, 'r1', 100);
  assert.deepEqual(request?.lockedAnswers, { q1: 'yes', q2: null });
  assert.equal(request?.receivedAt, 100);
});

const single: ClarifyQuestion = { qid: 'q1', question: 'Which?', choices: ['Red (Recommended)', 'Blue'], multiSelect: false };
const multi: ClarifyQuestion = { qid: 'q2', question: 'Which all?', choices: ['A', 'B'], multiSelect: true };

test('staging: a single pick excludes typed text; multi-select keeps both', () => {
  assert.equal(stagedAnswer(single), null);
  let stage = toggleChoice(single, undefined, 'Red (Recommended)');
  assert.equal(stagedAnswer(single, stage), 'Red', 'the recommended tag is not part of the answer');
  stage = setDraft(single, stage, 'Green');
  assert.deepEqual(stage.choices, []);
  assert.equal(stagedAnswer(single, stage), 'Green');

  let many = toggleChoice(multi, undefined, 'A');
  many = toggleChoice(multi, many, 'B');
  many = setDraft(multi, many, 'also C');
  assert.equal(stagedAnswer(multi, many), JSON.stringify(['A', 'B', 'also C']));
  many = toggleChoice(multi, many, 'A');
  assert.equal(stagedAnswer(multi, many), JSON.stringify(['B', 'also C']));
});

test('replayed locks stage once; a later edit stands', () => {
  const locked = { q1: 'Blue', q2: JSON.stringify(['A', 'typed']) };
  const first = stageLocked([single, multi], locked, {}, {});
  assert.deepEqual(first.q1, { choices: ['Blue'], draft: '' });
  assert.deepEqual(first.q2, { choices: ['A'], draft: 'typed' });

  const edited = { ...first, q1: setDraft(single, first.q1, 'mine') };
  assert.deepEqual(stageLocked([single, multi], locked, locked, edited), edited, 'an answer seen before is left alone');
  const changed = stageLocked([single, multi], { ...locked, q1: 'Red' }, locked, edited);
  assert.deepEqual(changed.q1, { choices: ['Red (Recommended)'], draft: '' });
});

test('typed composer text names a choice in any case, else stays words', () => {
  assert.equal(typedAnswer(single, 'blue'), 'Blue');
  assert.equal(typedAnswer(single, 'RED'), 'Red');
  assert.equal(typedAnswer(single, 'something else'), 'something else');
  assert.equal(typedAnswer(multi, 'a'), JSON.stringify(['A']));
});

test('skip settles as cancelled, keeping answers the server already locked', () => {
  const request = { requestId: 'r1', receivedAt: 1, questions: [single, multi], lockedAnswers: { q2: JSON.stringify(['A']) } };
  assert.deepEqual(skippedResult(request), {
    outcome: 'cancelled',
    responses: [
      { question: 'Which?', status: 'unanswered', user_response: null },
      { question: 'Which all?', status: 'answered', user_response: ['A'] },
    ],
  });
  assert.deepEqual(submittedResult(request, { q1: 'Blue' }).responses, [
    { question: 'Which?', status: 'answered', user_response: 'Blue' },
    { question: 'Which all?', status: 'skipped', user_response: null },
  ]);
});

test('the tool result and call args read back as the card needs them', () => {
  const result = readClarifyResult(JSON.stringify({ outcome: 'submitted', responses: [{ question: 'Q', status: 'answered', user_response: ['a', 'b'] }, { question: 'R', status: 'unanswered', user_response: null }] }));
  assert.equal(result.outcome, 'submitted');
  assert.deepEqual(result.responses, [
    { question: 'Q', answer: ['a', 'b'], unanswered: false },
    { question: 'R', answer: undefined, unanswered: true },
  ]);
  assert.deepEqual(readClarifyResult('not json').responses, []);
  assert.deepEqual(readClarifyArgs({ questions: [{ question: 'Q', choices: ['x'], multi_select: true }, { nope: 1 }] }).questions, [{ question: 'Q', choices: ['x'], multiSelect: true }]);
});

test('prompts parse per method and open in the sheet in a fixed order', () => {
  assert.deepEqual(parsePrompt('sudo', 'r1', { command: 'apt update' }), { kind: 'sudo', requestId: 'r1', command: 'apt update' });
  assert.deepEqual(parsePrompt('secret', 'r2', { env_var: 'API_KEY', prompt: 'Key please' }), { kind: 'secret', requestId: 'r2', envVar: 'API_KEY', prompt: 'Key please' });
  assert.deepEqual(parsePrompt('vault.unlock_prompt', 'r3', { backend: 'op' }), { kind: 'vault-unlock', requestId: 'r3', backend: 'op', displayName: 'op' });
  assert.deepEqual(parsePrompt('vault.save_login', 'r4', { origin: 'https://x.test' }), { kind: 'vault-save', requestId: 'r4', origin: 'https://x.test', site: 'https://x.test' });
  assert.deepEqual(parsePrompt('vault.code', 'r5', { site: 'x.test', hint: 'sms' }), { kind: 'vault-code', requestId: 'r5', site: 'x.test', hint: 'sms' });
  assert.equal(parsePrompt('tour', 'r6', {}), null);

  let state = setPrompt(setPrompt(emptyRequests(), parsePrompt('vault.code', 'r5', {})!), parsePrompt('sudo', 'r1', {})!);
  assert.equal(activePrompt(state)?.kind, 'sudo');
  state = clearPrompt(state, 'r1');
  assert.equal(activePrompt(state)?.kind, 'vault-code');
  assert.equal(clearPrompt(state, 'nope'), state);
  assert.equal(cleanVaultCode('123 456-7'), '1234567');
});

test('a turn ending clears approvals and prompts, and a clarify only once the server has let go', () => {
  let state = receiveApproval(emptyRequests(), approval('a'));
  state = setPrompt(state, parsePrompt('sudo', 'r1', {})!);
  state = setClarify(state, { requestId: 'c1', receivedAt: 1, questions: [single] });
  assert.equal(hasBlockingPrompt(state), true);
  assert.equal(awaitingInput(state), true);

  const held = clearTurn(state, (id) => id === 'c1');
  assert.deepEqual(held.approvals, []);
  assert.deepEqual(held.prompts, {});
  assert.equal(held.clarify?.requestId, 'c1');
  assert.equal(hasBlockingPrompt(held), false);
  assert.equal(awaitingInput(held), true);

  assert.equal(clearTurn(state, () => false).clarify, null);
  assert.equal(clearClarify(held, 'other'), held);
  assert.equal(clearTurn(emptyRequests(), () => false).approvals.length, 0);
});

const tool = (extra: Partial<ToolPart>): ToolPart => ({ kind: 'tool', id: 't1', name: 'clarify', context: '', args: {}, status: 'done', ...extra });
const assistant = (id: string, parts: Message['parts'], status: Message['status'] = 'complete'): Message => ({ id, role: 'assistant', parts, status });
const transcript = (messages: Message[]): Transcript => ({ ...emptyTranscript(), messages });
const clarifyRequest = { requestId: 'r1', receivedAt: 1, questions: [{ qid: 'q1', question: 'Which?', choices: null, multiSelect: false }] };

test('arming finds the hydrated clarify row by its question and wakes it', () => {
  const stored = tool({ id: 'provider-id', args: { questions: [{ question: 'Which?' }] }, status: 'done' });
  const { transcript: next, toolId } = armClarify(transcript([assistant('m1', [{ kind: 'text', text: 'Asking.' }, stored])]), clarifyRequest);
  assert.equal(toolId, 'provider-id');
  const part = next.messages[0].parts[1] as ToolPart;
  assert.equal(part.status, 'running');
  assert.deepEqual(part.args, { questions: [{ question: 'Which?' }] });
});

test('arming takes the one running clarify when no question matches, but never a sealed one', () => {
  const running = tool({ id: 'live', status: 'running' });
  assert.equal(armClarify(transcript([assistant('m1', [running])]), clarifyRequest).toolId, 'live');

  const sealed = tool({ id: 'old', status: 'done' });
  const added = armClarify(transcript([assistant('m1', [sealed])]), clarifyRequest);
  assert.equal(added.toolId, 'r1', 'a sealed call is history, so a new row stands for the request');
  assert.equal(added.transcript.messages[0].parts.length, 2);
});

test('with no row at all the call joins the trailing assistant message, or opens one', () => {
  const tail = armClarify(transcript([assistant('m1', [{ kind: 'text', text: 'hi' }])]), clarifyRequest);
  assert.equal(tail.transcript.messages.length, 1);
  assert.equal((tail.transcript.messages[0].parts[1] as ToolPart).id, 'r1');

  const user: Message = { id: 'u', role: 'user', parts: [{ kind: 'text', text: 'go' }], status: 'complete' };
  const opened = armClarify(transcript([user]), clarifyRequest);
  assert.equal(opened.transcript.messages.length, 2);
  assert.equal(opened.transcript.messages[1].role, 'assistant');
});

test('a withdrawn clarify row settles as skipped from its own questions', () => {
  const part = tool({ id: 'live', status: 'running', args: { questions: [{ question: 'Which?' }, { question: 'Why?' }] } });
  const settled = settleClarifyTool(transcript([assistant('m1', [part])]), 'live');
  const done = settled.messages[0].parts[0] as ToolPart;
  assert.equal(done.status, 'done');
  assert.deepEqual(readClarifyResult(done.result).responses.map((r) => r.unanswered), [true, true]);
  assert.equal(readClarifyResult(done.result).outcome, 'cancelled');
  assert.equal(settleClarifyTool(settled, 'live'), settled, 'a settled row is left alone');
});

test('the approval stack summarises this turn’s terminal and code calls only', () => {
  const user = (id: string): Message => ({ id, role: 'user', parts: [{ kind: 'text', text: 'x' }], status: 'complete' });
  const messages = [
    user('u1'),
    assistant('a1', [tool({ id: 'old', name: 'terminal' })]),
    user('u2'),
    assistant('a2', [tool({ id: 'one', name: 'terminal' }), tool({ id: 'two', name: 'read_file' }), tool({ id: 'three', name: 'execute_code' })]),
  ];
  assert.deepEqual(approvalActivity(messages).map((p) => p.id), ['one', 'three']);
  assert.deepEqual(approvalActivity([]), []);
});
