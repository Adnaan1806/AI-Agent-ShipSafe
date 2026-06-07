# ShipSafe — QA AI Agent

AI-powered QA platform. The AI doesn't generate scripts — it reads real requirements, generates real test cases, executes real HTTP requests, and operates a real browser step by step.

## Quick start

### 1. Start infrastructure
```bash
cd shipsafe
docker-compose up -d        # PostgreSQL on :5433, Redis on :6379
```

### 2. Start Ollama (AI provider)
```bash
ollama serve                # separate terminal
ollama pull qwen2.5         # first time only
```

### 3. Backend
```bash
cd backend
npm install
cp .env.example .env        # fill in your values
npx prisma migrate dev --name init
npm run dev                 # http://localhost:3001
```

### 4. Frontend
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Open http://localhost:5173

---

## Project structure

```
shipsafe/
├── backend/
│   ├── src/
│   │   ├── routes/          # auth, projects, tcg, api-testing, automation, reports
│   │   ├── services/        # tcg-service, api-executor, api-ai-service, report-generator
│   │   ├── db/              # Prisma client
│   │   └── lib/             # auth middleware, SSE emitter
│   └── prisma/
│       └── schema.prisma
├── frontend/
│   └── src/
│       ├── pages/           # Home, Projects, TCG, APITesting, Automation
│       ├── components/      # Layout, Sidebar
│       └── lib/             # api client, AuthContext, types
├── shipsafe-collection.json # Postman collection for testing ShipSafe's own API
└── docker-compose.yml
```

---

## Environment variables

Create `backend/.env`:

```env
PORT=3001
NODE_ENV=development

DATABASE_URL=postgresql://postgres:postgres@localhost:5433/shipsafe
REDIS_URL=redis://localhost:6379

AI_PROVIDER=ollama
OLLAMA_API_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=qwen2.5

JWT_SECRET=change-this-to-a-long-random-string
JWT_EXPIRES_IN=7d

FRONTEND_URL=http://localhost:5173
```

---

## Modules

### Test Case Generator (TCG)
- Paste a feature description or acceptance criteria
- AI generates a structured, traceable test suite with type, priority, preconditions, steps, and expected results
- Inline edit, add, and delete cases before activating
- Export to JSON or copy to clipboard
- Suites linked to projects

### API Testing
- Upload a Postman collection (v2.0 or v2.1) + optional environment file
- AI reads each endpoint's schema and generates 3–5 test cases with real payloads
- All test cases for each endpoint execute concurrently via `Promise.allSettled`
- Results stream live to the UI via SSE
- Download a self-contained HTML report when complete

### UI Automation *(Phase 4 — coming)*
- Plain-English test steps
- Claude operates a real Chromium browser using Playwright MCP tools
- Reads the actual DOM before every action — never guesses selectors
- Per-step screenshots and pass/fail streamed live

---

## Authentication

Every user has a JWT token (for browser use) and an API key (for CI/CD).

```
Authorization: Bearer <jwt>       # browser / Postman
Authorization: ApiKey <api-key>   # CI/CD pipelines
```

The API key is returned on register/login and shown in your profile.

---

## Build phases

| Phase | Module | Status |
|---|---|---|
| 1 | Foundation — auth, projects, DB, UI shell | ✅ Done |
| 2 | Test Case Generator (TCG) | ✅ Done |
| 3 | API Testing | ✅ Done |
| 4 | UI Automation (Playwright + MCP) | Pending |
| 5 | JIRA integration + TCG write-back | Pending |
| 6 | CI/CD webhooks + unified reports | Pending |

---

## Tech stack

| Concern | Choice |
|---|---|
| Frontend | React + Vite + Tailwind |
| Backend | Node.js + Express |
| AI | Ollama (qwen2.5) — free, runs locally |
| Database | PostgreSQL + Prisma |
| Job queue | BullMQ + Redis |
| Realtime | Server-Sent Events (SSE) |
| Browser automation | Playwright + MCP *(Phase 4)* |
| Auth | JWT + ApiKey |
