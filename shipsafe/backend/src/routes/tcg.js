import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { generateTestCases } from '../services/tcg-service.js';

const router = Router();

// POST /api/tcg/generate
// body: { requirementText, suiteName?, projectId? }
router.post('/generate', async (req, res) => {
  const { requirementText, suiteName, projectId, provider } = req.body;

  if (!requirementText?.trim()) {
    return res.status(400).json({ error: 'requirementText is required' });
  }

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user.id },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
  }

  let aiResult;
  try {
    aiResult = await generateTestCases(requirementText.trim(), provider || null);
  } catch (err) {
    return res.status(502).json({ error: `AI generation failed: ${err.message}` });
  }

  const resolvedSuiteName = suiteName?.trim() || aiResult.suiteName;
  const resolvedProjectId = projectId || await ensureDefaultProject(req.user.id);

  const suite = await prisma.testSuite.create({
    data: {
      name: resolvedSuiteName,
      projectId: resolvedProjectId,
      status: 'draft',
      source: 'ai',
      cases: {
        create: aiResult.cases.map((c, idx) => ({
          title: c.title,
          type: normaliseType(c.type),
          priority: normalisePriority(c.priority),
          preconditions: c.preconditions || null,
          steps: Array.isArray(c.steps) ? c.steps : [],
          expectedResult: c.expectedResult || '',
          testData: c.testData || null,
          order: idx,
        })),
      },
    },
    include: { cases: { orderBy: { order: 'asc' } } },
  });

  res.status(201).json({
    suite,
    scenarios: aiResult.scenarios,
    impactedAreas: aiResult.impactedAreas,
  });
});

// GET /api/tcg/suites
router.get('/suites', async (req, res) => {
  const { projectId } = req.query;

  const where = projectId
    ? { projectId, project: { userId: req.user.id } }
    : { project: { userId: req.user.id } };

  const suites = await prisma.testSuite.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { cases: true } } },
  });

  res.json({ suites });
});

// GET /api/tcg/suites/:id
router.get('/suites/:id', async (req, res) => {
  const suite = await prisma.testSuite.findFirst({
    where: { id: req.params.id, project: { userId: req.user.id } },
    include: { cases: { where: { status: 'active' }, orderBy: { order: 'asc' } } },
  });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });
  res.json({ suite });
});

// PATCH /api/tcg/cases/:id
router.patch('/cases/:id', async (req, res) => {
  const existing = await prisma.testCase.findFirst({
    where: { id: req.params.id, suite: { project: { userId: req.user.id } } },
  });
  if (!existing) return res.status(404).json({ error: 'Test case not found' });

  const allowed = ['title', 'type', 'priority', 'preconditions', 'steps', 'expectedResult', 'testData'];
  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  if (data.type) data.type = normaliseType(data.type);
  if (data.priority) data.priority = normalisePriority(data.priority);

  const updated = await prisma.testCase.update({ where: { id: req.params.id }, data });
  res.json({ case: updated });
});

// POST /api/tcg/suites/:id/activate
router.post('/suites/:id/activate', async (req, res) => {
  const suite = await prisma.testSuite.findFirst({
    where: { id: req.params.id, project: { userId: req.user.id } },
  });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });

  const updated = await prisma.testSuite.update({
    where: { id: req.params.id },
    data: { status: 'active' },
    include: { _count: { select: { cases: true } } },
  });
  res.json({ suite: updated });
});

// POST /api/tcg/suites/:id/cases  (add a blank case manually)
router.post('/suites/:id/cases', async (req, res) => {
  const suite = await prisma.testSuite.findFirst({
    where: { id: req.params.id, project: { userId: req.user.id } },
    include: { _count: { select: { cases: true } } },
  });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });

  const { title, type, priority, preconditions, steps, expectedResult, testData } = req.body;

  const created = await prisma.testCase.create({
    data: {
      suiteId: suite.id,
      title: title || 'Untitled test case',
      type: normaliseType(type || 'functional'),
      priority: normalisePriority(priority || 'P2'),
      preconditions: preconditions || null,
      steps: Array.isArray(steps) ? steps : ['Step 1: '],
      expectedResult: expectedResult || '',
      testData: testData || null,
      order: suite._count.cases,
    },
  });

  res.status(201).json({ case: created });
});

// DELETE /api/tcg/suites/:id
router.delete('/suites/:id', async (req, res) => {
  const suite = await prisma.testSuite.findFirst({
    where: { id: req.params.id, project: { userId: req.user.id } },
  });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });

  await prisma.testSuite.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// DELETE /api/tcg/cases/:id  (soft delete)
router.delete('/cases/:id', async (req, res) => {
  const existing = await prisma.testCase.findFirst({
    where: { id: req.params.id, suite: { project: { userId: req.user.id } } },
  });
  if (!existing) return res.status(404).json({ error: 'Test case not found' });

  await prisma.testCase.update({ where: { id: req.params.id }, data: { status: 'deleted' } });
  res.json({ ok: true });
});

// GET /api/tcg/suites/:id/export
router.get('/suites/:id/export', async (req, res) => {
  const suite = await prisma.testSuite.findFirst({
    where: { id: req.params.id, project: { userId: req.user.id } },
    include: { cases: { where: { status: 'active' }, orderBy: { order: 'asc' } } },
  });
  if (!suite) return res.status(404).json({ error: 'Suite not found' });

  const filename = suite.name.replace(/[^a-z0-9]/gi, '_') + '.json';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify({ suite: { name: suite.name, version: suite.version }, cases: suite.cases }, null, 2));
});

// ---- helpers ----

function normaliseType(t) {
  const valid = ['functional', 'negative', 'edge', 'security', 'ux'];
  return valid.includes(t) ? t : 'functional';
}

function normalisePriority(p) {
  const up = p?.toUpperCase();
  return ['P1', 'P2', 'P3'].includes(up) ? up : 'P2';
}

async function ensureDefaultProject(userId) {
  const existing = await prisma.project.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;
  const created = await prisma.project.create({ data: { name: 'Default', userId } });
  return created.id;
}

export default router;
