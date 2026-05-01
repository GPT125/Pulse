window.WS = (() => {
  let socket = null;
  const handlers = { message: [], typing: [], hello: [] };
  let reconnectTimer = null;

  function connect() {
    const token = API.token();
    if (!token) return;
    if (socket && socket.readyState === WebSocket.OPEN) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    socket.onopen = () => { /* console.log('ws open'); */ };
    socket.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const list = handlers[m.type];
      if (list) for (const fn of list) try { fn(m); } catch (e) { console.error(e); }
    };
    socket.onclose = () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 2000);
    };
    socket.onerror = () => { try { socket.close(); } catch {} };
  }
  function on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
  function send(obj) { if (socket && socket.readyState === 1) socket.send(JSON.stringify(obj)); }
  function disconnect() { try { socket && socket.close(); } catch {} socket = null; clearTimeout(reconnectTimer); }

  return { connect, on, send, disconnect };
})();
