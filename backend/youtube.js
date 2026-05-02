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
// We DON'T pre-filter with -f — getting the full format list lets us pick
// progressive MP4 (best for <video>) OR an HLS manifest (best for HD via hls.js).
function ytdlpJson(videoId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const args = ['-j', '--no-warnings', '--no-playlist', '--skip-download', url];
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

// Pick the best playable format. Two browser-friendly paths:
//   1) Progressive MP4 (audio+video in one file) — works in <video> directly.
//      Highest progressive YouTube ever offers is 720p (itag 22) but it's
//      often missing; otherwise capped at 360p (itag 18).
//   2) HLS m3u8 master manifest — gives access to up-to-1080p on most videos
//      and plays via hls.js in the browser.
function pickBestFormat(info) {
  const fmts = info.formats || [];

  // Progressive MP4 candidates
  const progressive = fmts.filter(f =>
    f.vcodec && f.vcodec !== 'none' &&
    f.acodec && f.acodec !== 'none' &&
    f.ext === 'mp4' &&
    f.protocol && f.protocol.startsWith('https')
  ).sort((a, b) => (b.height || 0) - (a.height || 0));

  // HLS master manifest (one URL that lists multiple bitrates)
  const hls = fmts.filter(f =>
    f.protocol === 'm3u8_native' || f.protocol === 'm3u8' ||
    (f.manifest_url && /\.m3u8/i.test(f.manifest_url))
  ).sort((a, b) => (b.height || 0) - (a.height || 0));

  return { progressive, hls, bestProgressive: progressive[0] || null, bestHls: hls[0] || null };
}

async function resolveVideo(videoId) {
  let info = getCachedInfo(videoId);
  if (info) return info;
  const data = await ytdlpJson(videoId);
  const picks = pickBestFormat(data);

  // Prefer HLS for HD playback (1080p, adaptive bitrate via hls.js).
  // Fall back to progressive MP4 if HLS isn't available.
  const useHls = picks.bestHls && (picks.bestHls.height || 0) >= 480;

  let chosenKind, chosenUrl, chosenHeaders, chosenHeight, chosenContentType;
  if (useHls) {
    chosenKind = 'hls';
    chosenUrl = picks.bestHls.manifest_url || picks.bestHls.url;
    chosenHeaders = picks.bestHls.http_headers || {};
    chosenHeight = picks.bestHls.height || null;
    chosenContentType = 'application/vnd.apple.mpegurl';
  } else if (picks.bestProgressive) {
    chosenKind = 'mp4';
    chosenUrl = picks.bestProgressive.url;
    chosenHeaders = picks.bestProgressive.http_headers || {};
    chosenHeight = picks.bestProgressive.height || null;
    chosenContentType = 'video/mp4';
  } else if (picks.bestHls) {
    chosenKind = 'hls';
    chosenUrl = picks.bestHls.manifest_url || picks.bestHls.url;
    chosenHeaders = picks.bestHls.http_headers || {};
    chosenHeight = picks.bestHls.height || null;
    chosenContentType = 'application/vnd.apple.mpegurl';
  } else {
    throw new Error('No playable format');
  }

  info = {
    title: data.title,
    duration: data.duration,
    thumbnail: data.thumbnail,
    channel: data.channel || data.uploader,
    kind: chosenKind,
    streamUrl: chosenUrl,
    headers: chosenHeaders,
    contentType: chosenContentType,
    height: chosenHeight,
    filesize: null
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

// Comments: yt-dlp --get-comments. Capped to ~30, cached, with timeout.
const commentsCache = new Map(); // videoId -> { ts, comments }
const COMMENTS_TTL_MS = 30 * 60 * 1000;

function comments(videoId) {
  const cached = commentsCache.get(videoId);
  if (cached && Date.now() - cached.ts < COMMENTS_TTL_MS) return Promise.resolve(cached.comments);
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [
      '-j', '--no-warnings', '--no-playlist', '--skip-download',
      '--get-comments',
      '--extractor-args', 'youtube:max_comments=30,0,0,0;comment_sort=top',
      url
    ];
    const p = spawn('yt-dlp', args);
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    const timeout = setTimeout(() => { try { p.kill(); } catch {} ; reject(new Error('Comments timed out')); }, 25000);
    p.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error((err.split('\n').filter(Boolean).pop()) || `yt-dlp exit ${code}`));
      try {
        const data = JSON.parse(out);
        const list = (data.comments || []).slice(0, 30).map(c => ({
          author: c.author || 'Unknown',
          author_thumbnail: c.author_thumbnail || null,
          text: c.text || '',
          likes: c.like_count || 0,
          timestamp: c.timestamp || null
        }));
        commentsCache.set(videoId, { ts: Date.now(), comments: list });
        resolve(list);
      } catch (e) { reject(e); }
    });
    p.on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

function checkBinaries() {
  const a = spawnSync('yt-dlp', ['--version']);
  if (a.status !== 0) throw new Error('yt-dlp not installed');
}

module.exports = { search, streamVideo, info, comments, checkBinaries };
