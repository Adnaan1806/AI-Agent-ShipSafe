// Agent memory system — stores per-endpoint execution history in the database.
// The AI reads this context before generating test cases, enabling it to
// generate smarter tests based on what has failed before.

import { prisma } from '../db/prisma.js';
import { makeEndpointKey } from './api-schema-store.js';

export async function getMemory(projectId, method, url) {
  const key = makeEndpointKey(method, url);
  return prisma.apiEndpointMemory.findUnique({
    where: { projectId_endpointKey: { projectId: projectId ?? 'global', endpointKey: key } },
  });
}

export async function updateMemory(projectId, method, url, results) {
  const key = makeEndpointKey(method, url);
  const pid = projectId ?? 'global';

  const passCount = results.filter(r => r.status === 'passed').length;
  const failCount = results.filter(r => r.status !== 'passed').length;
  const avgDur = results.length
    ? Math.round(results.reduce((s, r) => s + (r.durationMs ?? 0), 0) / results.length)
    : 0;
  const newErrors = results
    .filter(r => r.status !== 'passed' && r.error)
    .map(r => r.error)
    .slice(0, 3);

  const existing = await prisma.apiEndpointMemory.findUnique({
    where: { projectId_endpointKey: { projectId: pid, endpointKey: key } },
  });

  if (!existing) {
    await prisma.apiEndpointMemory.create({
      data: {
        projectId: pid,
        endpointKey: key,
        runCount: 1,
        passCount,
        failCount,
        avgDurationMs: avgDur,
        commonFailures: newErrors,
        lastRunAt: new Date(),
      },
    });
    return;
  }

  const totalRuns = existing.runCount + 1;
  const newAvg = Math.round(
    (existing.avgDurationMs * existing.runCount + avgDur) / totalRuns
  );
  const allErrors = [
    ...newErrors,
    ...(Array.isArray(existing.commonFailures) ? existing.commonFailures : []),
  ];
  const uniqueErrors = [...new Set(allErrors)].slice(0, 5);

  await prisma.apiEndpointMemory.update({
    where: { id: existing.id },
    data: {
      runCount: totalRuns,
      passCount: existing.passCount + passCount,
      failCount: existing.failCount + failCount,
      avgDurationMs: newAvg,
      commonFailures: uniqueErrors,
      lastRunAt: new Date(),
    },
  });
}

// Format the memory record into a concise context string for the AI prompt.
export function buildMemoryContext(memory) {
  if (!memory || memory.runCount === 0) return '';
  const failRate = Math.round((memory.failCount / memory.runCount) * 100);
  const lines = [
    `[Memory] This endpoint has been tested ${memory.runCount} time(s) — ${100 - failRate}% pass rate, avg ${Math.round(memory.avgDurationMs)}ms.`,
  ];
  if (memory.failCount > 0 && Array.isArray(memory.commonFailures) && memory.commonFailures.length > 0) {
    lines.push(`[Memory] Past failures: ${memory.commonFailures.slice(0, 3).join('; ')}`);
    lines.push('[Memory] Focus test cases on these failure modes when relevant.');
  }
  return lines.join('\n');
}
