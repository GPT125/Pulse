// Lightweight AI assistant. If OPENAI_API_KEY is set, uses OpenAI; otherwise a local rule-based fallback.
const fetch = require('node-fetch');

async function aiReply(history, prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const messages = [
        { role: 'system', content: 'You are a helpful, concise assistant inside a messaging app.' },
        ...history.slice(-10).map(m => ({
          role: m.sender_id === 'ai-bot' ? 'assistant' : 'user',
          content: m.content
        })),
        { role: 'user', content: prompt }
      ];
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7 })
      });
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content) return content.trim();
    } catch (e) {
      console.error('AI error:', e.message);
    }
  }
  return localFallback(prompt);
}

function localFallback(prompt) {
  const p = (prompt || '').toLowerCase();
  if (!p.trim()) return "Hi! Ask me anything.";
  if (/hi|hello|hey/.test(p)) return "Hello! How can I help you today?";
  if (/your name|who are you/.test(p)) return "I'm the in-app AI assistant. I can help answer questions, brainstorm, or summarize.";
  if (/time|date/.test(p)) return `It's currently ${new Date().toLocaleString()}.`;
  if (/youtube|video|proxy/.test(p)) return "You can search and play YouTube videos in the YouTube tab — they stream through the built-in proxy server.";
  if (/games?/.test(p)) return "Visit the Games tab to play user-uploaded HTML5 games or upload your own.";
  if (/help/.test(p)) return "Try the Chats, AI, Games, and YouTube tabs. You can sign up with email and chat in real time.";
  return `You said: "${prompt}". (Configure OPENAI_API_KEY for richer responses.)`;
}

module.exports = { aiReply };
