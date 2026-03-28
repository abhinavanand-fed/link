import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.API_KEY = 'secret-key';

const { server } = await import('../server.js');

let baseUrl = '';

test.before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

test('api/shorten requires API key when configured', async () => {
  const response = await fetch(`${baseUrl}/api/shorten`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com' })
  });

  assert.equal(response.status, 401);
});

test('api/shorten creates link and stats supports pagination', async () => {
  const createResponse = await fetch(`${baseUrl}/api/shorten`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'secret-key'
    },
    body: JSON.stringify({
      url: 'https://example.com/docs',
      customCode: 'docs12',
      title: 'Docs',
      expiresAt: '2099-01-01T00:00:00Z'
    })
  });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.shortCode, 'docs12');

  const redirectResponse = await fetch(`${baseUrl}/docs12`, { redirect: 'manual' });
  assert.equal(redirectResponse.status, 302);

  const statsResponse = await fetch(`${baseUrl}/api/stats/docs12?limit=1&offset=0`);
  assert.equal(statsResponse.status, 200);

  const stats = await statsResponse.json();
  assert.equal(stats.shortCode, 'docs12');
  assert.equal(stats.pagination.limit, 1);
  assert.equal(stats.pagination.offset, 0);
  assert.ok(Array.isArray(stats.visits));
});

test('rejects private destination URLs', async () => {
  const createResponse = await fetch(`${baseUrl}/api/shorten`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'secret-key'
    },
    body: JSON.stringify({
      url: 'http://127.0.0.1/admin'
    })
  });

  assert.equal(createResponse.status, 400);
});
