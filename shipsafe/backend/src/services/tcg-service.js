const OLLAMA_URL   = process.env.OLLAMA_API_URL  || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL    || 'qwen2.5';

export async function generateTestCases(requirementText) {
  const prompt = `You are a senior QA engineer responsible for creating a complete, traceable, and executable test suite from acceptance criteria.

Requirement:
${requirementText}

========================================================
## Step 0 — AC EXTRACTION (MANDATORY, INTERNAL ONLY)
========================================================

Before writing any test cases:
1. Extract ALL acceptance criteria (AC01, AC02, ...).
2. Think through each AC: action | expected outcome | system state change.
3. DO NOT output this extraction. It is internal reasoning only.
4. The ONLY output must be the final JSON object.
5. No AC may be skipped, merged, or interpreted loosely.

========================================================
## Step 1 — AC COVERAGE (MANDATORY 1:1 MAPPING)
========================================================

For EACH AC generate at least 1 test case that directly validates it.
- Tag testData with { "ac": "AC01" }
- One test case maps to exactly ONE AC
- Validate BOTH UI/API behavior AND the business outcome (state change, email sent, token invalidated, etc.)

FOR ACs THAT CLAIM A STATE PERSISTS (e.g. "existing password remains valid"):
- You MUST include active verification steps — navigate to the relevant page and perform the action
- Example: if AC says "old password still works", the steps MUST include navigating to Login, entering the old password, and verifying access is granted
- Do NOT write "system maintains existing functionality" as an expected result without steps that prove it

FOR PASSWORD/AUTH RESET FLOWS — these two cases are MANDATORY regardless of the ACs:
1. "Login succeeds with new password after reset" — P1, functional
   Steps: navigate to Login → enter new password → verify access granted
2. "Login fails with old password after reset" — P1, negative
   Steps: navigate to Login → enter old password → verify access denied

========================================================
## Step 2 — ADDITIONAL COVERAGE (DERIVED ONLY)
========================================================

After AC coverage, add derived cases for:
- Unregistered/invalid input handling
- Security: injection, access control, brute force, token misuse
- Edge: boundary values, max length, empty input, special characters
- UX: loading states, error clarity

Tag all derived cases: "Derived - ..."

SECURITY RULE — Email enumeration prevention:
When testing unregistered email, the expected result MUST be a generic message that does NOT reveal whether the email is registered.
Correct:   "System displays: 'If this email is registered, you will receive a reset link shortly'"
WRONG:     "System displays an error indicating the email is not registered"

PASSWORD POLICY RULE:
If the password policy is not defined in the requirement, use universally weak test values:
- Too short: 'ab'
- No complexity: '12345678' (numbers only, no uppercase/special chars)
- Empty: ''
Do NOT assume specific character restrictions unless explicitly stated in the requirement.

========================================================
## TEST CASE FORMAT (STRICT)
========================================================

{
  "title": "Short imperative title",
  "type": "functional|negative|edge|security|ux",
  "priority": "P1|P2|P3",
  "preconditions": "Exact system state before execution",
  "steps": [
    "Step 1: Navigate to 'Forgot Password' page",
    "Step 2: Enter 'user@example.com' into 'Email Address' field",
    "Step 3: Click 'Submit' button",
    "Step 4: Observe system response within 60 seconds"
  ],
  "expectedResult": "Specific observable outcome including both UI feedback and system state change",
  "testData": { "ac": "AC01", "email": "user@example.com" }
}

========================================================
## TYPE RULES (STRICT)
========================================================

- functional: happy path — system works correctly for valid input
- negative: system REJECTS invalid, unauthorised, or malformed input → any test with "invalid", "reject", "unregistered", "error", "prevent", "fail" in its intent
- edge: boundary values, empty input, max length, special characters
- security: injection, access control, token misuse, brute force, enumeration
- ux: loading states, responsive layout, error message clarity

RULE: Only use "functional" for happy path cases. If the test expects an error, rejection, or prevention — it is "negative", not "functional".

========================================================
## PRIORITY RULES (STRICT)
========================================================

P1 — a bug here blocks release:
- Core happy path (valid login, successful reset, new password works)
- Security vulnerabilities (injection, token misuse, access control)
- Authentication/authorization flows
- Data integrity (old password invalidated after reset)

P2 — a bug here is a sprint blocker:
- Validation rules (email format, password policy)
- Error handling (expired link, used link, policy mismatch)
- Important edge conditions

P3 — low impact:
- Cosmetic UX, loading states, rare edge cases

========================================================
## STEP QUALITY RULES (STRICT)
========================================================

- Every step starts with a verb: Navigate, Enter, Click, Submit, Verify, Observe, Wait
- Use CONCRETE values — no placeholders like "valid input" or "enter credentials"
- Specify exact field names and button labels
- 3–6 steps per test case
- Timing-based ACs must include: note the timestamp, perform action, verify outcome within N seconds

========================================================
## OUTPUT FORMAT
========================================================

Return a single JSON object:
{
  "suiteName": "...",
  "scenarios": ["one label per AC + derived scenarios"],
  "impactedAreas": ["system areas at regression risk"],
  "cases": [...]
}

Return valid JSON only. No markdown. No explanation. Every bracket must close. Do not truncate.`;

  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { num_predict: 8192, temperature: 0.2 },
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
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Model returned non-JSON: ${cleaned.slice(0, 300)}`);
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error(`Could not parse JSON from model response: ${cleaned.slice(0, 300)}`);
    }
  }

  if (!Array.isArray(parsed.cases)) {
    throw new Error('Model response missing "cases" array');
  }

  const result = {
    suiteName:     parsed.suiteName     || 'Generated Suite',
    scenarios:     Array.isArray(parsed.scenarios)     ? parsed.scenarios     : [],
    impactedAreas: Array.isArray(parsed.impactedAreas) ? parsed.impactedAreas : [],
    cases:         parsed.cases,
  };

  return postProcess(result, requirementText);
}

// ---- Post-processor ----
// Enforces structural rules the model consistently ignores:
// type normalisation, security→P1, and post-reset login verification cases.

function postProcess(result, requirementText) {
  const cases = result.cases.map(normaliseCase);

  if (isAuthFlow(requirementText, result)) {
    if (!hasCase(cases, ['new password', 'login']) && !hasCase(cases, ['new password', 'sign in']) && !hasCase(cases, ['new password', 'authenticate'])) {
      cases.push(makeCase({
        title: 'Login succeeds with new password after reset',
        type: 'functional',
        priority: 'P1',
        preconditions: 'User has successfully completed the password reset and set newpassword123 as the new password.',
        steps: [
          "Step 1: Navigate to the 'Login' page",
          "Step 2: Enter 'user@example.com' into the 'Email' field",
          "Step 3: Enter 'newpassword123' into the 'Password' field",
          "Step 4: Click the 'Sign In' button",
          "Step 5: Observe that the user is redirected to the application dashboard",
        ],
        expectedResult: 'User is authenticated successfully. Session is created. Dashboard is displayed.',
        testData: { ac: 'derived', note: 'Post-reset new credential verification', email: 'user@example.com', password: 'newpassword123' },
        order: 900,
      }));
    }

    if (!hasCase(cases, ['old password', 'fail']) && !hasCase(cases, ['old password', 'reject']) && !hasCase(cases, ['old password', 'invalid'])) {
      cases.push(makeCase({
        title: 'Login fails with old password after successful reset',
        type: 'negative',
        priority: 'P1',
        preconditions: 'User has successfully completed the password reset. Old password was oldpassword123.',
        steps: [
          "Step 1: Navigate to the 'Login' page",
          "Step 2: Enter 'user@example.com' into the 'Email' field",
          "Step 3: Enter 'oldpassword123' into the 'Password' field",
          "Step 4: Click the 'Sign In' button",
          "Step 5: Observe the system response",
        ],
        expectedResult: 'Login is rejected. System displays authentication error. Old password is no longer valid. No session is created.',
        testData: { ac: 'derived', note: 'Post-reset old credential invalidation', email: 'user@example.com', password: 'oldpassword123' },
        order: 901,
      }));
    }
  }

  return { ...result, cases };
}

function normaliseCase(c) {
  const type     = inferType(c.type, c.title, c.expectedResult);
  const priority = inferPriority(c.priority, type, c.title);
  return { ...c, type, priority };
}

function inferType(declared, title, expectedResult) {
  if (declared && declared !== 'functional') return declared;
  const text = `${title} ${expectedResult}`.toLowerCase();
  if (/inject|sql|xss|csrf|brute.?force|access.?control|token.?misu|enumerat|unauthori/i.test(text)) return 'security';
  if (/\bempty\b|max.?length|boundary|exceed|special.?char|too.?short|too.?long/i.test(text)) return 'edge';
  if (/invalid|unregistered|reject|does not meet|prevent|block|not send|cannot|fail|error|denied/i.test(text)) return 'negative';
  if (/loading|spinner|responsive|mobile|accessibility|aria|clear.?message|feedback/i.test(text)) return 'ux';
  return 'functional';
}

function inferPriority(declared, type, title) {
  if (type === 'security') return 'P1';
  const text = title.toLowerCase();
  if (/login succeed|new password.*login|login.*new password|success.*reset|happy path/i.test(text)) return 'P1';
  return declared || 'P2';
}

function isAuthFlow(req, result) {
  const text = `${req} ${result.suiteName} ${result.scenarios.join(' ')}`.toLowerCase();
  return /password|reset|login|auth|sign.?in|credential/i.test(text);
}

function hasCase(cases, keywords) {
  return cases.some(c => {
    const text = `${c.title} ${c.expectedResult}`.toLowerCase();
    return keywords.every(kw => text.includes(kw));
  });
}

function makeCase(fields) {
  return {
    title: fields.title,
    type: fields.type,
    priority: fields.priority,
    preconditions: fields.preconditions,
    steps: fields.steps,
    expectedResult: fields.expectedResult,
    testData: fields.testData,
    status: 'active',
    order: fields.order,
  };
}
