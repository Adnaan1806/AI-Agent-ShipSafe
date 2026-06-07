import { Router } from 'express';

const router = Router();

// Phase 5 — GET /api/reports/session/:sessionId
router.get('/session/:sessionId', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 5' });
});

// Phase 5 — GET /api/reports/run/:runId
router.get('/run/:runId', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 5' });
});

export default router;
