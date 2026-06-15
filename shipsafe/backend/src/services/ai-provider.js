import Groq from 'groq-sdk';

const PROVIDER = process.env.AI_PROVIDER || 'ollama';

async function callGroq(prompt, maxTokens) {
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await client.chat.completions.create({
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: maxTokens,
  });
  return completion.choices[0].message.content;
}

async function callOllama(prompt, maxTokens) {
  const url = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
  const model = process.env.OLLAMA_MODEL || 'qwen2.5';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
  }
  const { response } = await res.json();
  return response;
}

export async function askAI(prompt, { maxTokens = 4096 } = {}) {
  if (PROVIDER === 'groq') return callGroq(prompt, maxTokens);
  return callOllama(prompt, maxTokens);
}
