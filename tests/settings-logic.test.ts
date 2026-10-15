import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aboutRows, buildIdentity, shortVersion } from '../src/settings/about.ts';
import { pickActiveProfile, readActiveProfile } from '../src/settings/active-profile.ts';
import { filterServers, filterSkills, filterToolsets, prettyName, serverTarget, visibleToolsetCount, type SkillInfo, type ToolsetInfo } from '../src/settings/capabilities.ts';
import { assignmentRequest, interpretAssignment, MODEL_ASSIGNMENT_COPY } from '../src/settings/model-default.ts';

test('the about block carries the build identity from the vendor manifest', () => {
  const identity = buildIdentity('0.1.0', { upstream: { commit: '297552a9d646119871391d202509822cd86330df' }, contractSha256: '2280d7483a1cdbca2a9e97ba7f1dbbaa397cf7bf0cbcc0fde906645f24d6e2c7' }, '0.21.6+1913.gabc1234');
  assert.deepEqual(aboutRows(identity), [
    { label: 'Version', value: 'v0.1.0' },
    { label: 'Hermes commit', value: '297552a9d64611', mono: true },
    { label: 'Contract', value: '2280d7483a1c', mono: true },
    { label: 'Gateway', value: 'v0.21.6+1913' },
  ]);
  assert.equal(aboutRows(buildIdentity('0.1.0', {}, null)).at(-1)?.value, 'Version unavailable');
  assert.equal(shortVersion('v0.21.5+1913.gdeadbee.dirty'), '0.21.5+1913');
});

test('the active profile is the one the server is scoped to', () => {
  assert.equal(pickActiveProfile({ active: 'default', current: 'work' }, []), 'work');
  assert.equal(pickActiveProfile({ current: 'custom' }, []), null);
  assert.equal(pickActiveProfile({ current: 'ghost' }, ['default', 'work']), null);
  assert.equal(pickActiveProfile({}, []), null);
});

test('a failed profile read leaves the default in place', async () => {
  const failing = {
    get: async () => {
      throw new Error('503');
    },
  };
  assert.equal(await readActiveProfile(failing as never), null);
  const ok = { get: async () => ({ current: 'work' }) };
  assert.equal(await readActiveProfile(ok as never), 'work');
});

test('a model assignment is a main-scope set, confirmed on retry', () => {
  assert.deepEqual(assignmentRequest({ model: 'm', provider: 'p' }), { scope: 'main', provider: 'p', model: 'm' });
  assert.deepEqual(assignmentRequest({ model: 'm', provider: 'p' }, true), { scope: 'main', provider: 'p', model: 'm', confirm_expensive_model: true });
  assert.deepEqual(interpretAssignment({ ok: true }, false), { kind: 'saved' });
  assert.deepEqual(interpretAssignment({ ok: false, confirm_required: true, confirm_message: ' costly ' }, false), { kind: 'confirm', message: 'costly' });
  assert.deepEqual(interpretAssignment({ ok: false, confirm_required: true }, true), { kind: 'failed', message: MODEL_ASSIGNMENT_COPY.saveFailed });
  assert.deepEqual(interpretAssignment({ ok: false, confirm_message: 'nope' }, false), { kind: 'failed', message: 'nope' });
});

const skill = (name: string, extra: Partial<SkillInfo> = {}): SkillInfo => ({ name, description: '', category: 'general', enabled: true, ...extra });

test('skills list the most used first, then A to Z, and search names, descriptions and categories', () => {
  const skills = [skill('b'), skill('a'), skill('c', { usage: 5 }), skill('d', { category: 'data-science', description: 'plots' })];
  assert.deepEqual(filterSkills(skills, '').map((s) => s.name), ['c', 'a', 'b', 'd']);
  assert.deepEqual(filterSkills(skills, 'plot').map((s) => s.name), ['d']);
  assert.deepEqual(filterSkills(skills, 'data').map((s) => s.name), ['d']);
  assert.equal(prettyName('data-science'), 'Data Science');
});

test('toolsets hide the desktop’s curated names and search tool names too', () => {
  const toolset = (name: string, tools: string[] = []): ToolsetInfo => ({ name, label: '', description: '', enabled: true, configured: true, tools });
  const toolsets = [toolset('web', ['web_search']), toolset('moa'), toolset('discord'), toolset('file')];
  assert.deepEqual(filterToolsets(toolsets, '').map((t) => t.name), ['file', 'web']);
  assert.deepEqual(filterToolsets(toolsets, 'web_search').map((t) => t.name), ['web']);
  assert.equal(visibleToolsetCount(toolsets), 2);
});

test('an MCP server is found by name and shows where it runs', () => {
  const servers = [
    { name: 'files', transport: 'stdio', command: 'npx', args: ['-y', 'fs'], url: null, enabled: true, tools: null },
    { name: 'docs', transport: 'http', command: null, args: [], url: 'https://x.test/mcp', enabled: false, tools: ['a'] },
  ];
  assert.deepEqual(filterServers(servers, 'doc').map((s) => s.name), ['docs']);
  assert.equal(serverTarget(servers[0]), 'npx -y fs');
  assert.equal(serverTarget(servers[1]), 'https://x.test/mcp');
});
