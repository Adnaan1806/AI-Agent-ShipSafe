// OpenAPI 3.x / Swagger 2.x parser.
// Converts a spec (URL, JSON string, YAML string, or parsed object) into the
// same endpoint array shape used by the Postman parser, so the rest of the
// pipeline (AI generation, execution, SSE streaming) works without modification.

export async function parseOpenApiSpec(input, envJson = {}) {
  const { spec, sourceUrl } = await resolveSpec(input);
  const env = buildEnvMap(envJson);
  const baseUrl = extractBaseUrl(spec, env, sourceUrl);

  // Normalize to string — YAML parsers often return `swagger: 2.0` as the number 2
  const openapiVersion = String(spec.openapi ?? '');
  const swaggerVersion = String(spec.swagger ?? '');

  if (openapiVersion && (openapiVersion.startsWith('3.') || openapiVersion === '3')) {
    return parseOpenApi3(spec, env, baseUrl);
  }
  if (swaggerVersion && (swaggerVersion === '2.0' || swaggerVersion === '2')) {
    return parseSwagger2(spec, env, baseUrl);
  }

  const found = spec.openapi ? `openapi: ${spec.openapi}` : spec.swagger ? `swagger: ${spec.swagger}` : 'no openapi/swagger version field found';
  throw new Error(`Unsupported spec format (${found}). Must be OpenAPI 3.x or Swagger 2.0.`);
}

async function resolveSpec(input) {
  // Remote URL
  if (typeof input === 'string' && /^https?:\/\//i.test(input)) {
    let res;
    try {
      res = await fetch(input, { signal: AbortSignal.timeout(15000) });
    } catch (err) {
      const cause = err.cause?.code ?? err.cause?.message ?? err.message;
      throw new Error(`Could not reach ${input} — ${cause}. Try downloading the spec and uploading the file instead.`);
    }
    if (!res.ok) throw new Error(`Failed to fetch spec from ${input}: ${res.status} ${res.statusText}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new Error(`URL returned an HTML page, not a spec. Check the URL is a direct link to the JSON or YAML file.`);
    }
    return { spec: await parseText(await res.text()), sourceUrl: input };
  }
  // Buffer (file upload)
  if (Buffer.isBuffer(input)) return { spec: await parseText(input.toString('utf8')), sourceUrl: null };
  // Raw string
  if (typeof input === 'string') return { spec: await parseText(input), sourceUrl: null };
  // Already-parsed object
  return { spec: input, sourceUrl: null };
}

async function parseText(text) {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  // Try YAML
  try {
    const yaml = await import('yaml');
    const mod = yaml.default ?? yaml;
    return mod.parse(t);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message?.includes('Cannot find')) {
      throw new Error('YAML spec requires the "yaml" package: npm install yaml in backend/');
    }
    throw e;
  }
}

function buildEnvMap(envJson) {
  const m = {};
  if (Array.isArray(envJson.values)) {
    for (const e of envJson.values) { if (e.enabled !== false && e.key) m[e.key] = e.value ?? ''; }
  } else if (Array.isArray(envJson.variable)) {
    for (const e of envJson.variable) { if (e.key) m[e.key] = e.value ?? ''; }
  } else if (envJson && typeof envJson === 'object') {
    for (const [k, v] of Object.entries(envJson)) { if (typeof v === 'string') m[k] = v; }
  }
  return m;
}

function resolve(str, env) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (_, k) => env[k.trim()] ?? `{{${k.trim()}}}`);
}

function extractBaseUrl(spec, env, sourceUrl = null) {
  // OpenAPI 3.x
  if (Array.isArray(spec.servers) && spec.servers.length) {
    const serverUrl = resolve(spec.servers[0].url, env).replace(/\/$/, '');
    // Relative server URL (e.g. "/api/v3") — resolve against the URL we fetched from
    if (serverUrl.startsWith('/') && sourceUrl) {
      const { origin } = new URL(sourceUrl);
      return `${origin}${serverUrl}`;
    }
    return serverUrl;
  }
  // Swagger 2.x
  if (spec.host) {
    const scheme = (spec.schemes ?? ['https'])[0];
    const base = spec.basePath ?? '';
    return `${scheme}://${spec.host}${base}`.replace(/\/$/, '');
  }
  return '';
}

function parseOpenApi3(spec, env, baseUrl) {
  const endpoints = [];
  const globalComponents = spec.components ?? {};
  const globalSchemas = globalComponents.schemas ?? {};
  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      if (!pathItem[method]) continue;
      const op = pathItem[method];
      const url = resolve(`${baseUrl}${path}`, env);
      const headers = extractHeaders3(pathItem, op, spec, env);
      const body = extractBody3(op, globalSchemas);

      endpoints.push({
        name: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        url,
        headers,
        body,
        description: op.description ?? op.summary ?? '',
      });
    }
  }
  return endpoints;
}

function extractHeaders3(pathItem, op, spec, env) {
  const headers = {};
  const params = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])];
  for (const p of params) {
    if (p.in === 'header' && p.name) {
      headers[p.name] = p.example != null ? String(p.example) : '';
    }
  }

  // Security schemes → auth header hints
  const security = op.security ?? spec.security ?? [];
  if (security.length > 0) {
    const schemeName = Object.keys(security[0] ?? {})[0];
    if (schemeName) {
      const def = spec.components?.securitySchemes?.[schemeName];
      if (def?.type === 'http' && def.scheme === 'bearer') {
        headers['Authorization'] = resolve('Bearer {{token}}', env);
      } else if (def?.type === 'apiKey' && def.in === 'header') {
        headers[def.name] = resolve(`{{${def.name}}}`, env);
      } else if (def?.type === 'oauth2') {
        headers['Authorization'] = resolve('Bearer {{access_token}}', env);
      }
    }
  }
  return headers;
}

function extractBody3(op, schemas) {
  const rb = op.requestBody;
  if (!rb) return null;
  const content = rb.content?.['application/json'] ?? rb.content?.['application/x-www-form-urlencoded'];
  if (!content?.schema) return null;
  return schemaToExample(content.schema, schemas);
}

function parseSwagger2(spec, env, baseUrl) {
  const endpoints = [];
  const definitions = spec.definitions ?? {};
  const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      if (!pathItem[method]) continue;
      const op = pathItem[method];
      const url = resolve(`${baseUrl}${path}`, env);
      const headers = extractHeaders2(op, spec, env);
      const bodyParam = (op.parameters ?? []).find(p => p.in === 'body');
      const body = bodyParam?.schema ? schemaToExample(bodyParam.schema, definitions) : null;

      endpoints.push({
        name: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        url,
        headers,
        body,
        description: op.description ?? '',
      });
    }
  }
  return endpoints;
}

function extractHeaders2(op, spec, env) {
  const headers = {};
  const secDefs = spec.securityDefinitions ?? {};
  const security = op.security ?? spec.security ?? [];
  if (security.length > 0) {
    const key = Object.keys(security[0] ?? {})[0];
    if (key && secDefs[key]) {
      const def = secDefs[key];
      if (def.type === 'apiKey' && def.in === 'header') {
        headers[def.name] = resolve(`{{${def.name}}}`, env);
      } else if (def.type === 'oauth2' || def.type === 'basic') {
        headers['Authorization'] = resolve('Bearer {{token}}', env);
      }
    }
  }
  return headers;
}

// Convert a schema node to a concrete example value.
function schemaToExample(schema, defs, depth = 0) {
  if (!schema || depth > 6) return null;

  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return schemaToExample(defs[name] ?? {}, defs, depth + 1);
  }

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  if (schema.allOf?.length) return schemaToExample(schema.allOf[0], defs, depth);
  if (schema.oneOf?.length) return schemaToExample(schema.oneOf[0], defs, depth);

  if (schema.type === 'object' || schema.properties) {
    const obj = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      obj[k] = schemaToExample(v, defs, depth + 1);
    }
    return obj;
  }

  if (schema.type === 'array') {
    return [schemaToExample(schema.items ?? {}, defs, depth + 1)];
  }

  switch (schema.type) {
    case 'string':
      if (schema.format === 'email') return 'user@example.com';
      if (schema.format === 'date-time') return new Date().toISOString();
      if (schema.format === 'date') return new Date().toISOString().split('T')[0];
      if (schema.format === 'uri') return 'https://example.com';
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000001';
      if (schema.pattern) return 'string';
      return 'string';
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    default:
      return null;
  }
}
