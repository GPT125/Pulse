const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const { v4: uuid } = require('uuid');

const db = require('./db');
const { register, login, signToken, verifyToken, authMiddleware, publicUser } = require('./auth');
const chat = require('./chat');
const ai = require('./ai');
const games = require('./games');
const youtube = require('./youtube');

const PORT = process.env.PORT || 4000;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

try { youtube.checkBinaries(); } catch (e) { console.warn('[youtube]', e.message); }

const app = express();
// CORS: comma-separated origins via CORS_ORIGINS, or "*" by default.
const corsOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: corsOrigins.includes('*') ? true : corsOrigins,
  credentials: false
}));
app.use(express.json({ limit: '5mb' }));

// Static frontend & uploaded avatars
app.use('/', express.static(FRONTEND_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(UPLOADS_DIR, 'avatars')),
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname || '.png')}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ======== AUTH ========
app.post('/api/v1/register', async (req, res) => {
  try {
    const { email, password, display_name } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'password must be >= 6 chars' });
    const user = await register(email, password, display_name);
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/v1/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await login(email, password);
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

app.get('/api/v1/me', authMiddleware, (req, res) => res.json({ user: publicUser(req.user) }));

app.put('/api/v1/profile', authMiddleware, (req, res) => {
  const { display_name, status_message, avatar_url } = req.body || {};
  db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), status_message = COALESCE(?, status_message), avatar_url = COALESCE(?, avatar_url) WHERE user_id = ?')
    .run(display_name ?? null, status_message ?? null, avatar_url ?? null, req.user.user_id);
  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id);
  res.json({ user: publicUser(u) });
});

app.post('/api/v1/profile/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const url = `/uploads/avatars/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar_url = ? WHERE user_id = ?').run(url, req.user.user_id);
  res.json({ avatar_url: url });
});

// ======== USER SEARCH ========
app.get('/api/v1/users/search', authMiddleware, (req, res) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  const rows = db.prepare(`SELECT user_id, email, display_name, avatar_url FROM users
    WHERE (LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?) AND user_id != ? LIMIT 25`)
    .all(q, q, req.user.user_id);
  res.json({ users: rows });
});

// ======== CHANNELS / CHAT ========
app.get('/api/v1/chats', authMiddleware, (req, res) => {
  res.json({ chats: chat.listChannelsForUser(req.user.user_id) });
});

app.post('/api/v1/chats/direct', authMiddleware, (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const exists = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(user_id);
  if (!exists) return res.status(404).json({ error: 'user not found' });
  const channelId = chat.findOrCreateDirectChannel(req.user.user_id, user_id);
  res.json({ channel_id: channelId });
});

app.post('/api/v1/chats/group', authMiddleware, (req, res) => {
  const { name, members = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const channelId = chat.createGroup(req.user.user_id, name, members);
  res.json({ channel_id: channelId });
});

app.get('/api/v1/chats/ai', authMiddleware, (req, res) => {
  res.json({ channel_id: chat.getOrCreateAIChannel(req.user.user_id) });
});

app.get('/api/v1/chats/:id/messages', authMiddleware, (req, res) => {
  if (!chat.isMember(req.params.id, req.user.user_id)) return res.status(403).json({ error: 'not a member' });
  res.json({ messages: chat.getMessages(req.params.id) });
});

app.post('/api/v1/chats/:id/message', authMiddleware, async (req, res) => {
  const channelId = req.params.id;
  if (!chat.isMember(channelId, req.user.user_id)) return res.status(403).json({ error: 'not a member' });
  const { content, message_type, attachment_url, parent_id } = req.body || {};
  if (!content && !attachment_url) return res.status(400).json({ error: 'empty message' });
  const msg = chat.postMessage({
    channelId, senderId: req.user.user_id, content, messageType: message_type, attachmentUrl: attachment_url, parentId: parent_id
  });
  broadcastMessage(channelId, msg);

  // If AI channel: respond with AI message
  const channel = db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(channelId);
  if (channel && channel.type === 'ai') {
    handleAIResponse(channelId, content).catch(e => console.error('AI err:', e));
  }
  res.json({ message: msg });
});

app.post('/api/v1/chats/:id/read', authMiddleware, (req, res) => {
  const { message_id } = req.body || {};
  chat.markRead(req.params.id, req.user.user_id, message_id);
  res.json({ ok: true });
});

async function handleAIResponse(channelId, prompt) {
  const history = chat.getMessages(channelId, 20);
  const reply = await ai.aiReply(history, prompt);
  // Ensure ai-bot user exists
  const botId = 'ai-bot';
  const exists = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(botId);
  if (!exists) {
    db.prepare(`INSERT INTO users (user_id,email,password_hash,display_name,avatar_url,status_message,created_at,last_online)
                VALUES (?, ?, NULL, ?, NULL, '', ?, ?)`)
      .run(botId, 'bot@local', 'AI Assistant', Date.now(), Date.now());
  }
  // Add bot to channel if not already
  if (!chat.isMember(channelId, botId)) {
    db.prepare(`INSERT OR IGNORE INTO memberships (channel_id,user_id,role,joined_at) VALUES (?, ?, 'member', ?)`)
      .run(channelId, botId, Date.now());
  }
  const msg = chat.postMessage({ channelId, senderId: botId, content: reply });
  broadcastMessage(channelId, msg);
}

// ======== GAMES ========
app.get('/api/v1/games', (req, res) => res.json({ games: games.listGames() }));

app.get('/api/v1/games/:id', (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).json({ error: 'not found' });
  res.json({ game: g, reviews: games.listReviews(req.params.id) });
});

app.post('/api/v1/games', authMiddleware, (req, res) => {
  const { title, description, html } = req.body || {};
  if (!title || !html) return res.status(400).json({ error: 'title and html required' });
  if (html.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'game too large (max 2MB)' });
  const g = games.uploadGameHtml({ uploaderId: req.user.user_id, title, description, htmlContent: html });
  res.json({ game: g });
});

app.post('/api/v1/games/:id/play', (req, res) => {
  games.incrementPlay(req.params.id);
  res.json({ ok: true });
});

app.post('/api/v1/games/:id/review', authMiddleware, (req, res) => {
  const { rating, comment } = req.body || {};
  games.reviewGame({ gameId: req.params.id, userId: req.user.user_id, rating, comment });
  res.json({ ok: true });
});

// Serve game assets at /games/:id/* (so games can load relative resources)
app.get('/games/:id/', (req, res) => {
  const g = games.getGame(req.params.id);
  if (!g) return res.status(404).send('Game not found');
  const file = games.gameAssetPath(req.params.id, g.entry_path);
  if (!file || !fs.existsSync(file)) return res.status(404).send('Entry missing');
  res.sendFile(file);
});
app.get('/games/:id/*splat', (req, res) => {
  const splat = req.params.splat;
  const sub = Array.isArray(splat) ? splat.join('/') : splat;
  const file = games.gameAssetPath(req.params.id, sub);
  if (!file || !fs.existsSync(file)) return res.status(404).send('Not found');
  res.sendFile(file);
});

// ======== YOUTUBE PROXY ========
app.get('/api/v1/youtube/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q) return res.json({ results: [] });
    const results = await youtube.search(q);
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v1/youtube/info/:id', async (req, res) => {
  try { res.json({ info: await youtube.info(req.params.id) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Streaming endpoint with Range support
app.get('/api/v1/youtube/stream/:id', (req, res) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9_-]{6,15}$/.test(id)) return res.status(400).json({ error: 'invalid id' });
  youtube.streamVideo(req, res, id);
});

// ======== HEALTH ========
app.get('/api/v1/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ======== HTTP + WS ========
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map(); // userId -> Set<ws>

wss.on('connection', (ws, req) => {
  // Auth via ?token= query
  const u = new URL(req.url, 'http://localhost');
  const token = u.searchParams.get('token');
  const payload = token && verifyToken(token);
  if (!payload) { ws.close(1008, 'unauthorized'); return; }
  ws.userId = payload.uid;
  if (!clients.has(ws.userId)) clients.set(ws.userId, new Set());
  clients.get(ws.userId).add(ws);
  db.prepare('UPDATE users SET last_online = ? WHERE user_id = ?').run(Date.now(), ws.userId);

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'typing' && m.channel_id) {
      const members = chat.getChannelMembers(m.channel_id);
      const payload = JSON.stringify({ type: 'typing', channel_id: m.channel_id, user_id: ws.userId, on: !!m.on });
      for (const uid of members) {
        if (uid === ws.userId) continue;
        const set = clients.get(uid); if (!set) continue;
        for (const c of set) if (c.readyState === 1) c.send(payload);
      }
    } else if (m.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    const set = clients.get(ws.userId);
    if (set) { set.delete(ws); if (!set.size) clients.delete(ws.userId); }
    db.prepare('UPDATE users SET last_online = ? WHERE user_id = ?').run(Date.now(), ws.userId);
  });

  ws.send(JSON.stringify({ type: 'hello', user_id: ws.userId }));
});

function broadcastMessage(channelId, msg) {
  const members = chat.getChannelMembers(channelId);
  const payload = JSON.stringify({ type: 'message', channel_id: channelId, message: msg });
  for (const uid of members) {
    const set = clients.get(uid); if (!set) continue;
    for (const c of set) if (c.readyState === 1) c.send(payload);
  }
}

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
