window.Chat = (() => {
  const { $, $$, el, escapeHtml, avatarFor, timeAgo } = UI;
  let activeChannelId = null;
  let chatsCache = [];
  let typingTimer = null;
  let typingState = {}; // channelId -> { userId: timeoutId }

  async function refreshList() {
    const data = await API.listChats();
    chatsCache = data.chats || [];
    renderList();
  }

  function renderList() {
    const list = $('#chat-list');
    list.innerHTML = '';
    if (!chatsCache.length) {
      list.appendChild(el('div', { class: 'empty-state', text: 'Search a user above to start a chat' }));
      return;
    }
    for (const c of chatsCache) {
      if (c.type === 'ai') continue; // AI rendered in its own tab
      const row = el('div', { class: 'chat-row' + (c.channel_id === activeChannelId ? ' active' : ''), on: { click: () => openChannel(c.channel_id) }});
      row.appendChild(avatarFor(c.other || { display_name: c.name }));
      const info = el('div', { class: 'chat-info' });
      const title = el('div', { class: 'chat-title-line' }, [
        el('div', { class: 'chat-name', text: c.name || (c.type === 'group' ? 'Group' : 'Direct') }),
        el('div', { class: 'chat-time', text: c.last_ts ? timeAgo(c.last_ts) : '' })
      ]);
      info.appendChild(title);
      info.appendChild(el('div', { class: 'chat-snippet', text: c.last_content || (c.type === 'group' ? 'New group' : 'Say hi') }));
      row.appendChild(info);
      if (c.unread) row.appendChild(el('div', { class: 'unread-dot' }));
      list.appendChild(row);
    }
  }

  async function openChannel(channelId) {
    activeChannelId = channelId;
    renderList();
    const ch = chatsCache.find(c => c.channel_id === channelId);
    const pane = $('#chat-pane');
    pane.innerHTML = '';
    const header = el('div', { class: 'chat-header' });
    header.appendChild(avatarFor(ch?.other || { display_name: ch?.name || 'Chat' }));
    const head = el('div');
    head.appendChild(el('div', { class: 'chat-title', text: ch?.name || 'Chat' }));
    head.appendChild(el('div', { class: 'chat-sub', text: ch?.type === 'group' ? 'Group chat' : (ch?.other?.email || '') }));
    header.appendChild(head);
    pane.appendChild(header);

    const messages = el('div', { class: 'messages', id: 'chat-messages' });
    pane.appendChild(messages);
    const typing = el('div', { class: 'typing-indicator', id: 'chat-typing' });
    pane.appendChild(typing);

    const composer = el('form', { class: 'composer' });
    const input = el('input', { id: 'chat-input', placeholder: 'iMessage…', autocomplete: 'off' });
    composer.appendChild(input);
    composer.appendChild(el('button', { type: 'submit', text: 'Send' }));
    composer.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      try { await API.sendMessage(channelId, v); }
      catch (err) { UI.showError(err.message); }
    });
    input.addEventListener('input', () => {
      WS.send({ type: 'typing', channel_id: channelId, on: true });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => WS.send({ type: 'typing', channel_id: channelId, on: false }), 1500);
    });
    pane.appendChild(composer);

    const data = await API.getMessages(channelId);
    for (const m of data.messages) appendMessage(m, false);
    messages.scrollTop = messages.scrollHeight;
    const last = data.messages[data.messages.length - 1];
    if (last) API.markRead(channelId, last.message_id).catch(() => {});
  }

  function appendMessage(m, autoScroll = true) {
    const me = API.user()?.user_id;
    const cont = $('#chat-messages');
    if (!cont) return;
    const isMe = m.sender_id === me;
    const row = el('div', { class: 'bubble-row ' + (isMe ? 'me' : 'them') });
    if (!isMe) row.appendChild(avatarFor({ display_name: m.sender_name, avatar_url: m.sender_avatar }, 28));
    const wrap = el('div');
    if (!isMe) wrap.appendChild(el('div', { class: 'sender-name', text: m.sender_name || '' }));
    wrap.appendChild(el('div', { class: 'bubble', text: m.content || '' }));
    wrap.appendChild(el('div', { class: 'bubble-meta', text: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
    row.appendChild(wrap);
    cont.appendChild(row);
    if (autoScroll) cont.scrollTop = cont.scrollHeight;
  }

  function onIncoming(m) {
    if (m.channel_id === activeChannelId) {
      appendMessage(m.message);
      API.markRead(activeChannelId, m.message.message_id).catch(() => {});
    }
    refreshList();
  }

  function onTyping(m) {
    if (m.channel_id !== activeChannelId) return;
    const t = $('#chat-typing'); if (!t) return;
    if (m.on) {
      t.textContent = 'typing…';
      typingState[m.channel_id] = typingState[m.channel_id] || {};
      clearTimeout(typingState[m.channel_id][m.user_id]);
      typingState[m.channel_id][m.user_id] = setTimeout(() => { t.textContent = ''; }, 3000);
    } else {
      t.textContent = '';
    }
  }

  async function searchUsers(q) {
    const list = $('#search-results');
    list.innerHTML = '';
    if (!q || q.length < 2) return;
    try {
      const data = await API.searchUsers(q);
      for (const u of data.users) {
        const row = el('div', { class: 'search-row', on: { click: async () => {
          try {
            const r = await API.createDirect(u.user_id);
            list.innerHTML = ''; $('#chat-search').value = '';
            await refreshList();
            openChannel(r.channel_id);
          } catch (e) { UI.showError(e.message); }
        }}});
        row.appendChild(avatarFor(u));
        const info = el('div', { class: 'chat-info' });
        info.appendChild(el('div', { class: 'chat-name', text: u.display_name }));
        info.appendChild(el('div', { class: 'chat-snippet', text: u.email }));
        row.appendChild(info);
        list.appendChild(row);
      }
    } catch (e) { console.error(e); }
  }

  function init() {
    $('#chat-search').addEventListener('input', (e) => searchUsers(e.target.value.trim()));
    $('#new-group-btn').addEventListener('click', () => {
      const wrap = el('div');
      wrap.appendChild(el('div', { class: 'row' }, [
        el('label', { text: 'Group name' }),
        el('input', { id: 'g-name', placeholder: 'My group' })
      ]));
      wrap.appendChild(el('div', { class: 'row' }, [
        el('label', { text: 'Add members by email (comma separated)' }),
        el('input', { id: 'g-members', placeholder: 'a@b.com, c@d.com' })
      ]));
      UI.modal({ title: 'New group', content: wrap, confirmText: 'Create', onConfirm: async (close) => {
        const name = wrap.querySelector('#g-name').value.trim();
        const emails = wrap.querySelector('#g-members').value.split(',').map(s => s.trim()).filter(Boolean);
        if (!name) return;
        const memberIds = [];
        for (const e of emails) {
          try {
            const r = await API.searchUsers(e);
            const u = r.users.find(x => x.email.toLowerCase() === e.toLowerCase());
            if (u) memberIds.push(u.user_id);
          } catch {}
        }
        try {
          const r = await API.createGroup(name, memberIds);
          await refreshList();
          openChannel(r.channel_id);
          close();
        } catch (e) { UI.showError(e.message); }
      }});
    });

    WS.on('message', onIncoming);
    WS.on('typing', onTyping);
  }

  return { init, refreshList, openChannel };
})();
