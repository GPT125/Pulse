window.API = (() => {
  // Backend base URL: configured via /js/config.js (window.PULSE_API_BASE) or empty for same-origin.
  const API_BASE = (window.PULSE_API_BASE || '').replace(/\/$/, '');
  const TOKEN_KEY = 'pulse_token';
  const USER_KEY = 'pulse_user';
  let _token = localStorage.getItem(TOKEN_KEY) || null;
  let _user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  function apiUrl(path) { return API_BASE + path; }
  function wsUrl(path) {
    if (API_BASE) {
      const u = new URL(API_BASE);
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${u.host}${path}`;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}${path}`;
  }

  function setAuth(token, user) {
    _token = token; _user = user;
    if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY);
  }
  function token() { return _token; }
  function user() { return _user; }
  function logout() { setAuth(null, null); }

  async function req(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (_token) opts.headers['Authorization'] = `Bearer ${_token}`;
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(apiUrl(path), opts);
    const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  }

  return {
    setAuth, token, user, logout,
    config: () => req('GET', '/api/v1/config'),
    googleSignIn: (credential) => req('POST', '/api/v1/auth/google', { credential }),
    guestSignIn: (display_name) => req('POST', '/api/v1/auth/guest', { display_name }),
    devSignIn: (email, display_name) => req('POST', '/api/v1/auth/dev', { email, display_name }),
    me: () => req('GET', '/api/v1/me'),
    updateProfile: (data) => req('PUT', '/api/v1/profile', data),
    searchUsers: (q) => req('GET', `/api/v1/users/search?q=${encodeURIComponent(q)}`),
    listChats: () => req('GET', '/api/v1/chats'),
    createDirect: (user_id) => req('POST', '/api/v1/chats/direct', { user_id }),
    createGroup: (name, members) => req('POST', '/api/v1/chats/group', { name, members }),
    aiChannel: () => req('GET', '/api/v1/chats/ai'),
    getMessages: (cid) => req('GET', `/api/v1/chats/${cid}/messages`),
    sendMessage: (cid, content, extra = {}) => req('POST', `/api/v1/chats/${cid}/message`, { content, ...extra }),
    aiUploadImage: async (file) => {
      const fd = new FormData();
      fd.append('image', file);
      const headers = {};
      if (_token) headers['Authorization'] = `Bearer ${_token}`;
      const r = await fetch(apiUrl('/api/v1/ai/upload'), { method: 'POST', headers, body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    },
    proxyUrl: (target) => apiUrl(`/api/v1/proxy/fetch?url=${encodeURIComponent(target)}`),
    apiBase: () => API_BASE,
    markRead: (cid, mid) => req('POST', `/api/v1/chats/${cid}/read`, { message_id: mid }),
    listGames: () => req('GET', '/api/v1/games'),
    getGame: (id) => req('GET', `/api/v1/games/${id}`),
    uploadGame: (title, description, html) => req('POST', '/api/v1/games', { title, description, html }),
    playGame: (id) => req('POST', `/api/v1/games/${id}/play`),
    reviewGame: (id, rating, comment) => req('POST', `/api/v1/games/${id}/review`, { rating, comment }),
    ytSearch: (q) => req('GET', `/api/v1/youtube/search?q=${encodeURIComponent(q)}`),
    ytInfo: (id) => req('GET', `/api/v1/youtube/info/${id}`),
    ytComments: (id) => req('GET', `/api/v1/youtube/comments/${id}`),
    ytStreamUrl: (id) => apiUrl(`/api/v1/youtube/stream/${id}`),
    wsUrl,
  };
})();
