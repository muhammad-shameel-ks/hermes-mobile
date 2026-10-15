import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fontScalingOff, wrapExport } from '../src/ui/chromeTextWrap.ts';

type Props = { allowFontScaling?: boolean; label?: string };
const call = (component: unknown, props: Props) => (component as (props: Props) => unknown)(props);

test('a plain function component is called in place with font scaling off', () => {
  const seen: Props[] = [];
  const Text = Object.assign(
    (props: Props) => {
      seen.push(props);
      return 'rendered';
    },
    { Static: 1 },
  );
  const wrapped = fontScalingOff(Text as never);
  assert.equal(call(wrapped, { label: 'a' }), 'rendered');
  assert.deepEqual(seen[0], { label: 'a', allowFontScaling: false });
  assert.equal((wrapped as unknown as { Static: number }).Static, 1);
});

test('a call site that passes allowFontScaling still wins, and its props are passed through untouched', () => {
  const seen: Props[] = [];
  const wrapped = fontScalingOff(((props: Props) => void seen.push(props)) as never);
  const props = { allowFontScaling: true, label: 'x' };
  call(wrapped, props);
  assert.equal(seen[0], props);
  call(wrapped, { allowFontScaling: false });
  assert.equal(seen[1]?.allowFontScaling, false);
});

test('a class component keeps its own fibre: the wrapper returns an element of it', () => {
  class Legacy {}
  (Legacy.prototype as { isReactComponent?: unknown }).isReactComponent = {};
  const wrapped = fontScalingOff(Legacy as never);
  const element = call(wrapped, { label: 'x' }) as { type: unknown; props: Props };
  assert.equal(element.type, Legacy);
  assert.equal(element.props.allowFontScaling, false);
});

test('wrapExport swaps a configurable export and refuses a frozen one', () => {
  const exports: Record<string, unknown> = {};
  Object.defineProperty(exports, 'Text', { configurable: true, enumerable: true, get: () => () => null });
  assert.ok(wrapExport(exports, 'Text', (o) => o));
  const frozen = {};
  Object.defineProperty(frozen, 'Text', { value: () => null, configurable: false });
  assert.equal(wrapExport(frozen, 'Text', (o) => o), false);
});
