# Pulse — Next-Gen Messaging & Content Platform

A full-stack MVP implementing the design from `Next-Gen Messaging and Content Platform Design.pdf`:

- **Email-based auth** (signup/login, JWT, bcrypt)
- **Real-time chat** (REST + WebSocket): direct, group, AI
- **AI chat** (OpenAI-compatible if `OPENAI_API_KEY` set, local fallback otherwise)
- **Game Hub** — upload single-file HTML5 games, play in iframe, ratings & reviews, play-count tracking
- **YouTube proxy** — search YouTube, stream videos through the server using `yt-dlp` (byte-range, caching)
- **Educational web proxy** — server-side fetch, response sanitization, HTML/CSS URL rewriting, form POST support, redirect validation, per-tab server-side cookies
- **iMessage-inspired UI** — bubbles, typing indicators, dark mode, sidebar nav

## Stack

- Backend: Node.js / Express 5 / `ws` / better-sqlite3 / yt-dlp
- Frontend: Vanilla HTML/CSS/JS SPA (no build step)
- Storage: SQLite (in `backend/data/app.db`); uploads on disk under `backend/uploads/`

## Prerequisites

- Node.js 18+
- Optional for YouTube features: `yt-dlp` and `ffmpeg` installed (`brew install yt-dlp ffmpeg`)

## Run

```sh
cd backend
npm install
npm start
```

Open http://localhost:4000

## Test

```sh
cd backend
npm test
```

## Deploy

See [DEPLOY-VERCEL.md](./DEPLOY-VERCEL.md). Short version: **Vercel for frontend + Railway/Fly/Render for backend** (Vercel can't host the WebSockets, SQLite, and `yt-dlp` streaming).

Optional env:
- `OPENAI_API_KEY` — enable real LLM responses on the AI tab
- `JWT_SECRET` — override JWT secret
- `GOOGLE_CLIENT_ID` — enable Google Sign-In
- `ALLOW_GUEST=0` — disable guest accounts in production
- `CORS_ORIGINS=https://your-frontend.example` — restrict browser origins
- `PORT` — default 4000

## Try it out

1. **Sign in** with Google, or use **Continue as Guest** for a quick local account.
2. **Chats** — search for another user by email, click to start a 1:1 chat. Type and send.
3. **AI** — go to the AI tab and chat. Replies appear via WebSocket.
4. **Games** — click "Upload Game" → "Use sample game" to upload the bundled clicker. Play & rate it.
5. **YouTube** — search a video, click to play. Streamed via `/api/v1/youtube/stream/:id` (yt-dlp + range proxying).
6. **Web** — enter a URL or search term to browse through `/api/v1/proxy/fetch`.

## Key endpoints

```
GET   /api/v1/config
POST  /api/v1/auth/google | /api/v1/auth/guest | /api/v1/auth/dev
GET   /api/v1/me                    PUT /api/v1/profile
GET   /api/v1/users/search?q=
GET   /api/v1/chats                 GET /api/v1/chats/ai
POST  /api/v1/chats/direct          POST /api/v1/chats/group
GET   /api/v1/chats/:id/messages    POST /api/v1/chats/:id/message
GET   /api/v1/games                 POST /api/v1/games
GET   /api/v1/games/:id             POST /api/v1/games/:id/play|review
GET   /games/:id/...                (asset serving for game)
GET   /api/v1/youtube/search?q=
GET   /api/v1/youtube/info/:id
GET   /api/v1/youtube/stream/:id    (Range-aware video proxy)
GET   /api/v1/proxy/fetch?url=      (Educational HTTP proxy)
POST  /api/v1/proxy/fetch?url=      (Proxied form posts)
WS    /ws?token=...                 (auth via JWT)
```

## YouTube proxy notes

- Uses `yt-dlp -j` to resolve browser-playable progressive MP4 or HLS formats.
- Resolved stream URLs are cached for 4h; full byte-range proxy via `node-fetch` response piping.
- For higher quality at scale, terminate transcoding via `ffmpeg` before piping (not enabled by default for cost reasons).

## Educational web proxy notes

- Allows only `http` and `https` targets.
- Blocks localhost, loopback, link-local, and RFC1918 private addresses.
- Resolves DNS before fetching and validates each redirect before following it.
- Strips hop-by-hop, cookie, CSP, frame, HSTS, and compressed-body headers that break proxied rendering.
- Keeps upstream cookies in an ephemeral server-side jar keyed by a frontend proxy session ID, so multi-page sessions work without exposing target-site cookies to the Pulse origin.
- Rewrites common HTML/CSS navigation surfaces: `href`, `src`, `action`, `srcset`, CSS `url(...)`, CSS `@import`, and meta refresh URLs.
- Injects small browser-side shims for links, forms, `window.open`, `fetch`, and `XMLHttpRequest`.

This is a learning-oriented HTTP proxy, not a filter-evasion tool. Many modern sites depend on cookies, strict origin checks, service workers, signed API calls, or anti-bot systems; those will still be partial or broken through a simple rewriting proxy.

## Platform improvement guide

See [PLATFORM-IMPROVEMENT-GUIDE.md](./PLATFORM-IMPROVEMENT-GUIDE.md) for a prioritized roadmap.

## Out of scope for this MVP (designed but not implemented)

- WebRTC voice/video, SFU
- E2EE Signal protocol & PQ3
- Push (APNs/FCM), service workers
- Avatar uploads to S3/CDN
- Kubernetes/Redis Pub/Sub fan-out, multi-region

The schema in `backend/db.js` and the API surface anticipate these additions.
