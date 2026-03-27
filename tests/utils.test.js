import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCustomCode, isValidHttpUrl, isExpired, toIsoOrNull } from '../lib/utils.js';

test('validates HTTP/HTTPS URLs', () => {
  assert.equal(isValidHttpUrl('https://example.com'), true);
  assert.equal(isValidHttpUrl('http://example.com/path'), true);
  assert.equal(isValidHttpUrl('ftp://example.com'), false);
  assert.equal(isValidHttpUrl('nope'), false);
});

test('validates custom short code format', () => {
  assert.equal(isValidCustomCode('abc_123-XYZ'), true);
  assert.equal(isValidCustomCode('ab'), false);
  assert.equal(isValidCustomCode('invalid space'), false);
});

test('parses expiration and evaluates expiration window', () => {
  const futureIso = toIsoOrNull('2099-01-01T12:00');
  assert.ok(futureIso);
  assert.equal(isExpired(futureIso), false);

  const pastIso = toIsoOrNull('2000-01-01T00:00');
  assert.ok(pastIso);
  assert.equal(isExpired(pastIso), true);

  assert.equal(toIsoOrNull('not-a-date'), null);
});
