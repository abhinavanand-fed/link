import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinkStore } from './lib/store.js';
import {
  escapeHtml,
  isExpired,
  isValidCustomCode,
  isValidHttpUrl,
  toIsoOrNull
} from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = process.env.BASE_URL || '';
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'linklite';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'links';

const store = new LinkStore({
  mongoUri: MONGODB_URI,
  dbName: MONGODB_DB,
  collectionName: MONGODB_COLLECTION
});

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch {
          resolve({});
        }
        return;
      }

      const params = new URLSearchParams(data);
      resolve(Object.fromEntries(params.entries()));
    });
  });
}

function send(res, status, body, contentType = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

function buildShortUrl(req, code) {
  if (BASE_URL) return `${BASE_URL.replace(/\/$/, '')}/${code}`;
  const host = req.headers.host || `localhost:${PORT}`;
  return `http://${host}/${code}`;
}

function pageLayout(title, content) {
  const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf-8');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">🔗 LinkLite JS</a>
    <p class="subtitle">JavaScript-powered link shortener with analytics</p>
  </header>
  <main class="container">${content}</main>
</body>
</html>`;
}

async function homePage(message = '') {
  const recentLinks = await store.getRecent(15);
  const recent = recentLinks
    .map(
      (item) => `<tr>
<td><code>${escapeHtml(item.shortCode)}</code></td>
<td><a href="${escapeHtml(item.originalUrl)}">${escapeHtml(item.originalUrl)}</a></td>
<td>${item.clickCount}</td>
<td><a href="/stats/${escapeHtml(item.shortCode)}">View stats</a></td>
</tr>`
    )
    .join('');

  const messageHtml = message ? `<div class="message">${escapeHtml(message)}</div>` : '';

  return pageLayout(
    'Create short links',
    `${messageHtml}
<section class="card">
<h1>Create a short link</h1>
<form method="post" action="/shorten" class="stack">
  <label>Destination URL<input type="url" name="originalUrl" required placeholder="https://example.com/very/long/link"/></label>
  <label>Custom alias (optional)<input type="text" name="customCode" placeholder="promo-2026"/></label>
  <label>Title (optional)<input type="text" name="title" placeholder="Campaign name"/></label>
  <label>Expiration (optional, ISO datetime)<input type="text" name="expiresAt" placeholder="2026-12-31T23:59"/></label>
  <button type="submit">Shorten link</button>
</form>
</section>
<section class="card">
<h2>Recent links</h2>
<div class="table-wrap">
<table>
<thead><tr><th>Code</th><th>Destination</th><th>Clicks</th><th>Stats</th></tr></thead>
<tbody>${recent || '<tr><td colspan="4">No links created yet.</td></tr>'}</tbody>
</table>
</div>
</section>`
  );
}

function createdPage(shortUrl, record) {
  return pageLayout(
    'Short link created',
    `<section class="card">
<h1>Short link created</h1>
<p>Your short URL is:</p>
<p><a class="short-link" href="${escapeHtml(shortUrl)}">${escapeHtml(shortUrl)}</a></p>
<p>Original URL: <a href="${escapeHtml(record.originalUrl)}">${escapeHtml(record.originalUrl)}</a></p>
<div class="actions">
  <a class="button" href="/stats/${escapeHtml(record.shortCode)}">Open stats</a>
  <a class="button secondary" href="/">Create another</a>
</div>
</section>`
  );
}

function statsPage(record) {
  const visitRows = (record.visits || [])
    .slice(0, 50)
    .map(
      (visit) => `<tr>
<td>${escapeHtml(visit.visitedAt)}</td>
<td>${escapeHtml(visit.ipAddress || 'Unknown')}</td>
<td>${escapeHtml(visit.referer || 'Direct')}</td>
<td>${escapeHtml(visit.userAgent || 'Unknown')}</td>
</tr>`
    )
    .join('');

  return pageLayout(
    `Stats for ${record.shortCode}`,
    `<section class="card">
<h1>Analytics for <code>${escapeHtml(record.shortCode)}</code></h1>
<p><strong>Destination:</strong> <a href="${escapeHtml(record.originalUrl)}">${escapeHtml(record.originalUrl)}</a></p>
<p><strong>Total clicks:</strong> ${record.clickCount}</p>
<p><strong>Created:</strong> ${escapeHtml(record.createdAt)}</p>
<p><strong>Expires:</strong> ${escapeHtml(record.expiresAt || 'Never')}</p>
</section>
<section class="card">
<h2>Recent visits</h2>
<div class="table-wrap">
<table>
<thead><tr><th>When (UTC)</th><th>IP</th><th>Referer</th><th>User agent</th></tr></thead>
<tbody>${visitRows || '<tr><td colspan="4">No visit data yet.</td></tr>'}</tbody>
</table>
</div>
</section>`
  );
}

function notFoundPage() {
  return pageLayout('Not found', '<section class="card"><h1>404</h1><p>The link does not exist.</p></section>');
}

async function route(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathName = reqUrl.pathname;

  if (req.method === 'GET' && pathName === '/public/styles.css') {
    const cssPath = path.join(__dirname, 'public', 'styles.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    return send(res, 200, css, 'text/css; charset=utf-8');
  }

  if (req.method === 'GET' && pathName === '/') {
    return send(res, 200, await homePage());
  }

  if (req.method === 'POST' && pathName === '/shorten') {
    const body = await parseBody(req);
    const originalUrl = String(body.originalUrl || '').trim();
    const customCode = String(body.customCode || '').trim();
    const title = String(body.title || '').trim();
    const expiresAtInput = String(body.expiresAt || '').trim();

    if (!isValidHttpUrl(originalUrl)) {
      return send(res, 400, await homePage('Please provide a valid URL that starts with http:// or https://'));
    }

    if (customCode && !isValidCustomCode(customCode)) {
      return send(res, 400, await homePage('Custom code must be 3-32 chars: letters, numbers, - or _.'));
    }

    if (customCode && await store.codeExists(customCode)) {
      return send(res, 409, await homePage('That custom alias is already taken.'));
    }

    const expiresAt = toIsoOrNull(expiresAtInput);
    if (expiresAtInput && !expiresAt) {
      return send(res, 400, await homePage('Expiration should be a valid date/time. Example: 2026-12-31T23:59'));
    }

    const record = await store.create({
      originalUrl,
      customCode: customCode || null,
      title,
      expiresAt
    });

    return send(res, 201, createdPage(buildShortUrl(req, record.shortCode), record));
  }

  if (req.method === 'POST' && pathName === '/api/shorten') {
    const body = await parseBody(req);
    const originalUrl = String(body.url || '').trim();
    const customCode = String(body.customCode || '').trim();
    const title = String(body.title || '').trim();
    const expiresAtInput = String(body.expiresAt || '').trim();

    if (!isValidHttpUrl(originalUrl)) {
      return send(res, 400, JSON.stringify({ error: 'Invalid URL.' }), 'application/json');
    }

    if (customCode && !isValidCustomCode(customCode)) {
      return send(res, 400, JSON.stringify({ error: 'Invalid custom code.' }), 'application/json');
    }

    if (customCode && await store.codeExists(customCode)) {
      return send(res, 409, JSON.stringify({ error: 'Custom code already exists.' }), 'application/json');
    }

    const expiresAt = toIsoOrNull(expiresAtInput);
    if (expiresAtInput && !expiresAt) {
      return send(res, 400, JSON.stringify({ error: 'Invalid expiration datetime.' }), 'application/json');
    }

    const record = await store.create({ originalUrl, customCode: customCode || null, title, expiresAt });
    return send(
      res,
      201,
      JSON.stringify({
        shortCode: record.shortCode,
        shortUrl: buildShortUrl(req, record.shortCode),
        originalUrl: record.originalUrl
      }),
      'application/json'
    );
  }

  if (req.method === 'GET' && pathName.startsWith('/api/stats/')) {
    const code = decodeURIComponent(pathName.replace('/api/stats/', ''));
    const record = await store.getByCode(code);
    if (!record) return send(res, 404, JSON.stringify({ error: 'Not found' }), 'application/json');

    return send(
      res,
      200,
      JSON.stringify({
        shortCode: record.shortCode,
        originalUrl: record.originalUrl,
        title: record.title,
        clickCount: record.clickCount,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        recentVisits: record.visits.slice(0, 25)
      }),
      'application/json'
    );
  }

  if (req.method === 'GET' && pathName.startsWith('/stats/')) {
    const code = decodeURIComponent(pathName.replace('/stats/', ''));
    const record = await store.getByCode(code);
    if (!record) return send(res, 404, notFoundPage());
    return send(res, 200, statsPage(record));
  }

  if (req.method === 'GET' && pathName.length > 1) {
    const code = decodeURIComponent(pathName.slice(1));
    const record = await store.getByCode(code);
    if (!record) return send(res, 404, notFoundPage());
    if (isExpired(record.expiresAt)) {
      return send(res, 410, await homePage('This short link has expired.'));
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers.referer || '';

    await store.addVisit(code, { ipAddress, userAgent, referer });
    res.writeHead(302, { location: record.originalUrl });
    res.end();
    return;
  }

  return send(res, 404, notFoundPage());
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    send(res, 500, pageLayout('Server error', '<section class="card"><h1>500</h1><p>Unexpected error.</p></section>'));
  });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => {
    console.log(`LinkLite JS running on http://${HOST}:${PORT}`);
  });
}

async function shutdown() {
  await store.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { server, store };
