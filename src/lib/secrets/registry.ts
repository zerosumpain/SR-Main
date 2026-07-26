// src/lib/secrets/registry.ts
//
// The API secret registry — credentials jkai can USE but never READ.
//
// Design contract (every one of these is load-bearing):
//
//  1. NO CALLER EVER RECEIVES A VALUE. The only function that returns plaintext
//     is `resolveSecretForUrl`, and it returns it already attached to request
//     headers/query plus the plaintext list purely so the caller can SCRUB it
//     back out of the response. Nothing else — no HTTP route, no tool, no log —
//     can read a value. `listSecrets`/`getSecretMeta` return metadata only.
//
//  2. HOST BINDING IS OWNER-SET AND ENFORCED AT CALL TIME. A secret only
//     authenticates a request whose URL host is on that secret's own
//     `allowedHosts`. This is what closes the exfiltration path documented in
//     `site-tools/tools/apis.ts`: catalogue entries are LLM-writable, so a
//     prompt-injected model can always write `{baseUrl: 'https://evil.example',
//     auth: {kind: 'secret', handle: 'openrouter'}}`. With host binding that
//     entry simply fails to authenticate — the attacker's host is not on the
//     openrouter secret's list, and only the owner (via /admin/ai/apis) can
//     change that list. Registration-time validation is a nicety; THIS is the
//     boundary.
//
//  3. OPTIONAL PATH NARROWING. `allowedPathPrefixes` lets the owner scope a key
//     to read-only endpoints (e.g. the openrouter key to /api/v1/credits), so a
//     credential handed to an autonomous agent cannot be spent on that host's
//     expensive write endpoints.
//
// Server-only: imports node:crypto and the DB. Never import from a .svelte file.

import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { apiSecrets, type ApiSecretRow } from '$lib/db/schema';
import { decryptPayload, encryptPayload } from '$lib/integrations/crypto';

export type SecretInjection =
  | { kind: 'bearer' }
  | { kind: 'header'; name: string }
  | { kind: 'query'; name: string };

export type SecretSource = 'vault' | 'ref';

/** Metadata safe to expose over HTTP / to the model. Deliberately has no value field. */
export interface SecretMeta {
  handle: string;
  label: string;
  source: SecretSource;
  refKey?: string;
  injection: SecretInjection;
  allowedHosts: string[];
  allowedPathPrefixes: string[];
  /** Last 4 chars of the value, for identification only. */
  hint?: string;
  notes?: string;
  /** False when the underlying value cannot currently be resolved on this host. */
  available: boolean;
  unavailableReason?: string;
  lastUsedAt?: string;
  useCount: number;
}

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

// ---------------------------------------------------------------------------
// `ref` sources — point at a key the site already owns instead of storing a
// second copy. Adding to this map is a code change (owner action) by design:
// it is the allow-list of server secrets the registry can ever reach, so an
// owner mis-clicking in the UI cannot bind, say, AUTH_SECRET to a public host.
// ---------------------------------------------------------------------------

const REF_SOURCES: Record<string, { label: string; resolve: () => Promise<string | undefined> }> = {
  openrouter: {
    label: 'OpenRouter API key (app_settings openrouter.api_key → keys.json)',
    resolve: async () => {
      const { getOpenRouterApiKey } = await import('$lib/server/models/settings');
      return getOpenRouterApiKey();
    },
  },
  tavily: {
    label: 'Tavily API key (keys.json / env TAVILY_API_KEY)',
    resolve: async () => {
      const { loadKeys } = await import('$lib/deepdive/keys');
      return loadKeys().tavilyApiKey;
    },
  },
  elevenlabs: {
    label: 'ElevenLabs API key (keys.json / env ELEVENLABS_API_KEY)',
    resolve: async () => {
      const { loadKeys } = await import('$lib/deepdive/keys');
      return loadKeys().elevenlabsApiKey;
    },
  },
  companies_house: {
    label: 'Companies House API key (env COMPANIES_HOUSE_API_KEY)',
    resolve: async () => process.env.COMPANIES_HOUSE_API_KEY,
  },
  github: {
    label: 'GitHub API token (env GITHUB_API_TOKEN)',
    resolve: async () => process.env.GITHUB_API_TOKEN,
  },
};

export function listRefSources(): Array<{ key: string; label: string }> {
  return Object.entries(REF_SOURCES).map(([key, v]) => ({ key, label: v.label }));
}

// ---------------------------------------------------------------------------
// Host / path binding
// ---------------------------------------------------------------------------

/** Strip the FQDN trailing dot and lower-case. `new URL()` has already punycoded. */
function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, '');
}

/**
 * Does `host` match an allow-list entry? Entries are either an exact host or a
 * `*.example.com` wildcard, which matches sub-domains ONLY (not the apex — an
 * owner who wants both lists both). A bare `*` is never accepted, so a secret
 * can never be host-unbound.
 */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = normaliseHost(host);
  const p = normaliseHost(String(pattern ?? '').trim());
  if (!h || !p || p === '*') return false;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // '.example.com'
    // Dot-boundary suffix match: 'api.example.com' yes, 'notexample.com' no.
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

export function hostAllowed(host: string, allowedHosts: string[]): boolean {
  return (allowedHosts ?? []).some((p) => hostMatchesPattern(host, p));
}

/**
 * Path narrowing. Empty list = any path. A prefix matches at a segment
 * boundary, so `/api/v1/credits` does not authorise `/api/v1/creditsomething`.
 */
export function pathAllowed(pathname: string, prefixes: string[]): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  const p = pathname || '/';
  return prefixes.some((raw) => {
    const pre = String(raw ?? '').trim();
    if (!pre) return false;
    if (p === pre) return true;
    const withSlash = pre.endsWith('/') ? pre : pre + '/';
    return p.startsWith(withSlash);
  });
}

/**
 * Parse + sanity-check a target URL before any secret is considered.
 * Rejects non-http(s) and any URL carrying userinfo — `https://openrouter.ai@evil.example`
 * is a hostname of `evil.example`, and refusing outright removes the whole class
 * of "the host I think I see" confusion.
 */
function parseTarget(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SecretError('request URL is not a valid absolute URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new SecretError(`refusing to attach a credential to a ${u.protocol} URL`);
  }
  if (u.username || u.password) {
    throw new SecretError('refusing to attach a credential to a URL containing userinfo (user:pass@host)');
  }
  return u;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Replace every occurrence of each plaintext with `[redacted]`, deeply, across
 * strings/objects/arrays. Applied to response bodies, composed URLs (a
 * `query`-injected key lives in the URL!) and error messages before anything is
 * handed back to a model or persisted.
 *
 * Short values are skipped: redacting a 3-character "secret" would shred
 * unrelated text, and anything that short is not a credential worth protecting.
 */
export function redactSecrets<T>(value: T, plaintexts: string[]): T {
  const needles = (plaintexts ?? []).filter((p) => typeof p === 'string' && p.length >= 8);
  if (needles.length === 0) return value;

  const scrubString = (s: string): string => {
    let out = s;
    for (const n of needles) {
      if (out.includes(n)) out = out.split(n).join('[redacted]');
      // Also catch a percent-encoded copy (query-injected keys in a URL).
      const enc = encodeURIComponent(n);
      if (enc !== n && out.includes(enc)) out = out.split(enc).join('[redacted]');
    }
    return out;
  };

  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 12) return v;
    if (typeof v === 'string') return scrubString(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[scrubString(k)] = walk(val, depth + 1);
      }
      return out;
    }
    return v;
  };

  return walk(value, 0) as T;
}

// ---------------------------------------------------------------------------
// Row mapping / listing (metadata only)
// ---------------------------------------------------------------------------

function injectionOf(row: ApiSecretRow): SecretInjection {
  const raw = (row.injection ?? {}) as Record<string, unknown>;
  const kind = String(raw.kind ?? 'bearer');
  if (kind === 'header') return { kind: 'header', name: String(raw.name ?? 'X-API-Key') };
  if (kind === 'query') return { kind: 'query', name: String(raw.name ?? 'key') };
  return { kind: 'bearer' };
}

async function toMeta(row: ApiSecretRow): Promise<SecretMeta> {
  let available = false;
  let unavailableReason: string | undefined;
  if (row.source === 'ref') {
    const ref = REF_SOURCES[row.refKey ?? ''];
    if (!ref) unavailableReason = `unknown ref source "${row.refKey}"`;
    else {
      try {
        available = !!(await ref.resolve());
        if (!available) unavailableReason = 'the referenced key is not configured on this host';
      } catch (err) {
        unavailableReason = err instanceof Error ? err.message : 'ref resolution failed';
      }
    }
  } else {
    if (!row.payloadEnc) unavailableReason = 'no stored value';
    else if (!process.env.INTEGRATION_CREDENTIALS_KEY) {
      unavailableReason = 'INTEGRATION_CREDENTIALS_KEY is not set on this host';
    } else {
      try {
        available = decryptPayload(row.payloadEnc).length > 0;
        if (!available) unavailableReason = 'stored value is empty';
      } catch {
        unavailableReason = 'stored value cannot be decrypted on this host (wrong INTEGRATION_CREDENTIALS_KEY?)';
      }
    }
  }

  return {
    handle: row.handle,
    label: row.label,
    source: row.source as SecretSource,
    refKey: row.refKey ?? undefined,
    injection: injectionOf(row),
    allowedHosts: row.allowedHosts ?? [],
    allowedPathPrefixes: row.allowedPathPrefixes ?? [],
    hint: row.hint ?? undefined,
    notes: row.notes ?? undefined,
    available,
    unavailableReason,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : undefined,
    useCount: row.useCount ?? 0,
  };
}

/** Every registered secret, metadata only. Safe for the model and the admin UI. */
export async function listSecrets(): Promise<SecretMeta[]> {
  const rows = await db.select().from(apiSecrets).orderBy(apiSecrets.handle);
  return Promise.all(rows.map(toMeta));
}

export async function getSecretMeta(handle: string): Promise<SecretMeta | null> {
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, normaliseHandle(handle))).limit(1);
  return row ? toMeta(row) : null;
}

/**
 * Which registered secrets COULD authenticate this URL. Powers the "you got a
 * 401 and there is a credential for this host" hint that lets jkai discover the
 * registry without ever seeing a value.
 */
export async function secretsForUrl(url: string): Promise<SecretMeta[]> {
  let u: URL;
  try {
    u = parseTarget(url);
  } catch {
    return [];
  }
  const all = await listSecrets();
  return all.filter((s) => hostAllowed(u.hostname, s.allowedHosts) && pathAllowed(u.pathname, s.allowedPathPrefixes));
}

export function normaliseHandle(handle: string): string {
  return String(handle ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// Owner-only mutations. Callers MUST be owner-gated (see
// src/routes/api/admin/apis/secrets/+server.ts). jkai has no tool that reaches
// these — it can read metadata and reference a handle, nothing more.
// ---------------------------------------------------------------------------

export interface UpsertSecretInput {
  handle: string;
  label?: string;
  source: SecretSource;
  /** vault only. Omit on update to keep the stored value. */
  value?: string;
  /** ref only. */
  refKey?: string;
  injection: SecretInjection;
  allowedHosts: string[];
  allowedPathPrefixes?: string[];
  notes?: string;
}

function validateInjection(injection: SecretInjection): SecretInjection {
  const kind = injection?.kind;
  if (kind === 'bearer') return { kind: 'bearer' };
  if (kind === 'header' || kind === 'query') {
    const name = String((injection as { name?: string }).name ?? '').trim();
    if (!name) throw new SecretError(`injection kind "${kind}" needs a name`);
    // No CRLF / separators smuggled into a header name or query key.
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
      throw new SecretError(`invalid ${kind} name "${name}" — letters, digits, dot, dash, underscore only`);
    }
    return kind === 'header' ? { kind: 'header', name } : { kind: 'query', name };
  }
  throw new SecretError('injection must be {kind:"bearer"} | {kind:"header",name} | {kind:"query",name}');
}

function validateHosts(hosts: string[]): string[] {
  const out: string[] = [];
  for (const raw of hosts ?? []) {
    const h = normaliseHost(String(raw ?? '').trim());
    if (!h) continue;
    if (h === '*' || h.includes('/') || h.includes(' ')) {
      throw new SecretError(`invalid host pattern "${raw}" — use a hostname or *.example.com`);
    }
    // Must look like a hostname (optionally wildcarded) with a dot-separated TLD.
    if (!/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) {
      throw new SecretError(`invalid host pattern "${raw}" — use a hostname or *.example.com`);
    }
    out.push(h);
  }
  if (out.length === 0) {
    throw new SecretError('a secret must be bound to at least one allowed host — that binding is what stops it being exfiltrated');
  }
  return Array.from(new Set(out));
}

export async function upsertSecret(input: UpsertSecretInput): Promise<SecretMeta> {
  const handle = normaliseHandle(input.handle);
  if (!handle) throw new SecretError('handle is required');

  const injection = validateInjection(input.injection);
  const allowedHosts = validateHosts(input.allowedHosts);
  const allowedPathPrefixes = (input.allowedPathPrefixes ?? [])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : '/' + p));

  const [existing] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, handle)).limit(1);

  let payloadEnc: string | null = existing?.payloadEnc ?? null;
  let refKey: string | null = existing?.refKey ?? null;
  let hint: string | null = existing?.hint ?? null;

  if (input.source === 'vault') {
    refKey = null;
    if (input.value) {
      const value = input.value.trim();
      if (!value) throw new SecretError('value is empty');
      payloadEnc = encryptPayload(value);
      hint = value.length > 4 ? value.slice(-4) : null;
    } else if (!existing) {
      throw new SecretError('a vault secret needs a value on first save');
    }
  } else if (input.source === 'ref') {
    payloadEnc = null;
    const key = String(input.refKey ?? '').trim();
    if (!REF_SOURCES[key]) {
      throw new SecretError(`unknown ref source "${key}" — one of: ${Object.keys(REF_SOURCES).join(', ')}`);
    }
    refKey = key;
    const resolved = await REF_SOURCES[key].resolve();
    hint = resolved && resolved.length > 4 ? resolved.slice(-4) : null;
  } else {
    throw new SecretError('source must be "vault" or "ref"');
  }

  const values = {
    handle,
    label: (input.label ?? handle).slice(0, 200),
    source: input.source,
    payloadEnc,
    refKey,
    injection: injection as unknown as Record<string, unknown>,
    allowedHosts,
    allowedPathPrefixes,
    hint,
    notes: input.notes ?? null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(apiSecrets).set(values).where(eq(apiSecrets.handle, handle));
  } else {
    await db.insert(apiSecrets).values({ id: randomUUID(), ...values });
  }

  const meta = await getSecretMeta(handle);
  if (!meta) throw new SecretError('secret save failed');
  return meta;
}

export async function deleteSecret(handle: string): Promise<boolean> {
  const h = normaliseHandle(handle);
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, h)).limit(1);
  if (!row) return false;
  await db.delete(apiSecrets).where(eq(apiSecrets.handle, h));
  return true;
}

// ---------------------------------------------------------------------------
// Resolution — the ONLY path that touches plaintext
// ---------------------------------------------------------------------------

export interface ResolvedSecret {
  handle: string;
  /** Headers to merge into the request. */
  headers: Record<string, string>;
  /** Query params to merge into the URL. */
  query: Record<string, string>;
  /**
   * Plaintexts the caller must scrub out of the response, the composed URL and
   * any error text. Never log, persist, or return these.
   */
  plaintexts: string[];
}

async function resolveValue(row: ApiSecretRow): Promise<string> {
  if (row.source === 'ref') {
    const ref = REF_SOURCES[row.refKey ?? ''];
    if (!ref) throw new SecretError(`secret "${row.handle}" references unknown source "${row.refKey}"`);
    const v = await ref.resolve();
    if (!v) throw new SecretError(`secret "${row.handle}" is not configured on this host (${ref.label})`);
    return v;
  }
  if (!row.payloadEnc) throw new SecretError(`secret "${row.handle}" has no stored value`);
  try {
    const v = decryptPayload(row.payloadEnc);
    if (!v) throw new SecretError('empty');
    return v;
  } catch {
    // Never echo crypto internals or any fragment of the value.
    throw new SecretError(
      `secret "${row.handle}" cannot be decrypted on this host — vault secrets are per-environment ` +
        `(INTEGRATION_CREDENTIALS_KEY differs between homeserv and the VPS). Re-enter it on this host.`,
    );
  }
}

/**
 * Resolve a secret for a specific request URL, enforcing the owner-set host and
 * path binding. Throws (never returns a partial result) if the binding fails.
 *
 * The URL passed here MUST be the final request URL. Callers that follow
 * redirects must re-check every hop — see `guardedFetch` in
 * site-tools/tools/apis.ts, which refuses to carry a registry secret across an
 * origin change at all.
 */
export async function resolveSecretForUrl(handle: string, url: string): Promise<ResolvedSecret> {
  const h = normaliseHandle(handle);
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, h)).limit(1);
  if (!row) {
    throw new SecretError(
      `no secret registered under the handle "${handle}". The owner adds credentials at /admin/ai/apis; ` +
        `use api_secrets_list to see which handles exist and which hosts they are bound to.`,
    );
  }

  const u = parseTarget(url);

  if (!hostAllowed(u.hostname, row.allowedHosts ?? [])) {
    throw new SecretError(
      `secret "${row.handle}" is bound to ${(row.allowedHosts ?? []).join(', ') || '(none)'} and will not be ` +
        `sent to ${u.hostname}. Host bindings are owner-set at /admin/ai/apis.`,
    );
  }
  if (!pathAllowed(u.pathname, row.allowedPathPrefixes ?? [])) {
    throw new SecretError(
      `secret "${row.handle}" is scoped to ${(row.allowedPathPrefixes ?? []).join(', ')} on ${u.hostname} ` +
        `and will not be sent to ${u.pathname}.`,
    );
  }

  const value = await resolveValue(row);
  const injection = injectionOf(row);

  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  if (injection.kind === 'bearer') headers.Authorization = `Bearer ${value}`;
  else if (injection.kind === 'header') headers[injection.name] = value;
  else query[injection.name] = value;

  void noteSecretUse(h);

  return { handle: row.handle, headers, query, plaintexts: [value] };
}

/** Best-effort usage bookkeeping. Never throws, never records the value. */
export async function noteSecretUse(handle: string): Promise<void> {
  try {
    await db
      .update(apiSecrets)
      .set({ lastUsedAt: new Date(), useCount: sql`${apiSecrets.useCount} + 1` })
      .where(eq(apiSecrets.handle, normaliseHandle(handle)));
  } catch {
    /* bookkeeping only */
  }
}
