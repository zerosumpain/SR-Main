// src/lib/workflows/site-tools/tools/apis.ts
//
// `apis` toolset — API-first answering. The `api_catalog` system collection
// (seeded by the self-improvement engine) is the registry of external data
// sources. This toolset lets the model:
//   - api_search : rank catalogued APIs against a question/capability (no LLM)
//   - api_call   : execute a request against a CATALOGUED API only, SSRF-guarded,
//                  with auth resolved server-side from env-var references
//   - api_register: add/update a candidate catalogue entry
//
// Raw secrets are never stored in records — only env-var *names*; the value is
// injected at call time. All datastore access runs as actor `jkai`.

import { register } from '../registry-internal';
import type { ToolDefinition, ToolResult } from '../registry-internal';
import { assertPublicUrl } from '$lib/server/ssrf-guard';
import {
  DatastoreError,
  getRecordByKey,
  queryRecords,
  updateRecord,
  upsertRecord,
} from '$lib/datastore';

const API_CATALOG = 'api_catalog';
const ACTOR = 'jkai';
const CALL_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 100 * 1024; // 100 KB

type ApiAuth =
  | { kind: 'none' }
  | { kind: 'bearer-env'; envVar: string }
  | { kind: 'header-env'; envVar: string; header: string };

interface ApiEntry {
  name: string;
  baseUrl: string;
  docsUrl?: string;
  description?: string;
  capabilities?: string[];
  tags?: string[];
  auth?: ApiAuth;
  exampleRequests?: Array<{ label?: string; method?: string; url: string; body?: unknown }>;
  status?: 'seeded' | 'candidate' | 'verified' | 'broken';
  lastVerifiedAt?: string;
  source?: 'seed' | 'jkai' | 'selfimprove';
}

/** name -> stable catalogue key (also used elsewhere as the record key). */
export function slugifyName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toToolError(err: unknown): ToolResult {
  if (err instanceof DatastoreError || (err as { name?: string })?.name === 'DatastoreError') {
    const e = err as DatastoreError;
    return { success: false, error: e.message, data: { code: e.code } };
  }
  return { success: false, error: err instanceof Error ? err.message : 'api error' };
}

function tokenize(...parts: (string | string[] | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const s = Array.isArray(p) ? p.join(' ') : p;
    for (const t of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length > 1) out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// api_search
// ---------------------------------------------------------------------------

async function loadCatalog(): Promise<Array<{ key: string | null; entry: ApiEntry }>> {
  try {
    const { records } = await queryRecords(API_CATALOG, { limit: 500 }, ACTOR);
    return records.map((r) => ({ key: r.key, entry: r.data as unknown as ApiEntry }));
  } catch (err) {
    // Catalogue not seeded yet -> behave as empty rather than erroring.
    if (err instanceof DatastoreError && err.code === 'not_found') return [];
    throw err;
  }
}

export async function handleApiSearch(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const query = String(args.query ?? '');
    const tags = (args.tags as string[] | undefined) ?? [];
    const qTokens = new Set(tokenize(query, tags));
    const tagSet = new Set(tags.map((t) => t.toLowerCase()));

    const catalog = await loadCatalog();
    const scored = catalog.map(({ key, entry }) => {
      const hay = tokenize(entry.name, entry.description, entry.capabilities, entry.tags);
      const haySet = new Set(hay);
      let score = 0;
      for (const t of qTokens) if (haySet.has(t)) score += 1;
      for (const t of entry.tags ?? []) if (tagSet.has(t.toLowerCase())) score += 2; // tag exact matches weigh more
      if ((entry.status ?? 'seeded') === 'broken') score -= 5;
      return { key, entry, score };
    });

    // No query -> return the catalogue (stable order); otherwise rank by score.
    const ranked = qTokens.size === 0 && tagSet.size === 0
      ? scored
      : scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

    const top = ranked.slice(0, 8).map(({ key, entry }) => ({
      key: key ?? slugifyName(entry.name),
      name: entry.name,
      baseUrl: entry.baseUrl,
      description: entry.description,
      capabilities: entry.capabilities ?? [],
      tags: entry.tags ?? [],
      auth: entry.auth?.kind ?? 'none',
      status: entry.status ?? 'seeded',
      exampleRequests: entry.exampleRequests ?? [],
    }));

    return { success: true, data: { count: top.length, apis: top } };
  } catch (err) {
    return toToolError(err);
  }
}

// ---------------------------------------------------------------------------
// api_call
// ---------------------------------------------------------------------------

async function findEntry(api: string): Promise<{ key: string; entry: ApiEntry } | null> {
  const slug = slugifyName(api);
  try {
    const rec = await getRecordByKey(API_CATALOG, slug, ACTOR);
    return { key: rec.key ?? slug, entry: rec.data as unknown as ApiEntry };
  } catch (err) {
    if (!(err instanceof DatastoreError && err.code === 'not_found')) throw err;
  }
  // Fall back to a name match across the catalogue.
  const catalog = await loadCatalog();
  const want = api.toLowerCase();
  const hit = catalog.find(
    ({ key, entry }) => (entry.name ?? '').toLowerCase() === want || key === slug,
  );
  return hit ? { key: hit.key ?? slug, entry: hit.entry } : null;
}

/** Resolve the auth header for an entry. Throws a clear error if the env is missing. */
function resolveAuthHeaders(entry: ApiEntry): Record<string, string> {
  const auth = entry.auth ?? { kind: 'none' };
  if (auth.kind === 'none') return {};
  if (auth.kind === 'bearer-env') {
    const v = process.env[auth.envVar];
    if (!v) throw new Error(`API "${entry.name}" needs env var ${auth.envVar}, which is not set on this host.`);
    return { Authorization: `Bearer ${v}` };
  }
  if (auth.kind === 'header-env') {
    const v = process.env[auth.envVar];
    if (!v) throw new Error(`API "${entry.name}" needs env var ${auth.envVar}, which is not set on this host.`);
    return { [auth.header]: v };
  }
  return {};
}

/** Fetch with SSRF guard, timeout, and a hard response-size cap. */
async function guardedFetch(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; ok: boolean; contentType: string; text: string; truncated: boolean }> {
  await assertPublicUrl(url);
  const method = (opts.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json, text/*;q=0.8', ...(opts.headers ?? {}) };
  let body: string | undefined;
  if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: controller.signal, redirect: 'follow' });
  } catch (err: unknown) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error(`request timed out after ${CALL_TIMEOUT_MS}ms`);
    }
    throw new Error((err as Error)?.message ?? 'network error');
  }
  clearTimeout(timer);

  // Re-validate the final URL after redirects (open-redirect defence).
  if (res.url && res.url !== url) await assertPublicUrl(res.url);

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        truncated = true;
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8').slice(0, MAX_RESPONSE_BYTES);
  return { status: res.status, ok: res.ok, contentType, text, truncated };
}

/** Best-effort catalogue status update after a call (never throws). */
async function markStatus(key: string, status: 'verified' | 'broken'): Promise<void> {
  try {
    const patch: Record<string, unknown> = { status };
    if (status === 'verified') patch.lastVerifiedAt = new Date().toISOString();
    await updateRecord(API_CATALOG, { key }, { patch }, ACTOR);
  } catch {
    /* status bookkeeping is best-effort */
  }
}

export async function handleApiCall(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const api = String(args.api ?? '').trim();
    const url = String(args.url ?? '').trim();
    if (!api) return { success: false, error: '"api" (catalogue key or name) is required' };
    if (!url) return { success: false, error: '"url" is required' };

    const found = await findEntry(api);
    if (!found) {
      return { success: false, error: `No catalogued API named "${api}". Use api_search to find one, or api_register to add it.` };
    }
    const { key, entry } = found;

    if (!entry.baseUrl || !url.startsWith(entry.baseUrl)) {
      return { success: false, error: `url must start with the API's baseUrl (${entry.baseUrl}). Refusing to call outside the catalogued host.` };
    }

    let authHeaders: Record<string, string>;
    try {
      authHeaders = resolveAuthHeaders(entry);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    let result;
    try {
      result = await guardedFetch(url, {
        method: args.method as string | undefined,
        headers: { ...authHeaders, ...((args.headers as Record<string, string> | undefined) ?? {}) },
        body: args.body,
      });
    } catch (err) {
      // Network / timeout / SSRF -> a hard failure; mark the entry broken.
      void markStatus(key, 'broken');
      return { success: false, error: (err as Error).message };
    }

    // 2xx -> verified; 5xx -> broken (server-side); 4xx leaves status untouched
    // (a bad path/params does not condemn the whole API).
    if (result.ok) void markStatus(key, 'verified');
    else if (result.status >= 500) void markStatus(key, 'broken');

    let parsed: unknown = undefined;
    if (!result.truncated && result.contentType.includes('json') && result.text) {
      try { parsed = JSON.parse(result.text); } catch { /* keep raw text */ }
    }

    return {
      success: result.ok,
      error: result.ok ? undefined : `HTTP ${result.status}`,
      data: {
        api: entry.name,
        url,
        status: result.status,
        contentType: result.contentType,
        truncated: result.truncated,
        json: parsed,
        text: parsed === undefined ? result.text : undefined,
      },
    };
  } catch (err) {
    return toToolError(err);
  }
}

// ---------------------------------------------------------------------------
// api_register
// ---------------------------------------------------------------------------

/** Best-effort probe of an entry's first safe GET example. Returns true on 2xx. */
async function probeEntry(entry: ApiEntry): Promise<boolean> {
  const example = (entry.exampleRequests ?? []).find(
    (e) => (e.method ?? 'GET').toUpperCase() === 'GET' && e.url?.startsWith(entry.baseUrl ?? ''),
  );
  if (!example) return false;
  if ((entry.auth?.kind ?? 'none') !== 'none') return false; // don't burn creds during registration
  try {
    const r = await guardedFetch(example.url, { method: 'GET' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function handleApiRegister(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const entryIn = (args.entry as ApiEntry | undefined) ?? (args as unknown as ApiEntry);
    if (!entryIn?.name || !entryIn?.baseUrl) {
      return { success: false, error: 'entry requires at least "name" and "baseUrl"' };
    }
    // baseUrl must itself be a public http(s) URL.
    try {
      await assertPublicUrl(entryIn.baseUrl);
    } catch (err) {
      return { success: false, error: `baseUrl rejected: ${(err as Error).message}` };
    }

    const verified = await probeEntry(entryIn);
    const key = slugifyName(entryIn.name);
    const data: ApiEntry = {
      name: entryIn.name,
      baseUrl: entryIn.baseUrl,
      docsUrl: entryIn.docsUrl,
      description: entryIn.description ?? '',
      capabilities: entryIn.capabilities ?? [],
      tags: entryIn.tags ?? [],
      auth: entryIn.auth ?? { kind: 'none' },
      exampleRequests: entryIn.exampleRequests ?? [],
      status: verified ? 'verified' : 'candidate',
      lastVerifiedAt: verified ? new Date().toISOString() : entryIn.lastVerifiedAt,
      source: 'jkai',
    };
    const rec = await upsertRecord(API_CATALOG, { key, data: data as unknown as Record<string, unknown> }, ACTOR);
    return { success: true, data: { key, status: data.status, id: rec.id } };
  } catch (err) {
    return toToolError(err);
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const apiTools: ToolDefinition[] = [
  {
    name: 'api_search',
    description:
      'Find external APIs in the catalogue that can answer a data question. Ranks catalogued sources by relevance to your query/capabilities and returns the top matches with their baseUrl and example requests. Call this FIRST when a question is about current, factual, numeric or external data — then use api_call to fetch live data.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you need data about (e.g. "UK school pupil numbers", "current weather", "company registration").' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional capability/domain tags to bias the ranking.' },
      },
      required: ['query'],
    },
    category: 'APIs',
    toolset: 'apis',
    handler: (args) => handleApiSearch(args),
  },
  {
    name: 'api_call',
    description:
      'Call a catalogued external API to fetch live data. The url MUST extend the catalogue entry\'s baseUrl; requests are SSRF-guarded (no internal hosts) and auth is injected server-side from env-var references. Cite the API you used in your answer. Use api_search first to pick the right "api" key.',
    parameters: {
      type: 'object',
      properties: {
        api: { type: 'string', description: 'Catalogue key or name of the API to call (from api_search).' },
        url: { type: 'string', description: 'Full request URL — must start with the catalogued baseUrl.' },
        method: { type: 'string', description: 'HTTP method (default GET).' },
        body: { description: 'Optional request body (object -> JSON, or a string) for non-GET methods.' },
        headers: { type: 'object', description: 'Optional extra request headers.' },
      },
      required: ['api', 'url'],
    },
    category: 'APIs',
    toolset: 'apis',
    handler: (args) => handleApiCall(args),
  },
  {
    name: 'api_register',
    description:
      'Add or update an API in the catalogue so it can be searched and called later. Store an env-var NAME for auth (never a raw secret). Use this when you discover a genuinely useful public API that is not already catalogued.',
    parameters: {
      type: 'object',
      properties: {
        entry: {
          type: 'object',
          description: 'The API entry.',
          properties: {
            name: { type: 'string' },
            baseUrl: { type: 'string', description: 'Base URL all calls must extend (e.g. https://api.example.com/v1).' },
            docsUrl: { type: 'string' },
            description: { type: 'string' },
            capabilities: { type: 'array', items: { type: 'string' } },
            tags: { type: 'array', items: { type: 'string' } },
            auth: {
              type: 'object',
              description: 'Auth spec: {kind:"none"} | {kind:"bearer-env",envVar} | {kind:"header-env",envVar,header}. Only the env-var name is stored.',
            },
            exampleRequests: { type: 'array', items: { type: 'object' } },
          },
          required: ['name', 'baseUrl'],
        },
      },
      required: ['entry'],
    },
    category: 'APIs',
    toolset: 'apis',
    handler: (args) => handleApiRegister(args),
  },
];

for (const tool of apiTools) register(tool);
