# ShipSafe — QA AI Agent

ShipSafe is an AI-powered QA automation platform. The AI doesn't generate code — it operates a real browser using tools, reads the actual DOM, and verifies each step independently.

This project was designed by studying the limitations of a previous QA tool (AutoQA/QAgent) and rebuilding it correctly from scratch.

---

## Project Structure

```
shipsafe/
├── frontend/          # React + Vite (port 5173)
│   ├── src/
│   │   ├── pages/     # Home, APITesting, Automation, TCG
│   │   ├── components/
│   │   └── lib/       # API client, SSE hooks, types
│   └── vite.config.ts
│
├── backend/           # Node.js + Express (port 3001)
│   ├── src/
│   │   ├── routes/    # api-testing, automation, tcg, reports
│   │   ├── services/  # playwright-agent, api-executor, report-generator
│   │   ├── db/        # Prisma client + schema
│   │   ├── queue/     # BullMQ job definitions
│   │   └── lib/       # SSE emitter, auth middleware, helpers
│   └── prisma/
│       └── schema.prisma
│
└── docker-compose.yml # PostgreSQL + Redis
```

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Frontend | React + Vite | Fast dev server, clean separation from backend |
| Backend | Node.js + Express | Familiar, minimal friction |
| AI | Gemini 2.0 Flash via `@google/generative-ai` | Free tier (1500 req/day), supports function calling/tool use, good DOM reasoning |
| Browser automation | Playwright + `@playwright/mcp` | AI operates browser as tools, not generated code |
| Database | PostgreSQL + Prisma | Typed schema, persistent sessions and results |
| Job queue | BullMQ + Redis | Non-blocking test runs |
| Realtime | Server-Sent Events (SSE) | Stream step results live to the frontend |
| Auth | JWT middleware | Simple, stateless, add OAuth later |

---

## The Three Modules — Which Tool Each Uses

| Module | Needs Browser? | Uses Playwright MCP? | AI Integration |
|---|---|---|---|
| API Testing | No — pure HTTP | No | Claude SDK directly → generate payloads → axios executes |
| UI Automation | Yes — real browser | Yes | Claude SDK + MCP tools → browser operates live |
| TCG | No | No | Claude SDK directly → generate test cases |

**Rule:** Playwright + MCP is only for UI automation. Everything else talks to Claude directly via the Anthropic SDK and uses axios for HTTP.

### 1. API Testing
- No browser involved — pure HTTP calls
- User uploads a Postman collection JSON + optional environment variables file
- Claude (via Anthropic SDK, no MCP) reads the endpoint schema and generates test cases with **real request payloads**
- Tests execute concurrently via `Promise.allSettled` using axios
- Results stored in PostgreSQL
- Self-contained HTML report generated on demand

### 2. UI Automation (Playwright + MCP — the core value)
- Requires a real browser — this is the only module that uses Playwright MCP
- User writes test steps in plain English
- Claude executes steps one-by-one using Playwright MCP browser tools
- Claude reads the real DOM before acting (`browser_snapshot`) — never guesses selectors
- Each step is independently pass/fail with a screenshot
- Results streamed live to frontend via SSE
- No generated scripts, no subprocesses, no hardcoded selectors

### 3. Test Case Generator (TCG)
- No browser involved
- Defer JIRA integration to Phase 4
- Phase 1: user pastes a feature description or acceptance criteria
- Claude (via Anthropic SDK, no MCP) generates structured test cases
- Export to JSON or copy to clipboard
- JIRA write-back added later

---

## The Core Architecture: Playwright + MCP Agent Loop

This is the most important part of the entire project. Understand this before writing any automation code.

**The wrong way (what AutoQA did):**
```
User text → AI writes complete Selenium script → spawn subprocess → hope it works
```
Problems: AI guesses selectors blindly, no per-step tracking, can't recover from errors,
returns fake "passed" when Chrome isn't installed.

**The right way (ShipSafe):**
```
User text → Claude interprets step 1
         → uses browser_snapshot() to read actual DOM
         → uses browser_click(selector) or browser_fill(selector, value)
         → Playwright executes the action
         → Claude takes browser_screenshot() to verify
         → step result streamed to frontend
         → Claude interprets step 2 → repeat
```

### Playwright MCP Setup

```bash
npm install @google/generative-ai @playwright/mcp playwright
npx playwright install chromium
```

**AI Provider options (all free):**
- **Gemini 2.0 Flash** — default, free tier via Google AI Studio (1500 req/day), get key at https://aistudio.google.com
- **Ollama** — fully free, runs locally, no rate limits, needs `ollama pull llama3.1` or `qwen2.5`
- The provider is swapped via `AI_PROVIDER` env var — same pattern as AutoQA

```javascript
// backend/src/services/playwright-agent.js

import { createServer } from '@playwright/mcp';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function runAutomationTest(testSteps, targetUrl, onStepResult) {
  const mcpServer = await createServer({
    browser: 'chromium',
    headless: true,
    viewport: { width: 1920, height: 1080 }
  });

  // Convert Playwright MCP tools to Gemini function declarations
  const mcpTools = mcpServer.getTools();
  const geminiTools = [{
    functionDeclarations: mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }))
  }];

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    tools: geminiTools
  });

  const chat = model.startChat({
    history: [],
    systemInstruction: `You are a QA automation engineer executing browser tests.
- Navigate to the URL first
- Before clicking any element, use browser_snapshot to read the DOM and find the correct selector
- After each action, take a screenshot with browser_screenshot to confirm the result
- If a step fails, capture the error state and stop — do NOT continue past a failed step
- Never guess a selector — always snapshot first`
  });

  const stepResults = [];

  try {
    let result = await chat.sendMessage(
      `Target URL: ${targetUrl}\n\nTest Steps:\n${testSteps}\n\nBegin execution now.`
    );

    while (true) {
      const response = result.response;
      const functionCalls = response.functionCalls();

      if (functionCalls && functionCalls.length > 0) {
        const functionResponses = [];

        for (const call of functionCalls) {
          let callResult;
          try {
            callResult = await mcpServer.callTool(call.name, call.args);
            const stepResult = {
              toolName: call.name,
              input: call.args,
              success: true,
              output: callResult,
              screenshotData: callResult.screenshot || null
            };
            stepResults.push(stepResult);
            onStepResult(stepResult); // streams to SSE
          } catch (err) {
            callResult = { error: err.message };
            const stepResult = {
              toolName: call.name,
              input: call.args,
              success: false,
              error: err.message
            };
            stepResults.push(stepResult);
            onStepResult(stepResult);
          }

          functionResponses.push({
            functionResponse: {
              name: call.name,
              response: callResult
            }
          });
        }

        result = await chat.sendMessage(functionResponses);
        continue;
      }

      // No more function calls — Gemini finished
      return { steps: stepResults, summary: response.text() };
    }
  } finally {
    await mcpServer.close();
  }
}
```

---

## SSE Streaming

Never use polling. Stream step results live as they happen.

```javascript
// backend/src/routes/automation.js

router.get('/stream/:sessionId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = sseEmitter.on(req.params.sessionId, send);

  req.on('close', () => {
    unsubscribe();
  });
});

// Trigger a test run (non-blocking — job queued)
router.post('/run', async (req, res) => {
  const { sessionId, testSteps, targetUrl } = req.body;
  await automationQueue.add('run-test', { sessionId, testSteps, targetUrl });
  res.json({ sessionId, status: 'queued' });
});
```

```javascript
// backend/src/queue/automation-worker.js

automationQueue.process('run-test', async (job) => {
  const { sessionId, testSteps, targetUrl } = job.data;

  await runAutomationTest(testSteps, targetUrl, (stepResult) => {
    sseEmitter.emit(sessionId, { type: 'step', data: stepResult });
  });

  sseEmitter.emit(sessionId, { type: 'complete' });
});
```

```javascript
// frontend/src/lib/useTestStream.js

export function useTestStream(sessionId) {
  const [steps, setSteps] = useState([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    const stream = new EventSource(`/api/automation/stream/${sessionId}`);

    stream.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'step') setSteps(prev => [...prev, event.data]);
      if (event.type === 'complete') { setDone(true); stream.close(); }
      if (event.type === 'error') { setDone(true); stream.close(); }
    };

    return () => stream.close();
  }, [sessionId]);

  return { steps, done };
}
```

---

## Database Schema (Prisma)

```prisma
// backend/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  sessions  TestSession[]
}

model TestSession {
  id          String    @id @default(cuid())
  type        String    // "api" | "automation" | "tcg"
  status      String    // "queued" | "running" | "completed" | "failed"
  input       Json      // postman collection / test steps text / feature description
  targetUrl   String?   // for automation sessions
  createdAt   DateTime  @default(now())
  completedAt DateTime?
  userId      String?
  user        User?     @relation(fields: [userId], references: [id])

  results     TestResult[]
  reports     Report[]
}

model TestResult {
  id          String  @id @default(cuid())
  sessionId   String
  stepIndex   Int
  toolName    String? // which MCP tool was called
  stepName    String
  status      String  // "passed" | "failed" | "skipped"
  durationMs  Int
  input       Json?   // tool input (selector, url, value etc)
  output      Json?   // tool result
  screenshot  String? // base64 or S3 URL
  error       String?
  session     TestSession @relation(fields: [sessionId], references: [id])
}

model Report {
  id          String   @id @default(cuid())
  sessionId   String
  htmlContent String
  createdAt   DateTime @default(now())
  session     TestSession @relation(fields: [sessionId], references: [id])
}
```

---

## API Testing Module

### Key improvements over AutoQA

1. **Resolve Postman variables** — accept an environment JSON alongside the collection
2. **Concurrent execution** — `Promise.allSettled` not a for loop
3. **AI generates real payloads** — prompt includes actual request body schema
4. **No sequential delay** — remove the 1-second sleep between APIs

### Prompt for AI test case generation

```javascript
function buildApiTestPrompt(api) {
  return `You are a QA engineer writing test cases for an API endpoint.

Endpoint:
  Method: ${api.method}
  URL: ${api.url}
  Headers: ${JSON.stringify(api.headers)}
  Body: ${JSON.stringify(api.body)}
  Description: ${api.description}

Generate test cases with REAL request payloads. Include:
1. Positive test — valid payload, expect 2xx
2. Negative test — missing required field, expect 400
3. Invalid payload — malformed body (wrong types), expect 400 or 422
4. Auth failure — no Authorization header, expect 401
5. Status code validation — confirm the exact code matches the spec

For each test case return:
{
  "type": "...",
  "description": "...",
  "method": "...",
  "url": "...",
  "headers": {...},
  "body": {...},        // actual payload, not placeholder
  "expectedStatus": 200
}

Return a JSON array only. No markdown.`;
}
```

---

## Environment Variables

```env
# Backend (.env)
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shipsafe

# Redis (for BullMQ)
REDIS_URL=redis://localhost:6379

# AI Provider (free options)
AI_PROVIDER=gemini                        # gemini | ollama
GEMINI_API_KEY=your_key_from_aistudio    # free at https://aistudio.google.com
GEMINI_MODEL=gemini-2.0-flash

# Ollama (alternative, fully free, runs locally)
OLLAMA_API_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=llama3.1                     # needs: ollama pull llama3.1

# Auth
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d

# Playwright
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_BROWSER=chromium

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5173
```

```env
# Frontend (.env)
 =http://localhost:3001
```

---

## What NOT to Do (Lessons from AutoQA)

These are real mistakes from the previous codebase. Do not repeat them.

- **Never spawn a Node subprocess to run automation scripts.** Use Playwright's API directly.
- **Never have the AI generate a complete script as a string.** The AI uses tools to act step by step.
- **Never return fake "passed" results when execution fails.** Hard fail with a clear error and reason.
- **Never silently fall back to simulated results.** The user must know if the test didn't actually run.
- **Never use regex to inject code into generated scripts.** There are no generated scripts.
- **Never poll for progress from the frontend.** Use SSE.
- **Never store results as flat JSON files on disk.** Use PostgreSQL.
- **Never leave endpoints unauthenticated.** Apply JWT middleware from day one.
- **Never truncate JIRA descriptions.** Claude supports 200K context — send everything.
- **Never hardcode form field IDs like `firstName`, `lastName`.** Claude reads the actual DOM.
- **Never use `Date.now()` for IDs.** Use `cuid()` or `uuid`.

---

## Build Order (Phases)

### Phase 1 — Foundation
- [ ] Monorepo setup: `frontend/` (React + Vite) + `backend/` (Express)
- [ ] `docker-compose.yml` with PostgreSQL + Redis
- [ ] Prisma schema + migrations
- [ ] JWT auth middleware on all `/api` routes
- [ ] Basic UI shell with 3 module pages (no logic yet)

### Phase 2 — API Testing
- [ ] Postman collection upload + variable resolution
- [ ] AI test case generation with real payloads (Claude)
- [ ] Concurrent HTTP test execution
- [ ] Results stored in PostgreSQL
- [ ] Self-contained HTML report
- [ ] SSE progress streaming

### Phase 3 — Playwright + MCP Automation (core value)
- [ ] `@playwright/mcp` server setup
- [ ] Claude agent loop with tool use
- [ ] BullMQ worker for non-blocking execution
- [ ] SSE streaming of step results to frontend
- [ ] Per-step screenshots stored as base64
- [ ] Step-level pass/fail tracking
- [ ] Playwright trace file saved for debugging

### Phase 4 — TCG + JIRA
- [ ] Feature description input (no JIRA yet)
- [ ] Claude generates structured test cases
- [ ] Export to JSON / clipboard
- [ ] JIRA OAuth integration
- [ ] Fetch story by ticket ID
- [ ] Write test cases back to JIRA as comment

### Phase 5 — Polish
- [ ] Rate limiting (express-rate-limit)
- [ ] CSRF protection
- [ ] Test history page (previous sessions + results)
- [ ] Re-run failed steps only
- [ ] Bulk Postman collection runs
- [ ] Screenshot diff between runs

---

## CORS Setup

```javascript
// backend/src/index.js
import cors from 'cors';

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
```

---

## Project Context

This project was designed by analyzing AutoQA — a Selenium-based QA tool that used AI as a code generator. The core insight driving ShipSafe:

> AI should operate the browser as an agent, not write scripts about it.

The previous tool generated Selenium scripts as strings, injected headless flags via regex, spawned subprocesses, and returned fake "passed" results when Chrome wasn't installed. ShipSafe solves all of this by using Playwright MCP — the AI calls `browser_snapshot()`, reads the real DOM, calls `browser_click()`, and sees the result immediately. Every step is grounded in what's actually on the page.
