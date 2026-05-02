window.YouTube = (() => {
  const { $, el } = UI;

  function init() {
    $('#yt-search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#yt-q').value.trim();
      if (!q) return;
      const list = $('#yt-results');
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'empty-state small', text: 'Searching…' }));
      try {
        const data = await API.ytSearch(q);
        list.innerHTML = '';
        if (!data.results.length) {
          list.appendChild(el('div', { class: 'empty-state small', text: 'No results' }));
          return;
        }
        for (const r of data.results) renderResultRow(list, r);
      } catch (err) {
        list.innerHTML = '';
        list.appendChild(el('div', { class: 'empty-state small', text: 'Error: ' + err.message }));
      }
    });
  }

  function renderResultRow(list, r) {
    const row = el('div', { class: 'yt-row' });
    row.addEventListener('click', () => play(r));
    const thumbWrap = el('div', { class: 'yt-thumb-wrap' });
    thumbWrap.appendChild(el('img', { class: 'yt-thumb', src: r.thumbnail || '', alt: '', loading: 'lazy' }));
    if (r.duration) thumbWrap.appendChild(el('span', { class: 'yt-dur', text: r.duration }));
    row.appendChild(thumbWrap);
    const info = el('div', { class: 'yt-info' });
    info.appendChild(el('div', { class: 'yt-title', text: r.title }));
    info.appendChild(el('div', { class: 'yt-meta', text: [r.channel, r.views].filter(Boolean).join(' · ') }));
    row.appendChild(info);
    list.appendChild(row);
  }

  async function play(video) {
    const stage = $('#yt-stage');
    stage.innerHTML = '';

    const playerWrap = el('div', { class: 'yt-player-wrap' });
    const v = el('video', { controls: '', autoplay: '', playsinline: '', src: API.ytStreamUrl(video.id) });
    v.addEventListener('error', () => {
      const errBox = el('div', { class: 'yt-error', text: "Couldn't play this one — try another result." });
      playerWrap.appendChild(errBox);
    });
    playerWrap.appendChild(v);
    stage.appendChild(playerWrap);

    const meta = el('div', { class: 'yt-meta-block' });
    meta.appendChild(el('h2', { class: 'yt-vid-title', text: video.title }));
    const metaRow = el('div', { class: 'yt-vid-meta-row' });
    const channel = el('div', { class: 'yt-channel' });
    channel.appendChild(el('div', { class: 'yt-channel-avatar', text: (video.channel || '?').charAt(0).toUpperCase() }));
    const channelText = el('div');
    channelText.appendChild(el('div', { class: 'yt-channel-name', text: video.channel || 'Channel' }));
    channelText.appendChild(el('div', { class: 'yt-channel-sub', text: video.views || '' }));
    channel.appendChild(channelText);
    metaRow.appendChild(channel);
    metaRow.appendChild(el('div', { class: 'yt-via', text: 'Streaming via Pulse' }));
    meta.appendChild(metaRow);
    stage.appendChild(meta);

    const commentsBox = el('div', { class: 'yt-comments' });
    commentsBox.appendChild(el('h3', { class: 'yt-comments-head', text: 'Comments' }));
    const commentsList = el('div', { class: 'yt-comments-list' });
    commentsList.appendChild(el('div', { class: 'empty-state small', text: 'Loading comments…' }));
    commentsBox.appendChild(commentsList);
    stage.appendChild(commentsBox);

    try {
      const data = await API.ytComments(video.id);
      commentsList.innerHTML = '';
      if (!data.comments || !data.comments.length) {
        commentsList.appendChild(el('div', { class: 'empty-state small', text: 'No comments available.' }));
      } else {
        for (const c of data.comments) commentsList.appendChild(renderComment(c));
      }
    } catch {
      commentsList.innerHTML = '';
      commentsList.appendChild(el('div', { class: 'empty-state small', text: 'Could not load comments.' }));
    }
  }

  function renderComment(c) {
    const row = el('div', { class: 'yt-comment' });
    const avatar = el('div', { class: 'yt-comment-avatar' });
    if (c.author_thumbnail) avatar.appendChild(el('img', { src: c.author_thumbnail, alt: '' }));
    else avatar.textContent = (c.author || '?').charAt(0).toUpperCase();
    row.appendChild(avatar);
    const body = el('div', { class: 'yt-comment-body' });
    const head = el('div', { class: 'yt-comment-head' });
    head.appendChild(el('span', { class: 'yt-comment-author', text: c.author }));
    if (c.timestamp) head.appendChild(el('span', { class: 'yt-comment-time', text: relativeTime(c.timestamp) }));
    body.appendChild(head);
    body.appendChild(el('div', { class: 'yt-comment-text', text: c.text }));
    if (c.likes) body.appendChild(el('div', { class: 'yt-comment-likes', text: `👍 ${formatCount(c.likes)}` }));
    row.appendChild(body);
    return row;
  }

  function relativeTime(ts) {
    const sec = Math.floor((Date.now()/1000) - ts);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
    if (sec < 86400*30) return `${Math.floor(sec/86400)}d ago`;
    if (sec < 86400*365) return `${Math.floor(sec/86400/30)}mo ago`;
    return `${Math.floor(sec/86400/365)}y ago`;
  }

  function formatCount(n) {
    if (n >= 1_000_000) return (n/1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n/1_000).toFixed(1) + 'K';
    return String(n);
  }

  return { init };
})();
