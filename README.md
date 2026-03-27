# LinkLite JS (Node.js + MongoDB)

A full-featured JavaScript link shortener website with:

- Short link generation
- Optional custom aliases
- Optional expiration timestamps
- Redirect + click tracking
- Visit logs (IP, referer, user-agent)
- Browser UI and JSON API
- MongoDB Atlas persistence (works well on Render)

## Quick start (local)

```bash
npm install
export MONGODB_URI='your_mongodb_connection_string'
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
5. Deploy.

## Important security note

Because a MongoDB credential was shared in chat, rotate/reset that MongoDB password in Atlas before production use and set the new URI via Render environment variables.

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
- `MONGODB_URI` (**required**)
- `MONGODB_DB` (default: `linklite`)
- `MONGODB_COLLECTION` (default: `links`)
