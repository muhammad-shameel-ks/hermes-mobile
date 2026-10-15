import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectionGlyphName, connectionKind } from '../src/drawer/connectionGlyph.ts';

test('loopback, private LAN and mDNS hosts are this network\'s own', () => {
  for (const url of ['http://localhost:9119', 'http://127.0.0.1:9119', 'http://[::1]:9119', 'http://10.0.0.5:9119', 'https://192.168.1.20', 'http://172.20.3.4:80', 'http://studio.local:9119']) {
    assert.equal(connectionKind(url), 'local', url);
  }
});

test('anything else is remote', () => {
  for (const url of ['https://hermes.example.com', 'http://172.32.0.1', 'http://8.8.8.8:9119', 'https://user@gw.example.com:8443/x', 'garbage']) {
    assert.equal(connectionKind(url), 'remote', url);
  }
});

test('each kind has its glyph', () => {
  assert.equal(connectionGlyphName('local'), 'device-desktop');
  assert.equal(connectionGlyphName('remote'), 'remote-explorer');
});
