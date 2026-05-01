# Pulse — Next-Gen Messaging & Content Platform

A full-stack MVP implementing the design from `Next-Gen Messaging and Content Platform Design.pdf`:

- **Email-based auth** (signup/login, JWT, bcrypt)
- **Real-time chat** (REST + WebSocket): direct, group, AI
- **AI chat** (OpenAI-compatible if `OPENAI_API_KEY` set, local fallback otherwise)
- **Game Hub** — upload single-file HTML5 games, play in iframe, ratings & reviews, play-count tracking
- **YouTube proxy** — search YouTube, stream videos through the server using `yt-dlp` (byte-range, caching)
- **iMessage-inspired UI** — bubbles, typing indicators, dark mode, sidebar nav

## Stack

- Backend: Node.js / Express 5 / `ws` / better-sqlite3 / yt-dlp
- Frontend: Vanilla HTML/CSS/JS SPA (no build step)
- Storage: SQLite (in `backend/data/app.db`); uploads on disk under `backend/uploads/`

## Prerequisites

- Node.js 18+
- `yt-dlp` and `ffmpeg` installed (`brew install yt-dlp ffmpeg`)

## Run

```sh
cd backend
npm install        # already installed
node server.js
```

Open http://localhost:4000

## Deploy

See [DEPLOY-VERCEL.md](./DEPLOY-VERCEL.md). Short version: **Vercel for frontend + Railway/Fly/Render for backend** (Vercel can't host the WebSockets, SQLite, and `yt-dlp` streaming).

Optional env:
- `OPENAI_API_KEY` — enable real LLM responses on the AI tab
- `JWT_SECRET` — override JWT secret
- `PORT` — default 4000

## Try it out

1. **Sign up** with any email + password (≥6 chars).
2. **Chats** — search for another user by email, click to start a 1:1 chat. Type and send.
3. **AI** — go to the AI tab and chat. Replies appear via WebSocket.
4. **Games** — click "Upload Game" → "Use sample game" to upload the bundled clicker. Play & rate it.
5. **YouTube** — search a video, click to play. Streamed via `/api/v1/youtube/stream/:id` (yt-dlp + range proxying).

## Key endpoints

```
POST  /api/v1/register | /api/v1/login
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
GET   /api/v1/youtube/stream/:id    (Range-aware MP4 proxy)
WS    /ws?token=...                 (auth via JWT)
```

## YouTube proxy notes

- Uses `yt-dlp -f 18/best[ext=mp4][protocol^=https]…` to force a progressive HTTPS MP4 (universal browser playback).
- Resolved stream URLs are cached for 4h; full byte-range proxy via `node-fetch` → response stream pipe.
- For higher quality at scale, terminate transcoding via `ffmpeg` before piping (not enabled by default for cost reasons).

## Out of scope for this MVP (designed but not implemented)

- WebRTC voice/video, SFU
- E2EE Signal protocol & PQ3
- Push (APNs/FCM), service workers
- OAuth (Google), avatar uploads to S3/CDN
- Kubernetes/Redis Pub/Sub fan-out, multi-region

The schema in `backend/db.js` and the API surface anticipate these additions.
