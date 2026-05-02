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

const MAX_BYTES = 8 * 1024 * 1024;        // 8 MB cap on a single response
const TIMEOUT_MS = 15_000;
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
  // Strip CSP / framing headers so rewritten pages can render in the iframe.
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'strict-transport-security'
]);

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

// Rewrite a url found in HTML so it goes back through our proxy.
function rewriteUrl(rawUrl, baseUrl, proxyBase) {
  if (!rawUrl) return rawUrl;
  const trimmed = String(rawUrl).trim();
  // Skip data:, javascript:, mailto:, blob:, fragments
  if (/^(data:|javascript:|mailto:|blob:|tel:|#)/i.test(trimmed)) return trimmed;
  try {
    const abs = new URL(trimmed, baseUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return trimmed;
    return `${proxyBase}?url=${encodeURIComponent(abs.toString())}`;
  } catch { return trimmed; }
}

function rewriteHtml(html, baseUrl, proxyBase) {
  // Inject <base> so relative URLs the rewriter misses still resolve sensibly,
  // and a tiny script that catches most JS-driven navigations and sends them
  // back through the proxy.
  const inject = `<base href="${baseUrl.toString().replace(/"/g, '&quot;')}">
<script>(function(){
  var P=${JSON.stringify(proxyBase)};
  function wrap(u){try{var a=new URL(u, document.baseURI);if(a.protocol!=='http:'&&a.protocol!=='https:')return u;return P+'?url='+encodeURIComponent(a.toString());}catch(e){return u;}}
  var open=window.open;window.open=function(u,n,f){return open.call(window,wrap(u),n,f);};
  document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(!h)return;a.setAttribute('href',wrap(h));},true);
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

  // Inject the <base>+script after the opening <head>, or at top.
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, m => m + inject);
  } else {
    out = inject + out;
  }
  return out;
}

function rewriteCss(css, baseUrl, proxyBase) {
  return css.replace(/url\(\s*("([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
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

// Express handler. `proxyBase` is the absolute URL of this endpoint, e.g.
// "https://example.com/api/v1/proxy/fetch", used when rewriting links.
async function handleFetch(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'url query param required' });

  let url;
  try { url = validateTargetUrl(target); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const proxyBase = `${req.protocol}://${req.get('host')}${req.baseUrl || ''}${req.path}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      follow: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PulseEduProxy/1.0)',
        'Accept': req.get('accept') || '*/*',
        'Accept-Language': req.get('accept-language') || 'en-US,en;q=0.9'
      },
      signal: controller.signal
    });

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

    if (ctype.includes('text/html')) {
      const html = buf.toString('utf8');
      const finalUrl = upstream.url ? new URL(upstream.url) : url;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(rewriteHtml(html, finalUrl, proxyBase));
    } else if (ctype.includes('text/css')) {
      const css = buf.toString('utf8');
      const finalUrl = upstream.url ? new URL(upstream.url) : url;
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.send(rewriteCss(css, finalUrl, proxyBase));
    } else {
      res.send(buf);
    }
  } catch (e) {
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Upstream timed out' });
    res.status(502).json({ error: e.message });
  } finally {
    clearTimeout(t);
  }
}

module.exports = { handleFetch };
