// Dependency-chaining engine for API test workflows.
// Resolves {{varName}} placeholders in URLs, headers, and bodies
// using values extracted from previous step responses.

export class WorkflowContext {
  constructor(initialVars = {}) {
    this.vars = { ...initialVars };
  }

  set(key, value) {
    this.vars[key] = value;
  }

  get(key) {
    return this.vars[key];
  }

  // Extract variables from a response body using dot-path specs.
  // extractions: { "authToken": "data.token", "userId": "user.id" }
  extract(extractions, responseBody) {
    if (!extractions || typeof extractions !== 'object' || !responseBody) return;
    for (const [varName, path] of Object.entries(extractions)) {
      const value = getByPath(responseBody, path);
      if (value !== undefined && value !== null) {
        this.vars[varName] = value;
      }
    }
  }

  // Resolve all {{varName}} references in a string.
  resolve(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const k = key.trim();
      return this.vars[k] !== undefined ? String(this.vars[k]) : `{{${k}}}`;
    });
  }

  // Deep-resolve an object: all string leaves have their {{vars}} substituted.
  resolveObject(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return this.resolve(obj);
    if (Array.isArray(obj)) return obj.map(v => this.resolveObject(v));
    if (typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = this.resolveObject(v);
      return out;
    }
    return obj;
  }

  snapshot() {
    return { ...this.vars };
  }
}

// Apply context resolution to a single test case before execution.
export function resolveTestCase(tc, context) {
  return {
    ...tc,
    url: context.resolve(tc.url),
    headers: context.resolveObject(tc.headers ?? {}),
    body: context.resolveObject(tc.body),
  };
}

// Get a nested value by dot-path: "user.profile.id" → obj.user.profile.id
function getByPath(obj, path) {
  if (!path || obj == null) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}
