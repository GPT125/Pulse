window.AIChat = (() => {
  const { $, el, avatarFor } = UI;
  let channelId = null;

  async function init() {
    const data = await API.aiChannel();
    channelId = data.channel_id;
    await loadMessages();
    $('#ai-composer').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#ai-input');
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      try { await API.sendMessage(channelId, v); }
      catch (err) { UI.showError(err.message); }
    });
    WS.on('message', (m) => {
      if (m.channel_id === channelId) appendMessage(m.message);
    });
  }

  async function loadMessages() {
    const cont = $('#ai-messages');
    cont.innerHTML = '';
    const data = await API.getMessages(channelId);
    if (!data.messages.length) {
      appendMessage({
        sender_id: 'ai-bot', sender_name: 'AI', content: "Hi! I'm your AI assistant. Ask me anything.", timestamp: Date.now()
      });
    }
    for (const m of data.messages) appendMessage(m);
  }

  function appendMessage(m) {
    const me = API.user()?.user_id;
    const cont = $('#ai-messages');
    if (!cont) return;
    const isMe = m.sender_id === me;
    const row = el('div', { class: 'bubble-row ' + (isMe ? 'me' : 'them') });
    if (!isMe) row.appendChild(el('div', { class: 'avatar bot', text: '✨', style: 'width:28px;height:28px;font-size:14px;' }));
    const wrap = el('div');
    if (!isMe) wrap.appendChild(el('div', { class: 'sender-name', text: m.sender_name || 'AI' }));
    wrap.appendChild(el('div', { class: 'bubble', text: m.content || '' }));
    wrap.appendChild(el('div', { class: 'bubble-meta', text: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
    row.appendChild(wrap);
    cont.appendChild(row);
    cont.scrollTop = cont.scrollHeight;
  }

  return { init };
})();
