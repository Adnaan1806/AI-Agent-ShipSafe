const OLLAMA_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5';

export async function generateApiTestCases(endpoint) {
  const prompt = buildPrompt(endpoint);

  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { num_predict: 4096, temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
  }

  const { response } = await res.json();
  const cleaned = response.trim()
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`Non-JSON response from AI: ${cleaned.slice(0, 300)}`);
    try { parsed = JSON.parse(match[0]); }
    catch { throw new Error(`Cannot parse JSON array: ${cleaned.slice(0, 300)}`); }
  }

  if (!Array.isArray(parsed)) throw new Error('AI did not return a JSON array');

  return parsed.filter(tc => tc && typeof tc === 'object' && tc.description);
}

function buildPrompt(endpoint) {
  const isReadOnly = ['GET', 'HEAD', 'OPTIONS'].includes(endpoint.method.toUpperCase());
  const bodyStr = endpoint.body ? JSON.stringify(endpoint.body, null, 2) : 'null';
  const headersStr = JSON.stringify(endpoint.headers, null, 2);

  const methodNote = isReadOnly
    ? `IMPORTANT: This is a ${endpoint.method} request — it has NO request body. Do NOT generate tests that send body payloads or test for missing body fields. Only test URL variations (valid path, non-existent resource, out-of-range ID).`
    : `This is a ${endpoint.method} request with a request body. Generate tests that vary the body payload.`;

  const testIdeas = isReadOnly
    ? `- Happy path: call the URL as-is → expect 200
- Non-existent resource: change the path ID to 99999 → expect 404
- Edge case: change the path ID to 0 or a string like "abc" → observe the response`
    : `- Positive: valid payload → expect 2xx
- Negative: missing a required field → expect 400
- Invalid types: send wrong data types → expect 400 or 422
- Auth: remove Authorization header (only if auth headers exist) → expect 401
- Edge: empty string or null for a required field → expect 400`;

  return `You are a QA engineer generating API test cases.

Endpoint:
  Name: ${endpoint.name}
  Method: ${endpoint.method}
  URL: ${endpoint.url}
  Headers: ${headersStr}
  Body: ${bodyStr}
  Description: ${endpoint.description || 'none'}

${methodNote}

Generate 3–5 test cases. Return a JSON array only. No markdown. No explanation.

Each element must match this shape exactly:
{
  "description": "short imperative test name",
  "type": "positive" | "negative" | "auth" | "edge",
  "method": "${endpoint.method}",
  "url": "full URL including any path changes",
  "headers": { "key": "value" },
  "body": null,
  "expectedStatus": 200
}

Test ideas for this endpoint:
${testIdeas}

Rules:
- Never use placeholder values like "string" or "value" — use realistic data
- For GET/HEAD: body must always be null
- For mutations: body must be a JSON object with real field values
- Set expectedStatus to the exact HTTP status you expect (200, 201, 400, 401, 404, 422, etc.)

Return only the JSON array. Nothing else.`;
}
