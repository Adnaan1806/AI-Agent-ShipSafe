// Postman collection parser and HTTP test executor

export function parseCollection(collectionJson, envJson = {}) {
  const env = buildEnvMap(envJson);
  const endpoints = [];
  const items = collectionJson.item ?? collectionJson.collection?.item ?? [];
  extractItems(items, endpoints, env);
  return endpoints;
}

function buildEnvMap(envJson) {
  const map = {};
  if (Array.isArray(envJson.values)) {
    for (const entry of envJson.values) {
      if (entry.enabled !== false && entry.key) map[entry.key] = entry.value ?? '';
    }
  } else if (Array.isArray(envJson.variable)) {
    for (const entry of envJson.variable) {
      if (entry.key) map[entry.key] = entry.value ?? '';
    }
  } else if (envJson && typeof envJson === 'object') {
    for (const [k, v] of Object.entries(envJson)) {
      if (typeof v === 'string' || typeof v === 'number') map[k] = String(v);
    }
  }
  return map;
}

function resolve(str, env) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const k = key.trim();
    return k in env ? env[k] : `{{${k}}}`;
  });
}

function extractItems(items, out, env) {
  for (const item of (items ?? [])) {
    if (Array.isArray(item.item)) {
      extractItems(item.item, out, env);
    } else if (item.request) {
      const parsed = parseRequest(item, env);
      if (parsed) out.push(parsed);
    }
  }
}

function parseRequest(item, env) {
  const req = item.request;
  let rawUrl = '';
  if (typeof req.url === 'string') {
    rawUrl = resolve(req.url, env);
  } else if (req.url && typeof req.url === 'object') {
    rawUrl = resolve(req.url.raw ?? buildUrlFromObj(req.url, env), env);
  }
  if (!rawUrl) return null;

  const headers = {};
  for (const h of (req.header ?? [])) {
    if (!h.disabled && h.key) headers[resolve(h.key, env)] = resolve(h.value ?? '', env);
  }

  let body = null;
  const mode = req.body?.mode;
  if (mode === 'raw' && req.body.raw) {
    const raw = resolve(req.body.raw, env);
    try { body = JSON.parse(raw); } catch { body = raw; }
  } else if (mode === 'urlencoded') {
    body = {};
    for (const f of (req.body.urlencoded ?? [])) {
      if (!f.disabled) body[f.key] = resolve(f.value ?? '', env);
    }
  } else if (mode === 'formdata') {
    body = {};
    for (const f of (req.body.formdata ?? [])) {
      if (!f.disabled && f.type !== 'file') body[f.key] = resolve(f.value ?? '', env);
    }
  }

  return {
    name: item.name || rawUrl,
    method: (req.method ?? 'GET').toUpperCase(),
    url: rawUrl,
    headers,
    body,
    description: extractDescription(req.description),
  };
}

function buildUrlFromObj(urlObj, env) {
  const protocol = urlObj.protocol ?? 'https';
  const host = (urlObj.host ?? []).map(h => resolve(String(h), env)).join('.');
  const path = (urlObj.path ?? []).map(p => resolve(String(p), env)).join('/');
  const query = (urlObj.query ?? [])
    .filter(q => !q.disabled && q.key)
    .map(q => `${encodeURIComponent(q.key)}=${encodeURIComponent(resolve(q.value ?? '', env))}`)
    .join('&');
  let url = `${protocol}://${host}/${path}`;
  if (query) url += `?${query}`;
  return url;
}

function extractDescription(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  return desc.content ?? '';
}

export async function executeHttpTest(testCase, timeoutMs = 15000) {
  const { method, url, headers, body, expectedStatus } = testCase;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const reqHeaders = { 'Content-Type': 'application/json', ...headers };
    const opts = { method, headers: reqHeaders, signal: controller.signal };

    if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    clearTimeout(timer);
    const durationMs = Date.now() - start;

    let responseBody = null;
    const ct = res.headers.get('content-type') ?? '';
    try {
      responseBody = ct.includes('application/json') ? await res.json() : await res.text();
    } catch { /* ignore */ }

    const passed = res.status === expectedStatus;
    return {
      status: passed ? 'passed' : 'failed',
      actualStatus: res.status,
      expectedStatus,
      durationMs,
      responseBody,
      error: passed ? null : `Expected HTTP ${expectedStatus}, got ${res.status}`,
    };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    return {
      status: 'error',
      actualStatus: null,
      expectedStatus,
      durationMs,
      responseBody: null,
      error: err.name === 'AbortError' ? `Request timed out after ${timeoutMs}ms` : err.message,
    };
  }
}
