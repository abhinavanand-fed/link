import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { LinkStore } from '../lib/store.js';

test('local fallback mode works without MongoDB URI', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linklite-'));
  const filePath = path.join(tmpDir, 'links.local.json');

  const store = new LinkStore({
    mongoUri: '',
    fallbackFilePath: filePath,
    dbName: 'ignored',
    collectionName: 'ignored'
  });

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
