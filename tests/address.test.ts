import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseGatewayAddress, type GatewayAddress } from '../src/gateway/address.ts';

function ok(input: string): GatewayAddress {
  const result = parseGatewayAddress(input);
  if (!result.ok) throw new Error(`${JSON.stringify(input)} failed: ${result.reason}`);
  return result.address;
}

function reason(input: string): string {
  const result = parseGatewayAddress(input);
  if (result.ok) throw new Error(`${JSON.stringify(input)} unexpectedly parsed as ${result.address.baseUrl}`);
  return result.reason;
}

test('keeps an explicit scheme and port untouched', () => {
  assert.deepEqual(ok('https://hermes.example.com:8443'), {
    baseUrl: 'https://hermes.example.com:8443',
    scheme: 'https',
    host: 'hermes.example.com',
    port: 8443,
    label: 'hermes.example.com:8443',
  });
  assert.equal(ok('http://10.0.0.5:9119').baseUrl, 'http://10.0.0.5:9119');
});

test('an explicit scheme survives a private host', () => {
  assert.equal(ok('https://127.0.0.1:9443').baseUrl, 'https://127.0.0.1:9443');
  assert.equal(ok('HTTP://192.168.1.5:9119').baseUrl, 'http://192.168.1.5:9119');
});

test('a bare private address defaults to http on the gateway port', () => {
  assert.equal(ok('127.0.0.1:9119').baseUrl, 'http://127.0.0.1:9119');
  assert.equal(ok('127.0.0.1').baseUrl, 'http://127.0.0.1:9119');
  assert.equal(ok('localhost:9119').baseUrl, 'http://localhost:9119');
  assert.equal(ok('10.0.2.2:9119').baseUrl, 'http://10.0.2.2:9119');
  assert.equal(ok('192.168.1.42').baseUrl, 'http://192.168.1.42:9119');
  assert.equal(ok('172.20.0.9').baseUrl, 'http://172.20.0.9:9119');
  assert.equal(ok('[::1]:9119').baseUrl, 'http://[::1]:9119');
});

test('a bare public host defaults to https on 443', () => {
  assert.equal(ok('gateway.example.com').baseUrl, 'https://gateway.example.com:443');
  assert.equal(ok('hermes.shameel.dev:8443').baseUrl, 'https://hermes.shameel.dev:8443');
  assert.equal(ok('172.32.0.9').baseUrl, 'https://172.32.0.9:443');
});

test('a trailing slash is stripped', () => {
  assert.equal(ok('http://127.0.0.1:9119/').baseUrl, 'http://127.0.0.1:9119');
  assert.equal(ok('gateway.example.com/').baseUrl, 'https://gateway.example.com:443');
});

test('empty and spaced input is rejected', () => {
  assert.equal(reason('   '), 'Enter a gateway address.');
  assert.equal(reason('not a host'), 'A gateway address cannot contain spaces.');
});

test('non-http schemes are rejected', () => {
  assert.match(reason('ftp://gateway.example.com'), /not supported/);
});

test('paths, queries and fragments are rejected', () => {
  const message = 'Give just a host and port, without a path, query or fragment.';
  assert.equal(reason('http://gateway.example.com/api'), message);
  assert.equal(reason('gateway.example.com:9119?x=1'), message);
  assert.equal(reason('gateway.example.com:9119#top'), message);
});

test('credentials in the address are rejected', () => {
  assert.equal(reason('http://user:secret@gateway.example.com:9119'), 'Remove the credentials from the address.');
});

test('ports outside 1-65535 are rejected', () => {
  const message = 'The port must be a number between 1 and 65535.';
  assert.equal(reason('http://gateway.example.com:0'), message);
  assert.equal(reason('http://gateway.example.com:70000'), message);
  assert.equal(reason('http://gateway.example.com:abc'), message);
});
