// YouTube proxy: search via Invidious-like scrape + stream via yt-dlp + range-proxy through server.
const { spawn, spawnSync } = require('child_process');
const fetch = require('node-fetch');
const { URL } = require('url');

// Simple in-memory cache for stream URLs (resolved video formats)
const streamCache = new Map(); // key: videoId -> { ts, data }
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4h (YouTube URLs typically valid ~6h)

function getCachedInfo(videoId) {
  const v = streamCache.get(videoId);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) { streamCache.delete(videoId); return null; }
  return v.data;
}
function setCachedInfo(videoId, data) {
  streamCache.set(videoId, { ts: Date.now(), data });
}

// Use yt-dlp -j to get JSON metadata including stream URLs.
function ytdlpJson(videoId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    // -f selects the best progressive HTTPS MP4 with both video+audio (browser <video>-friendly).
    // Falls back to any best mp4 if not available.
    const args = [
      '-j', '--no-warnings', '--no-playlist',
      '-f', '18/best[ext=mp4][vcodec!=none][acodec!=none][protocol^=https]/best[ext=mp4][protocol^=https]/best',
      url
    ];
    const p = spawn('yt-dlp', args);
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      if (code !== 0) return reject(new Error(err || `yt-dlp exit ${code}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
    p.on('error', reject);
  });
}

function pickFormat(info) {
  // With -f selector above, yt-dlp returns the chosen format at top-level (url).
  // But info.formats may still hold the full list. Prefer requested_formats / direct url.
  if (info.url && info.protocol && info.protocol.startsWith('https') && info.ext === 'mp4'
      && info.vcodec && info.vcodec !== 'none' && info.acodec && info.acodec !== 'none') {
    return info;
  }
  // Search formats for a progressive https mp4
  const fmts = info.formats || [];
  const progressive = fmts.filter(f =>
    f.vcodec && f.vcodec !== 'none' &&
    f.acodec && f.acodec !== 'none' &&
    f.ext === 'mp4' &&
    f.protocol && f.protocol.startsWith('https')
  ).sort((a,b) => (a.height||0) - (b.height||0));
  const target = progressive.find(f => (f.height||0) >= 360) || progressive[progressive.length - 1];
  if (target) return target;
  // Last resort: top-level url
  if (info.url) return info;
  return null;
}

async function resolveVideo(videoId) {
  let info = getCachedInfo(videoId);
  if (info) return info;
  const data = await ytdlpJson(videoId);
  const fmt = pickFormat(data);
  if (!fmt || !fmt.url) throw new Error('No playable format');
  info = {
    title: data.title,
    duration: data.duration,
    thumbnail: data.thumbnail,
    channel: data.channel || data.uploader,
    streamUrl: fmt.url,
    headers: fmt.http_headers || {},
    contentType: fmt.ext === 'mp4' ? 'video/mp4' : (fmt.mimetype || 'video/mp4'),
    height: fmt.height,
    filesize: fmt.filesize || fmt.filesize_approx || null
  };
  setCachedInfo(videoId, info);
  return info;
}

// Search via YouTube's search results page (no API key). Returns minimal video list.
async function search(query, max = 15) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  const html = await r.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const items = [];
  function walk(node) {
    if (!node || items.length >= max) return;
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    if (typeof node === 'object') {
      if (node.videoRenderer) {
        const v = node.videoRenderer;
        const id = v.videoId;
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText;
        const thumb = v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url;
        const channel = v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text;
        const dur = v.lengthText?.simpleText;
        const views = v.viewCountText?.simpleText || v.shortViewCountText?.simpleText;
        if (id && title) items.push({ id, title, thumbnail: thumb, channel, duration: dur, views });
        return;
      }
      for (const k of Object.keys(node)) walk(node[k]);
    }
  }
  walk(data);
  return items;
}

// Stream the resolved video URL through this server with byte-range support.
async function streamVideo(req, res, videoId) {
  let info;
  try {
    info = await resolveVideo(videoId);
  } catch (e) {
    res.status(502).json({ error: 'Failed to resolve video', detail: e.message });
    return;
  }

  const range = req.headers.range;
  const upstreamHeaders = { ...info.headers };
  if (range) upstreamHeaders['Range'] = range;
  // Strip cookies/origins that could leak
  delete upstreamHeaders['Cookie'];

  let upstream;
  try {
    upstream = await fetch(info.streamUrl, { headers: upstreamHeaders });
  } catch (e) {
    res.status(502).json({ error: 'Upstream fetch failed', detail: e.message });
    return;
  }

  if (!upstream.ok && upstream.status !== 206) {
    // Try refreshing the cached URL once
    streamCache.delete(videoId);
    try {
      info = await resolveVideo(videoId);
      const headers2 = { ...info.headers };
      if (range) headers2['Range'] = range;
      upstream = await fetch(info.streamUrl, { headers: headers2 });
    } catch {}
  }

  res.status(upstream.status);
  // Forward useful headers
  const forward = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag'];
  for (const h of forward) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!upstream.headers.get('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  if (!upstream.headers.get('content-type')) res.setHeader('Content-Type', info.contentType);

  upstream.body.on('error', err => { try { res.destroy(err); } catch {} });
  upstream.body.pipe(res);
  req.on('close', () => { try { upstream.body.destroy(); } catch {} });
}

async function info(videoId) {
  const data = await resolveVideo(videoId);
  return {
    title: data.title, duration: data.duration, thumbnail: data.thumbnail,
    channel: data.channel, height: data.height
  };
}

function checkBinaries() {
  const a = spawnSync('yt-dlp', ['--version']);
  if (a.status !== 0) throw new Error('yt-dlp not installed');
}

module.exports = { search, streamVideo, info, checkBinaries };
