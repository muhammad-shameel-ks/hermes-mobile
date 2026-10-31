import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filePathFromMediaPath } from '../src/chat/media.ts';
import { linkedPath } from '../src/files/path.ts';
import { downloadUrl } from '../src/files/rest.ts';
import { isPickerCancelled, safeFileName } from '../src/files/save.ts';

test('a download is stored under the file name its path carries, not the one the response suggests', () => {
  assert.equal(safeFileName('/opt/data/report.pdf'), 'report.pdf');
  assert.equal(safeFileName('notes/My Report v2.final.md'), 'My Report v2.final.md');
  assert.equal(safeFileName('C:\\Users\\ada\\data.csv'), 'data.csv');
  assert.equal(safeFileName('/opt/data/'), 'data');
});

test('names that would escape or vanish fall back to a plain one', () => {
  assert.equal(safeFileName('..'), 'file');
  assert.equal(safeFileName('/tmp/..'), 'file');
});

test('characters a file system or document provider would mangle are replaced', () => {
  assert.equal(safeFileName('/tmp/a:b*c?.txt'), 'a_b_c_.txt');
  assert.equal(safeFileName(''), 'file');
  assert.equal(safeFileName('/'), 'file');
});

test('a file card builds the gateway URL from the decoded, cwd-resolved path', () => {
  const card = (path: string, cwd?: string | null) => linkedPath(filePathFromMediaPath(path), cwd);
  const base = 'https://gw.example';

  const absolute = card('file:///home/ada/My%20Report.pdf', '/work');
  assert.equal(absolute, '/home/ada/My Report.pdf');
  assert.equal(downloadUrl(base, { origin: 'link', path: absolute, profile: 'ada' }), `${base}/api/fs/download?path=%2Fhome%2Fada%2FMy%20Report.pdf&profile=ada`);
  assert.equal(safeFileName(absolute), 'My Report.pdf');

  const relative = card('out/data.csv', '/work/');
  assert.equal(relative, '/work/out/data.csv');
  assert.equal(downloadUrl(base, { origin: 'link', path: relative, profile: 'ada' }), `${base}/api/fs/download?path=%2Fwork%2Fout%2Fdata.csv&profile=ada`);

  // no working directory known: the path goes up as written and the name still comes from it
  assert.equal(card('out/data.csv', null), 'out/data.csv');
  assert.equal(safeFileName(card('out/data.csv', null)), 'data.csv');
});

test('a dismissed folder picker is told apart from a failed one', () => {
  assert.equal(isPickerCancelled(Object.assign(new Error('The file picker was cancelled by the user'), { code: 'ERR_PICKER_CANCELLED' })), true);
  assert.equal(isPickerCancelled(Object.assign(new Error('File picking was cancelled by the user'), { code: 'ERR_FILE_PICKING_CANCELLED' })), true);
  assert.equal(isPickerCancelled(new Error('The user cancelled the picker')), true);
  assert.equal(isPickerCancelled(Object.assign(new Error('No view controller available for presenting file picker'), { code: 'ERR_NO_VIEW_CONTROLLER' })), false);
  assert.equal(isPickerCancelled(undefined), false);
  assert.equal(isPickerCancelled('boom'), false);
});
