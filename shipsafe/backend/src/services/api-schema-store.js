// Schema learning and contract drift detection.
// After each successful response, the response body's shape is stored.
// On subsequent runs, the stored shape is compared against the current shape
// and any structural changes are reported as "drift".

import { prisma } from '../db/prisma.js';

// Normalize a method+URL into a stable key (path params replaced with :id).
export function makeEndpointKey(method, url) {
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/\/[0-9a-f]{24,}/gi, '/:id')   // mongo-style IDs
      .replace(/\/\d+/g, '/:id');              // numeric IDs
    return `${method.toUpperCase()}:${path}`;
  } catch {
    return `${method.toUpperCase()}:${url}`;
  }
}

// Derive a structural schema from a response body (not JSON Schema — just type map).
export function inferSchema(body, depth = 0) {
  if (depth > 8) return { type: 'any' };
  if (body === null || body === undefined) return { type: 'null' };
  if (Array.isArray(body)) {
    return { type: 'array', items: body.length > 0 ? inferSchema(body[0], depth + 1) : { type: 'any' } };
  }
  if (typeof body === 'object') {
    const props = {};
    const required = [];
    for (const [k, v] of Object.entries(body)) {
      props[k] = inferSchema(v, depth + 1);
      if (v !== null && v !== undefined) required.push(k);
    }
    return { type: 'object', properties: props, required };
  }
  return { type: typeof body };
}

// Store or update the schema for an endpoint after a successful response.
export async function learnSchema(projectId, method, url, responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return;
  const key = makeEndpointKey(method, url);
  const pid = projectId ?? 'global';
  const schema = inferSchema(responseBody);

  await prisma.apiEndpointSchema.upsert({
    where: { projectId_endpointKey: { projectId: pid, endpointKey: key } },
    create: { projectId: pid, endpointKey: key, schema, sampleCount: 1 },
    update: { schema, sampleCount: { increment: 1 } },
  });
}

// Compare the current response against the stored schema and return any drifts.
export async function detectDrift(projectId, method, url, currentBody) {
  if (!currentBody || typeof currentBody !== 'object') return null;
  const key = makeEndpointKey(method, url);
  const pid = projectId ?? 'global';

  const stored = await prisma.apiEndpointSchema.findUnique({
    where: { projectId_endpointKey: { projectId: pid, endpointKey: key } },
  });
  if (!stored) return null;

  const currentSchema = inferSchema(currentBody);
  const drifts = compareSchemas(stored.schema, currentSchema, '');
  if (!drifts.length) return null;

  return { endpointKey: key, storedAt: stored.updatedAt, drifts };
}

// Recursively diff two schema trees and collect drift entries.
function compareSchemas(stored, current, path) {
  const drifts = [];
  if (!stored || !current) return drifts;

  if (stored.type !== current.type) {
    drifts.push({ path: path || 'root', change: 'type_changed', from: stored.type, to: current.type });
    return drifts;
  }

  if (stored.type === 'object') {
    const sp = stored.properties ?? {};
    const cp = current.properties ?? {};

    for (const k of Object.keys(sp)) {
      if (!(k in cp)) {
        drifts.push({ path: join(path, k), change: 'field_removed', field: k, previousType: sp[k]?.type });
      }
    }
    for (const k of Object.keys(cp)) {
      if (!(k in sp)) {
        drifts.push({ path: join(path, k), change: 'field_added', field: k, currentType: cp[k]?.type });
      } else {
        drifts.push(...compareSchemas(sp[k], cp[k], join(path, k)));
      }
    }
  }

  if (stored.type === 'array' && stored.items && current.items) {
    drifts.push(...compareSchemas(stored.items, current.items, `${path}[]`));
  }

  return drifts;
}

function join(base, key) {
  return base ? `${base}.${key}` : key;
}
