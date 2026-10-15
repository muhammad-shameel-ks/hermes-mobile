import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitSvgToBox, prepareSvg, sanitizeSvg, svgAspectRatio } from '../src/ui/svg.ts';

test('svg loses scripts, handlers, links and remote references but keeps internal ones', () => {
  const dirty = [
    '<?xml version="1.0"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" onload="steal()">',
    '<script>alert(1)</script>',
    '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>',
    '<a href="https://evil.test"><rect width="10" height="10" fill="url(#g)" onclick="x()"/></a>',
    '<image href="https://evil.test/track.png" width="5" height="5"/>',
    '<image href="data:image/png;base64,AAAA" width="5" height="5"/>',
    '<use href="#g"/>',
    '<circle r="5" style="fill:url(https://evil.test/x)"/>',
    '<foreignObject><div>hi</div></foreignObject>',
    '</svg>',
  ].join('');
  const clean = sanitizeSvg(dirty);
  assert.doesNotMatch(clean, /script|onload|onclick|evil|foreignObject|<a\b|<\?xml/i);
  assert.match(clean, /fill="url\(#g\)"/);
  assert.match(clean, /<use href="#g"\/>/);
  assert.match(clean, /data:image\/png/);
});

test('svg aspect comes from the viewBox, else the root size, and fitting drops the fixed size', () => {
  assert.equal(svgAspectRatio('<svg viewBox="0 0 200 100"></svg>'), 2);
  assert.equal(svgAspectRatio('<svg width="300px" height="100"></svg>'), 3);
  assert.equal(svgAspectRatio('<svg></svg>'), null);
  assert.equal(fitSvgToBox('<svg width="300" height="100"><g/></svg>'), '<svg viewBox="0 0 300 100"><g/></svg>');
  assert.equal(fitSvgToBox('<svg viewBox="0 0 4 2" width="400"><g/></svg>'), '<svg viewBox="0 0 4 2"><g/></svg>');
});

test('svg loses script, foreign content, event handlers, links and remote refs', () => {
  const dirty = [
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="alert(1)">',
    '<script>alert(1)</script>',
    '<foreignObject><div>hi</div></foreignObject>',
    '<style>@import url(http://evil/x.css); .a{fill:url(http://evil/p)}</style>',
    '<a href="https://evil"><rect id="keep" width="5" height="5" fill="url(#g)" onclick="x()"/></a>',
    '<image href="https://evil/p.png"/>',
    '<image href="data:image/png;base64,AAAA"/>',
    '<use xlink:href="https://evil/s.svg#a"/>',
    '<use href="#local"/>',
    '</svg>',
  ].join('');
  const clean = sanitizeSvg(dirty);
  for (const bad of ['script', 'foreignObject', 'onload', 'onclick', 'evil', 'DOCTYPE', '<a ', '@import', '<?xml']) {
    assert.equal(clean.includes(bad), false, `${bad} should be gone`);
  }
  for (const good of ['id="keep"', 'fill="url(#g)"', 'data:image/png;base64,AAAA', 'href="#local"']) {
    assert.equal(clean.includes(good), true, `${good} should stay`);
  }
});

test('an svg without a viewBox gets one from its declared size', () => {
  const prepared = prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect/></svg>');
  assert.ok(prepared);
  assert.match(prepared.xml, /<svg viewBox="0 0 40 20"/);
  assert.equal(/\swidth=/.test(prepared.xml.split('>')[0]), false);
  assert.equal(prepared.aspect, 2);
});

test('an svg with a viewBox keeps it and reports its aspect', () => {
  const prepared = prepareSvg('<svg viewBox="0 0 100 50" width="300"><g/></svg>');
  assert.ok(prepared);
  assert.match(prepared.xml, /viewBox="0 0 100 50"/);
  assert.equal(prepared.aspect, 2);
  assert.equal(prepareSvg('<div>nope</div>'), null);
});

test('an image or use with an unquoted remote href is dropped whole', () => {
  const clean = sanitizeSvg('<svg><image href=https://evil.test/p.png width="5"/><use href=https://evil.test/s.svg#a /><rect id="keep"/></svg>');
  assert.equal(clean.includes('evil'), false);
  assert.equal(clean.includes('id="keep"'), true);
});
