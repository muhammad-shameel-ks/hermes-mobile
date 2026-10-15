import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artifactFileName, classifyFile, composeArtifactHtml, isWebUrl, mimeFor } from '../src/files/preview.ts';

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
