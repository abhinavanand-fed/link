import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LinkStore } from '../lib/store.js';

function makeStore() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linklite-'));
  const filePath = path.join(tmpDir, 'links.local.json');

  return new LinkStore({
    mongoUri: '',
    fallbackFilePath: filePath,
    dbName: 'ignored',
    collectionName: 'ignored'
  });
}

test('local fallback mode works without MongoDB URI', async () => {
  const store = makeStore();

  const record = await store.create({
    originalUrl: 'https://example.com',
    customCode: 'abc123',
    title: 'Example'
  });

  assert.equal(record.shortCode, 'abc123');

  const fetched = await store.getByCode('abc123');
  assert.ok(fetched);
  assert.equal(fetched.originalUrl, 'https://example.com');

  await store.addVisit('abc123', { ipAddress: '127.0.0.1', userAgent: 'node-test', referer: '' });

  const withVisit = await store.getByCode('abc123');
  assert.equal(withVisit.clickCount, 1);
  assert.equal(withVisit.visits.length, 1);
});

test('cleanupExpired removes old links and keeps active links', async () => {
  const store = makeStore();

  await store.create({
    originalUrl: 'https://example.com/live',
    customCode: 'live1',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  await store.create({
    originalUrl: 'https://example.com/old',
    customCode: 'old11',
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  });

  const removed = await store.cleanupExpired();
  assert.equal(removed, 1);
  assert.ok(await store.getByCode('live1'));
  assert.equal(await store.getByCode('old11'), null);
});

test('create throws for duplicate custom code', async () => {
  const store = makeStore();

  await store.create({
    originalUrl: 'https://example.com/one',
    customCode: 'dupe01'
  });

  await assert.rejects(
    () =>
      store.create({
        originalUrl: 'https://example.com/two',
        customCode: 'dupe01'
      }),
    /already exists/
  );
});
