// Calculates test coverage across five dimensions after a test session completes.

export function calculateCoverage(endpoints, results) {
  const empty = { functional: 0, negative: 0, auth: 0, schema: 0, statusCodes: 0, overall: 0 };
  if (!results.length || !endpoints.length) return empty;

  // 1. Functional: % of endpoints that have ≥1 test result
  const testedKeys = new Set(results.map(r => r.toolName).filter(Boolean));
  const functional = Math.round((testedKeys.size / endpoints.length) * 100);

  // 2. Negative: % of test results that are negative/auth/edge/security type
  const negativeTypes = new Set(['negative', 'auth', 'edge', 'security']);
  const negativeCount = results.filter(r => {
    const t = (r.input?.type ?? r.stepName ?? '').toLowerCase();
    return [...negativeTypes].some(nt => t.includes(nt));
  }).length;
  const negative = Math.round((negativeCount / results.length) * 100);

  // 3. Auth: whether at least one auth scenario was tested
  const authTested = results.some(r => {
    const t = (r.input?.type ?? '').toLowerCase();
    return t === 'auth' || (r.input?.headers && !r.input.headers['Authorization']);
  });
  const auth = authTested ? 100 : 0;

  // 4. Status code coverage: coverage of target HTTP codes
  const hitCodes = new Set(results.map(r => r.output?.actualStatus).filter(Boolean));
  const targetCodes = [200, 201, 204, 400, 401, 403, 404, 409, 422, 500];
  const hitTarget = targetCodes.filter(c => hitCodes.has(c)).length;
  const statusCodes = Math.round((hitTarget / targetCodes.length) * 100);

  // 5. Schema coverage: % of positive tests that validated response assertions
  const positiveResults = results.filter(r => (r.input?.type ?? '') === 'positive' || r.status === 'passed');
  const assertedCount = positiveResults.filter(r => Array.isArray(r.output?.assertionResults) && r.output.assertionResults.length > 0).length;
  const schema = positiveResults.length > 0
    ? Math.round((assertedCount / positiveResults.length) * 100)
    : 0;

  // Weighted overall score
  const overall = Math.round(
    functional * 0.30 +
    negative   * 0.20 +
    auth       * 0.20 +
    schema     * 0.20 +
    statusCodes * 0.10
  );

  return { functional, negative, auth, schema, statusCodes, overall };
}

export function gradeCoverage(score) {
  if (score >= 90) return { grade: 'A', label: 'Excellent', color: '#3fb950' };
  if (score >= 75) return { grade: 'B', label: 'Good', color: '#58a6ff' };
  if (score >= 60) return { grade: 'C', label: 'Moderate', color: '#d29922' };
  if (score >= 40) return { grade: 'D', label: 'Poor', color: '#f0883e' };
  return { grade: 'F', label: 'Critical', color: '#f85149' };
}
