import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import tcgRouter from './routes/tcg.js';
import apiTestingRouter from './routes/api-testing.js';
import automationRouter from './routes/automation.js';
import reportsRouter from './routes/reports.js';
import { requireAuth } from './lib/auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'shipsafe-backend' }));

// Public
app.use('/api/auth', authRouter);

// Protected — all require valid JWT or ApiKey
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/tcg', requireAuth, tcgRouter);
app.use('/api/api-testing', requireAuth, apiTestingRouter);
app.use('/api/automation', requireAuth, automationRouter);
app.use('/api/reports', requireAuth, reportsRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`ShipSafe backend → http://localhost:${PORT}`);
});
