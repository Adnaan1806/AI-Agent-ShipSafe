import { Router } from 'express';
import multer from 'multer';
import { parseCollection, executeHttpTest } from '../services/api-executor.js';
import { generateApiTestCases } from '../services/api-ai-service.js';
import { generateHtmlReport } from '../services/report-generator.js';
import { parseOpenApiSpec } from '../services/openapi-parser.js';
import { validateAssertions } from '../services/api-assertion-engine.js';
import { generateSecurityTests, scoreSecurityResults } from '../services/api-security-agent.js';
import { runPerformanceTest } from '../services/api-performance.js';
import { calculateCoverage } from '../services/api-coverage.js';
import { learnSchema, detectDrift } from '../services/api-schema-store.js';
import { getMemory, updateMemory } from '../services/api-memory.js';
import { batchAnalyzeFailures } from '../services/api-rca-service.js';
import { WorkflowContext, resolveTestCase } from '../services/api-workflow-engine.js';
import { prisma } from '../db/prisma.js';
import { sseEmitter } from '../lib/sse.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ─── POST /api/api-testing/run ──────────────────────────────────────────────
// Standard run from a Postman collection file upload.
router.post('/run', upload.fields([{ name: 'collection', maxCount: 1 }, { name: 'env', maxCount: 1 }]), async (req, res) => {
  const collectionFile = req.files?.collection?.[0];
  if (!collectionFile) return res.status(400).json({ error: 'collection file is required' });

  let collectionJson;
  try { collectionJson = JSON.parse(collectionFile.buffer.toString('utf8')); }
  catch { return res.status(400).json({ error: 'collection file is not valid JSON' }); }

  let envJson = {};
  const envFile = req.files?.env?.[0];
  if (envFile) {
    try { envJson = JSON.parse(envFile.buffer.toString('utf8')); } catch { /* ignore */ }
  }

  let endpoints;
  try { endpoints = parseCollection(collectionJson, envJson); }
  catch (err) { return res.status(400).json({ error: `Failed to parse collection: ${err.message}` }); }

  if (!endpoints.length) return res.status(400).json({ error: 'No HTTP requests found in collection' });

  const collectionName = collectionJson.info?.name ?? collectionJson.collection?.info?.name ?? 'Unnamed Collection';
  const session = await prisma.testSession.create({
    data: {
      type: 'api',
      status: 'queued',
      input: { collectionName, endpointCount: endpoints.length, mode: req.body.mode ?? 'standard' },
      userId: req.user.id,
      projectId: req.body.projectId || null,
    },
  });

  runApiTests(session.id, endpoints, req.user.id, req.body.projectId || null, req.body.provider || null).catch(err => {
    console.error(`[api-testing] session ${session.id} crashed:`, err);
  });

  res.json({ sessionId: session.id, endpointCount: endpoints.length, collectionName });
});

// ─── POST /api/api-testing/run-openapi ─────────────────────────────────────
// Run from an OpenAPI 3.x / Swagger 2.x spec.
// Accepts multipart with optional 'spec' file, OR JSON body with { url, specContent }.
router.post('/run-openapi', upload.fields([{ name: 'spec', maxCount: 1 }, { name: 'env', maxCount: 1 }]), async (req, res) => {
  let specInput;
  const specFile = req.files?.spec?.[0];
  const specUrl = req.body?.url;
  const specContent = req.body?.specContent;

  if (specFile) specInput = specFile.buffer;
  else if (specUrl) specInput = specUrl;
  else if (specContent) specInput = specContent;
  else return res.status(400).json({ error: 'Provide a spec file, URL, or specContent' });

  let envJson = {};
  const envFile = req.files?.env?.[0];
  if (envFile) {
    try { envJson = JSON.parse(envFile.buffer.toString('utf8')); } catch { /* ignore */ }
  }

  let endpoints;
  try { endpoints = await parseOpenApiSpec(specInput, envJson); }
  catch (err) { return res.status(400).json({ error: `Failed to parse OpenAPI spec: ${err.message}` }); }

  if (!endpoints.length) return res.status(400).json({ error: 'No endpoints found in spec' });

  const specName = req.body?.name ?? (typeof specInput === 'string' && /^https?:\/\//.test(specInput) ? new URL(specInput).hostname : 'OpenAPI Spec');
  const session = await prisma.testSession.create({
    data: {
      type: 'api',
      status: 'queued',
      input: { collectionName: specName, endpointCount: endpoints.length, mode: 'openapi' },
      userId: req.user.id,
      projectId: req.body.projectId || null,
    },
  });

  runApiTests(session.id, endpoints, req.user.id, req.body.projectId || null, req.body.provider || null).catch(err => {
    console.error(`[api-testing] openapi session ${session.id} crashed:`, err);
  });

  res.json({ sessionId: session.id, endpointCount: endpoints.length, specName });
});

// ─── POST /api/api-testing/workflow ────────────────────────────────────────
// Run a dependency-chained workflow where each step's output feeds into the next.
// Body: { name, steps: [ { endpoint, extractVars: { varName: "field.path" } } ], projectId? }
router.post('/workflow', async (req, res) => {
  const { name = 'Workflow', steps, projectId } = req.body;
  if (!Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ error: 'steps array is required' });
  }

  const session = await prisma.testSession.create({
    data: {
      type: 'api',
      status: 'queued',
      input: { collectionName: name, mode: 'workflow', stepCount: steps.length },
      userId: req.user.id,
      projectId: projectId || null,
    },
  });

  runWorkflow(session.id, steps, req.user.id, projectId || null).catch(err => {
    console.error(`[api-testing] workflow ${session.id} crashed:`, err);
  });

  res.json({ sessionId: session.id, stepCount: steps.length });
});

// ─── POST /api/api-testing/autonomous ──────────────────────────────────────
// Fully autonomous run: standard tests → security → schema learning → coverage → RCA.
// Body: same as /run (multipart collection upload) plus optional { projectId, perfConcurrency }
router.post('/autonomous', upload.fields([{ name: 'collection', maxCount: 1 }, { name: 'env', maxCount: 1 }]), async (req, res) => {
  const collectionFile = req.files?.collection?.[0];
  if (!collectionFile) return res.status(400).json({ error: 'collection file is required' });

  let collectionJson;
  try { collectionJson = JSON.parse(collectionFile.buffer.toString('utf8')); }
  catch { return res.status(400).json({ error: 'collection file is not valid JSON' }); }

  let envJson = {};
  const envFile = req.files?.env?.[0];
  if (envFile) {
    try { envJson = JSON.parse(envFile.buffer.toString('utf8')); } catch { /* ignore */ }
  }

  let endpoints;
  try { endpoints = parseCollection(collectionJson, envJson); }
  catch (err) { return res.status(400).json({ error: `Failed to parse collection: ${err.message}` }); }

  if (!endpoints.length) return res.status(400).json({ error: 'No HTTP requests found in collection' });

  const collectionName = collectionJson.info?.name ?? 'Collection';
  const session = await prisma.testSession.create({
    data: {
      type: 'api',
      status: 'queued',
      input: { collectionName, endpointCount: endpoints.length, mode: 'autonomous' },
      userId: req.user.id,
      projectId: req.body.projectId || null,
    },
  });

  runAutonomous(session.id, endpoints, req.user.id, req.body.projectId || null, {
    perfConcurrency: Number(req.body.perfConcurrency) || 10,
  }).catch(err => {
    console.error(`[api-testing] autonomous session ${session.id} crashed:`, err);
  });

  res.json({ sessionId: session.id, endpointCount: endpoints.length, collectionName, mode: 'autonomous' });
});

// ─── POST /api/api-testing/performance ─────────────────────────────────────
// Run a performance test against a single endpoint.
// Body: { method, url, headers?, body?, concurrency?, totalRequests? }
router.post('/performance', async (req, res) => {
  const { method, url, headers = {}, body = null, concurrency = 10, totalRequests = 50 } = req.body;
  if (!method || !url) return res.status(400).json({ error: 'method and url are required' });

  const session = await prisma.testSession.create({
    data: {
      type: 'api',
      status: 'queued',
      input: { collectionName: `Performance: ${method} ${url}`, mode: 'performance' },
      userId: req.user.id,
      projectId: req.body.projectId || null,
    },
  });

  const emit = (type, data) => sseEmitter.emit(session.id, { type, data });

  (async () => {
    await prisma.testSession.update({ where: { id: session.id }, data: { status: 'running' } });
    emit('phase_change', { phase: 'performance', endpoint: `${method} ${url}` });
    try {
      const result = await runPerformanceTest(
        { method: method.toUpperCase(), url, headers, body, expectedStatus: 200 },
        { concurrency: Number(concurrency), totalRequests: Number(totalRequests) }
      );
      emit('performance_result', { endpoint: `${method} ${url}`, ...result });
      await prisma.testSession.update({ where: { id: session.id }, data: { status: 'completed', completedAt: new Date() } });
      emit('complete', { total: totalRequests, passed: 0, failed: 0, errored: 0 });
    } catch (err) {
      emit('error', { error: err.message });
      await prisma.testSession.update({ where: { id: session.id }, data: { status: 'failed', completedAt: new Date() } });
    }
  })().catch(() => {});

  res.json({ sessionId: session.id });
});

// ─── POST /api/api-testing/sessions/:id/security ───────────────────────────
// Run security tests on the endpoints from an existing completed session.
router.post('/sessions/:id/security', async (req, res) => {
  const session = await prisma.testSession.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const secSessionId = `${req.params.id}-sec`;
  sseEmitter.emit(req.params.id, { type: 'security_start', data: {} });

  const endpoints = session.input?.endpoints ?? [];
  if (!endpoints.length) return res.status(400).json({ error: 'No endpoint data in session. Re-run with latest version.' });

  runSecurityTests(req.params.id, endpoints, req.user.id, session.projectId).catch(() => {});
  res.json({ sessionId: req.params.id, status: 'security_queued' });
});

// ─── GET /api/api-testing/stream/:sessionId ────────────────────────────────
router.get('/stream/:sessionId', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const unsubscribe = sseEmitter.on(req.params.sessionId, send);
  req.on('close', unsubscribe);
});

// ─── GET /api/api-testing/sessions ─────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  const sessions = await prisma.testSession.findMany({
    where: { userId: req.user.id, type: 'api' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { _count: { select: { results: true } } },
  });
  res.json({ sessions });
});

// ─── GET /api/api-testing/sessions/:id ─────────────────────────────────────
router.get('/sessions/:id', async (req, res) => {
  const session = await prisma.testSession.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { results: { orderBy: { stepIndex: 'asc' } } },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ session });
});

// ─── GET /api/api-testing/sessions/:id/coverage ────────────────────────────
router.get('/sessions/:id/coverage', async (req, res) => {
  const session = await prisma.testSession.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { results: true },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const endpointCount = session.input?.endpointCount ?? 1;
  const mockEndpoints = Array.from({ length: endpointCount }, (_, i) => ({ name: `endpoint_${i}` }));
  const coverage = calculateCoverage(mockEndpoints, session.results);
  res.json({ coverage });
});

// ─── GET /api/api-testing/trends ───────────────────────────────────────────
router.get('/trends', async (req, res) => {
  const projectId = req.query.projectId;
  const where = { userId: req.user.id, type: 'api', status: 'completed' };
  if (projectId) where.projectId = projectId;

  const sessions = await prisma.testSession.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { _count: { select: { results: true } } },
  });

  // Compute per-session pass rate by fetching result counts
  const trends = await Promise.all(sessions.map(async (s) => {
    const [passed, total] = await Promise.all([
      prisma.testResult.count({ where: { sessionId: s.id, status: 'passed' } }),
      prisma.testResult.count({ where: { sessionId: s.id } }),
    ]);
    const avgDuration = await prisma.testResult.aggregate({
      where: { sessionId: s.id },
      _avg: { durationMs: true },
    });
    return {
      sessionId: s.id,
      collectionName: s.input?.collectionName ?? 'Unknown',
      createdAt: s.createdAt,
      total,
      passed,
      failed: total - passed,
      passRate: total ? Math.round((passed / total) * 100) : 0,
      avgDurationMs: Math.round(avgDuration._avg.durationMs ?? 0),
    };
  }));

  // Identify flaky endpoints (appeared in multiple sessions with mixed results)
  res.json({ trends: trends.reverse() }); // oldest first for charting
});

// ─── POST /api/api-testing/sessions/:id/report ─────────────────────────────
router.post('/sessions/:id/report', async (req, res) => {
  const session = await prisma.testSession.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { results: { orderBy: { stepIndex: 'asc' } } },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'completed') return res.status(400).json({ error: 'Session has not completed yet' });

  const collectionName = session.input?.collectionName ?? 'API Tests';
  const generatedAt = new Date().toUTCString();
  const endpointCount = session.input?.endpointCount ?? 1;
  const mockEndpoints = Array.from({ length: endpointCount }, (_, i) => ({ name: `ep_${i}` }));
  const coverage = calculateCoverage(mockEndpoints, session.results);

  // Pull enriched data from session metadata if autonomous/security was run
  const meta = session.input?.reportMeta ?? {};

  const html = generateHtmlReport({
    sessionId: session.id,
    collectionName,
    generatedAt,
    results: session.results,
    coverage,
    securitySummary: meta.securitySummary ?? null,
    performanceResults: meta.performanceResults ?? null,
    driftReports: meta.driftReports ?? null,
    rcaFindings: meta.rcaFindings ?? null,
  });

  await prisma.report.upsert({
    where: { id: session.id },
    create: { id: session.id, sessionId: session.id, htmlContent: html, summary: session.input },
    update: { htmlContent: html },
  }).catch(() => {});

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ════════════════════════════════════════════════════════════════════════════
// Async runners
// ════════════════════════════════════════════════════════════════════════════

async function runApiTests(sessionId, endpoints, userId, projectId, provider = null) {
  await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'running' } });
  const emit = (type, data) => sseEmitter.emit(sessionId, { type, data });
  const failureBatch = [];

  // Pre-flight: obtain a real auth token so positive tests on protected endpoints pass.
  // Find the first login endpoint that has credentials in its body.
  const ctx = new WorkflowContext();
  const loginEndpoint = endpoints.find(ep =>
    ep.method === 'POST' &&
    /\/(auth\/)?login$/i.test(ep.url) &&
    ep.body?.email &&
    ep.body?.password
  );
  if (loginEndpoint) {
    try {
      const loginResult = await executeHttpTest({
        method: 'POST',
        url: loginEndpoint.url,
        headers: { 'Content-Type': 'application/json' },
        body: loginEndpoint.body,
        expectedStatus: 200,
      });
      if (loginResult.actualStatus === 200 && loginResult.responseBody?.token) {
        ctx.set('authToken', loginResult.responseBody.token);
        emit('auth_preflight', { status: 'success', url: loginEndpoint.url });
      } else {
        emit('auth_preflight', { status: 'no_token', url: loginEndpoint.url });
      }
    } catch (err) {
      emit('auth_preflight', { status: 'failed', url: loginEndpoint.url, error: err.message });
    }
  }

  try {
    // Announce all endpoints upfront so the UI shows them all immediately
    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      emit('endpoint_start', { index: i, total: endpoints.length, name: ep.name, method: ep.method, url: ep.url });
    }

    // Process endpoints concurrently (limit 3 — safe for Ollama and Groq)
    await runWithConcurrency(endpoints, 3, async (endpoint, i) => {
      const memory = await getMemory(projectId, endpoint.method, endpoint.url).catch(() => null);

      let testCases;
      try {
        testCases = await generateApiTestCases(endpoint, memory, provider);
      } catch (err) {
        emit('endpoint_error', { index: i, name: endpoint.name, error: err.message });
        await saveResult(sessionId, i * 1000, `${endpoint.method} ${endpoint.name}`, 'AI generation failed', {
          status: 'error', actualStatus: null, durationMs: 0, error: err.message, responseBody: null, expectedStatus: 0,
        }, null);
        return;
      }

      emit('tests_generated', { index: i, name: endpoint.name, count: testCases.length, descriptions: testCases.map(t => t.description) });

      const settled = await Promise.allSettled(
        testCases.map((tc, j) => runSingleTest(sessionId, i, j, endpoint, tc, emit, projectId, ctx))
      );

      const results = settled.map(s => s.status === 'fulfilled' ? s.value : { status: 'error', durationMs: 0 });

      settled.forEach((s, j) => {
        if (s.status === 'fulfilled' && s.value.status !== 'passed') {
          failureBatch.push({ testCase: testCases[j], result: s.value, memory });
        }
      });

      await updateMemory(projectId, endpoint.method, endpoint.url, results).catch(() => {});

      const epPassed = results.filter(r => r.status === 'passed').length;
      emit('endpoint_done', { index: i, name: endpoint.name, passed: epPassed, total: testCases.length });
    });

    const allResults = await prisma.testResult.findMany({ where: { sessionId } });
    const passed = allResults.filter(r => r.status === 'passed').length;
    const failed = allResults.filter(r => r.status === 'failed').length;
    const errored = allResults.filter(r => r.status === 'error').length;

    // Coverage
    const coverage = calculateCoverage(endpoints, allResults);
    emit('coverage', { coverage });

    await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'completed', completedAt: new Date() } });
    emit('complete', { total: allResults.length, passed, failed, errored, coverage });

    // RCA is async — run after complete event so UI is responsive
    if (failureBatch.length > 0) {
      batchAnalyzeFailures(failureBatch.slice(0, 10)).then(analyses => {
        if (analyses.length) {
          sseEmitter.emit(sessionId, { type: 'rca_batch', data: { analyses } });
          // Persist RCA into session metadata
          prisma.testSession.findUnique({ where: { id: sessionId } }).then(s => {
            if (!s) return;
            const meta = s.input ?? {};
            meta.reportMeta = { ...(meta.reportMeta ?? {}), rcaFindings: analyses };
            prisma.testSession.update({ where: { id: sessionId }, data: { input: meta } }).catch(() => {});
          });
        }
      }).catch(() => {});
    }

  } catch (err) {
    await prisma.testSession.update({
      where: { id: sessionId },
      data: { status: 'failed', completedAt: new Date() },
    }).catch(() => {});
    emit('error', { error: err.message });
  }
}

async function runSingleTest(sessionId, endpointIdx, testIdx, endpoint, tc, emit, projectId, ctx = null) {
  const method = tc.method || endpoint.method;
  const rawUrl = tc.url || endpoint.url;
  const rawHeaders = tc.headers || endpoint.headers;
  const rawBody = tc.body ?? null;
  const expectedStatus = tc.expectedStatus ?? 200;

  // Resolve {{authToken}} and any other context variables before execution
  const url = ctx ? ctx.resolve(rawUrl) : rawUrl;
  const headers = ctx ? ctx.resolveObject(rawHeaders ?? {}) : (rawHeaders ?? {});
  const body = ctx ? ctx.resolveObject(rawBody) : rawBody;

  const result = await executeHttpTest({ method, url, headers, body, expectedStatus });

  // Assert response against AI-generated assertions
  const { assertionResults, assertionsPassed, assertionSummary } = validateAssertions(
    tc.assertions,
    { actualStatus: result.actualStatus, responseHeaders: result.responseHeaders ?? {}, responseBody: result.responseBody }
  );

  // Derive final status: must pass both HTTP status AND all assertions
  const finalStatus = (result.status === 'passed' && assertionsPassed) ? 'passed'
    : result.status === 'error' ? 'error'
    : 'failed';

  // Schema learning — store schema from successful positive-test responses
  if (result.status === 'passed' && tc.type === 'positive' && result.responseBody) {
    learnSchema(projectId, method, url, result.responseBody).catch(() => {});
  }

  emit('test_result', {
    endpointIndex: endpointIdx,
    testIndex: testIdx,
    description: tc.description,
    type: tc.type,
    status: finalStatus,
    actualStatus: result.actualStatus,
    expectedStatus,
    durationMs: result.durationMs,
    error: result.error,
    assertionResults,
    assertionsPassed,
    assertionSummary,
  });

  await saveResult(
    sessionId,
    endpointIdx * 1000 + testIdx,
    `${endpoint.method} ${endpoint.name}`,
    tc.description,
    { ...result, status: finalStatus },
    { method, url, headers, body, expectedStatus, type: tc.type, assertions: tc.assertions },
    { assertionResults, assertionsPassed }
  );

  return { ...result, status: finalStatus, durationMs: result.durationMs };
}


async function runSecurityTests(sessionId, endpoints, userId, projectId) {
  const emit = (type, data) => sseEmitter.emit(sessionId, { type, data });
  const secResults = [];

  for (const endpoint of endpoints) {
    const tests = generateSecurityTests(endpoint);
    emit('security_endpoint_start', { name: endpoint.name, count: tests.length });

    const settled = await Promise.allSettled(
      tests.map(tc => executeHttpTest({ method: tc.method, url: tc.url, headers: tc.headers, body: tc.body, expectedStatus: tc.expectedStatus }))
    );

    for (let j = 0; j < tests.length; j++) {
      const tc = tests[j];
      const r = settled[j].status === 'fulfilled' ? settled[j].value : { status: 'error', actualStatus: null, durationMs: 0, error: settled[j].reason?.message };
      const status = r.status;
      const item = { ...tc, status, actualStatus: r.actualStatus, durationMs: r.durationMs, error: r.error };
      secResults.push(item);
      emit('security_result', item);
    }
  }

  const summary = scoreSecurityResults(secResults);
  emit('security_done', { summary });

  // Persist security summary into session metadata
  const session = await prisma.testSession.findUnique({ where: { id: sessionId } });
  if (session) {
    const meta = session.input ?? {};
    meta.reportMeta = { ...(meta.reportMeta ?? {}), securitySummary: summary };
    await prisma.testSession.update({ where: { id: sessionId }, data: { input: meta } }).catch(() => {});
  }
}

async function runWorkflow(sessionId, steps, userId, projectId) {
  await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'running' } });
  const emit = (type, data) => sseEmitter.emit(sessionId, { type, data });
  const ctx = new WorkflowContext();

  try {
    let stepIdx = 0;
    for (const step of steps) {
      const endpoint = step.endpoint;
      if (!endpoint?.method || !endpoint?.url) {
        emit('endpoint_error', { index: stepIdx, name: `Step ${stepIdx + 1}`, error: 'Missing method or url' });
        stepIdx++;
        continue;
      }

      // Resolve context variables into this step's endpoint
      const resolved = resolveTestCase(endpoint, ctx);
      emit('endpoint_start', { index: stepIdx, total: steps.length, name: step.name ?? resolved.url, method: resolved.method, url: resolved.url });

      const result = await executeHttpTest({ ...resolved, expectedStatus: endpoint.expectedStatus ?? 200 });

      emit('test_result', {
        endpointIndex: stepIdx, testIndex: 0,
        description: step.name ?? `Step ${stepIdx + 1}`,
        type: 'workflow',
        status: result.status,
        actualStatus: result.actualStatus,
        expectedStatus: endpoint.expectedStatus ?? 200,
        durationMs: result.durationMs,
        error: result.error,
        contextSnapshot: ctx.snapshot(),
      });

      // Extract variables from response for use in subsequent steps
      if (step.extractVars && result.responseBody) {
        ctx.extract(step.extractVars, result.responseBody);
        emit('context_updated', { vars: ctx.snapshot() });
      }

      await saveResult(sessionId, stepIdx * 1000, step.name ?? resolved.url, step.name ?? `Step ${stepIdx + 1}`,
        result, { ...resolved, expectedStatus: endpoint.expectedStatus ?? 200 }, {});

      emit('endpoint_done', { index: stepIdx, name: step.name ?? resolved.url, passed: result.status === 'passed' ? 1 : 0, total: 1 });
      stepIdx++;
    }

    await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'completed', completedAt: new Date() } });
    emit('complete', { total: steps.length, passed: 0, failed: 0, errored: 0 });
  } catch (err) {
    await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'failed', completedAt: new Date() } }).catch(() => {});
    emit('error', { error: err.message });
  }
}

async function runAutonomous(sessionId, endpoints, userId, projectId, opts = {}) {
  await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'running' } });
  const emit = (type, data) => sseEmitter.emit(sessionId, { type, data });
  const failureBatch = [];
  const driftReports = [];
  const perfResults = [];

  try {
    // ── Phase 1: Standard tests ──────────────────────────────────────────
    emit('phase_change', { phase: 'standard', label: 'Generating & executing standard tests' });

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i];
      emit('endpoint_start', { index: i, total: endpoints.length, name: endpoint.name, method: endpoint.method, url: endpoint.url });

      const memory = await getMemory(projectId, endpoint.method, endpoint.url).catch(() => null);

      let testCases;
      try {
        testCases = await generateApiTestCases(endpoint, memory, null);
      } catch (err) {
        emit('endpoint_error', { index: i, name: endpoint.name, error: err.message });
        continue;
      }

      emit('tests_generated', { index: i, name: endpoint.name, count: testCases.length, descriptions: testCases.map(t => t.description) });

      const settled = await Promise.allSettled(
        testCases.map((tc, j) => runSingleTest(sessionId, i, j, endpoint, tc, emit, projectId))
      );

      const results = settled.map(s => s.status === 'fulfilled' ? s.value : { status: 'error', durationMs: 0 });
      settled.forEach((s, j) => {
        if (s.status === 'fulfilled' && s.value.status !== 'passed') {
          failureBatch.push({ testCase: testCases[j], result: s.value, memory });
        }
      });

      // Drift detection from successful responses
      for (const s of settled) {
        if (s.status === 'fulfilled' && s.value.responseBody) {
          const drift = await detectDrift(projectId, endpoint.method, endpoint.url, s.value.responseBody).catch(() => null);
          if (drift) driftReports.push(drift);
        }
      }

      await updateMemory(projectId, endpoint.method, endpoint.url, results).catch(() => {});
      const epPassed = results.filter(r => r.status === 'passed').length;
      emit('endpoint_done', { index: i, name: endpoint.name, passed: epPassed, total: testCases.length });
    }

    // ── Phase 2: Security tests ──────────────────────────────────────────
    emit('phase_change', { phase: 'security', label: 'Running security tests' });
    const secResults = [];
    for (const endpoint of endpoints.slice(0, 5)) { // cap at 5 endpoints for perf
      const tests = generateSecurityTests(endpoint);
      const settled = await Promise.allSettled(
        tests.map(tc => executeHttpTest({ method: tc.method, url: tc.url, headers: tc.headers, body: tc.body, expectedStatus: tc.expectedStatus }))
      );
      for (let j = 0; j < tests.length; j++) {
        const r = settled[j].status === 'fulfilled' ? settled[j].value : { status: 'error', actualStatus: null, durationMs: 0 };
        secResults.push({ ...tests[j], status: r.status, actualStatus: r.actualStatus, durationMs: r.durationMs });
        emit('security_result', secResults[secResults.length - 1]);
      }
    }
    const securitySummary = scoreSecurityResults(secResults);
    emit('security_done', { summary: securitySummary });

    // ── Phase 3: Performance (top 3 endpoints) ───────────────────────────
    emit('phase_change', { phase: 'performance', label: 'Performance benchmarking' });
    for (const endpoint of endpoints.slice(0, 3)) {
      try {
        const perf = await runPerformanceTest(
          { method: endpoint.method, url: endpoint.url, headers: endpoint.headers, body: null, expectedStatus: 200 },
          { concurrency: opts.perfConcurrency ?? 10, totalRequests: 30 }
        );
        const perfEntry = { endpoint: `${endpoint.method} ${endpoint.url}`, ...perf };
        perfResults.push(perfEntry);
        emit('performance_result', perfEntry);
      } catch { /* skip if endpoint is unreachable */ }
    }

    // ── Phase 4: RCA ─────────────────────────────────────────────────────
    let rcaFindings = [];
    if (failureBatch.length > 0) {
      emit('phase_change', { phase: 'rca', label: 'Analyzing failures with AI' });
      rcaFindings = await batchAnalyzeFailures(failureBatch.slice(0, 8)).catch(() => []);
      if (rcaFindings.length) emit('rca_batch', { analyses: rcaFindings });
    }

    // ── Phase 5: Coverage & completion ──────────────────────────────────
    const allResults = await prisma.testResult.findMany({ where: { sessionId } });
    const coverage = calculateCoverage(endpoints, allResults);
    emit('coverage', { coverage });

    const passed = allResults.filter(r => r.status === 'passed').length;
    const failed = allResults.filter(r => r.status === 'failed').length;
    const errored = allResults.filter(r => r.status === 'error').length;

    // Persist enriched metadata for the report
    const reportMeta = { securitySummary, performanceResults: perfResults, driftReports, rcaFindings };
    await prisma.testSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        input: {
          ...(await prisma.testSession.findUnique({ where: { id: sessionId } }))?.input,
          reportMeta,
        },
      },
    });

    emit('complete', { total: allResults.length, passed, failed, errored, coverage, securitySummary, driftCount: driftReports.length });

  } catch (err) {
    await prisma.testSession.update({ where: { id: sessionId }, data: { status: 'failed', completedAt: new Date() } }).catch(() => {});
    emit('error', { error: err.message });
  }
}

// Run items with a max concurrency limit
async function runWithConcurrency(items, limit, fn) {
  let idx = 0;
  async function next() {
    if (idx >= items.length) return;
    const i = idx++;
    await fn(items[i], i).catch(() => {});
    await next();
  }
  await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, next));
}

async function saveResult(sessionId, stepIndex, toolName, stepName, result, input, extra = {}) {
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
        assertionResults: extra.assertionResults ?? [],
        assertionsPassed: extra.assertionsPassed ?? true,
      },
      error: result.error,
    },
  });
}

export default router;
