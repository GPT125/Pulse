# Pulse Platform Improvement Guide

This is a practical roadmap for turning the current MVP into a stronger product. It is ordered by impact and risk.

## 1. Stabilize the Core

- Add a small API test suite for auth, chat membership, AI upload validation, games, YouTube metadata, and the web proxy.
- Add CI that runs `npm test`, boots the server, and smoke-tests `/api/v1/health`.
- Add structured request logging with request IDs, latency, status, user ID when authenticated, and upstream proxy timing.
- Add consistent error responses: `{ error, code, request_id }`.
- Add rate limits for auth, AI, YouTube, game upload, and generic proxy endpoints.

## 2. Make the Proxy Production-Grade

- Keep the current safety posture: allow only `http` and `https`, block private networks, validate DNS, and validate redirects.
- Add per-host throttling and total response-time budgets so one target cannot tie up the server.
- Add a small compatibility dashboard showing whether HTML, CSS, image assets, forms, fetch/XHR, and redirects worked for a proxied page.
- Add a configurable allowlist/denylist for school, team, or enterprise deployments.
- Add observability for proxy misses: blocked hosts, redirect failures, oversized responses, timeouts, and content types.
- Persist proxy-session diagnostics in memory per tab: cookie count, redirect chain, blocked resource count, rewritten URL count, and upstream error count.
- For serious browser fidelity, move from rewrite-only proxying toward an isolated browser rendering service or a purpose-built full web proxy architecture.

## 3. Harden Authentication and Accounts

- Set `JWT_SECRET`, `GOOGLE_CLIENT_ID`, and `CORS_ORIGINS` in every deployed environment.
- Disable guest accounts in production with `ALLOW_GUEST=0`, or add guest cleanup/expiration.
- Add refresh tokens or shorter-lived access tokens.
- Add account deletion, export, and session management.
- Add admin moderation tools for uploaded games, reviews, and abuse reports.

## 4. Improve Realtime Chat

- Add message edit/delete, reactions UI, read receipts, and attachment previews.
- Persist WebSocket presence more carefully: online, idle, offline, last seen.
- Add pagination for message history instead of loading recent messages only.
- Add Redis pub/sub before running multiple backend instances.
- Add push notifications via service workers first, then mobile push if you build native wrappers.

## 5. Improve AI

- Add streaming token responses so the AI tab feels alive.
- Add model/provider settings per environment.
- Store AI conversation metadata and allow users to rename, search, and delete AI threads.
- Add content-size limits for image uploads and prompt history.
- Add a tool-use layer for platform actions: summarize chats, explain game code, draft replies, and search user content with permission.

## 6. Improve Games

- Run uploaded games in stricter sandboxed origins, ideally separate from the main app origin.
- Add virus/static scanning and HTML sanitization for uploads.
- Add ZIP upload with manifest validation for multi-file games.
- Generate thumbnails from a headless browser screenshot.
- Add categories, tags, featured games, report buttons, and moderation states.

## 7. Improve YouTube

- Make `yt-dlp` availability explicit in the UI and health checks.
- Add fallback messaging when a video cannot be resolved or when YouTube changes markup.
- Cache search results and video metadata separately from stream URLs.
- Consider HLS client support if the frontend does not already load it reliably.
- Respect platform terms and deployment policies before exposing this broadly.

## 8. Upgrade Data and Deployment

- Move uploads to S3/R2/GCS and keep only metadata in SQLite/Postgres.
- Move from SQLite to Postgres once multiple instances or durable cloud hosting matter.
- Add database migrations instead of inline schema drift.
- Add backup and restore scripts.
- Containerize with health checks and resource limits.

## 9. Polish the Product

- Replace text-symbol buttons with consistent icon buttons and tooltips.
- Add loading, empty, and error states for every panel.
- Add mobile-first navigation refinements for chat, games, YouTube, and web.
- Add a settings page for privacy, display, notifications, and account controls.
- Add onboarding that teaches the four main surfaces without turning the app into a marketing page.

## 10. Suggested Next Sprint

1. Add API smoke tests and CI.
2. Add request logging and rate limits.
3. Add proxy observability and compatibility messages in the Web tab.
4. Add message pagination and better chat empty/loading states.
5. Add upload moderation and a safer game sandbox origin.
