(function () {
  const { $, $$, el } = UI;

  function showAuth(show) {
    $('#auth-screen').classList.toggle('hidden', !show);
    $('#app').classList.toggle('hidden', show);
  }

  // ----- Google Sign-In -----
  async function setupGoogle() {
    const host = $('#g-button-host');
    let clientId = window.PULSE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      try {
        const cfg = await API.config();
        clientId = cfg.google_client_id;
      } catch {}
    }
    if (!clientId) {
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'error', text:
        'Google sign-in not configured. Set GOOGLE_CLIENT_ID on the backend (see DEPLOY.md).' }));
      return;
    }
    // Wait for GIS library
    const start = Date.now();
    while (!(window.google && google.accounts && google.accounts.id)) {
      if (Date.now() - start > 8000) {
        host.innerHTML = '';
        host.appendChild(el('div', { class: 'error', text: 'Could not load Google Sign-In script.' }));
        return;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredential,
      auto_select: false,
      use_fedcm_for_prompt: true
    });
    host.innerHTML = '';
    google.accounts.id.renderButton(host, {
      type: 'standard',
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: 280
    });
  }

  async function handleCredential(response) {
    $('#auth-error').textContent = '';
    try {
      const data = await API.googleSignIn(response.credential);
      API.setAuth(data.token, data.user);
      await startApp();
    } catch (err) {
      $('#auth-error').textContent = err.message;
    }
  }

  function bindNav() {
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => {
      $$('.nav-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const view = b.dataset.view;
      $$('.view').forEach(v => v.classList.add('hidden'));
      $('#view-' + view).classList.remove('hidden');
      if (view === 'chats') Chat.refreshList();
      if (view === 'games') Games.refresh();
    }));
    $('#logout-btn').addEventListener('click', () => {
      API.logout();
      try { WS.disconnect(); } catch {}
      try { google.accounts.id.disableAutoSelect(); } catch {}
      location.reload();
    });
  }

  function bindSettings() {
    const f = $('#profile-form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = await API.updateProfile({
          display_name: f.display_name.value,
          status_message: f.status_message.value,
          avatar_url: f.avatar_url.value
        });
        API.setAuth(API.token(), data.user);
        renderMe();
      } catch (err) { UI.showError(err.message); }
    });
  }

  function renderMe() {
    const u = API.user();
    if (!u) return;
    $('#me-name').textContent = u.display_name;
    const av = $('#me-avatar');
    const init = $('#me-initial');
    if (u.avatar_url) {
      av.src = u.avatar_url;
      av.style.display = '';
      if (init) init.style.display = 'none';
    } else {
      av.style.display = 'none';
      if (init) {
        init.style.display = '';
        init.textContent = (u.display_name || u.email || '?').charAt(0).toUpperCase();
      }
    }
    const f = $('#profile-form');
    f.display_name.value = u.display_name || '';
    f.status_message.value = u.status_message || '';
    f.avatar_url.value = u.avatar_url || '';
    $('#settings-email').textContent = u.email;
  }

  async function startApp() {
    showAuth(false);
    renderMe();
    WS.connect();
    Chat.init();
    AIChat.init();
    Games.init();
    YouTube.init();
    bindNav();
    bindSettings();
    await Chat.refreshList();
  }

  async function boot() {
    if (API.token()) {
      try {
        const data = await API.me();
        API.setAuth(API.token(), data.user);
        await startApp();
        return;
      } catch { API.logout(); }
    }
    showAuth(true);
    setupGoogle();
  }
  boot();
})();
