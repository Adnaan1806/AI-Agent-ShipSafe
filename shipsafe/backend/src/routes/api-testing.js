import { Router } from 'express';
import multer from 'multer';
import { parseCollection, executeHttpTest } from '../services/api-executor.js';
import { generateApiTestCases } from '../services/api-ai-service.js';
import { generateHtmlReport } from '../services/report-generator.js';
import { prisma } from '../db/prisma.js';
import { sseEmitter } from '../lib/sse.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/api-testing/run
// Body: multipart with 'collection' (required) and 'env' (optional) files
router.post('/run', upload.fields([{ name: 'collection', maxCount: 1 }, { name: 'env', maxCount: 1 }]), async (req, res) => {
  const collectionFile = req.files?.collection?.[0];
  if (!collectionFile) return res.status(400).json({ error: 'collection file is required' });

  let collectionJson;
  try {
    collectionJson = JSON.parse(collectionFile.buffer.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'collection file is not valid JSON' });
  }

  let envJson = {};
  const envFile = req.files?.env?.[0];
  if (envFile) {
    try { envJson = JSON.parse(envFile.buffer.toString('utf8')); }
    catch { /* ignore malformed env file */ }
  }

  let endpoints;
  try {
    endpoints = parseCollection(collectionJson, envJson);
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse collection: ${err.message}` });
  }

  if (!endpoints.length) {
    return res.status(400).json({ error: 'No HTTP requests found in collection' });
  }

  const collectionName = collectionJson.info?.name ?? collectionJson.collection?.info?.name ?? 'Unnamed Collection';

  const session = await prisma.testSession.create({
    data: {
      type: 'api',
      status: 'queued',
      input: { collectionName, endpointCount: endpoints.length },
      userId: req.user.id,
      projectId: req.body.projectId || null,
    },
  });

  // Start non-blocking — respond immediately with sessionId
  runApiTests(session.id, endpoints).catch(err => {
    console.error(`[api-testing] session ${session.id} crashed:`, err);
  });

  res.json({ sessionId: session.id, endpointCount: endpoints.length, collectionName });
});

// GET /api/api-testing/stream/:sessionId?token=xxx
// EventSource-compatible SSE stream (token in query param because EventSource can't set headers)
router.get('/stream/:sessionId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const unsubscribe = sseEmitter.on(req.params.sessionId, send);
  req.on('close', unsubscribe);
});

// GET /api/api-testing/sessions
router.get('/sessions', async (req, res) => {
  const sessions = await prisma.testSession.findMany({
    where: { userId: req.user.id, type: 'api' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { _count: { select: { results: true } } },
  });
  res.json({ sessions });
});

// GET /api/api-testing/sessions/:id
router.get('/sessions/:id', async (req, res) => {
  const session = await prisma.testSession.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { results: { orderBy: { stepIndex: 'asc' } } },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ session });
});

// POST /api/api-testing/sessions/:id/report
router.post('/sessions/:id/report', async (req, res) => {
  const session = await prisma.testSession.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { results: { orderBy: { stepIndex: 'asc' } } },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'completed') {
    return res.status(400).json({ error: 'Session has not completed yet' });
  }

  const collectionName = session.input?.collectionName ?? 'API Tests';
  const generatedAt = new Date().toUTCString();

  const html = generateHtmlReport({
    sessionId: session.id,
    collectionName,
    generatedAt,
    results: session.results,
  });

  // Persist report
  await prisma.report.upsert({
    where: { id: session.id },
    create: { id: session.id, sessionId: session.id, htmlContent: html, summary: session.input },
    update: { htmlContent: html },
  }).catch(() => {
    // upsert by sessionId not id — just create if it doesn't exist
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ---- Async test runner ----

async function runApiTests(sessionId, endpoints) {
  await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'running' } });

  const emit = (type, data) => sseEmitter.emit(sessionId, { type, data });

  try {
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];

      emit('endpoint_start', {
        index: i,
        total: endpoints.length,
        name: endpoint.name,
        method: endpoint.method,
        url: endpoint.url,
      });

      let testCases;
      try {
        testCases = await generateApiTestCases(endpoint);
      } catch (err) {
        emit('endpoint_error', { index: i, name: endpoint.name, error: err.message });
        await saveResult(sessionId, i, endpoint.name, 'AI generation failed', {
          status: 'error', actualStatus: null, durationMs: 0, error: err.message, responseBody: null,
          expectedStatus: 0,
        }, null);
        continue;
      }

      emit('tests_generated', {
        index: i,
        name: endpoint.name,
        count: testCases.length,
        descriptions: testCases.map(t => t.description),
      });

      // Run all test cases for this endpoint concurrently
      const settled = await Promise.allSettled(
        testCases.map((tc, j) => runSingleTest(sessionId, i, j, endpoint, tc, emit))
      );

      const endpointResults = settled.map(s => s.status === 'fulfilled' ? s.value : { status: 'error' });
      const epPassed = endpointResults.filter(r => r.status === 'passed').length;

      emit('endpoint_done', {
        index: i,
        name: endpoint.name,
        passed: epPassed,
        total: testCases.length,
      });
    }

    const allResults = await prisma.testResult.findMany({ where: { sessionId } });
    const passed = allResults.filter(r => r.status === 'passed').length;
    const failed = allResults.filter(r => r.status === 'failed').length;
    const errored = allResults.filter(r => r.status === 'error').length;

    await prisma.testSession.update({
      where: { id: sessionId },
      data: { status: 'completed', completedAt: new Date() },
    });

    emit('complete', { total: allResults.length, passed, failed, errored });

  } catch (err) {
    await prisma.testSession.update({
      where: { id: sessionId },
      data: { status: 'failed', completedAt: new Date() },
    }).catch(() => {});
    emit('error', { error: err.message });
  }
}

async function runSingleTest(sessionId, endpointIdx, testIdx, endpoint, tc, emit) {
  const method = tc.method || endpoint.method;
  const url = tc.url || endpoint.url;
  const headers = tc.headers || endpoint.headers;
  const body = tc.body ?? null;
  const expectedStatus = tc.expectedStatus ?? 200;

  const result = await executeHttpTest({ method, url, headers, body, expectedStatus });

  emit('test_result', {
    endpointIndex: endpointIdx,
    testIndex: testIdx,
    description: tc.description,
    type: tc.type,
    status: result.status,
    actualStatus: result.actualStatus,
    expectedStatus,
    durationMs: result.durationMs,
    error: result.error,
  });

  await saveResult(sessionId, endpointIdx * 1000 + testIdx, `${endpoint.method} ${endpoint.name}`,
    tc.description, result, { method, url, headers, body, expectedStatus });

  return result;
}

async function saveResult(sessionId, stepIndex, toolName, stepName, result, input) {
  await prisma.testResult.create({
    data: {
      sessionId,
      stepIndex,
      toolName,
      stepName,
      status: result.status,
      durationMs: result.durationMs,
      input: input ?? {},
      output: {
        actualStatus: result.actualStatus,
        responseBody: result.responseBody,
      },
      error: result.error,
    },
  });
}

export default router;
