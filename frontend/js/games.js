window.Games = (() => {
  const { $, el } = UI;

  async function refresh() {
    const data = await API.listGames();
    const grid = $('#game-grid');
    grid.innerHTML = '';
    if (!data.games.length) {
      grid.appendChild(el('div', { class: 'empty-state', text: 'No games yet — upload one!' }));
      return;
    }
    for (const g of data.games) {
      const card = el('div', { class: 'game-card', on: { click: () => openGame(g.game_id) }});
      card.appendChild(el('div', { class: 'title', text: g.title }));
      card.appendChild(el('div', { class: 'meta', text: `★ ${g.rating_avg || 0} · ${g.play_count} plays` }));
      card.appendChild(el('div', { class: 'meta', text: `by ${g.uploader_name}` }));
      grid.appendChild(card);
    }
  }

  async function openGame(id) {
    const detail = $('#game-detail');
    detail.innerHTML = '<div class="empty-state">Loading…</div>';
    const { game, reviews } = await API.getGame(id);
    detail.innerHTML = '';
    detail.appendChild(el('h2', { text: game.title }));
    detail.appendChild(el('p', { class: 'muted', text: `by ${game.uploader_name} · ★ ${game.rating_avg || 0} · ${game.play_count} plays` }));
    if (game.description) detail.appendChild(el('p', { text: game.description }));

    const playBtn = el('button', { text: '▶ Play', class: 'review-form button', style: 'padding:10px 24px;background:var(--accent);border:0;color:white;border-radius:10px;font-weight:600;' });
    detail.appendChild(playBtn);
    playBtn.addEventListener('click', async () => {
      const iframe = el('iframe', { class: 'game-frame', src: `/games/${id}/`, sandbox: 'allow-scripts allow-pointer-lock allow-same-origin' });
      detail.appendChild(iframe);
      try { await API.playGame(id); } catch {}
      playBtn.remove();
    });

    detail.appendChild(el('h3', { text: 'Reviews' }));
    const form = el('form', { class: 'review-form', on: { submit: async (e) => {
      e.preventDefault();
      const rating = form.querySelector('select').value;
      const comment = form.querySelector('input').value;
      try { await API.reviewGame(id, rating, comment); openGame(id); }
      catch (e) { UI.showError(e.message); }
    }}});
    const sel = el('select');
    for (let i = 5; i >= 1; i--) sel.appendChild(el('option', { value: i, text: '★'.repeat(i) }));
    form.appendChild(sel);
    form.appendChild(el('input', { placeholder: 'Write a review…' }));
    form.appendChild(el('button', { type: 'submit', text: 'Post' }));
    detail.appendChild(form);

    for (const r of reviews) {
      const rev = el('div', { class: 'review' });
      rev.appendChild(el('div', { class: 'who', text: r.display_name }));
      rev.appendChild(el('div', { class: 'stars', text: '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) }));
      if (r.comment) rev.appendChild(el('div', { text: r.comment }));
      detail.appendChild(rev);
    }
  }

  function showUploadModal() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'row' }, [
      el('label', { text: 'Title' }),
      el('input', { id: 'gu-title', placeholder: 'My Awesome Game' })
    ]));
    wrap.appendChild(el('div', { class: 'row' }, [
      el('label', { text: 'Description (optional)' }),
      el('input', { id: 'gu-desc', placeholder: 'A short description' })
    ]));
    wrap.appendChild(el('div', { class: 'row' }, [
      el('label', { text: 'Game HTML (full standalone HTML file, ≤2MB)' }),
      el('textarea', { id: 'gu-html', placeholder: '<!DOCTYPE html><html>…</html>' })
    ]));
    wrap.appendChild(el('button', { text: 'Use sample game', type: 'button', class: 'secondary', style: 'background:var(--panel-2);border:1px solid var(--border);padding:8px 12px;border-radius:8px;color:var(--text);', on: { click: () => {
      wrap.querySelector('#gu-title').value = 'Click the Box';
      wrap.querySelector('#gu-desc').value = 'A simple click game.';
      wrap.querySelector('#gu-html').value = SAMPLE_GAME;
    }}}));
    UI.modal({
      title: 'Upload Game',
      content: wrap,
      confirmText: 'Upload',
      onConfirm: async (close) => {
        const title = wrap.querySelector('#gu-title').value.trim();
        const desc = wrap.querySelector('#gu-desc').value.trim();
        const html = wrap.querySelector('#gu-html').value;
        if (!title || !html) { UI.showError('Title and HTML required'); return; }
        try { await API.uploadGame(title, desc, html); close(); refresh(); }
        catch (e) { UI.showError(e.message); }
      }
    });
  }

  const SAMPLE_GAME = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Click the Box</title>
<style>body{margin:0;font-family:system-ui;background:#222;color:#fff;display:flex;flex-direction:column;align-items:center;padding:40px;height:100vh;box-sizing:border-box}
.box{width:80px;height:80px;background:#0af;border-radius:8px;cursor:pointer;position:absolute;transition:transform .1s}
.box:active{transform:scale(.9)}
h1{margin:0 0 20px}#score{font-size:24px;margin-bottom:20px}
#area{position:relative;width:100%;flex:1;background:#111;border-radius:12px;overflow:hidden}</style></head>
<body><h1>Click the Box</h1><div id="score">Score: 0</div><div id="area"></div>
<script>let s=0;const sc=document.getElementById('score'),area=document.getElementById('area');
function spawn(){const b=document.createElement('div');b.className='box';
const r=area.getBoundingClientRect();b.style.left=Math.random()*(r.width-80)+'px';b.style.top=Math.random()*(r.height-80)+'px';
b.onclick=()=>{s++;sc.textContent='Score: '+s;b.remove();spawn();};area.appendChild(b);}
spawn();</script></body></html>`;

  function init() {
    $('#upload-game-btn').addEventListener('click', showUploadModal);
  }

  return { init, refresh };
})();
