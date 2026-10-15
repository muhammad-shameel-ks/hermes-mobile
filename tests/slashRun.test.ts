import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUSY_KICKOFF_TEXT, reasoningArgs, runSlash, subcommandRefusal, type SlashEnv } from '../src/chat/slashRun.ts';
import { resolveCommand } from '../src/chat/slash.ts';

type Call = { method: string; params: Record<string, unknown> };

function fakeEnv(options: Partial<Pick<SlashEnv, 'isBotChat' | 'running' | 'hasSession'>> = {}, answers: Record<string, unknown | ((params: Record<string, unknown>) => unknown)> = {}) {
  const calls: Call[] = [];
  const said: string[] = [];
  const notices: string[] = [];
  const log: string[] = [];
  const submitted: Array<{ text: string; display?: string }> = [];
  const queued: Array<{ text: string; display?: string }> = [];
  const env: SlashEnv = {
    isBotChat: false,
    running: false,
    hasSession: true,
    ...options,
    request: async <T,>(method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      return (typeof answer === 'function' ? (answer as (p: Record<string, unknown>) => unknown)(params) : (answer ?? {})) as T;
    },
    sessionId: async () => 'rt-1',
    runtimeId: () => 'rt-1',
    say: (text) => said.push(text),
    notify: (text) => notices.push(text),
    newChat: () => log.push('new'),
    compact: async (topic) => void log.push(`compact:${topic}`),
    stop: async () => void log.push('stop'),
    setEffort: async (effort) => void log.push(`effort:${effort}`),
    retitle: (title) => void log.push(`title:${title}`),
    submit: async (text, display) => void submitted.push({ text, display }),
    enqueue: (text, display) => {
      queued.push({ text, display });
      return true;
    },
  };
  return { env, calls, said, notices, log, submitted, queued };
}

test('prose that only starts with a slash is not a command', async () => {
  const { env, calls } = fakeEnv();
  assert.equal(await runSlash(env, '/usr/local/bin is missing'), false);
  assert.equal(await runSlash(env, 'hello'), false);
  assert.equal(await runSlash(env, '/'), false);
  assert.equal(calls.length, 0);
});

test('/new and /reset start a fresh chat; in a Bot Chat they compact with the notice', async () => {
  const plain = fakeEnv();
  assert.equal(await runSlash(plain.env, '/new'), true);
  await runSlash(plain.env, '/reset');
  assert.deepEqual(plain.log, ['new', 'new']);

  const bot = fakeEnv({ isBotChat: true });
  await runSlash(bot.env, '/new');
  assert.deepEqual(bot.log, ['compact:']);
  assert.match(bot.notices[0], /never resets/);
});

test('/compact and /compress compact, carrying a focus topic; a draft has nothing to compress', async () => {
  const live = fakeEnv();
  await runSlash(live.env, '/compact');
  await runSlash(live.env, '/compress the auth refactor');
  assert.deepEqual(live.log, ['compact:', 'compact:the auth refactor']);

  const draft = fakeEnv({ hasSession: false });
  await runSlash(draft.env, '/compact');
  assert.deepEqual(draft.log, []);
  assert.match(draft.said[0], /Nothing to compress/);
});

test('/stop interrupts, then reports the background processes it stopped', async () => {
  const { env, log, said } = fakeEnv({}, { 'process.stop': { killed: 2 } });
  await runSlash(env, '/stop');
  assert.deepEqual(log, ['stop']);
  assert.match(said[0], /Stopped 2 background processes/);
});

test('/title sets the title over session.title; bare /title shows it through the worker', async () => {
  const set = fakeEnv({}, { 'session.title': { title: 'Release plan' } });
  await runSlash(set.env, '/title Release plan');
  assert.deepEqual(set.calls[0], { method: 'session.title', params: { session_id: 'rt-1', title: 'Release plan' } });
  assert.deepEqual(set.log, ['title:Release plan']);

  const bare = fakeEnv({}, { 'slash.exec': { output: 'Title: Release plan' } });
  await runSlash(bare.env, '/title');
  assert.equal(bare.calls[0].method, 'slash.exec');
  assert.equal(bare.said[0], '/title\nTitle: Release plan');
});

test('/steer redirects a running turn and is just the next message otherwise', async () => {
  const running = fakeEnv({ running: true }, { 'session.steer': { status: 'queued', text: 'use tabs' } });
  await runSlash(running.env, '/steer use tabs');
  assert.deepEqual(running.calls[0], { method: 'session.steer', params: { session_id: 'rt-1', text: 'use tabs' } });
  assert.match(running.said[0], /Steered · "use tabs" queued/);

  const idle = fakeEnv();
  await runSlash(idle.env, '/steer use tabs');
  assert.deepEqual(idle.submitted, [{ text: 'use tabs', display: undefined }]);

  const bare = fakeEnv();
  await runSlash(bare.env, '/steer');
  assert.match(bare.said[0], /Usage: \/steer/);
});

test('/reasoning sets the effort, reads it back bare, and passes a scope to the gateway', async () => {
  const set = fakeEnv();
  await runSlash(set.env, '/reasoning HIGH');
  assert.deepEqual(set.log, ['effort:high']);

  const show = fakeEnv({}, { 'config.get': { value: 'low' } });
  await runSlash(show.env, '/reasoning');
  assert.equal(show.said[0], '/reasoning\nreasoning: low');

  const scoped = fakeEnv({}, { 'config.set': { value: 'high' } });
  await runSlash(scoped.env, '/reasoning high --global');
  assert.deepEqual(scoped.calls[0], { method: 'config.set', params: { key: 'reasoning', session_id: 'rt-1', value: 'high', scope: 'global' } });

  assert.deepEqual(reasoningArgs('--session  Medium'), { value: 'medium', scope: 'session' });
  assert.equal(reasoningArgs('--global'), null);
});

test('/status prints the session status', async () => {
  const { env, said } = fakeEnv({}, { 'session.status': { output: 'model: x' } });
  await runSlash(env, '/status');
  assert.equal(said[0], '/status\nmodel: x');
});

test('an exec command prints the worker\'s output, with its warning', async () => {
  const plain = fakeEnv({}, { 'slash.exec': { output: 'v1.2.3' } });
  await runSlash(plain.env, '/version');
  assert.deepEqual(plain.calls[0], { method: 'slash.exec', params: { session_id: 'rt-1', command: 'version' } });
  assert.equal(plain.said[0], '/version\nv1.2.3');

  const warned = fakeEnv({}, { 'slash.exec': { output: 'ok', warning: 'stale' } });
  await runSlash(warned.env, '/usage');
  assert.equal(warned.said[0], '/usage\nwarning: stale\nok');

  const silent = fakeEnv({}, { 'slash.exec': {} });
  await runSlash(silent.env, '/whoami');
  assert.equal(silent.said[0], '/whoami\n/whoami: no output');
});

test('a skill rerouted through command.dispatch sends its message with the invocation as the bubble', async () => {
  const { env, calls, submitted } = fakeEnv(
    {},
    {
      'slash.exec': new Error('worker: not a worker command'),
      'command.dispatch': { type: 'skill', name: 'work', message: '[skill body]', display: '/work fix the leak' },
    },
  );
  await runSlash(env, '/work fix the leak');
  assert.deepEqual(calls.map((c) => c.method), ['slash.exec', 'command.dispatch']);
  assert.deepEqual(calls[1].params, { session_id: 'rt-1', name: 'work', arg: 'fix the leak' });
  assert.deepEqual(submitted, [{ text: '[skill body]', display: '/work fix the leak' }]);
});

test('a skill dispatch falls back to what was typed when the gateway projects no display', async () => {
  const { env, submitted } = fakeEnv({}, { 'slash.exec': { type: 'send', message: 'do the thing', notice: '⊙ Goal set' } });
  await runSlash(env, '/goal ship it');
  assert.deepEqual(submitted, [{ text: 'do the thing', display: '/goal ship it' }]);
});

test('a skill kickoff is queued, not sent, while a turn runs', async () => {
  const { env, submitted, queued, said } = fakeEnv({ running: true }, { 'slash.exec': { type: 'skill', name: 'work', message: 'body', display: '/work x' } });
  await runSlash(env, '/work x');
  assert.deepEqual(submitted, []);
  assert.deepEqual(queued, [{ text: 'body', display: '/work x' }]);
  assert.equal(said[0], '/work\n' + BUSY_KICKOFF_TEXT.queued);
});

test('a kickoff that cannot be queued tells the reader to stop the reply first', async () => {
  const { env, said } = fakeEnv({ running: true }, { 'slash.exec': { type: 'send', message: 'go' } });
  env.enqueue = () => false;
  await runSlash(env, '/goal ship');
  assert.match(said[0], /stop the current reply first/);
});

test('commands that run on their own execute at once while a turn runs', async () => {
  const { env, calls, said, log } = fakeEnv({ running: true }, { 'slash.exec': { output: 'Hermes 9.9' }, 'session.status': { output: 'busy: yes' }, 'process.stop': { killed: 0 } });
  await runSlash(env, '/version');
  await runSlash(env, '/status');
  await runSlash(env, '/stop');
  assert.deepEqual(log, ['stop']);
  assert.deepEqual(calls.map((c) => c.method), ['slash.exec', 'session.status', 'process.stop']);
  assert.match(said[0], /Hermes 9.9/);
  assert.match(said[1], /busy: yes/);
});

test('an alias directive runs its target with the same argument', async () => {
  const { env, calls } = fakeEnv({}, { 'slash.exec': (params: Record<string, unknown>) => (params.command === 'ship now' ? { type: 'alias', target: 'deploy' } : { output: 'deployed' }) });
  await runSlash(env, '/ship now');
  assert.deepEqual(calls.map((c) => c.params.command), ['ship now', 'deploy now']);
});

test('the worker error survives a dispatch fallback that has nothing to add', async () => {
  const { env, said } = fakeEnv(
    {},
    { 'slash.exec': new Error('worker crashed'), 'command.dispatch': new Error('not a quick/plugin/skill command: usage') },
  );
  await runSlash(env, '/usage');
  assert.equal(said[0], '/usage\nerror: /usage failed: worker crashed');
});

test('a command narrowed to subcommands refuses the rest before the network', async () => {
  const command = resolveCommand('/skills');
  assert.match(subcommandRefusal(command, 'skills', '') ?? '', /needs a subcommand/);
  assert.match(subcommandRefusal(command, 'skills', 'install foo') ?? '', /not available on the phone/);
  assert.equal(subcommandRefusal(command, 'skills', 'pending'), null);

  const { env, calls, said } = fakeEnv();
  await runSlash(env, '/skills install foo');
  assert.equal(calls.length, 0);
  assert.match(said[0], /Available here: pending, approve/);
});

test('a picker command that reaches the controller says where it lives', async () => {
  const { env, said, calls } = fakeEnv();
  assert.equal(await runSlash(env, '/model'), true);
  assert.equal(calls.length, 0);
  assert.match(said[0], /composer/);
});
