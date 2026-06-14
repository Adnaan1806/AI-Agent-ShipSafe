// AI-powered root cause analysis for API test failures.
// Called after a test fails; returns a structured diagnosis from Ollama.

const OLLAMA_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5';

export async function analyzeFailure(testCase, result, memoryContext = null) {
  const prompt = buildPrompt(testCase, result, memoryContext);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { num_predict: 768, temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;

    const { response } = await res.json();
    const cleaned = response.trim()
      .replace(/^```(?:json)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) return { rootCause: cleaned.slice(0, 300), confidence: 0.4, category: 'unknown', suggestedFix: 'Check the response details.', investigationSteps: [] };
      try { parsed = JSON.parse(m[0]); } catch { return null; }
    }

    return {
      rootCause: parsed.rootCause ?? 'Unknown',
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      category: parsed.category ?? 'unknown',
      suggestedFix: parsed.suggestedFix ?? '',
      investigationSteps: Array.isArray(parsed.investigationSteps) ? parsed.investigationSteps : [],
    };
  } catch {
    return null;
  }
}

// Run RCA in batch across all failures — does NOT block test execution.
export async function batchAnalyzeFailures(failures) {
  const analyses = [];
  for (const { testCase, result, memory } of failures) {
    const rca = await analyzeFailure(testCase, result, memory);
    if (rca) analyses.push({ description: testCase.description, url: testCase.url, ...rca });
  }
  return analyses;
}

function buildPrompt(testCase, result, memory) {
  const histNote = memory && memory.failCount > 0
    ? `Historical pattern: this endpoint has failed ${memory.failCount}/${memory.runCount} previous runs. Common errors: ${JSON.stringify((memory.commonFailures ?? []).slice(0, 3))}.`
    : '';

  return `You are a QA engineer diagnosing an API test failure.

Test Case:
  Description: ${testCase.description}
  Type: ${testCase.type ?? 'unknown'}
  Method: ${testCase.method}
  URL: ${testCase.url}
  Expected HTTP Status: ${testCase.expectedStatus}
  Request Headers: ${JSON.stringify(testCase.headers ?? {})}
  Request Body: ${JSON.stringify(testCase.body ?? null)}

Actual Result:
  HTTP Status: ${result.actualStatus ?? 'request failed / no response'}
  Error: ${result.error ?? 'none'}
  Response Body: ${JSON.stringify(result.responseBody)?.slice(0, 600) ?? 'none'}
  Duration: ${result.durationMs}ms
${histNote}

Return ONLY a JSON object — no markdown, no prose:
{
  "rootCause": "1–2 sentence explanation of why this test failed",
  "confidence": 0.85,
  "category": "auth" | "validation" | "not_found" | "server_error" | "timeout" | "network" | "contract" | "data" | "permission",
  "suggestedFix": "specific, actionable recommendation",
  "investigationSteps": ["step 1", "step 2", "step 3"]
}`;
}
