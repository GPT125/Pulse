// Basic educational HTTP proxy.
//
// What it does: server-side fetches a URL, strips connection-control headers,
// and rewrites links inside HTML so the user can browse a site through this
// server. This is a learning artifact for an HTTP proxy assignment — it
// demonstrates the core concepts (request relay, header sanitization, link
// rewriting). It is NOT designed to evade modern network filters or DPI.
//
// SSRF protection: refuses non-http/https schemes, refuses localhost / RFC1918
// private ranges, and follows up to 5 redirects only.
const fetch = require('node-fetch');
const { URL } = require('url');
const net = require('net');
const dns = require('dns').promises;

const MAX_BYTES = 8 * 1024 * 1024;        // 8 MB cap on a single response
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const COOKIE_JAR_TTL_MS = 60 * 60 * 1000;
const MAX_COOKIE_JARS = 500;
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
  // node-fetch decodes compressed bodies by default. Forwarding the original
  // content-encoding header would make browsers try to decode them again.
  'content-encoding',
  // Strip CSP / framing headers so rewritten pages can render in the iframe.
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'strict-transport-security'
]);

const cookieJars = new Map();

function isPrivateAddress(host) {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (net.isIP(lower) === 4) {
    const [a, b] = lower.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (net.isIP(lower) === 6) {
    if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
  }
  return false;
}

function validateTargetUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported');
  }
  if (isPrivateAddress(u.hostname)) {
    throw new Error('Refusing to fetch private/loopback address');
  }
  return u;
}

function normalizeSessionId(raw) {
  if (!raw) return null;
  const sid = String(raw);
  return /^[A-Za-z0-9_-]{8,80}$/.test(sid) ? sid : null;
}

function getCookieJar(sessionId) {
  if (!sessionId) return null;
  const now = Date.now();
  for (const [sid, jar] of cookieJars) {
    if (now - jar.touched > COOKIE_JAR_TTL_MS) cookieJars.delete(sid);
  }
  if (!cookieJars.has(sessionId)) {
    if (cookieJars.size >= MAX_COOKIE_JARS) {
      const oldest = [...cookieJars.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) cookieJars.delete(oldest[0]);
    }
    cookieJars.set(sessionId, {
      touched: now,
      cookies: new Map(),
      stats: {
        requests: 0,
        redirects: 0,
        blocked: 0,
        bytes: 0,
        last_url: null,
        last_status: null,
        last_error: null,
        updated_at: now
      }
    });
  }
  const jar = cookieJars.get(sessionId);
  jar.touched = now;
  return jar;
}

function defaultCookiePath(pathname) {
  if (!pathname || pathname[0] !== '/') return '/';
  if (pathname === '/') return '/';
  return pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
}

function domainMatches(hostname, domain) {
  const host = hostname.toLowerCase();
  const d = domain.replace(/^\./, '').toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

function parseSetCookie(header, url) {
  const parts = String(header || '').split(';').map(p => p.trim()).filter(Boolean);
  const first = parts.shift();
  if (!first || !first.includes('=')) return null;
  const eq = first.indexOf('=');
  const cookie = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1),
    domain: url.hostname.toLowerCase(),
    hostOnly: true,
    path: defaultCookiePath(url.pathname),
    secure: false,
    expires: null
  };
  if (!cookie.name) return null;

  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'domain' && val) {
      const domain = val.replace(/^\./, '').toLowerCase();
      if (!domainMatches(url.hostname, domain)) return null;
      cookie.domain = domain;
      cookie.hostOnly = false;
    } else if (key === 'path' && val && val.startsWith('/')) {
      cookie.path = val;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'max-age') {
      const seconds = Number(val);
      if (Number.isFinite(seconds)) cookie.expires = Date.now() + seconds * 1000;
    } else if (key === 'expires') {
      const ts = Date.parse(val);
      if (Number.isFinite(ts)) cookie.expires = ts;
    }
  }
  return cookie;
}

function storeCookies(sessionId, setCookieHeaders, url) {
  const jar = getCookieJar(sessionId);
  if (!jar || !setCookieHeaders || !setCookieHeaders.length) return;
  for (const header of setCookieHeaders) {
    const cookie = parseSetCookie(header, url);
    if (!cookie) continue;
    const key = `${cookie.domain};${cookie.path};${cookie.name}`;
    if (cookie.expires && cookie.expires <= Date.now()) jar.cookies.delete(key);
    else jar.cookies.set(key, cookie);
  }
}

function cookieHeaderFor(sessionId, url) {
  const jar = getCookieJar(sessionId);
  if (!jar) return null;
  const now = Date.now();
  const pairs = [];
  for (const [key, cookie] of jar.cookies) {
    if (cookie.expires && cookie.expires <= now) {
      jar.cookies.delete(key);
      continue;
    }
    const hostMatches = cookie.hostOnly
      ? url.hostname.toLowerCase() === cookie.domain
      : domainMatches(url.hostname, cookie.domain);
    if (!hostMatches) continue;
    if (!url.pathname.startsWith(cookie.path)) continue;
    if (cookie.secure && url.protocol !== 'https:') continue;
    pairs.push(`${cookie.name}=${cookie.value}`);
  }
  return pairs.length ? pairs.join('; ') : null;
}

function touchStats(sessionId, patch = {}) {
  const jar = getCookieJar(sessionId);
  if (!jar) return;
  Object.assign(jar.stats, patch, { updated_at: Date.now() });
}

function sessionStatus(rawSessionId) {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId || !cookieJars.has(sessionId)) {
    return {
      session_id: sessionId,
      active: false,
      cookie_count: 0,
      stats: {
        requests: 0,
        redirects: 0,
        blocked: 0,
        bytes: 0,
        last_url: null,
        last_status: null,
        last_error: null,
        updated_at: null
      }
    };
  }
  const jar = getCookieJar(sessionId);
  return {
    session_id: sessionId,
    active: true,
    cookie_count: jar.cookies.size,
    stats: { ...jar.stats }
  };
}

function clearSession(rawSessionId) {
  const sessionId = normalizeSessionId(rawSessionId);
  if (!sessionId) return false;
  return cookieJars.delete(sessionId);
}

async function assertPublicHostname(url) {
  if (net.isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error('Refusing to fetch private/loopback address');
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch (e) {
    throw new Error(`Could not resolve hostname: ${url.hostname}`);
  }

  if (!addresses.length) throw new Error(`Could not resolve hostname: ${url.hostname}`);
  const blocked = addresses.find(a => isPrivateAddress(a.address));
  if (blocked) throw new Error('Refusing to fetch hostname that resolves to a private/loopback address');
}

// Rewrite a url found in HTML so it goes back through our proxy.
function rewriteUrl(rawUrl, baseUrl, proxyBase) {
  if (!rawUrl) return rawUrl;
  const trimmed = String(rawUrl).trim();
  // Skip data:, javascript:, mailto:, blob:, fragments
  if (/^(data:|javascript:|mailto:|blob:|tel:|#)/i.test(trimmed)) return trimmed;
  try {
    const abs = new URL(trimmed, baseUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return trimmed;
    const sep = proxyBase.includes('?') ? '&' : '?';
    return `${proxyBase}${sep}url=${encodeURIComponent(abs.toString())}`;
  } catch { return trimmed; }
}

function rewriteHtml(html, baseUrl, proxyBase) {
  // Inject <base> so relative URLs the rewriter misses still resolve sensibly,
  // and a tiny script that catches most JS-driven navigations and sends them
  // back through the proxy.
  const inject = `<base href="${baseUrl.toString().replace(/"/g, '&quot;')}">
<script>(function(){
  var P=${JSON.stringify(proxyBase)};
  var S=P.indexOf('?')===-1?'?':'&';
  function wrap(u){try{var a=new URL(u, document.baseURI);if(a.protocol!=='http:'&&a.protocol!=='https:')return u;return P+S+'url='+encodeURIComponent(a.toString());}catch(e){return u;}}
  var open=window.open;window.open=function(u,n,f){return open.call(window,wrap(u),n,f);};
  var fetch0=window.fetch;if(fetch0){window.fetch=function(input,init){try{if(typeof input==='string'){input=wrap(input);}else if(input&&input.url){input=new Request(wrap(input.url),input);}}catch(e){}return fetch0.call(this,input,init);};}
  var xhrOpen=XMLHttpRequest&&XMLHttpRequest.prototype.open;if(xhrOpen){XMLHttpRequest.prototype.open=function(m,u){arguments[1]=wrap(u);return xhrOpen.apply(this,arguments);};}
  document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h)return;a.setAttribute('href',wrap(h));},true);
  document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.getAttribute)return;var a=f.getAttribute('action')||document.baseURI;f.setAttribute('action',wrap(a));},true);
})();</script>`;

  // Rewrite href, src, action attributes.
  let out = html.replace(/\b(href|src|action)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (m, attr, _q, dq, sq, uq) => {
      const val = dq ?? sq ?? uq ?? '';
      const rewritten = rewriteUrl(val, baseUrl, proxyBase);
      return `${attr}="${rewritten.replace(/"/g, '&quot;')}"`;
    });

  // Rewrite srcset (comma-separated list of url + descriptor pairs).
  out = out.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
    const list = (dq ?? sq ?? '').split(',').map(part => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const [url, ...rest] = trimmed.split(/\s+/);
      return [rewriteUrl(url, baseUrl, proxyBase), ...rest].join(' ');
    }).join(', ');
    return `srcset="${list.replace(/"/g, '&quot;')}"`;
  });

  // Rewrite simple url(...) in inline styles.
  out = out.replace(/url\(\s*("([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    (m, _q, dq, sq, uq) => {
      const val = (dq ?? sq ?? uq ?? '').trim();
      return `url("${rewriteUrl(val, baseUrl, proxyBase).replace(/"/g, '&quot;')}")`;
    });

  // Rewrite meta refresh redirects such as: content="0; url=/login".
  out = out.replace(/(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*)(["'])(.*?)\2/gi,
    (m, prefix, quote, content) => {
      const rewritten = content.replace(/(^|;\s*)url\s*=\s*([^;]+)/i, (part, lead, raw) => {
        return `${lead}url=${rewriteUrl(raw.trim(), baseUrl, proxyBase)}`;
      });
      return `${prefix}${quote}${rewritten.replace(new RegExp(quote, 'g'), '&quot;')}${quote}`;
    });

  // Inject the <base>+script after the opening <head>, or at top.
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, m => m + inject);
  } else {
    out = inject + out;
  }
  return out;
}

function rewriteCss(css, baseUrl, proxyBase) {
  return css
    .replace(/@import\s+("([^"]*)"|'([^']*)')/gi, (m, _q, dq, sq) => {
      const val = dq ?? sq ?? '';
      return `@import "${rewriteUrl(val, baseUrl, proxyBase).replace(/"/g, '&quot;')}"`;
    })
    .replace(/url\(\s*("([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    (m, _q, dq, sq, uq) => {
      const val = (dq ?? sq ?? uq ?? '').trim();
      return `url("${rewriteUrl(val, baseUrl, proxyBase).replace(/"/g, '&quot;')}")`;
    });
}

async function readWithCap(res) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('Response exceeds size cap (8MB)');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readRequestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('Request body exceeds size cap (8MB)');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function buildForwardHeaders(req, url, sessionId, method = req.method) {
  const headers = {
    'User-Agent': req.get('user-agent') || 'Mozilla/5.0 (compatible; PulseEduProxy/1.0)',
    'Accept': req.get('accept') || '*/*',
    'Accept-Language': req.get('accept-language') || 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity'
  };
  const contentType = req.get('content-type');
  if (contentType && method !== 'GET' && method !== 'HEAD') headers['Content-Type'] = contentType;
  const cookies = cookieHeaderFor(sessionId, url);
  if (cookies) headers.Cookie = cookies;
  return headers;
}

async function fetchWithValidatedRedirects(url, req, signal, body, sessionId) {
  let current = url;
  let method = req.method;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicHostname(current);
    const upstream = await fetch(current.toString(), {
      method,
      redirect: 'manual',
      headers: buildForwardHeaders(req, current, sessionId, method),
      body,
      signal
    });
    storeCookies(sessionId, upstream.headers.raw()['set-cookie'], current);

    if (![301, 302, 303, 307, 308].includes(upstream.status)) {
      return { upstream, finalUrl: current };
    }

    const location = upstream.headers.get('location');
    if (!location) return { upstream, finalUrl: current };
    const next = validateTargetUrl(new URL(location, current).toString());

    if (upstream.body && upstream.body.destroy) upstream.body.destroy();
    current = next;
    touchStats(sessionId, { redirects: (sessionStatus(sessionId).stats.redirects || 0) + 1 });

    // Browser semantics: most redirects after a POST become GET, except 307/308.
    if (upstream.status === 301 || upstream.status === 302 || upstream.status === 303) {
      method = 'GET';
      body = undefined;
    }
  }
  throw new Error('Too many redirects');
}

// Express handler. `proxyBase` is the absolute URL of this endpoint, e.g.
// "https://example.com/api/v1/proxy/fetch", used when rewriting links.
async function handleFetch(req, res) {
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD, POST');
    return res.status(405).json({ error: 'Proxy supports GET, HEAD and POST only' });
  }

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'url query param required' });
  const sessionId = normalizeSessionId(req.query.sid);

  let url;
  try { url = validateTargetUrl(target); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const endpoint = `${req.protocol}://${req.get('host')}${req.baseUrl || ''}${req.path}`;
  const proxyBase = sessionId ? `${endpoint}?sid=${encodeURIComponent(sessionId)}` : endpoint;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    touchStats(sessionId, {
      requests: (sessionStatus(sessionId).stats.requests || 0) + 1,
      last_url: url.toString(),
      last_error: null
    });
    const body = await readRequestBody(req);
    const { upstream, finalUrl } = await fetchWithValidatedRedirects(url, req, controller.signal, body, sessionId);

    // Pass through status & sanitized headers.
    const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
    res.status(upstream.status);
    upstream.headers.forEach((v, k) => {
      if (HOP_BY_HOP.has(k.toLowerCase())) return;
      if (k.toLowerCase() === 'content-length') return;
      if (k.toLowerCase() === 'set-cookie') return; // do not relay cookies
      try { res.setHeader(k, v); } catch {}
    });

    const buf = await readWithCap(upstream);
    touchStats(sessionId, {
      bytes: (sessionStatus(sessionId).stats.bytes || 0) + buf.length,
      last_url: finalUrl.toString(),
      last_status: upstream.status
    });

    if (ctype.includes('text/html')) {
      const html = buf.toString('utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(rewriteHtml(html, finalUrl, proxyBase));
    } else if (ctype.includes('text/css')) {
      const css = buf.toString('utf8');
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.send(rewriteCss(css, finalUrl, proxyBase));
    } else {
      res.send(buf);
    }
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Upstream timed out' });
    if (/^(Refusing|Could not resolve|Too many redirects)/.test(e.message)) {
      touchStats(sessionId, {
        blocked: (sessionStatus(sessionId).stats.blocked || 0) + 1,
        last_error: e.message
      });
      return res.status(400).json({ error: e.message });
    }
    touchStats(sessionId, { last_error: e.message });
    res.status(502).json({ error: e.message });
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  handleFetch,
  isPrivateAddress,
  validateTargetUrl,
  rewriteUrl,
  rewriteHtml,
  rewriteCss,
  normalizeSessionId,
  sessionStatus,
  clearSession
};
