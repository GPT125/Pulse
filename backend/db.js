const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  status_message TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  last_online INTEGER
);

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('direct','group','ai')),
  name TEXT,
  owner_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  last_read_message_id TEXT,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT,
  message_type TEXT DEFAULT 'text',
  attachment_url TEXT,
  parent_id TEXT,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, timestamp);

CREATE TABLE IF NOT EXISTS reactions (
  reaction_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,
  uploader_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  upload_date INTEGER NOT NULL,
  entry_path TEXT NOT NULL,
  thumbnail_url TEXT,
  play_count INTEGER DEFAULT 0,
  rating_sum INTEGER DEFAULT 0,
  rating_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_reviews (
  review_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(game_id, user_id),
  FOREIGN KEY (game_id) REFERENCES games(game_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  user_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL
);
`);

// Migration: add google_sub to old user tables that pre-date the column.
const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userCols.includes('google_sub')) {
  db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL");
}

module.exports = db;
