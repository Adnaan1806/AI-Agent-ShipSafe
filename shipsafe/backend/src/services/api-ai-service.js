import { generateBody } from './api-data-generator.js';
import { buildMemoryContext } from './api-memory.js';
import { askAI } from './ai-provider.js';

// Generate test cases for a single endpoint.
// memory: ApiEndpointMemory record (or null) — injected as context into the AI prompt.
export async function generateApiTestCases(endpoint, memory = null, provider = null) {
  // Enrich the body with realistic values before handing to AI
  const enrichedBody = endpoint.body ? generateBody(endpoint.body) : null;
  const memoryCtx = memory ? buildMemoryContext(memory) : '';
  const prompt = buildPrompt({ ...endpoint, body: enrichedBody }, memoryCtx);

  const response = await askAI(prompt, { maxTokens: 4096, ...(provider && { provider }) });
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

  // Detect if this endpoint requires Bearer auth (placeholder left by the parser)
  const requiresAuth = Object.values(endpoint.headers ?? {}).some(
    v => typeof v === 'string' && v.includes('{{authToken}}')
  );

  // Detect registration endpoints — must use a unique email to avoid 409 conflicts on re-runs
  const isRegisterEndpoint =
    /register/i.test(endpoint.url) || /register/i.test(endpoint.name);

  const methodNote = isReadOnly
    ? `IMPORTANT: This is a ${endpoint.method} request — no request body. Only generate URL/path variation tests.`
    : `This is a ${endpoint.method} request with a body. Vary the payload for each test type.`;

  const authNote = requiresAuth
    ? `\nIMPORTANT — Authentication: the test runner performs a pre-flight login and injects the real token as {{authToken}}.
- For positive tests: include "Authorization": "Bearer {{authToken}}" in headers (the runner resolves it automatically).
- For auth tests (testing 401): omit the Authorization header entirely.`
    : '';

  const registerNote = isRegisterEndpoint && !isReadOnly
    ? `\nIMPORTANT — Registration endpoint: for the positive test, generate a UNIQUE email such as "qa_${Math.floor(Math.random() * 900000) + 100000}@example.com" so it never conflicts with an already-registered user. Do NOT reuse the email from the endpoint template.`
    : '';

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
${authNote}${registerNote}

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
