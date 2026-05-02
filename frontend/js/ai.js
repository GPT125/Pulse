window.AIChat = (() => {
  const { $, el } = UI;
  let channelId = null;
  // Pending uploads waiting to be sent: [{ url, mime, previewUrl, name }]
  const pending = [];

  async function init() {
    const data = await API.aiChannel();
    channelId = data.channel_id;
    await loadMessages();

    $('#ai-composer').addEventListener('submit', onSubmit);
    $('#ai-attach-btn').addEventListener('click', () => $('#ai-file').click());
    $('#ai-file').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const f of files) await attachFile(f);
    });

    // Paste images (e.g., screenshots).
    $('#ai-input').addEventListener('paste', async (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.kind === 'file' && /^image\//.test(it.type)) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); await attachFile(f); }
        }
      }
    });

    // Drag & drop onto the AI pane.
    const pane = $('#ai-pane');
    pane.addEventListener('dragover', (e) => { e.preventDefault(); pane.classList.add('drop-active'); });
    pane.addEventListener('dragleave', () => pane.classList.remove('drop-active'));
    pane.addEventListener('drop', async (e) => {
      e.preventDefault();
      pane.classList.remove('drop-active');
      const files = Array.from(e.dataTransfer.files || []).filter(f => /^image\//.test(f.type));
      for (const f of files) await attachFile(f);
    });

    WS.on('message', (m) => {
      if (m.channel_id === channelId) appendMessage(m.message);
    });
  }

  async function attachFile(file) {
    const tray = $('#ai-attach-tray');
    const previewUrl = URL.createObjectURL(file);
    const slot = el('div', { class: 'attach-thumb' });
    slot.innerHTML = `<img src="${previewUrl}" alt="">
      <div class="attach-spinner">…</div>`;
    tray.appendChild(slot);
    try {
      const data = await API.aiUploadImage(file);
      pending.push({ url: data.url, mime: data.mime, name: file.name });
      const sp = slot.querySelector('.attach-spinner');
      if (sp) sp.remove();
      const x = el('button', {
        class: 'attach-x', type: 'button', text: '×',
        on: { click: () => {
          const idx = pending.findIndex(p => p.url === data.url);
          if (idx >= 0) pending.splice(idx, 1);
          slot.remove();
          URL.revokeObjectURL(previewUrl);
        }}
      });
      slot.appendChild(x);
    } catch (err) {
      slot.remove();
      UI.showError('Upload failed: ' + err.message);
      URL.revokeObjectURL(previewUrl);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const input = $('#ai-input');
    const v = input.value.trim();
    if (!v && !pending.length) return;
    input.value = '';
    const tray = $('#ai-attach-tray');
    // One message per attached image (so each renders in its own bubble), or
    // one text-only message if no attachments.
    if (pending.length) {
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        // Only the first carries the typed text; the rest are pure attachments.
        const text = i === 0 ? v : '';
        try {
          await API.sendMessage(channelId, text, {
            message_type: 'image',
            attachment_url: p.url
          });
        } catch (err) { UI.showError(err.message); }
      }
      pending.length = 0;
      tray.innerHTML = '';
    } else {
      try { await API.sendMessage(channelId, v); }
      catch (err) { UI.showError(err.message); }
    }
  }

  async function loadMessages() {
    const cont = $('#ai-messages');
    cont.innerHTML = '';
    const data = await API.getMessages(channelId);
    if (!data.messages.length) {
      appendMessage({
        sender_id: 'ai-bot', sender_name: 'AI',
        content: "Hi! I'm your AI assistant. Ask me anything — you can also paste a screenshot or drop an image to ask about it.",
        timestamp: Date.now()
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

    const bubble = el('div', { class: 'bubble' });
    if (m.attachment_url && (m.message_type === 'image' || /\.(png|jpe?g|gif|webp)$/i.test(m.attachment_url))) {
      const src = /^https?:\/\//i.test(m.attachment_url)
        ? m.attachment_url
        : (API.apiBase() || '') + m.attachment_url;
      bubble.classList.add('bubble-image');
      const img = el('img', { class: 'bubble-img', src, alt: 'attachment' });
      bubble.appendChild(img);
    }
    if (m.content) {
      const text = el('div', { class: 'bubble-text', text: m.content });
      bubble.appendChild(text);
    }
    wrap.appendChild(bubble);
    wrap.appendChild(el('div', { class: 'bubble-meta', text: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
    row.appendChild(wrap);
    cont.appendChild(row);
    cont.scrollTop = cont.scrollHeight;
  }

  return { init };
})();
