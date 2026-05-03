const { v4: uuid } = require('uuid');
const db = require('./db');

function getOrCreateAIChannel(userId) {
  let row = db.prepare('SELECT channel_id FROM ai_conversations WHERE user_id = ?').get(userId);
  if (row) return row.channel_id;
  const channelId = uuid();
  const now = Date.now();
  db.prepare(`INSERT INTO channels (channel_id,type,name,owner_id,created_at) VALUES (?, 'ai', 'AI Assistant', ?, ?)`)
    .run(channelId, userId, now);
  db.prepare(`INSERT INTO memberships (channel_id,user_id,role,joined_at) VALUES (?, ?, 'owner', ?)`)
    .run(channelId, userId, now);
  db.prepare('INSERT INTO ai_conversations (user_id, channel_id) VALUES (?, ?)').run(userId, channelId);
  return channelId;
}

function findOrCreateDirectChannel(userA, userB) {
  // Find existing direct channel containing both
  const row = db.prepare(`
    SELECT c.channel_id FROM channels c
    JOIN memberships m1 ON m1.channel_id = c.channel_id AND m1.user_id = ?
    JOIN memberships m2 ON m2.channel_id = c.channel_id AND m2.user_id = ?
    WHERE c.type = 'direct'
    LIMIT 1`).get(userA, userB);
  if (row) return row.channel_id;
  const channelId = uuid();
  const now = Date.now();
  db.prepare(`INSERT INTO channels (channel_id,type,name,owner_id,created_at) VALUES (?, 'direct', NULL, ?, ?)`)
    .run(channelId, userA, now);
  const stmt = db.prepare(`INSERT INTO memberships (channel_id,user_id,role,joined_at) VALUES (?, ?, ?, ?)`);
  stmt.run(channelId, userA, 'member', now);
  stmt.run(channelId, userB, 'member', now);
  return channelId;
}

function createGroup(ownerId, name, memberIds = []) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) throw new Error('Group name required');
  const channelId = uuid();
  const now = Date.now();
  db.prepare(`INSERT INTO channels (channel_id,type,name,owner_id,created_at) VALUES (?, 'group', ?, ?, ?)`)
    .run(channelId, cleanName, ownerId, now);
  const stmt = db.prepare(`INSERT INTO memberships (channel_id,user_id,role,joined_at) VALUES (?, ?, ?, ?)`);
  stmt.run(channelId, ownerId, 'owner', now);
  const uniqueMembers = [...new Set(memberIds.filter(Boolean))];
  for (const uid of uniqueMembers) {
    if (uid === ownerId) continue;
    const exists = db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(uid);
    if (exists) {
      try { stmt.run(channelId, uid, 'member', now); } catch {}
    }
  }
  return channelId;
}

function listChannelsForUser(userId) {
  const rows = db.prepare(`
    SELECT c.channel_id, c.type, c.name, c.owner_id, c.created_at,
      (SELECT content FROM messages WHERE channel_id = c.channel_id ORDER BY timestamp DESC LIMIT 1) AS last_content,
      (SELECT timestamp FROM messages WHERE channel_id = c.channel_id ORDER BY timestamp DESC LIMIT 1) AS last_ts,
      (SELECT message_id FROM messages WHERE channel_id = c.channel_id ORDER BY timestamp DESC LIMIT 1) AS last_id,
      m.last_read_message_id
    FROM channels c
    JOIN memberships m ON m.channel_id = c.channel_id
    WHERE m.user_id = ?
    ORDER BY last_ts DESC NULLS LAST, c.created_at DESC`).all(userId);
  // Add direct chat counterpart info
  for (const ch of rows) {
    if (ch.type === 'direct') {
      const other = db.prepare(`
        SELECT u.user_id, u.display_name, u.avatar_url, u.email FROM memberships m
        JOIN users u ON u.user_id = m.user_id
        WHERE m.channel_id = ? AND m.user_id != ?`).get(ch.channel_id, userId);
      ch.other = other || null;
      ch.name = other ? other.display_name : 'Direct';
    }
    ch.unread = !ch.last_id || ch.last_read_message_id === ch.last_id ? 0 : 1;
  }
  return rows;
}

function getMessages(channelId, limit = 100, before = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  const beforeClause = before ? 'AND m.timestamp < @before' : '';
  return db.prepare(`
    SELECT m.*, u.display_name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m JOIN users u ON u.user_id = m.sender_id
    WHERE m.channel_id = @channelId ${beforeClause}
    ORDER BY m.timestamp ASC
    LIMIT @limit`).all({ channelId, limit: safeLimit, before });
}

function getChannelSummary(channelId, viewerId) {
  const channel = db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(channelId);
  if (!channel) return null;
  const members = db.prepare(`
    SELECT u.user_id, u.email, u.display_name, u.avatar_url, m.role, m.joined_at
    FROM memberships m
    JOIN users u ON u.user_id = m.user_id
    WHERE m.channel_id = ?
    ORDER BY m.role = 'owner' DESC, u.display_name ASC`).all(channelId);
  if (channel.type === 'direct') {
    const other = members.find(m => m.user_id !== viewerId);
    channel.name = other ? other.display_name : 'Direct';
    channel.other = other || null;
  }
  channel.members = members;
  return channel;
}

function postMessage({ channelId, senderId, content, messageType = 'text', attachmentUrl = null, parentId = null }) {
  const messageId = uuid();
  const ts = Date.now();
  db.prepare(`INSERT INTO messages (message_id,channel_id,sender_id,content,message_type,attachment_url,parent_id,timestamp)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(messageId, channelId, senderId, content, messageType, attachmentUrl, parentId, ts);
  // Mark sender as read
  db.prepare(`UPDATE memberships SET last_read_message_id = ? WHERE channel_id = ? AND user_id = ?`)
    .run(messageId, channelId, senderId);
  const row = db.prepare(`SELECT m.*, u.display_name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m JOIN users u ON u.user_id = m.sender_id WHERE m.message_id = ?`).get(messageId);
  return row;
}

function isMember(channelId, userId) {
  return !!db.prepare('SELECT 1 FROM memberships WHERE channel_id = ? AND user_id = ?').get(channelId, userId);
}

function getChannelMembers(channelId) {
  return db.prepare(`SELECT u.user_id FROM memberships m JOIN users u ON u.user_id = m.user_id WHERE m.channel_id = ?`)
    .all(channelId).map(r => r.user_id);
}

function markRead(channelId, userId, messageId) {
  db.prepare(`UPDATE memberships SET last_read_message_id = ? WHERE channel_id = ? AND user_id = ?`)
    .run(messageId, channelId, userId);
}

module.exports = {
  getOrCreateAIChannel,
  findOrCreateDirectChannel,
  createGroup,
  listChannelsForUser,
  getMessages,
  getChannelSummary,
  postMessage,
  isMember,
  getChannelMembers,
  markRead
};
