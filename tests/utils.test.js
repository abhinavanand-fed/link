import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isExpired,
  isPrivateOrLocalHost,
  isSafePublicHttpUrl,
  isValidCustomCode,
  isValidHttpUrl,
  toIsoOrNull
} from '../lib/utils.js';

test('validates HTTP/HTTPS URLs', () => {
  assert.equal(isValidHttpUrl('https://example.com'), true);
  assert.equal(isValidHttpUrl('http://example.com/path'), true);
  assert.equal(isValidHttpUrl('ftp://example.com'), false);
  assert.equal(isValidHttpUrl('nope'), false);
});

test('validates public-safe HTTP URLs', () => {
  assert.equal(isSafePublicHttpUrl('https://example.com'), true);
  assert.equal(isSafePublicHttpUrl('http://localhost:3000'), false);
  assert.equal(isSafePublicHttpUrl('http://127.0.0.1/test'), false);
  assert.equal(isSafePublicHttpUrl('http://10.1.2.3/path'), false);
});

test('detects private hostnames and ip ranges', () => {
  assert.equal(isPrivateOrLocalHost('localhost'), true);
  assert.equal(isPrivateOrLocalHost('127.0.0.1'), true);
  assert.equal(isPrivateOrLocalHost('192.168.1.4'), true);
  assert.equal(isPrivateOrLocalHost('example.com'), false);
});

test('validates custom short code format', () => {
  assert.equal(isValidCustomCode('abc_123-XYZ'), true);
  assert.equal(isValidCustomCode('ab'), false);
  assert.equal(isValidCustomCode('invalid space'), false);
});

test('parses expiration and evaluates expiration window', () => {
  const futureIso = toIsoOrNull('2099-01-01T12:00:00Z');
  assert.ok(futureIso);
  assert.equal(isExpired(futureIso), false);

  const pastIso = toIsoOrNull('2000-01-01T00:00:00Z');
  assert.ok(pastIso);
  assert.equal(isExpired(pastIso), true);

  assert.equal(toIsoOrNull('2026-12-31T23:59'), null);
  assert.equal(toIsoOrNull('not-a-date'), null);
});
