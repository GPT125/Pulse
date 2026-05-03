// Web view — drives the educational proxy. Loads URLs through
// /api/v1/proxy/fetch and renders inside a sandboxed iframe.
window.WebView = (() => {
  const { $ } = UI;
  const history = [];
  let cursor = -1;
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
    $('#web-url').value = url;
    if (push) {
      history.splice(cursor + 1);
      history.push(url);
      cursor = history.length - 1;
    }
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

  function init() {
    $('#web-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = normalizeUrl($('#web-url').value);
      if (url) load(url);
    });
    $('#web-back').addEventListener('click', back);
    $('#web-fwd').addEventListener('click', fwd);
    $('#web-reload').addEventListener('click', reload);
    document.querySelectorAll('#web-empty a[data-go]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        load(a.getAttribute('data-go'));
      });
    });
  }

  return { init, load };
})();
