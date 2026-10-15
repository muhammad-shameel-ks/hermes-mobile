import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayToggleParams, reactionsParams } from '../src/settings/display-toggles.ts';
import {
  allowlistWith,
  allowlistWithout,
  APPROVAL_MODES,
  configPatch,
  describeTimeout,
  normalizeApprovalMode,
  parseTimeout,
  readAllowlist,
  readPath,
  readSafety,
  SAFETY_COPY,
  SAFETY_DEFAULTS,
  SAFETY_GROUPS,
  saveBody,
} from '../src/settings/safety.ts';

test('the approval modes are the backend choices, in its order', () => {
  assert.deepEqual(
    APPROVAL_MODES.map((mode) => mode.id),
    ['manual', 'smart', 'off'],
  );
  assert.deepEqual(
    APPROVAL_MODES.map((mode) => mode.label),
    ['Manual', 'Smart', 'Off'],
  );
});

test('a bare YAML off reads as the off mode, and anything unknown as manual', () => {
  assert.equal(normalizeApprovalMode(false), 'off');
  assert.equal(normalizeApprovalMode(true), 'manual');
  assert.equal(normalizeApprovalMode(' Smart '), 'smart');
  assert.equal(normalizeApprovalMode('OFF'), 'off');
  assert.equal(normalizeApprovalMode('auto'), 'manual');
  assert.equal(normalizeApprovalMode(undefined), 'manual');
});

test('every key of the desktop safety pages has copy, and each key sits on one page', () => {
  const keys = SAFETY_GROUPS.flatMap((group) => group.keys);
  assert.deepEqual(
    SAFETY_GROUPS.map((group) => group.id),
    ['approvals', 'privacy', 'checkpoints'],
  );
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys.slice().sort(), Object.keys(SAFETY_COPY).sort());
  assert.equal(SAFETY_COPY['approvals.timeout'].label, 'Approval Timeout');
  assert.equal(SAFETY_COPY['approvals.mode'].label, 'Approval Mode');
});

test('the config is read with the server defaults for absent keys', () => {
  assert.deepEqual(readSafety({}), {
    approvalMode: 'manual',
    approvalTimeout: 300,
    mcpReloadConfirm: true,
    allowlist: [],
    redactSecrets: true,
    allowPrivateUrls: false,
    checkpoints: false,
  });
  assert.equal(SAFETY_DEFAULTS.approvalTimeout, 300);
  assert.deepEqual(
    readSafety({
      approvals: { mode: 'smart', timeout: 45, mcp_reload_confirm: false },
      command_allowlist: ['recursive delete', '', 7],
      security: { redact_secrets: false, allow_private_urls: true },
      checkpoints: { enabled: true },
    }),
    {
      approvalMode: 'smart',
      approvalTimeout: 45,
      mcpReloadConfirm: false,
      allowlist: ['recursive delete'],
      redactSecrets: false,
      allowPrivateUrls: true,
      checkpoints: true,
    },
  );
  assert.equal(readSafety({ approvals: { mode: false } }).approvalMode, 'off');
  assert.equal(readSafety({ approvals: { timeout: 'soon' } }).approvalTimeout, 300);
});

test('a legacy bare-string allowlist is recovered as one entry', () => {
  assert.deepEqual(readAllowlist('pip install'), ['pip install']);
  assert.deepEqual(readAllowlist(null), []);
});

test('dotted paths read through nested config and stop at a non-object', () => {
  assert.equal(readPath({ a: { b: { c: 1 } } }, 'a.b.c'), 1);
  assert.equal(readPath({ a: 3 }, 'a.b'), undefined);
  assert.equal(readPath({ a: [1] }, 'a.0'), undefined);
});

test('one changed key is sent as a sparse nested patch', () => {
  assert.deepEqual(configPatch('approvals.mode', 'off'), { approvals: { mode: 'off' } });
  assert.deepEqual(configPatch('command_allowlist', ['a']), { command_allowlist: ['a'] });
  assert.deepEqual(saveBody('security.redact_secrets', false), { config: { security: { redact_secrets: false } } });
  assert.deepEqual(saveBody('approvals.timeout', 120), { config: { approvals: { timeout: 120 } } });
});

test('the timeout takes whole seconds only', () => {
  assert.equal(parseTimeout('300'), 300);
  assert.equal(parseTimeout(' 90 '), 90);
  assert.equal(parseTimeout('0'), 0);
  assert.equal(parseTimeout(''), null);
  assert.equal(parseTimeout('-5'), null);
  assert.equal(parseTimeout('1.5'), null);
  assert.equal(parseTimeout('1e3'), null);
  assert.equal(parseTimeout('99999999999999999999'), null);
});

test('the timeout reads in minutes and seconds', () => {
  assert.equal(describeTimeout(300), '5 min');
  assert.equal(describeTimeout(90), '1 min 30 s');
  assert.equal(describeTimeout(45), '45 s');
  assert.equal(describeTimeout(0), '0 s');
});

test('the allowlist adds a trimmed entry once and removes by value', () => {
  assert.deepEqual(allowlistWith(['a'], ' b '), ['a', 'b']);
  assert.deepEqual(allowlistWith(['a'], 'a'), ['a']);
  assert.deepEqual(allowlistWith(['a'], '   '), ['a']);
  assert.deepEqual(allowlistWithout(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(allowlistWithout(['a'], 'z'), ['a']);
});

test('message reactions go to the gateway as the display toggle the desktop writes', () => {
  assert.deepEqual(reactionsParams(true, 'work'), { key: 'display.message_reactions', value: 'true', profile: 'work' });
  assert.deepEqual(reactionsParams(false, 'default'), { key: 'display.message_reactions', value: 'false', profile: 'default' });
});

test('any display toggle is spelled the way the gateway parses it', () => {
  assert.deepEqual(displayToggleParams('display.in_app_tips', true, 'default'), { key: 'display.in_app_tips', value: 'true', profile: 'default' });
});
