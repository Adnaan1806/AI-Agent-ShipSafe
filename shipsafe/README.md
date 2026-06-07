# ShipSafe — QA AI Agent

AI-powered QA platform. Requirements → test cases → browser automation → API testing → unified report.

## Quick start

### 1. Start infrastructure
```bash
docker-compose up -d
```

### 2. Backend
```bash
cd backend
npm install
npx prisma migrate dev --name init
npm run dev
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Structure
```
shipsafe/
├── backend/           # Express + Prisma (port 3001)
├── frontend/          # React + Vite (port 5173)
└── docker-compose.yml # PostgreSQL + Redis
```

## Build phases
| Phase | Module | Status |
|---|---|---|
| 1 | Foundation (auth, projects, UI shell) | ✅ Done |
| 2 | Test Case Generator (TCG) | Pending |
| 3 | API Testing | Pending |
| 4 | UI Automation (Playwright + MCP) | Pending |
| 5 | Project linking + unified report | Pending |
| 6 | CI/CD webhooks | Pending |

## API key (for CI/CD)
Every user has an `apiKey`. Use it in the `Authorization` header:
```
Authorization: ApiKey <your-api-key>
```
