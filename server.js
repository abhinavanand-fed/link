import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinkStore } from './lib/store.js';
import {
  escapeHtml,
  isExpired,
  isSafePublicHttpUrl,
  isValidCustomCode,
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
const FALLBACK_FILE_PATH = process.env.FALLBACK_FILE_PATH || path.join(__dirname, 'data', 'links.local.json');
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 15 * 60 * 1000);
const WRITE_RATE_LIMIT_WINDOW_MS = Number(process.env.WRITE_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const WRITE_RATE_LIMIT_MAX = Number(process.env.WRITE_RATE_LIMIT_MAX || 30);
const API_KEY = process.env.API_KEY || '';

const store = new LinkStore({
  mongoUri: MONGODB_URI,
  dbName: MONGODB_DB,
  collectionName: MONGODB_COLLECTION,
  fallbackFilePath: FALLBACK_FILE_PATH
});

const CSS_PATH = path.join(__dirname, 'public', 'styles.css');
const CSS_CONTENT = fs.readFileSync(CSS_PATH, 'utf-8');
const writeRateLimiter = new Map();

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

function getSecurityHeaders(contentType) {
  return {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), microphone=(), camera=()',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
  };
}

function send(res, status, body, contentType = 'text/html; charset=utf-8') {
  res.writeHead(status, getSecurityHeaders(contentType));
  res.end(body);
}

function sendJson(res, status, payload) {
  return send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function jsonError(res, status, code, message) {
  return sendJson(res, status, { error: { code, message } });
}

function buildShortUrl(req, code) {
  if (BASE_URL) return `${BASE_URL.replace(/\/$/, '')}/${code}`;
  const host = req.headers.host || `localhost:${PORT}`;
  return `http://${host}/${code}`;
}

function pageLayout(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${CSS_CONTENT}</style>
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
  <label>Expiration (optional, ISO datetime with timezone)<input type="text" name="expiresAt" placeholder="2026-12-31T23:59:00Z"/></label>
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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function enforceWriteRateLimit(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const key = `${ip}|${req.url}`;
  const state = writeRateLimiter.get(key) || { count: 0, resetAt: now + WRITE_RATE_LIMIT_WINDOW_MS };

  if (now > state.resetAt) {
    state.count = 0;
    state.resetAt = now + WRITE_RATE_LIMIT_WINDOW_MS;
  }

  state.count += 1;
  writeRateLimiter.set(key, state);

  if (state.count > WRITE_RATE_LIMIT_MAX) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000))
    };
  }

  return { blocked: false };
}

function requireApiKey(req) {
  if (!API_KEY) return true;
  const provided = req.headers['x-api-key'];
  return typeof provided === 'string' && provided === API_KEY;
}

function sanitizeVisitRecord(record) {
  return {
    visitedAt: record.visitedAt,
    ipAddress: record.ipAddress,
    referer: record.referer,
    userAgent: record.userAgent
  };
}

async function route(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathName = reqUrl.pathname;

  if (req.method === 'GET' && pathName === '/public/styles.css') {
    return send(res, 200, CSS_CONTENT, 'text/css; charset=utf-8');
  }

  if (req.method === 'GET' && pathName === '/') {
    return send(res, 200, await homePage());
  }

  if (req.method === 'POST' && (pathName === '/shorten' || pathName === '/api/shorten')) {
    const rate = enforceWriteRateLimit(req);
    if (rate.blocked) {
      res.setHeader('retry-after', String(rate.retryAfterSeconds));
      if (pathName === '/api/shorten') return jsonError(res, 429, 'rate_limited', 'Too many create requests. Please retry later.');
      return send(res, 429, await homePage('Too many requests. Please wait and try again.'));
    }
  }

  if (req.method === 'POST' && pathName === '/shorten') {
    const body = await parseBody(req);
    const originalUrl = String(body.originalUrl || '').trim();
    const customCode = String(body.customCode || '').trim();
    const title = String(body.title || '').trim();
    const expiresAtInput = String(body.expiresAt || '').trim();

    if (!isSafePublicHttpUrl(originalUrl)) {
      return send(res, 400, await homePage('Please provide a valid public URL that starts with http:// or https://'));
    }

    if (customCode && !isValidCustomCode(customCode)) {
      return send(res, 400, await homePage('Custom code must be 3-32 chars: letters, numbers, - or _.'));
    }

    const expiresAt = toIsoOrNull(expiresAtInput);
    if (expiresAtInput && !expiresAt) {
      return send(res, 400, await homePage('Expiration must be ISO 8601 with timezone. Example: 2026-12-31T23:59:00Z'));
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
    if (!requireApiKey(req)) {
      return jsonError(res, 401, 'unauthorized', 'Missing or invalid API key.');
    }

    const body = await parseBody(req);
    const originalUrl = String(body.url || '').trim();
    const customCode = String(body.customCode || '').trim();
    const title = String(body.title || '').trim();
    const expiresAtInput = String(body.expiresAt || '').trim();

    if (!isSafePublicHttpUrl(originalUrl)) {
      return jsonError(res, 400, 'invalid_url', 'Invalid URL. Must be public http(s).');
    }

    if (customCode && !isValidCustomCode(customCode)) {
      return jsonError(res, 400, 'invalid_custom_code', 'Invalid custom code.');
    }

    const expiresAt = toIsoOrNull(expiresAtInput);
    if (expiresAtInput && !expiresAt) {
      return jsonError(res, 400, 'invalid_expiration', 'Invalid expiration datetime. Use ISO 8601 with timezone.');
    }

    const record = await store.create({ originalUrl, customCode: customCode || null, title, expiresAt });
    return sendJson(res, 201, {
      shortCode: record.shortCode,
      shortUrl: buildShortUrl(req, record.shortCode),
      originalUrl: record.originalUrl,
      title: record.title,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt
    });
  }

  if (req.method === 'GET' && pathName.startsWith('/api/stats/')) {
    const code = decodeURIComponent(pathName.replace('/api/stats/', ''));
    const record = await store.getByCode(code);
    if (!record) return jsonError(res, 404, 'not_found', 'Not found');

    const limit = Math.max(1, Math.min(100, Number(reqUrl.searchParams.get('limit') || 25)));
    const offset = Math.max(0, Number(reqUrl.searchParams.get('offset') || 0));
    const totalVisits = record.visits.length;

    return sendJson(res, 200, {
      shortCode: record.shortCode,
      originalUrl: record.originalUrl,
      title: record.title,
      clickCount: record.clickCount,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      visits: record.visits.slice(offset, offset + limit).map(sanitizeVisitRecord),
      pagination: {
        limit,
        offset,
        total: totalVisits
      }
    });
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

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers.referer || '';

    await store.addVisit(code, { ipAddress, userAgent, referer });
    res.writeHead(302, { location: record.originalUrl, ...getSecurityHeaders('text/plain; charset=utf-8') });
    res.end();
    return;
  }

  return send(res, 404, notFoundPage());
}

const server = http.createServer((req, res) => {
  const started = Date.now();

  const finish = () => {
    const durationMs = Date.now() - started;
    const ip = getClientIp(req);
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      method: req.method,
      path: req.url,
      statusCode: res.statusCode,
      durationMs,
      ip
    }));
  };

  res.on('finish', finish);

  route(req, res).catch((error) => {
    console.error(error);
    send(res, 500, pageLayout('Server error', '<section class="card"><h1>500</h1><p>Unexpected error.</p></section>'));
  });
});

let cleanupTimer = null;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, HOST, () => {
    const mode = MONGODB_URI ? 'MongoDB mode' : `Local fallback mode (${FALLBACK_FILE_PATH})`;
    console.log(`LinkLite JS running on http://${HOST}:${PORT} - ${mode}`);
  });

  cleanupTimer = setInterval(async () => {
    try {
      const removed = await store.cleanupExpired();
      if (removed > 0) {
        console.log(`Expired links cleanup removed ${removed} links.`);
      }
    } catch (error) {
      console.error('Cleanup job failed:', error);
    }
  }, CLEANUP_INTERVAL_MS);

  cleanupTimer.unref();
}

async function shutdown() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  await store.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { server, store };
