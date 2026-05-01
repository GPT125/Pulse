window.YouTube = (() => {
  const { $, el } = UI;

  function init() {
    $('#yt-search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#yt-q').value.trim();
      if (!q) return;
      const list = $('#yt-results');
      list.innerHTML = '<div class="empty-state">Searching…</div>';
      try {
        const data = await API.ytSearch(q);
        list.innerHTML = '';
        if (!data.results.length) {
          list.appendChild(el('div', { class: 'empty-state', text: 'No results' }));
          return;
        }
        for (const r of data.results) {
          const row = el('div', { class: 'yt-row', on: { click: () => play(r) }});
          row.appendChild(el('img', { class: 'yt-thumb', src: r.thumbnail || '', alt: '' }));
          const info = el('div', { class: 'yt-info' });
          info.appendChild(el('div', { class: 'yt-title', text: r.title }));
          info.appendChild(el('div', { class: 'yt-meta', text: `${r.channel || ''} · ${r.duration || ''} · ${r.views || ''}` }));
          row.appendChild(info);
          list.appendChild(row);
        }
      } catch (err) { list.innerHTML = ''; list.appendChild(el('div', { class: 'empty-state', text: 'Error: ' + err.message })); }
    });
  }

  function play(video) {
    const player = $('#yt-player');
    player.innerHTML = '';
    const v = el('video', { controls: '', autoplay: '', src: API.ytStreamUrl(video.id) });
    v.addEventListener('error', () => {
      const e = v.error;
      const msg = e ? `Playback error (code ${e.code}). The server is fetching the video — try again or pick another.` : 'Playback error';
      const m = el('div', { class: 'yt-meta-block' }, [
        el('h3', { text: video.title }),
        el('p', { text: msg })
      ]);
      player.appendChild(m);
    });
    player.appendChild(v);
    const meta = el('div', { class: 'yt-meta-block' });
    meta.appendChild(el('h3', { text: video.title }));
    meta.appendChild(el('p', { text: `${video.channel || ''} · streamed via /api/v1/youtube/stream/${video.id}` }));
    player.appendChild(meta);
  }

  return { init };
})();
