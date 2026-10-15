import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artifactFileName, classifyFile, composeArtifactHtml, isWebUrl, mimeFor } from '../src/files/preview.ts';
import { prepareSvg, sanitizeSvg } from '../src/files/svg.ts';

test('files classify by extension and default to text', () => {
  assert.equal(classifyFile('/a/photo.PNG'), 'image');
  assert.equal(classifyFile('logo.svg'), 'svg');
  assert.equal(classifyFile('README.md'), 'markdown');
  assert.equal(classifyFile('index.html'), 'html');
  assert.equal(classifyFile('paper.pdf'), 'pdf');
  assert.equal(classifyFile('clip.mp4'), 'media');
  assert.equal(classifyFile('data.zip'), 'binary');
  assert.equal(classifyFile('main.rs'), 'text');
  assert.equal(classifyFile('Makefile'), 'text');
  assert.equal(classifyFile('.gitignore'), 'text');
});

test('mime types fall back to the server answer, then octet-stream', () => {
  assert.equal(mimeFor('a.svg'), 'image/svg+xml');
  assert.equal(mimeFor('a.xyz', 'text/x-foo'), 'text/x-foo');
  assert.equal(mimeFor('a.xyz'), 'application/octet-stream');
});

test('only http and https hand off to the browser', () => {
  assert.equal(isWebUrl('https://example.com/x'), true);
  assert.equal(isWebUrl('file:///etc/passwd'), false);
  assert.equal(isWebUrl('javascript:alert(1)'), false);
});

test('an HTML fragment gets a document shell, a full document is left alone', () => {
  assert.match(composeArtifactHtml('<p>hi</p>'), /^<!doctype html>[\s\S]*<body>\n<p>hi<\/p>\n<\/body>/);
  const doc = '<!DOCTYPE html><html><body>x</body></html>';
  assert.equal(composeArtifactHtml(doc), doc);
});

test('artifact download names follow the desktop', () => {
  assert.equal(artifactFileName({ kind: 'artifact', label: 'My page!', content: '', artifactKind: 'html' }), 'My-page.html');
  assert.equal(artifactFileName({ kind: 'artifact', label: 'script.py', content: '', artifactKind: 'code' }), 'script.py');
  assert.equal(artifactFileName({ kind: 'artifact', label: '', content: '', artifactKind: 'code', language: 'ts' }), 'artifact.ts');
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
