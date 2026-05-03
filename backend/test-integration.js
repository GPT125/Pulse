const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 49100 + Math.floor(Math.random() * 1000);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-test-db-'));
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    DEV_AUTH_BYPASS: '1',
    ALLOW_GUEST: '1',
    JWT_SECRET: 'integration-test-secret',
    OPENAI_API_KEY: '',
    GROQ_API_KEY: '',
    OPENROUTER_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    HUGGINGFACE_API_KEY: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
child.stdout.on('data', d => { serverOutput += d.toString(); });
child.stderr.on('data', d => { serverOutput += d.toString(); });

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const r = await fetch(`${BASE}/api/v1/health`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 120));
  }
  throw new Error(`server did not become healthy:\n${serverOutput}`);
}

async function req(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${pathname} -> ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

async function signIn(email, displayName) {
  return req('/api/v1/auth/dev', {
    method: 'POST',
    body: { email, display_name: displayName }
  });
}

(async () => {
  try {
    await waitForHealth();

    const status = await req('/api/v1/status');
    assert.equal(status.ok, true);
    assert.ok(Array.isArray(status.ai.providers));

    const alice = await signIn('alice@example.test', 'Alice');
    const bob = await signIn('bob@example.test', 'Bob');
    const cam = await signIn('cam@example.test', 'Cam');

    const direct = await req('/api/v1/chats/direct', {
      method: 'POST',
      token: alice.token,
      body: { user_id: bob.user.user_id }
    });
    assert.ok(direct.channel_id);

    const sent = await req(`/api/v1/chats/${direct.channel_id}/message`, {
      method: 'POST',
      token: alice.token,
      body: { content: 'hello bob' }
    });
    assert.equal(sent.message.content, 'hello bob');

    const bobMessages = await req(`/api/v1/chats/${direct.channel_id}/messages`, { token: bob.token });
    assert.equal(bobMessages.messages.length, 1);
    assert.equal(bobMessages.messages[0].sender_name, 'Alice');

    const group = await req('/api/v1/chats/group', {
      method: 'POST',
      token: alice.token,
      body: { name: 'Launch Team', members: [bob.user.user_id, cam.user.user_id] }
    });
    assert.ok(group.channel_id);

    const summary = await req(`/api/v1/chats/${group.channel_id}`, { token: cam.token });
    assert.equal(summary.channel.name, 'Launch Team');
    assert.equal(summary.channel.members.length, 3);

    await req(`/api/v1/chats/${group.channel_id}/message`, {
      method: 'POST',
      token: cam.token,
      body: { content: 'group works' }
    });
    const groupMessages = await req(`/api/v1/chats/${group.channel_id}/messages`, { token: alice.token });
    assert.equal(groupMessages.messages.at(-1).content, 'group works');

    const aiChannel = await req('/api/v1/chats/ai', { token: alice.token });
    await req(`/api/v1/chats/${aiChannel.channel_id}/message`, {
      method: 'POST',
      token: alice.token,
      body: { content: 'hello ai' }
    });
    await new Promise(r => setTimeout(r, 350));
    const aiMessages = await req(`/api/v1/chats/${aiChannel.channel_id}/messages`, { token: alice.token });
    assert.ok(aiMessages.messages.some(m => m.sender_id === 'ai-bot'));

    const blocked = await fetch(`${BASE}/api/v1/proxy/fetch?url=${encodeURIComponent(`${BASE}/api/v1/health`)}`);
    assert.equal(blocked.status, 400);

    const proxySession = await req('/api/v1/proxy/session?sid=testsession123');
    assert.equal(proxySession.active, false);

    console.log('integration tests passed');
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  }
})().catch(err => {
  console.error(err);
  child.kill('SIGTERM');
  process.exit(1);
});
