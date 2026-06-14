// Lightweight performance testing layer.
// Sends N concurrent HTTP requests to measure latency percentiles,
// throughput, and error rate. Returns a health score and grade.

import { executeHttpTest } from './api-executor.js';

export async function runPerformanceTest(endpoint, options = {}) {
  const {
    concurrency = 10,
    totalRequests = 50,
    warmupRequests = 5,
    thresholds = { p95Ms: 2000, errorRate: 0.05 },
  } = options;

  // Warmup — discard results, just prime connections
  await Promise.allSettled(
    Array.from({ length: warmupRequests }, () => executeHttpTest(endpoint).catch(() => null))
  );

  const durations = [];
  const statuses = [];
  const errors = [];
  let completed = 0;

  while (completed < totalRequests) {
    const batchSize = Math.min(concurrency, totalRequests - completed);
    const batch = await Promise.all(
      Array.from({ length: batchSize }, () =>
        executeHttpTest(endpoint).catch(err => ({
          status: 'error', actualStatus: null, durationMs: 0, error: err.message,
        }))
      )
    );

    for (const r of batch) {
      durations.push(r.durationMs ?? 0);
      statuses.push(r.actualStatus);
      if (r.status === 'error' || (r.actualStatus && r.actualStatus >= 500)) {
        errors.push(r.error ?? `HTTP ${r.actualStatus}`);
      }
    }
    completed += batchSize;
  }

  durations.sort((a, b) => a - b);

  const errorRate = errors.length / totalRequests;
  const metrics = {
    totalRequests,
    concurrency,
    errorRate: parseFloat(errorRate.toFixed(4)),
    errorsCount: errors.length,
    min: durations[0] ?? 0,
    max: durations[durations.length - 1] ?? 0,
    avg: avg(durations),
    p50: pct(durations, 50),
    p75: pct(durations, 75),
    p95: pct(durations, 95),
    p99: pct(durations, 99),
    throughputRps: totalRequests > 0
      ? Math.round(totalRequests / (durations.reduce((a, b) => a + b, 0) / 1000 / concurrency || 1))
      : 0,
  };

  const issues = [];
  if (metrics.p95 > thresholds.p95Ms) {
    issues.push(`p95 latency (${metrics.p95}ms) exceeds threshold (${thresholds.p95Ms}ms)`);
  }
  if (metrics.errorRate > thresholds.errorRate) {
    issues.push(`Error rate ${(metrics.errorRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.errorRate * 100).toFixed(1)}%`);
  }
  if (metrics.p99 > 5000) {
    issues.push(`p99 latency (${metrics.p99}ms) above 5s — tail latency concern`);
  }

  const score = calcScore(metrics, thresholds);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  return { metrics, issues, score, grade, statusCodes: statusBreakdown(statuses) };
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function calcScore(m, t) {
  let s = 100;
  if (m.p95 > t.p95Ms * 2) s -= 30;
  else if (m.p95 > t.p95Ms) s -= 15;
  if (m.errorRate > 0.2) s -= 40;
  else if (m.errorRate > t.errorRate) s -= 20;
  else if (m.errorRate > 0) s -= 5;
  if (m.p99 > 5000) s -= 10;
  if (m.avg > 1000) s -= 5;
  return Math.max(0, s);
}

function statusBreakdown(statuses) {
  const map = {};
  for (const s of statuses) {
    if (s) map[s] = (map[s] ?? 0) + 1;
  }
  return map;
}
