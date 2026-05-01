const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ uid: user.user_id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || null);
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(payload.uid);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

async function register(email, password, displayName) {
  email = email.toLowerCase().trim();
  const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(email);
  if (existing) throw new Error('Email already registered');
  const password_hash = await bcrypt.hash(password, 10);
  const user = {
    user_id: uuid(),
    email,
    password_hash,
    display_name: displayName || email.split('@')[0],
    avatar_url: null,
    status_message: '',
    created_at: Date.now(),
    last_online: Date.now()
  };
  db.prepare(`INSERT INTO users (user_id,email,password_hash,display_name,avatar_url,status_message,created_at,last_online)
              VALUES (@user_id,@email,@password_hash,@display_name,@avatar_url,@status_message,@created_at,@last_online)`).run(user);
  return user;
}

async function login(email, password) {
  email = email.toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.password_hash) throw new Error('Invalid credentials');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error('Invalid credentials');
  db.prepare('UPDATE users SET last_online = ? WHERE user_id = ?').run(Date.now(), user.user_id);
  return user;
}

function publicUser(u) {
  if (!u) return null;
  return {
    user_id: u.user_id,
    email: u.email,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
    status_message: u.status_message,
    last_online: u.last_online
  };
}

module.exports = { signToken, verifyToken, authMiddleware, register, login, publicUser };
