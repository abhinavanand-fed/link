# LinkLite JS (Node.js)

A full-featured JavaScript link shortener website with:

- Short link generation
- Optional custom aliases
- Optional expiration timestamps
- Redirect + click tracking
- Visit logs (IP, referer, user-agent)
- Browser UI and JSON API
- Persistent JSON storage for local deployments

## Quick start

```bash
node server.js
```

Server runs on `http://localhost:5000` by default.

## NPM scripts

```bash
npm start
npm run dev
npm test
```

## API

### Create short link

`POST /api/shorten`

```json
{
  "url": "https://example.com/docs",
  "customCode": "docs",
  "title": "Documentation",
  "expiresAt": "2026-12-31T23:59"
}
```

### Get link stats

`GET /api/stats/<code>`

### Redirect

`GET /<code>`

## Environment variables

- `PORT` (default: `5000`)
- `HOST` (default: `0.0.0.0`)
- `BASE_URL` (optional absolute base used to build short URLs)
- `DATA_PATH` (default: `./data/links.json`)
