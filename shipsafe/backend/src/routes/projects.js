import { Router } from 'express';
import { prisma } from '../db/prisma.js';

const router = Router();

router.get('/', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { userId: req.user.id },
    include: {
      _count: { select: { requirements: true, suites: true, runs: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ projects });
});

router.post('/', async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name required' });

  const project = await prisma.project.create({
    data: { name: name.trim(), description: description?.trim(), userId: req.user.id },
  });
  res.status(201).json({ project });
});

router.get('/:id', async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: {
      requirements: { orderBy: { createdAt: 'desc' } },
      suites: {
        include: { _count: { select: { cases: true } } },
        orderBy: { createdAt: 'desc' },
      },
      runs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

router.patch('/:id', async (req, res) => {
  const { name, description } = req.body;
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const updated = await prisma.project.update({
    where: { id: req.params.id },
    data: { name: name?.trim() ?? project.name, description: description?.trim() ?? project.description },
  });
  res.json({ project: updated });
});

router.delete('/:id', async (req, res) => {
  await prisma.project.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  res.json({ ok: true });
});

export default router;
