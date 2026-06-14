import { generateBody } from './api-data-generator.js';
import { buildMemoryContext } from './api-memory.js';

const OLLAMA_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5';

// Generate test cases for a single endpoint.
// memory: ApiEndpointMemory record (or null) — injected as context into the AI prompt.
export async function generateApiTestCases(endpoint, memory = null) {
  // Enrich the body with realistic values before handing to AI
  const enrichedBody = endpoint.body ? generateBody(endpoint.body) : null;
  const memoryCtx = memory ? buildMemoryContext(memory) : '';
  const prompt = buildPrompt({ ...endpoint, body: enrichedBody }, memoryCtx);

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

function buildPrompt(endpoint, memoryCtx) {
  const isReadOnly = ['GET', 'HEAD', 'OPTIONS'].includes(endpoint.method.toUpperCase());
  const bodyStr = endpoint.body ? JSON.stringify(endpoint.body, null, 2) : 'null';
  const headersStr = JSON.stringify(endpoint.headers, null, 2);

  const methodNote = isReadOnly
    ? `IMPORTANT: This is a ${endpoint.method} request — no request body. Only generate URL/path variation tests.`
    : `This is a ${endpoint.method} request with a body. Vary the payload for each test type.`;

  const testIdeas = isReadOnly
    ? `- Happy path: call as-is → expect 200
- Non-existent resource: replace path ID with 99999 → expect 404
- Edge case: path ID = 0 or "abc" → observe response`
    : `- Positive: fully valid payload → expect 2xx. Include assertions for response body schema.
- Negative: omit a required field → expect 400
- Invalid types: send wrong data types → expect 400 or 422
- Auth: remove Authorization header if present → expect 401
- Edge: null or empty string for required field → expect 400`;

  return `You are a senior QA engineer generating API test cases with detailed response assertions.
${memoryCtx ? '\n' + memoryCtx + '\n' : ''}
Endpoint:
  Name: ${endpoint.name}
  Method: ${endpoint.method}
  URL: ${endpoint.url}
  Headers: ${headersStr}
  Body: ${bodyStr}
  Description: ${endpoint.description || 'none'}

${methodNote}

Generate 3–5 test cases. Return a JSON array ONLY. No markdown. No explanation.

Each element MUST match this exact shape:
{
  "description": "short imperative test name",
  "type": "positive" | "negative" | "auth" | "edge",
  "method": "${endpoint.method}",
  "url": "full URL including any path changes",
  "headers": { "key": "value" },
  "body": null,
  "expectedStatus": 200,
  "assertions": {
    "expectedStatus": 200,
    "expectedHeaders": { "content-type": "application/json" },
    "requiredFields": ["id", "name"],
    "schema": { "id": "number", "name": "string", "email": "string" },
    "notNull": ["id"]
  }
}

Test ideas for this endpoint:
${testIdeas}

Rules:
- Never use placeholder values like "string" or "value" — use realistic data
- For GET/HEAD: body must always be null
- For positive tests: assertions.requiredFields and assertions.schema must list the actual response fields you expect
- For negative/auth/edge tests: assertions.requiredFields and assertions.schema should be [] and {}
- assertions.expectedHeaders must always include { "content-type": "application/json" } for non-error responses
- Set expectedStatus to the exact HTTP status you expect

Return ONLY the JSON array. Nothing else.`;
}
