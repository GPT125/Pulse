# Deploying to Vercel (frontend) + Backend host (Railway / Fly / Render)

**Important:** Vercel cannot host the entire platform. Vercel's serverless model breaks WebSockets, long-lived video streaming, persistent SQLite, and native binaries (`yt-dlp`, `ffmpeg`). The supported pattern is:

```
┌─────────────────┐   HTTPS / WSS   ┌──────────────────────────────┐
│   Vercel        │ ───────────────▶│  Railway / Fly.io / Render   │
│   (frontend)    │                 │  Node.js + ws + SQLite +     │
│   static SPA    │                 │  yt-dlp + ffmpeg             │
└─────────────────┘                 └──────────────────────────────┘
```

---

## Step 1 — Deploy the backend (one of these)

### Option A: Railway (easiest)

1. Push this repo to GitHub.
2. Go to https://railway.com → **New Project → Deploy from GitHub repo**.
3. Select the repo, set **Root Directory** to `backend`.
4. Railway auto-detects `backend/Dockerfile`. Click Deploy.
5. Add a **Persistent Volume** in the service settings:
   - Mount path: `/app/data` (1 GB) — for SQLite
   - Mount path: `/app/uploads` (5 GB) — for game files
6. Set environment variables (Settings → Variables):
   - `JWT_SECRET` = a long random string
   - `OPENAI_API_KEY` = (optional) for real AI replies
   - `CORS_ORIGINS` = your Vercel URL, e.g. `https://your-app.vercel.app`
7. Generate a public domain (Settings → Networking → Generate Domain).
8. Copy the URL, e.g. `https://pulse-backend-production.up.railway.app`.

### Option B: Fly.io

```sh
cd backend
fly launch --no-deploy        # creates fly app
fly volumes create pulse_data --size 1
fly volumes create pulse_uploads --size 5
fly secrets set JWT_SECRET="$(openssl rand -hex 32)" OPENAI_API_KEY="sk-..." CORS_ORIGINS="https://your-app.vercel.app"
fly deploy
```

### Option C: Render

1. Push repo to GitHub.
2. Render → **New → Blueprint** → point at `backend/render.yaml`.
3. Set `OPENAI_API_KEY` and `CORS_ORIGINS` in the dashboard.
4. Click Deploy.

---

## Step 2 — Configure the frontend

Edit `frontend/js/config.js` and set your backend URL:

```js
window.PULSE_API_BASE = "https://pulse-backend-production.up.railway.app";
```

Commit and push.

---

## Step 3 — Deploy the frontend to Vercel

1. https://vercel.com → **Add New → Project** → import the GitHub repo.
2. Framework Preset: **Other**.
3. **Root Directory**: leave at repo root (the `vercel.json` handles output).
4. Build Command: leave empty.
5. Output Directory: `frontend`.
6. Click Deploy.

That's it. `vercel.json` already has the right config (`outputDirectory: frontend`).

---

## Step 4 — Verify everything works

After deploy:

```sh
# Backend health
curl https://YOUR-BACKEND/api/v1/health

# YouTube proxy works
curl "https://YOUR-BACKEND/api/v1/youtube/search?q=hello"
```

Then open `https://your-app.vercel.app`:
- Sign up → real-time chat → AI tab → Games → YouTube tab. All work.

---

## Why not just use Vercel for everything?

If you want a fully-Vercel solution, you'd need to swap every backend piece:

| Need | Vercel-friendly replacement |
|---|---|
| WebSockets | Pusher / Ably / Supabase Realtime (paid) |
| SQLite | Vercel Postgres / Neon / Supabase / Turso |
| File uploads (games, avatars) | Vercel Blob / S3 / R2 |
| YouTube proxy | **Not feasible** — needs `yt-dlp` binary + unbounded streaming |

The YouTube proxy is the dealbreaker: Vercel's max function duration (60s Hobby / 300s Pro) and lack of binary install kill it. **Keep the backend on Railway/Fly/Render.**

---

## Local development still works the same

```sh
cd backend && node server.js   # serves both API and frontend on :4000
```

When `PULSE_API_BASE` is empty (the default), the frontend uses same-origin and everything works in one process.
