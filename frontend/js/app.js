(function () {
  const { $, $$, el } = UI;

  function showAuth(show) {
    $('#auth-screen').classList.toggle('hidden', !show);
    $('#app').classList.toggle('hidden', show);
  }

  function bindAuth() {
    $$('.tab-btn').forEach(b => b.addEventListener('click', () => {
      $$('.tab-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      $$('.auth-form').forEach(f => f.classList.remove('active'));
      document.getElementById(b.dataset.form).classList.add('active');
      $('#auth-error').textContent = '';
    }));
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const data = await API.login(f.email.value, f.password.value);
        API.setAuth(data.token, data.user);
        await startApp();
      } catch (err) { $('#auth-error').textContent = err.message; }
    });
    $('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const data = await API.register(f.email.value, f.password.value, f.display_name.value);
        API.setAuth(data.token, data.user);
        await startApp();
      } catch (err) { $('#auth-error').textContent = err.message; }
    });
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
      API.logout(); WS.disconnect(); location.reload();
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
    $('#me-avatar').src = u.avatar_url || '';
    if (!u.avatar_url) {
      // Use initial as fallback
      $('#me-avatar').style.display = 'none';
    } else {
      $('#me-avatar').style.display = '';
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
    bindAuth();
    if (API.token()) {
      try {
        const data = await API.me();
        API.setAuth(API.token(), data.user);
        await startApp();
        return;
      } catch { API.logout(); }
    }
    showAuth(true);
  }
  boot();
})();
