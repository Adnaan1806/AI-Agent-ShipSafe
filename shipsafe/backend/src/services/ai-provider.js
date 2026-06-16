import Groq from 'groq-sdk';

const PROVIDER = process.env.AI_PROVIDER || 'ollama';

function extractRetryAfterMs(err) {
  // Groq embeds "Please try again in 4.77s" in the error message
  const match = String(err?.message ?? '').match(/try again in (\d+\.?\d*)s/i);
  if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500;
  return null;
}

async function callGroq(prompt, maxTokens) {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: maxTokens,
      });
      return completion.choices[0].message.content;
    } catch (err) {
      const isRateLimit = err?.status === 429 || /rate.limit/i.test(err?.message ?? '');
      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        const waitMs = extractRetryAfterMs(err) ?? (5000 * (attempt + 1));
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

async function callOllama(prompt, maxTokens) {
  const url = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
  const model = process.env.OLLAMA_MODEL || 'qwen2.5';

  // Use streaming so bytes keep flowing and Node's body-timeout never fires.
  // A hard AbortController cap of 10 minutes guards against hung models.
  const controller = new AbortController();
  const hardTimeout = setTimeout(() => controller.abort(), 600_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: { num_predict: maxTokens, temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep any incomplete trailing line
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.response) fullResponse += obj.response;
          if (obj.done) { finished = true; break; }
        } catch { /* skip malformed NDJSON lines */ }
      }
    }

    return fullResponse;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Ollama request timed out after 10 minutes');
    const cause = err.cause?.message ? ` — ${err.cause.message}` : '';
    throw new Error(`Ollama fetch failed: ${err.message}${cause}`);
  } finally {
    clearTimeout(hardTimeout);
  }
}

export async function askAI(prompt, { maxTokens = 4096, provider } = {}) {
  const resolved = provider || PROVIDER;
  if (resolved === 'groq') return callGroq(prompt, maxTokens);
  return callOllama(prompt, maxTokens);
}
