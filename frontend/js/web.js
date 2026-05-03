// Web view — drives the educational proxy. Loads URLs through
// /api/v1/proxy/fetch and renders inside a sandboxed iframe.
window.WebView = (() => {
  const { $ } = UI;
  const history = [];
  let cursor = -1;
  let currentUrl = null;
  const sessionId = (() => {
    try {
      const existing = sessionStorage.getItem('pulse_proxy_sid');
      if (existing) return existing;
      const fresh = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
        .replace(/[^A-Za-z0-9_-]/g, '');
      sessionStorage.setItem('pulse_proxy_sid', fresh);
      return fresh;
    } catch {
      return String(Date.now()) + String(Math.random()).slice(2);
    }
  })();

  function normalizeUrl(input) {
    const t = (input || '').trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    // bare domain → assume https
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(t)) return 'https://' + t;
    // otherwise treat as a search query
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(t);
  }

  function load(url, push = true) {
    if (!url) return;
    const proxied = API.proxyUrl(url, sessionId);
    const frame = $('#web-frame');
    const empty = $('#web-empty');
    frame.style.display = 'block';
    if (empty) empty.style.display = 'none';
    frame.src = proxied;
    currentUrl = url;
    $('#web-url').value = url;
    if (push) {
      history.splice(cursor + 1);
      history.push(url);
      cursor = history.length - 1;
    }
    updateStatsSoon();
  }

  function back() {
    if (cursor > 0) { cursor--; load(history[cursor], false); }
  }
  function fwd() {
    if (cursor < history.length - 1) { cursor++; load(history[cursor], false); }
  }
  function reload() {
    if (cursor >= 0) load(history[cursor], false);
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  async function renderSessionStats() {
    const target = $('#web-session-stats');
    if (!target) return;
    try {
      const data = await API.proxySession(sessionId);
      const s = data.stats || {};
      target.textContent = `${s.requests || 0} requests · ${data.cookie_count || 0} cookies · ${s.redirects || 0} redirects · ${formatBytes(s.bytes || 0)}`;
      target.title = s.last_error || s.last_url || 'Proxy session diagnostics';
      target.classList.toggle('has-error', !!s.last_error);
    } catch {
      target.textContent = 'Proxy diagnostics unavailable';
      target.classList.add('has-error');
    }
  }

  function updateStatsSoon() {
    setTimeout(renderSessionStats, 400);
    setTimeout(renderSessionStats, 1800);
  }

  function init() {
    $('#web-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = normalizeUrl($('#web-url').value);
      if (url) load(url);
    });
    $('#web-back').addEventListener('click', back);
    $('#web-fwd').addEventListener('click', fwd);
    $('#web-reload').addEventListener('click', reload);
    $('#web-frame').addEventListener('load', renderSessionStats);
    $('#web-copy').addEventListener('click', async () => {
      if (!currentUrl) return;
      try { await navigator.clipboard.writeText(currentUrl); } catch {}
      renderSessionStats();
    });
    $('#web-open-external').addEventListener('click', () => {
      if (currentUrl) window.open(currentUrl, '_blank', 'noopener,noreferrer');
    });
    $('#web-clear-session').addEventListener('click', async () => {
      try { await API.clearProxySession(sessionId); } catch {}
      sessionStorage.removeItem('pulse_proxy_sid');
      renderSessionStats();
    });
    document.querySelectorAll('#web-empty a[data-go]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        load(a.getAttribute('data-go'));
      });
    });
    renderSessionStats();
  }

  return { init, load };
})();
