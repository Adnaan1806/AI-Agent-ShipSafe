import { Router } from 'express';

const router = Router();

// Phase 4 — POST /api/automation/run
router.post('/run', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 4' });
});

// Phase 4 — GET /api/automation/stream/:sessionId (SSE)
router.get('/stream/:sessionId', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 4' });
});

// Phase 4 — GET /api/automation/sessions/:id
router.get('/sessions/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented — Phase 4' });
});

export default router;
