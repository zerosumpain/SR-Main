// src/lib/apis/integrations.ts
//
// The API INTEGRATION register — named, callable operations on top of the
// `api_catalog`.
//
// `api_catalog` answers "which APIs exist and how do they authenticate";
// this layer answers "what exact call answers this question", e.g.
//   openrouter-credit-balance -> GET openrouter /credits, outputs.remaining
// so both a chat answer and a no-code canvas node can reuse it verbatim.
//
// Storage is a datastore system collection (`api_integrations`), matching
// `api_catalog` — same actor model, same audit trail, same admin surfaces.
//
// SECURITY NOTE: like the catalogue, these records are LLM-writable (a model can
// reach them via `datastore_save` as well as the tools here), so NOTHING here is
// treated as trusted input. Every call is routed through `callCatalogApi`, which
// re-enforces baseUrl containment, SSRF-guards each hop, and resolves auth via
// the secret registry's owner-set host binding. A hand-forged record cannot move
// a credential anywhere the owner did not allow.

import {
  DatastoreError,
  ensureCollection,
  getRecordByKey,
  queryRecords,
  upsertRecord,
  deleteRecord,
  updateRecord,
} from '$lib/datastore';
import { safeFunction } from '$lib/workflows/nodes/safe-eval';
import { slugifyName } from '$lib/workflows/site-tools/tools/apis';

export const INTEGRATIONS_COLLECTION = 'api_integrations';
const ACTOR = 'jkai';
const SYSTEM_ACTOR = 'system';

/** Methods that change remote state — gated behind an explicit confirmation. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface IntegrationParam {
  name: string;
  /** Where the value goes. `path` substitutes a {name} placeholder in `path`. */
  in: 'path' | 'query' | 'body' | 'header';
  required?: boolean;
  description?: string;
  example?: string;
  default?: string;
}

export interface IntegrationOutput {
  /** Name exposed downstream, e.g. `remaining`. */
  name: string;
  /**
   * A single safe expression over `json` (the parsed response), evaluated by the
   * same AST-gated evaluator the `conditional` node uses — so a stored
   * expression cannot reach Node internals.
   * e.g. `json.data.total_credits - json.data.total_usage`
   */
  expr: string;
  unit?: string;
  description?: string;
}

export interface ApiIntegration {
  key: string;
  name: string;
  description?: string;
  /** `api_catalog` key or name — supplies baseUrl + auth. */
  api: string;
  method: string;
  path: string;
  params: IntegrationParam[];
  outputs: IntegrationOutput[];
  docsUrl?: string;
  status: 'draft' | 'verified' | 'broken';
  lastTestedAt?: string;
  lastTestStatus?: 'ok' | 'failed';
  lastTestSummary?: string;
  createdBy: 'jkai' | 'owner' | 'system';
  createdAt?: string;
  updatedAt?: string;
}

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}

/** Idempotent — safe to call on every boot and before every read/write. */
export async function ensureIntegrationsCollection(): Promise<void> {
  await ensureCollection(
    INTEGRATIONS_COLLECTION,
    {
      name: 'API Integrations',
      description:
        'Named, callable operations over catalogued APIs (register at /admin/ai/apis). Each record is one request: method + path + params + named outputs, reusable from chat and from the api-integration canvas node.',
      isSystem: true,
      // Mirrors api_catalog: anyone reads, jkai/system author, owner/system prune.
      defaultPermissions: {
        read: ['*'],
        write: ['owner', 'jkai', 'system'],
        delete: ['owner', 'system'],
      },
    },
    SYSTEM_ACTOR,
  );
}

/**
 * `status` is written by jkai as well as by the register, and it has written
 * values outside the union before — `paypal-transactions` sat on "candidate"
 * (the api_catalog word, not this one). An out-of-union status renders
 * unstyled, never matches a "verified" filter and reads as a state the code
 * does not have, so it is folded back to `draft` on the way out. One bad write
 * then costs nothing downstream.
 */
const INTEGRATION_STATUSES = new Set<ApiIntegration['status']>(['draft', 'verified', 'broken']);

function normaliseStatus(raw: unknown): ApiIntegration['status'] {
  const s = raw as ApiIntegration['status'];
  return INTEGRATION_STATUSES.has(s) ? s : 'draft';
}

function normaliseIntegration(key: string, data: Record<string, unknown>): ApiIntegration {
  const raw = data as Partial<ApiIntegration>;
  return {
    key,
    name: String(raw.name ?? key),
    description: raw.description ?? '',
    api: String(raw.api ?? ''),
    method: String(raw.method ?? 'GET').toUpperCase(),
    path: String(raw.path ?? ''),
    params: Array.isArray(raw.params) ? (raw.params as IntegrationParam[]) : [],
    outputs: Array.isArray(raw.outputs) ? (raw.outputs as IntegrationOutput[]) : [],
    docsUrl: raw.docsUrl,
    status: normaliseStatus(raw.status),
    lastTestedAt: raw.lastTestedAt,
    lastTestStatus: raw.lastTestStatus,
    lastTestSummary: raw.lastTestSummary,
    createdBy: (raw.createdBy as ApiIntegration['createdBy']) ?? 'jkai',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function listIntegrations(): Promise<ApiIntegration[]> {
  await ensureIntegrationsCollection();
  try {
    const { records } = await queryRecords(INTEGRATIONS_COLLECTION, { limit: 500 }, ACTOR);
    return records
      .map((r) => normaliseIntegration(r.key ?? '', r.data as Record<string, unknown>))
      .filter((i) => !!i.key)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return [];
    throw err;
  }
}

export async function getIntegration(key: string): Promise<ApiIntegration | null> {
  await ensureIntegrationsCollection();
  const slug = slugifyName(key);
  try {
    const rec = await getRecordByKey(INTEGRATIONS_COLLECTION, slug, ACTOR);
    return normaliseIntegration(rec.key ?? slug, rec.data as Record<string, unknown>);
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') {
      // Fall back to a name match so "OpenRouter credit balance" also resolves.
      const all = await listIntegrations();
      const want = String(key).toLowerCase();
      return all.find((i) => i.name.toLowerCase() === want) ?? null;
    }
    throw err;
  }
}

export interface SaveIntegrationInput {
  key?: string;
  name: string;
  description?: string;
  api: string;
  method?: string;
  path?: string;
  params?: IntegrationParam[];
  outputs?: IntegrationOutput[];
  docsUrl?: string;
}

/**
 * Create or update an integration. Validates shape only — the security boundary
 * is at call time (see the module header). Never sets `status: 'verified'`;
 * only a passing `testIntegration` earns that.
 */
export async function saveIntegration(
  input: SaveIntegrationInput,
  createdBy: ApiIntegration['createdBy'] = 'jkai',
): Promise<ApiIntegration> {
  await ensureIntegrationsCollection();

  const name = String(input.name ?? '').trim();
  if (!name) throw new IntegrationError('name is required');
  const api = String(input.api ?? '').trim();
  if (!api) throw new IntegrationError('api (catalogue key or name) is required');

  const key = slugifyName(input.key || name);
  if (!key) throw new IntegrationError('could not derive a key from the name');

  const method = String(input.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new IntegrationError(`unsupported method "${method}"`);
  }

  // The catalogue entry must exist — that is where baseUrl + auth live.
  const { findApiEntry } = await import('$lib/workflows/site-tools/tools/apis');
  const entry = await findApiEntry(api);
  if (!entry) {
    throw new IntegrationError(
      `no catalogued API named "${api}". Register the API first with api_register (it holds the baseUrl and the auth handle), then save the integration.`,
    );
  }

  const params = (input.params ?? []).map((p) => {
    const pname = String(p?.name ?? '').trim();
    if (!pname) throw new IntegrationError('every param needs a name');
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(pname)) {
      throw new IntegrationError(`invalid param name "${pname}" — letters, digits, dot, dash, underscore only`);
    }
    const where = String(p?.in ?? 'query') as IntegrationParam['in'];
    if (!['path', 'query', 'body', 'header'].includes(where)) {
      throw new IntegrationError(`param "${pname}" has invalid "in": ${where}`);
    }
    return {
      name: pname,
      in: where,
      required: !!p.required,
      description: p.description ?? '',
      example: p.example ?? '',
      default: p.default ?? '',
    } satisfies IntegrationParam;
  });

  // Validate every output expression NOW so a broken one is a save error rather
  // than a mystery at run time. safeFunction throws on unsafe constructs.
  const outputs = (input.outputs ?? []).map((o) => {
    const oname = String(o?.name ?? '').trim();
    if (!oname) throw new IntegrationError('every output needs a name');
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,48}$/.test(oname)) {
      throw new IntegrationError(`invalid output name "${oname}" — must be a plain identifier`);
    }
    const expr = String(o?.expr ?? '').trim();
    if (!expr) throw new IntegrationError(`output "${oname}" needs an expr`);
    // `safeFunction`'s AST gate stops sandbox escapes but says nothing about
    // COST: these expressions are LLM-authored, stored, and re-evaluated
    // synchronously on every call of the integration, so `while(true){}` in an
    // expr would park the event loop of the whole single-threaded site.
    // An output is a projection of the response — it never needs a loop, a
    // function, or a statement — so reject those shapes outright rather than
    // trying to bound execution.
    if (/\b(while|for|do|function)\b|=>/.test(expr)) {
      throw new IntegrationError(
        `output "${oname}" must be a single expression over \`json\` — no loops, functions or arrow functions.`,
      );
    }
    if (expr.length > 500) {
      throw new IntegrationError(`output "${oname}" expression is too long (max 500 chars)`);
    }
    try {
      safeFunction(['json'], `return (${expr})`);
    } catch (err) {
      throw new IntegrationError(`output "${oname}" has an invalid expression: ${(err as Error).message}`);
    }
    return { name: oname, expr, unit: o.unit ?? '', description: o.description ?? '' } satisfies IntegrationOutput;
  });

  const existing = await getIntegration(key);
  const now = new Date().toISOString();
  const data: ApiIntegration = {
    key,
    name,
    description: input.description ?? existing?.description ?? '',
    api: entry.key,
    method,
    path: String(input.path ?? ''),
    params,
    outputs,
    docsUrl: input.docsUrl ?? existing?.docsUrl,
    // Re-saving invalidates a previous pass: the request changed, so the
    // evidence no longer applies.
    status: 'draft',
    lastTestedAt: existing?.lastTestedAt,
    lastTestStatus: existing?.lastTestStatus,
    lastTestSummary: existing?.lastTestSummary,
    createdBy: existing?.createdBy ?? createdBy,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await upsertRecord(
    INTEGRATIONS_COLLECTION,
    { key, data: data as unknown as Record<string, unknown> },
    createdBy === 'owner' ? 'owner' : ACTOR,
  );
  return data;
}

/**
 * `actor` is REQUIRED and has no default: a default of 'owner' let
 * `api_integration_delete` (a tool the model invokes) pass the literal string
 * 'owner', and `canDo` short-circuits on that — silently bypassing the
 * collection's declared `delete: ['owner','system']` permission.
 */
export async function deleteIntegration(key: string, actor: 'owner' | 'system' | 'jkai'): Promise<boolean> {
  await ensureIntegrationsCollection();
  const slug = slugifyName(key);
  try {
    await deleteRecord(INTEGRATIONS_COLLECTION, { key: slug }, actor);
    return true;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Calling
// ---------------------------------------------------------------------------

/** Substitute {name} placeholders, URL-encoding each value. */
function substitutePath(path: string, values: Record<string, string>): string {
  return path.replace(/\{([A-Za-z0-9_.-]+)\}/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined) throw new IntegrationError(`missing required path param "${name}"`);
    return encodeURIComponent(v);
  });
}

export interface CallIntegrationResult {
  success: boolean;
  error?: string;
  integration: string;
  api: string;
  method: string;
  status?: number;
  url?: string;
  json?: unknown;
  text?: string;
  /** Named outputs from the integration's `outputs` expressions. */
  values: Record<string, unknown>;
  dryRun?: boolean;
}

/**
 * Execute a recorded integration. Delegates the actual request to
 * `callCatalogApi`, so containment, SSRF pinning, secret host-binding and
 * response redaction are the same single code path the `api_call` tool uses.
 */
export async function callIntegration(opts: {
  key: string;
  params?: Record<string, unknown>;
  /** Required for POST/PUT/PATCH/DELETE — remote state changes are opt-in. */
  confirmWrite?: boolean;
  dryRun?: boolean;
}): Promise<CallIntegrationResult> {
  const integration = await getIntegration(opts.key);
  if (!integration) {
    const all = await listIntegrations();
    throw new IntegrationError(
      `no integration named "${opts.key}". Registered: ${all.map((i) => i.key).join(', ') || '(none yet)'}`,
    );
  }

  const supplied = opts.params ?? {};
  const pathValues: Record<string, string> = {};
  const query: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const bodyObj: Record<string, unknown> = {};

  for (const p of integration.params) {
    const raw = supplied[p.name] ?? (p.default !== '' ? p.default : undefined);
    if (raw === undefined || raw === null || raw === '') {
      if (p.required) {
        throw new IntegrationError(
          `integration "${integration.key}" needs param "${p.name}"${p.description ? ` (${p.description})` : ''}`,
        );
      }
      continue;
    }
    if (p.in === 'path') pathValues[p.name] = String(raw);
    else if (p.in === 'query') query[p.name] = raw;
    else if (p.in === 'header') headers[p.name] = String(raw);
    else bodyObj[p.name] = raw;
  }

  const method = integration.method.toUpperCase();
  if (WRITE_METHODS.has(method) && !opts.confirmWrite && !opts.dryRun) {
    throw new IntegrationError(
      `integration "${integration.key}" is a ${method} (it changes remote state). Re-run with confirmWrite:true — ` +
        `or, in a workflow, tick "Allow write operation" on the node — once you are sure.`,
    );
  }

  const path = substitutePath(integration.path, pathValues);

  if (opts.dryRun) {
    return {
      success: true,
      dryRun: true,
      integration: integration.key,
      api: integration.api,
      method,
      url: path,
      values: {},
    };
  }

  const { callCatalogApi } = await import('$lib/workflows/site-tools/tools/apis');
  const result = await callCatalogApi({
    api: integration.api,
    path,
    method,
    query,
    headers: Object.keys(headers).length ? headers : undefined,
    body: Object.keys(bodyObj).length ? bodyObj : undefined,
  });

  const data = (result.data ?? {}) as { status?: number; url?: string; json?: unknown; text?: string };

  if (!result.success) {
    // Only demote on evidence the OPERATION is broken. A 4xx from bad params, a
    // 429, or a SecretError (a host/binding configuration fact) is not — and
    // demoting on those let anyone who could force one failed call destroy the
    // "verified" evidence the owner reads in the register.
    const status = data.status ?? 0;
    const operationLooksBroken = status >= 500 || status === 404 || status === 0;
    if (operationLooksBroken && !/secret|bound to|scoped to|may only authenticate/i.test(result.error ?? '')) {
      void noteTest(integration.key, 'failed', result.error ?? 'call failed');
    }
    return {
      success: false,
      error: result.error,
      integration: integration.key,
      api: integration.api,
      method,
      status: data.status,
      url: data.url,
      json: data.json,
      text: data.text,
      values: {},
    };
  }

  const values = computeOutputs(integration.outputs, data.json);
  void noteTest(integration.key, 'ok', summariseValues(values, data.status));

  return {
    success: true,
    integration: integration.key,
    api: integration.api,
    method,
    status: data.status,
    url: data.url,
    json: data.json,
    text: data.text,
    values,
  };
}

/** Evaluate each output expression against the parsed response. */
export function computeOutputs(outputs: IntegrationOutput[], json: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of outputs ?? []) {
    try {
      const fn = safeFunction(['json'], `return (${o.expr})`);
      out[o.name] = fn(json);
    } catch (err) {
      out[o.name] = null;
      out[`${o.name}_error`] = (err as Error).message;
    }
  }
  return out;
}

function summariseValues(values: Record<string, unknown>, status?: number): string {
  const parts = Object.entries(values)
    .filter(([k]) => !k.endsWith('_error'))
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v.toFixed(4)) : String(v).slice(0, 40)}`);
  return `HTTP ${status ?? '?'}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
}

/** Record test/call evidence on the integration. Best-effort, never throws. */
export async function noteTest(key: string, status: 'ok' | 'failed', summary: string): Promise<void> {
  try {
    await updateRecord(
      INTEGRATIONS_COLLECTION,
      { key: slugifyName(key) },
      {
        patch: {
          status: status === 'ok' ? 'verified' : 'broken',
          lastTestStatus: status,
          lastTestedAt: new Date().toISOString(),
          lastTestSummary: summary.slice(0, 300),
        },
      },
      SYSTEM_ACTOR,
    );
  } catch {
    /* evidence bookkeeping is best-effort */
  }
}

/**
 * Picker-shaped list for the `api-integration` node panel and the register page:
 * enough to render a dropdown, parameter inputs and output hints without a
 * second round-trip. Includes the resolved host so the UI can show where each
 * call goes and whether a credential is attached.
 */
export async function listIntegrationsForPicker(): Promise<
  Array<
    ApiIntegration & {
      baseUrl: string;
      host: string;
      authKind: string;
      secretHandle?: string;
      writes: boolean;
    }
  >
> {
  const [integrations, apis] = await Promise.all([
    listIntegrations(),
    import('$lib/workflows/site-tools/tools/apis').then((m) => m.listCatalogApis()),
  ]);
  const byKey = new Map(apis.map((a) => [a.key, a]));
  return integrations.map((i) => {
    const api = byKey.get(i.api);
    let host = '';
    try {
      host = api?.baseUrl ? new URL(api.baseUrl).host : '';
    } catch {
      host = '';
    }
    return {
      ...i,
      baseUrl: api?.baseUrl ?? '',
      host,
      authKind: api?.auth ?? 'none',
      secretHandle: api?.secretHandle,
      writes: WRITE_METHODS.has(i.method.toUpperCase()),
    };
  });
}
