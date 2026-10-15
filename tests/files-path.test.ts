import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baseName, displayPath, folderNameError, formatBytes, formatPreviewBytes, isUnder, joinPath, linkedPath, parentPath, relativeTo } from '../src/files/path.ts';

test('joinPath keeps one separator and ignores leading slashes on the name', () => {
  assert.equal(joinPath('/opt/data', 'a.txt'), '/opt/data/a.txt');
  assert.equal(joinPath('/opt/data/', '/a.txt'), '/opt/data/a.txt');
  assert.equal(joinPath('C:\\data', 'a.txt'), 'C:\\data\\a.txt');
  assert.equal(joinPath('/opt/data', '  '), '/opt/data');
});

test('parent, base name and containment follow the path segments', () => {
  assert.equal(parentPath('/opt/data/a'), '/opt/data');
  assert.equal(parentPath('/opt'), '/');
  assert.equal(parentPath('/'), null);
  assert.equal(baseName('/opt/data/a.txt'), 'a.txt');
  assert.equal(isUnder('/opt/data', '/opt/data/a/b'), true);
  assert.equal(isUnder('/opt/data', '/opt/database'), false);
  assert.equal(isUnder('/', '/anywhere'), true);
  assert.equal(relativeTo('/opt/data', '/opt/data/a/b'), 'a/b');
  assert.equal(relativeTo('/opt/data', '/opt/data'), '.');
});

test('display paths collapse a home directory', () => {
  assert.equal(displayPath('/Users/ada/www/app'), '~/www/app');
  assert.equal(displayPath('/home/ada'), '~');
  assert.equal(displayPath('/var/log'), '/var/log');
  assert.equal(displayPath('/srv/ada/x', '/srv/ada'), '~/x');
});

test('a folder name is a single segment', () => {
  assert.equal(folderNameError('notes'), null);
  assert.equal(folderNameError('  '), 'Folder name required');
  assert.equal(folderNameError('a/b'), 'Enter a single folder name, without slashes.');
  assert.equal(folderNameError('..'), 'Enter a single folder name, without slashes.');
});

test('sizes read as the dashboard and the desktop preview print them', () => {
  assert.equal(formatBytes(null), '-');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatPreviewBytes(0), 'unknown size');
  assert.equal(formatPreviewBytes(2048), '2.0 KB');
  assert.equal(formatPreviewBytes(20 * 1024 * 1024), '20 MB');
});

test('a transcript link becomes an absolute server path', () => {
  assert.equal(linkedPath('file:///srv/app/a%20b.ts'), '/srv/app/a b.ts');
  assert.equal(linkedPath('src/a.ts', '/srv/app/'), '/srv/app/src/a.ts');
  assert.equal(linkedPath('./a.ts', '/srv/app'), '/srv/app/a.ts');
  assert.equal(linkedPath('/etc/hosts', '/srv/app'), '/etc/hosts');
  assert.equal(linkedPath('~/notes.md', '/srv/app'), '~/notes.md');
  assert.equal(linkedPath('a.ts'), 'a.ts');
});
