// Multi-provider AI chat. Tries the first configured provider, falls back through
// the chain on error. All providers use OpenAI-compatible Chat Completions.
const fetch = require('node-fetch');

const SYSTEM_PROMPT =
  'You are a helpful, concise assistant inside a messaging app called Pulse. ' +
  'Reply in plain text, friendly tone, no markdown headings.';

const PROVIDERS = [
  {
    name: 'groq',
    envKey: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  },
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: () => process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    extraHeaders: () => ({
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://pulse.app',
      'X-Title': 'Pulse'
    })
  },
  {
    name: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/chat/completions',
    model: () => process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  },
  {
    name: 'openai',
    envKey: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/chat/completions',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o-mini'
  }
];

async function callProvider(provider, messages) {
  const key = process.env[provider.envKey];
  if (!key) return null;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    ...(provider.extraHeaders ? provider.extraHeaders() : {})
  };
  const body = JSON.stringify({
    model: provider.model(),
    messages,
    temperature: 0.7,
    max_tokens: 600
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

function buildMessages(history, prompt) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-10).map(m => ({
      role: m.sender_id === 'ai-bot' ? 'assistant' : 'user',
      content: m.content || ''
    })),
    { role: 'user', content: prompt }
  ];
}

async function aiReply(history, prompt) {
  const messages = buildMessages(history, prompt);
  const errors = [];
  for (const p of PROVIDERS) {
    if (!process.env[p.envKey]) continue;
    try {
      const reply = await callProvider(p, messages);
      if (reply) return reply;
    } catch (e) {
      errors.push(`[${p.name}] ${e.message}`);
      console.warn('[ai]', e.message);
    }
  }
  if (errors.length) {
    return `(AI providers all failed. First error: ${errors[0]})`;
  }
  return localFallback(prompt);
}

function localFallback(prompt) {
  const p = (prompt || '').toLowerCase();
  if (!p.trim()) return 'Hi! Ask me anything.';
  if (/hi|hello|hey/.test(p)) return 'Hello! How can I help you today?';
  if (/your name|who are you/.test(p)) return "I'm Pulse's AI assistant. Add a GROQ_API_KEY to .env for real LLM responses.";
  if (/help/.test(p)) return 'Set GROQ_API_KEY (or OPENROUTER_API_KEY / DEEPSEEK_API_KEY) in your backend env to enable AI.';
  return `You said: "${prompt}". (No AI provider configured — set GROQ_API_KEY in .env.)`;
}

function configuredProviders() {
  return PROVIDERS.filter(p => process.env[p.envKey]).map(p => p.name);
}

module.exports = { aiReply, configuredProviders };
