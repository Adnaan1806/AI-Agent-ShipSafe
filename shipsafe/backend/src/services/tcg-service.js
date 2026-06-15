import { askAI } from './ai-provider.js';

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
## STEP 1 — AC COVERAGE (MANDATORY)
========================================================

For EACH AC generate at least one test case that directly validates it.

Rules:

- Every AC must be covered.
- No AC may be skipped.
- One test case maps to exactly one AC.
- Include testData.ac.
- Verify both UI/API behaviour and business outcome.

Before producing output internally verify:

1. Every AC appears at least once.
2. No AC is missing.
3. Every non-derived test references exactly one AC.
4. No test case references a non-existent AC.

========================================================
## STEP 2 — BOUNDARY ANALYSIS (MANDATORY)
========================================================

If an AC contains numeric, timing, quantity, or threshold rules,
generate boundary test cases.

Examples:

5 attempts:
- 4 attempts
- 5 attempts
- 6 attempts

15 minutes:
- before 15 minutes
- exactly 15 minutes
- after 15 minutes

30 minute lock:
- during lock period
- immediately after lock expires

Boundary tests should be tagged:

testData.ac = "ACxx"

========================================================
## STEP 3 — DERIVED COVERAGE (STRICT)
========================================================

Generate additional derived tests ONLY when they can be directly inferred from the requirement.

Allowed:

- Validation scenarios
- Boundary scenarios
- Security scenarios
- Error handling

Do NOT invent functionality.

Do NOT generate:

- Password reset tests unless password reset is explicitly mentioned.
- Registration tests unless registration is explicitly mentioned.
- Profile tests unless profile functionality is explicitly mentioned.
- Email verification tests unless email verification is explicitly mentioned.

Tag derived tests:

testData.ac = "derived"

========================================================
## SECURITY RULES
========================================================

When authentication exists:

Generate:

- SQL injection attempt
- Access control bypass attempt
- Brute-force protection validation

Only if applicable.

========================================================
## QUALITY CHECK (INTERNAL)
========================================================

Before returning JSON:

Verify:

- Every AC covered
- No hallucinated functionality
- No duplicate tests
- Boundary conditions generated
- JSON valid

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

  const response = await askAI(prompt, { maxTokens: 8192 });
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

  if (isPasswordResetFlow(requirementText, result)) {

    if (
      !hasCase(cases, ['new password', 'login']) &&
      !hasCase(cases, ['new password', 'sign in'])
    ) {
      cases.push(makeCase({
        title: 'Login succeeds with new password after reset',
        type: 'functional',
        priority: 'P1',
        preconditions:
          'User has successfully completed password reset and set newpassword123 as the new password.',
        steps: [
          "Step 1: Navigate to the 'Login' page",
          "Step 2: Enter 'user@example.com' into the 'Email' field",
          "Step 3: Enter 'newpassword123' into the 'Password' field",
          "Step 4: Click the 'Sign In' button",
          "Step 5: Verify the dashboard is displayed"
        ],
        expectedResult:
          'User is authenticated successfully. Session is created. Dashboard is displayed.',
        testData: {
          ac: 'derived',
          email: 'user@example.com',
          password: 'newpassword123'
        },
        order: 900
      }));
    }

    if (
      !hasCase(cases, ['old password', 'fail']) &&
      !hasCase(cases, ['old password', 'invalid'])
    ) {
      cases.push(makeCase({
        title: 'Login fails with old password after successful reset',
        type: 'negative',
        priority: 'P1',
        preconditions:
          'User has successfully completed password reset. Old password was oldpassword123.',
        steps: [
          "Step 1: Navigate to the 'Login' page",
          "Step 2: Enter 'user@example.com' into the 'Email' field",
          "Step 3: Enter 'oldpassword123' into the 'Password' field",
          "Step 4: Click the 'Sign In' button",
          "Step 5: Observe the system response"
        ],
        expectedResult:
          'Login is rejected. Old password is invalid. No session is created.',
        testData: {
          ac: 'derived',
          email: 'user@example.com',
          password: 'oldpassword123'
        },
        order: 901
      }));
    }
  }

  return {
    ...result,
    cases
  };
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

function isPasswordResetFlow(req, result) {
  const text = `${req} ${result.suiteName} ${result.scenarios.join(' ')}`.toLowerCase();
  return /password.*reset|reset.*password|forgot.?password/i.test(text);
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
