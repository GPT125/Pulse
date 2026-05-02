const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

if (!GOOGLE_CLIENT_ID) {
  console.warn('[auth] GOOGLE_CLIENT_ID is not set — Google Sign-In will fail.');
}
if (JWT_SECRET === 'dev-secret-change-me') {
  console.warn('[auth] Using dev JWT_SECRET. Set JWT_SECRET in production.');
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

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

function upsertUserFromGoogle(payload) {
  const sub = payload.sub;
  const email = (payload.email || '').toLowerCase().trim();
  const name = payload.name || email.split('@')[0] || 'User';
  const picture = payload.picture || null;
  const now = Date.now();

  const bySub = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(sub);
  if (bySub) {
    db.prepare('UPDATE users SET last_online = ?, avatar_url = COALESCE(avatar_url, ?) WHERE user_id = ?')
      .run(now, picture, bySub.user_id);
    return db.prepare('SELECT * FROM users WHERE user_id = ?').get(bySub.user_id);
  }

  if (email) {
    const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (byEmail) {
      db.prepare('UPDATE users SET google_sub = ?, last_online = ?, avatar_url = COALESCE(avatar_url, ?) WHERE user_id = ?')
        .run(sub, now, picture, byEmail.user_id);
      return db.prepare('SELECT * FROM users WHERE user_id = ?').get(byEmail.user_id);
    }
  }

  const newUser = {
    user_id: uuid(),
    email: email || `${sub}@google.local`,
    password_hash: null,
    google_sub: sub,
    display_name: name,
    avatar_url: picture,
    status_message: '',
    created_at: now,
    last_online: now
  };
  db.prepare(`INSERT INTO users (user_id,email,password_hash,google_sub,display_name,avatar_url,status_message,created_at,last_online)
              VALUES (@user_id,@email,@password_hash,@google_sub,@display_name,@avatar_url,@status_message,@created_at,@last_online)`)
    .run(newUser);
  return newUser;
}

async function googleSignIn(credential) {
  if (!credential) throw new Error('Missing Google credential');
  if (!GOOGLE_CLIENT_ID) throw new Error('Server is missing GOOGLE_CLIENT_ID');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) throw new Error('Invalid Google token');
  if (payload.email_verified === false) throw new Error('Google email not verified');
  return upsertUserFromGoogle(payload);
}

// Guest sign-in: creates a fresh anonymous user every time. Disable with
// ALLOW_GUEST=0 in production. Each guest gets a random email and is treated
// as a normal user thereafter (can chat, post, etc.).
function guestSignIn(displayName) {
  if (process.env.ALLOW_GUEST === '0') throw new Error('Guest sign-in is disabled');
  const now = Date.now();
  const id = uuid();
  const short = id.slice(0, 8);
  const newUser = {
    user_id: id,
    email: `guest-${short}@guest.local`,
    password_hash: null,
    google_sub: null,
    display_name: (displayName && displayName.trim()) || `Guest ${short.slice(0, 4).toUpperCase()}`,
    avatar_url: null,
    status_message: 'Guest',
    created_at: now,
    last_online: now
  };
  db.prepare(`INSERT INTO users (user_id,email,password_hash,google_sub,display_name,avatar_url,status_message,created_at,last_online)
              VALUES (@user_id,@email,@password_hash,@google_sub,@display_name,@avatar_url,@status_message,@created_at,@last_online)`)
    .run(newUser);
  return newUser;
}

// Dev-only: create/lookup a user by email. Guarded by DEV_AUTH_BYPASS=1.
function devSignIn(email, displayName) {
  if (process.env.DEV_AUTH_BYPASS !== '1') throw new Error('Dev auth bypass is disabled');
  email = (email || '').toLowerCase().trim();
  if (!email) throw new Error('email required');
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE users SET last_online = ? WHERE user_id = ?').run(now, existing.user_id);
    return existing;
  }
  const newUser = {
    user_id: uuid(),
    email,
    password_hash: null,
    google_sub: null,
    display_name: displayName || email.split('@')[0],
    avatar_url: null,
    status_message: '',
    created_at: now,
    last_online: now
  };
  db.prepare(`INSERT INTO users (user_id,email,password_hash,google_sub,display_name,avatar_url,status_message,created_at,last_online)
              VALUES (@user_id,@email,@password_hash,@google_sub,@display_name,@avatar_url,@status_message,@created_at,@last_online)`)
    .run(newUser);
  return newUser;
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

module.exports = { signToken, verifyToken, authMiddleware, googleSignIn, guestSignIn, devSignIn, publicUser };
