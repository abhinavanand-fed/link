# LinkLite JS (Node.js + MongoDB)

A full-featured JavaScript link shortener website with:

- Short link generation
- Optional custom aliases
- Optional expiration timestamps
- Redirect + click tracking
- Visit logs (referer, user-agent) with click counts (no IP storage)
- Browser UI and JSON API
- MongoDB Atlas persistence (works well on Render)
- Automatic local-file fallback if `MONGODB_URI` is not set
- Basic write rate limiting + optional API key auth
- Owner-scoped link visibility (only your own links/stats are listed)

## Quick start (local)

### Option A: Local fallback mode (no MongoDB required)

```bash
npm install
npm start
```

This runs immediately and stores links in `data/links.local.json`.

### Option B: MongoDB mode

**macOS/Linux (bash/zsh):**

```bash
npm install
export MONGODB_URI='your_mongodb_connection_string'
npm start
```

**Windows CMD:**

```cmd
npm install
set MONGODB_URI=your_mongodb_connection_string
npm start
```

**Windows PowerShell:**

```powershell
npm install
$env:MONGODB_URI="your_mongodb_connection_string"
npm start
```

Server runs on `http://localhost:5000` by default.

## Deploy on Render

1. Push this repo to GitHub.
2. In Render, create a **Web Service** from the repo.
3. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Add environment variables in Render:
   - `MONGODB_URI` = your Atlas URI
   - `MONGODB_DB` = `linklite` (or your preferred DB name)
   - `MONGODB_COLLECTION` = `links` (or your preferred collection)
   - `BASE_URL` = your Render public URL (optional but recommended)
   - `API_KEY` = protect `POST /api/shorten` (optional but recommended)
5. Deploy.

## Important security note

Because a MongoDB credential was shared in chat, rotate/reset that MongoDB password in Atlas before production use and set the new URI via environment variables.

## NPM scripts

```bash
npm start
npm run dev
npm test
```

## API

### Create short link

`POST /api/shorten`

Headers (optional unless `API_KEY` is configured):

```http
x-api-key: <your_api_key>
```

Body:

```json
{
  "url": "https://example.com/docs",
  "customCode": "docs",
  "title": "Documentation",
  "expiresAt": "2026-12-31T23:59:00Z"
}
```

> `expiresAt` must be ISO 8601 with timezone (`Z` or offset).

### Get link stats

`GET /api/stats/<code>?limit=25&offset=0`

This endpoint only returns stats when the requester owner ID matches the link owner. For API clients, pass `x-owner-id` consistently when creating and reading links.

### Redirect

`GET /<code>`

Redirects are private to the link owner. Requests from a different owner ID/cookie receive `404`.


## Ownership scoping

- API clients should send the same `x-owner-id` value on create/stats requests to see only their own links.
- Browser UI uses a secure cookie (`ll_owner`) to scope **Your recent links** and stats pages.

## Troubleshooting deploy syntax errors

Before deploying, run:

```bash
npm run check:syntax
```

This catches parser/syntax issues in `server.js` and `lib/store.js` early.

## Environment variables

- `PORT` (default: `5000`)
- `HOST` (default: `0.0.0.0`)
- `BASE_URL` (optional absolute base used to build short URLs)
- `MONGODB_URI` (optional; if missing, app uses local fallback)
- `MONGODB_DB` (default: `linklite`)
- `MONGODB_COLLECTION` (default: `links`)
- `FALLBACK_FILE_PATH` (default: `./data/links.local.json`)
- `API_KEY` (optional key required for `POST /api/shorten`)
- `WRITE_RATE_LIMIT_WINDOW_MS` (default: `60000`)
- `WRITE_RATE_LIMIT_MAX` (default: `30`)
- `CLEANUP_INTERVAL_MS` (default: `900000`)
