window.UI = (() => {
  function $(sel, root = document) { return root.querySelector(sel); }
  function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const k of Object.keys(attrs)) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'on') for (const ev of Object.keys(attrs[k])) e.addEventListener(ev, attrs[k][ev]);
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }
  function escapeHtml(str) {
    return (str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function avatarFor(user, size = 44) {
    const initials = (user?.display_name || user?.email || '?').slice(0, 1).toUpperCase();
    const avEl = el('div', { class: 'avatar', style: `width:${size}px;height:${size}px;` });
    if (user?.avatar_url) {
      avEl.appendChild(el('img', { src: user.avatar_url, alt: '' }));
    } else {
      avEl.textContent = initials;
    }
    return avEl;
  }
  function timeAgo(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60_000) return 'now';
    if (d < 3600_000) return Math.floor(d/60_000) + 'm';
    if (d < 86400_000) return Math.floor(d/3600_000) + 'h';
    return new Date(ts).toLocaleDateString();
  }
  function showError(msg) {
    const root = $('#modal-root');
    const back = el('div', { class: 'modal-backdrop', on: { click: e => { if (e.target === back) back.remove(); } }});
    const m = el('div', { class: 'modal' }, [
      el('h2', { text: 'Error' }),
      el('p', { text: msg }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'primary', text: 'OK', on: { click: () => back.remove() }})
      ])
    ]);
    back.appendChild(m);
    root.appendChild(back);
  }
  function modal({ title, content, onConfirm, confirmText = 'OK', cancelText = 'Cancel' }) {
    const root = $('#modal-root');
    const back = el('div', { class: 'modal-backdrop', on: { click: e => { if (e.target === back) back.remove(); } }});
    const actions = el('div', { class: 'modal-actions' });
    const close = () => back.remove();
    actions.appendChild(el('button', { class: 'secondary', text: cancelText, on: { click: close } }));
    if (onConfirm) actions.appendChild(el('button', { class: 'primary', text: confirmText, on: { click: () => { onConfirm(close); } } }));
    const m = el('div', { class: 'modal' }, [
      el('h2', { text: title }),
      content,
      actions
    ]);
    back.appendChild(m);
    root.appendChild(back);
    return { close };
  }
  return { $, $$, el, escapeHtml, avatarFor, timeAgo, showError, modal };
})();
