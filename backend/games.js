const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');
const db = require('./db');

const GAMES_DIR = path.join(__dirname, 'uploads', 'games');

function listGames() {
  return db.prepare(`
    SELECT g.*, u.display_name AS uploader_name,
      CASE WHEN g.rating_count > 0 THEN ROUND(g.rating_sum * 1.0 / g.rating_count, 2) ELSE 0 END AS rating_avg
    FROM games g JOIN users u ON u.user_id = g.uploader_user_id
    ORDER BY g.upload_date DESC`).all();
}

function getGame(gameId) {
  return db.prepare(`
    SELECT g.*, u.display_name AS uploader_name,
      CASE WHEN g.rating_count > 0 THEN ROUND(g.rating_sum * 1.0 / g.rating_count, 2) ELSE 0 END AS rating_avg
    FROM games g JOIN users u ON u.user_id = g.uploader_user_id
    WHERE g.game_id = ?`).get(gameId);
}

// Save a single HTML file as the game (simplest reliable approach, no zip extraction risks).
function uploadGameHtml({ uploaderId, title, description, htmlContent }) {
  const gameId = uuid();
  const dir = path.join(GAMES_DIR, gameId);
  fs.mkdirSync(dir, { recursive: true });
  const entry = 'index.html';
  fs.writeFileSync(path.join(dir, entry), htmlContent, 'utf8');
  db.prepare(`INSERT INTO games (game_id, uploader_user_id, title, description, upload_date, entry_path)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(gameId, uploaderId, title, description || '', Date.now(), entry);
  return getGame(gameId);
}

function incrementPlay(gameId) {
  db.prepare('UPDATE games SET play_count = play_count + 1 WHERE game_id = ?').run(gameId);
}

function reviewGame({ gameId, userId, rating, comment }) {
  rating = Math.max(1, Math.min(5, parseInt(rating, 10) || 0));
  const existing = db.prepare('SELECT * FROM game_reviews WHERE game_id = ? AND user_id = ?').get(gameId, userId);
  if (existing) {
    const diff = rating - existing.rating;
    db.prepare('UPDATE game_reviews SET rating = ?, comment = ?, created_at = ? WHERE review_id = ?')
      .run(rating, comment || '', Date.now(), existing.review_id);
    db.prepare('UPDATE games SET rating_sum = rating_sum + ? WHERE game_id = ?').run(diff, gameId);
  } else {
    db.prepare('INSERT INTO game_reviews (review_id, game_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuid(), gameId, userId, rating, comment || '', Date.now());
    db.prepare('UPDATE games SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE game_id = ?')
      .run(rating, gameId);
  }
}

function listReviews(gameId) {
  return db.prepare(`
    SELECT r.*, u.display_name FROM game_reviews r
    JOIN users u ON u.user_id = r.user_id
    WHERE r.game_id = ? ORDER BY r.created_at DESC`).all(gameId);
}

function gameAssetPath(gameId, assetPath) {
  // Prevent path traversal
  const safe = path.normalize(assetPath || '').replace(/^([.][.][/\\])+/, '');
  if (safe.includes('..')) return null;
  return path.join(GAMES_DIR, gameId, safe);
}

module.exports = { listGames, getGame, uploadGameHtml, incrementPlay, reviewGame, listReviews, gameAssetPath, GAMES_DIR };
