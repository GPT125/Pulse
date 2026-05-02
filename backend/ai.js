// Multi-provider AI chat. Tries the first configured provider, falls back through
// the chain on error. All providers use OpenAI-compatible Chat Completions.
// Supports vision (image attachments) via OpenAI-style content arrays.
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT =
  'You are a helpful, concise assistant inside a messaging app called Pulse. ' +
  'Reply in plain text, friendly tone, no markdown headings.';

// Order = priority. DeepSeek + Groq + HuggingFace are tried before OpenRouter
// so a single failing OpenRouter key cannot block everything else. Groq's
// llama-4-scout / llama-4-maverick can also handle images, so we have a vision
// path that doesn't depend on OpenRouter at all.
const PROVIDERS = [
  {
    name: 'groq',
    envKey: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: (hasImage) => process.env.GROQ_MODEL ||
      (hasImage ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'llama-3.3-70b-versatile'),
    vision: true
  },
  {
    name: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/chat/completions',
    model: () => process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    vision: false
  },
  {
    name: 'huggingface',
    envKey: 'HUGGINGFACE_API_KEY',
    // HF Inference Router exposes an OpenAI-compatible Chat Completions endpoint.
    url: 'https://router.huggingface.co/v1/chat/completions',
    model: () => process.env.HUGGINGFACE_MODEL || 'meta-llama/Llama-3.3-70B-Instruct',
    vision: false
  },
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: (hasImage) => process.env.OPENROUTER_MODEL ||
      (hasImage ? 'meta-llama/llama-3.2-11b-vision-instruct:free' : 'meta-llama/llama-3.3-70b-instruct:free'),
    vision: true,
    extraHeaders: () => ({
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://pulse.app',
      'X-Title': 'Pulse'
    })
  },
  {
    name: 'openai',
    envKey: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/chat/completions',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o-mini',
    vision: true
  }
];

async function callProvider(provider, messages, hasImage) {
  const key = process.env[provider.envKey];
  if (!key) return null;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    ...(provider.extraHeaders ? provider.extraHeaders() : {})
  };
  const body = JSON.stringify({
    model: typeof provider.model === 'function' ? provider.model(hasImage) : provider.model,
    messages,
    temperature: 0.7,
    max_tokens: 800
  });
  const r = await fetch(provider.url, { method: 'POST', headers, body });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`${provider.name} ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider.name}: empty response`);
  return content.trim();
}

// Convert a local /uploads/ai/... URL into a base64 data URL so AI providers
// (which can't reach localhost) still see the image. Public URLs are passed
// through unchanged.
function imageToDataUrl(maybeUrl) {
  if (!maybeUrl) return null;
  if (maybeUrl.startsWith('data:')) return maybeUrl;
  // Detect local upload references — both bare paths and absolute URLs that
  // happen to point at our own backend.
  let localPath = null;
  if (maybeUrl.startsWith('/uploads/')) {
    localPath = maybeUrl.slice(1);
  } else {
    try {
      const u = new URL(maybeUrl);
      if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname))
          && u.pathname.startsWith('/uploads/')) {
        localPath = u.pathname.slice(1);
      }
    } catch {}
  }
  if (!localPath) return maybeUrl; // public URL, leave alone
  const abs = path.join(__dirname, localPath);
  if (!fs.existsSync(abs)) return maybeUrl;
  try {
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return maybeUrl;
  }
}

// Build OpenAI-style messages. If imageUrls supplied, encode the latest turn
// as a content array with `image_url` parts.
function buildMessages(history, prompt, imageUrls = []) {
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const m of history.slice(-10)) {
    msgs.push({
      role: m.sender_id === 'ai-bot' ? 'assistant' : 'user',
      content: m.content || ''
    });
  }
  if (imageUrls && imageUrls.length) {
    const parts = [{ type: 'text', text: prompt || 'Please describe this image.' }];
    for (const raw of imageUrls) {
      const url = imageToDataUrl(raw);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
    msgs.push({ role: 'user', content: parts });
  } else {
    msgs.push({ role: 'user', content: prompt });
  }
  return msgs;
}

async function aiReply(history, prompt, imageUrls = []) {
  const hasImage = imageUrls && imageUrls.length > 0;
  const messages = buildMessages(history, prompt, imageUrls);
  const errors = [];
  for (const p of PROVIDERS) {
    if (!process.env[p.envKey]) continue;
    if (hasImage && !p.vision) continue; // skip text-only when image present
    try {
      const reply = await callProvider(p, messages, hasImage);
      if (reply) return reply;
    } catch (e) {
      errors.push(`[${p.name}] ${e.message}`);
      console.warn('[ai]', e.message);
    }
  }
  if (errors.length) {
    return `(AI providers all failed. Tried: ${errors.join(' | ')})`;
  }
  if (hasImage) {
    return '(No vision-capable AI provider configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY to analyze images.)';
  }
  return localFallback(prompt);
}

function localFallback(prompt) {
  const p = (prompt || '').toLowerCase();
  if (!p.trim()) return 'Hi! Ask me anything.';
  if (/hi|hello|hey/.test(p)) return 'Hello! How can I help you today?';
  if (/your name|who are you/.test(p)) return "I'm Pulse's AI assistant. Add a GROQ_API_KEY to .env for real LLM responses.";
  if (/help/.test(p)) return 'Set GROQ_API_KEY (or DEEPSEEK_API_KEY / HUGGINGFACE_API_KEY) in your backend env to enable AI.';
  return `You said: "${prompt}". (No AI provider configured — set GROQ_API_KEY in .env.)`;
}

function configuredProviders() {
  return PROVIDERS.filter(p => process.env[p.envKey]).map(p => p.name);
}

module.exports = { aiReply, configuredProviders };
