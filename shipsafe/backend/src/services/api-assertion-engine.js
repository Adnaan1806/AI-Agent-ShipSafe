// Validates HTTP responses against AI-generated assertions.
// Called after executeHttpTest with the tc.assertions object.

export function validateAssertions(assertions, { actualStatus, responseHeaders = {}, responseBody }) {
  if (!assertions || typeof assertions !== 'object') {
    return { assertionResults: [], assertionsPassed: true };
  }

  const results = [];

  // Status code
  results.push({
    type: 'status',
    expected: assertions.expectedStatus,
    actual: actualStatus,
    passed: actualStatus === assertions.expectedStatus,
    message: `HTTP ${actualStatus} ${actualStatus === assertions.expectedStatus ? '==' : '!='} expected ${assertions.expectedStatus}`,
  });

  // Response headers
  for (const [key, expectedValue] of Object.entries(assertions.expectedHeaders ?? {})) {
    const actual = responseHeaders[key.toLowerCase()] ?? responseHeaders[key] ?? '';
    const passed = actual.toLowerCase().includes(String(expectedValue).toLowerCase());
    results.push({
      type: 'header',
      field: key,
      expected: expectedValue,
      actual: actual || '(missing)',
      passed,
      message: passed
        ? `Header '${key}' matches`
        : `Header '${key}': expected to contain '${expectedValue}', got '${actual || 'missing'}'`,
    });
  }

  const body = flattenBody(responseBody);

  // Required fields
  for (const field of (assertions.requiredFields ?? [])) {
    const passed = body !== null && typeof body === 'object' && field in body;
    results.push({
      type: 'field_presence',
      field,
      passed,
      message: passed ? `Field '${field}' present` : `Required field '${field}' missing from response body`,
    });
  }

  // Schema type validation
  if (body && typeof body === 'object') {
    for (const [field, expectedType] of Object.entries(assertions.schema ?? {})) {
      if (!(field in body)) continue;
      const actualType = typeOf(body[field]);
      const passed = actualType === expectedType || expectedType === 'any';
      results.push({
        type: 'schema',
        field,
        expected: expectedType,
        actual: actualType,
        passed,
        message: passed
          ? `Field '${field}' type is ${actualType}`
          : `Field '${field}': expected type '${expectedType}', got '${actualType}'`,
      });
    }
  }

  // Not-null checks
  if (body && typeof body === 'object') {
    for (const field of (assertions.notNull ?? [])) {
      if (!(field in body)) continue;
      const passed = body[field] !== null && body[field] !== undefined;
      results.push({
        type: 'not_null',
        field,
        passed,
        message: passed ? `Field '${field}' is not null` : `Field '${field}' must not be null`,
      });
    }
  }

  return {
    assertionResults: results,
    assertionsPassed: results.every(r => r.passed),
    assertionSummary: `${results.filter(r => r.passed).length}/${results.length} assertions passed`,
  };
}

function flattenBody(body) {
  if (Array.isArray(body)) return body[0] ?? null;
  return body;
}

function typeOf(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}
