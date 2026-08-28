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
import { decryptPayload, encryptPayload } from '$lib/secrets/crypto';
import { getOAuthAccessToken, OAUTH_PROVIDERS } from './oauth-refresh';
import { normaliseHost, hostMatchesPattern, hostAllowed } from './host-match';

export type SecretInjection =
  | { kind: 'bearer' }
  /**
   * `field` names one key of a stored credential SET (see `parseCredentialSet`).
   * Absent means the whole stored value is the credential — the original,
   * single-value behaviour, and still the common case.
   *
   * This is what makes a multi-field credential USABLE rather than merely
   * storable. Plenty of APIs hand over three or four values of which exactly one
   * is the thing that goes on the wire (Darwin: a consumer key alongside a group
   * and a topic), and before this the only way to hold the set was `{kind:'none'}`,
   * which no request path will touch.
   */
  | { kind: 'header'; name: string; field?: string }
  | { kind: 'query'; name: string; field?: string }
  /**
   * HTTP Basic, composed from two fields of a stored credential set. The
   * base64 is built at call time and never stored, so rotating either half is a
   * normal field amend.
   */
  | { kind: 'basic'; usernameField?: string; passwordField?: string }
  /**
   * STORE-ONLY. The value is never attached to an outbound request by this
   * module; it exists so a multi-field credential SET (a client_id +
   * client_secret + refresh_token JSON blob) can be held encrypted and read by
   * one specific server module — see $lib/secrets/oauth-refresh.
   *
   * Without this kind such a row would have to claim some injection, and
   * `{kind:'bearer'}` would mean any caller that resolved it got the entire
   * JSON credential set pasted into an Authorization header. `resolveSecretForUrl`
   * refuses these rows outright.
   *
   * Note this does NOT exempt the row from host binding: it still needs an
   * allowed host, which is what `oauth-refresh` checks the token endpoint
   * against before sending anything.
   */
  | { kind: 'none' };

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
  /** HTTP methods this credential may authenticate. Empty is treated as GET+HEAD. */
  allowedMethods: string[];
  /** Last 4 chars of the value, for identification only. */
  hint?: string;
  notes?: string;
  /** False when the underlying value cannot currently be resolved on this host. */
  available: boolean;
  unavailableReason?: string;
  lastUsedAt?: string;
  useCount: number;
  /** When the row was last written. Used by the credential-request gate to
   *  verify a claimed write actually happened. A timestamp is not a value. */
  updatedAt?: string;
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
      const { loadKeys } = await import('$lib/llm/keys');
      return loadKeys().tavilyApiKey;
    },
  },
  elevenlabs: {
    label: 'ElevenLabs API key (keys.json / env ELEVENLABS_API_KEY)',
    resolve: async () => {
      const { loadKeys } = await import('$lib/llm/keys');
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
  // OAuth2 providers: `resolve()` runs on every request, so these trade the
  // stored credential set for a short-lived access token and cache it until it
  // is close to expiry. The client_secret / refresh_token live encrypted in the
  // companion `<provider>-oauth` vault secret and never leave the server.
  // See $lib/secrets/oauth-refresh.
  truelayer: {
    label: OAUTH_PROVIDERS.truelayer.label,
    resolve: async () => getOAuthAccessToken('truelayer'),
  },
  paypal: {
    label: OAUTH_PROVIDERS.paypal.label,
    resolve: async () => getOAuthAccessToken('paypal'),
  },
};

export function listRefSources(): Array<{ key: string; label: string }> {
  return Object.entries(REF_SOURCES).map(([key, v]) => ({ key, label: v.label }));
}

// ---------------------------------------------------------------------------
// Host / path binding
// ---------------------------------------------------------------------------

// The predicate itself lives in `./host-match` — a pure module with no node or
// DB imports — so the admin register can import the SAME rule instead of
// keeping a hand-written copy that drifts. Re-exported here so every existing
// server-side import path keeps working.
export { normaliseHost, hostMatchesPattern, hostAllowed } from './host-match';

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
  // https ONLY. A bearer token on a cleartext connection is readable by anything
  // on the path, and the binding model has no way to express "this host is fine
  // over http" — so there is no legitimate case to allow here.
  if (u.protocol !== 'https:') {
    throw new SecretError(
      `refusing to attach a credential over ${u.protocol.replace(':', '')} — credentials are only sent over https`,
    );
  }
  if (u.username || u.password) {
    throw new SecretError('refusing to attach a credential to a URL containing userinfo (user:pass@host)');
  }
  // Encoded separators make the path we path-check differ from the path the
  // origin routes on, which would turn segment-boundary narrowing into a
  // suggestion. No catalogued call needs one.
  if (/%2e|%2f|%5c|%25|;/i.test(u.pathname)) {
    throw new SecretError(
      'refusing to attach a credential to a URL whose path contains an encoded separator (%2E, %2F, %5C, %25 or ;)',
    );
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

/** A stored field name, or undefined. Same charset the write path validates. */
function fieldOf(raw: unknown): string | undefined {
  const f = String(raw ?? '').trim();
  return /^[a-z0-9_]{1,32}$/.test(f) ? f : undefined;
}

function injectionOf(row: ApiSecretRow): SecretInjection {
  const raw = (row.injection ?? {}) as Record<string, unknown>;
  const kind = String(raw.kind ?? 'bearer');
  if (kind === 'header') return { kind: 'header', name: String(raw.name ?? 'X-API-Key'), field: fieldOf(raw.field) };
  if (kind === 'query') return { kind: 'query', name: String(raw.name ?? 'key'), field: fieldOf(raw.field) };
  if (kind === 'basic') {
    return {
      kind: 'basic',
      usernameField: fieldOf(raw.usernameField) ?? 'username',
      passwordField: fieldOf(raw.passwordField) ?? 'password',
    };
  }
  if (kind === 'none') return { kind: 'none' };
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
    allowedMethods: effectiveMethods(row.allowedMethods),
    hint: row.hint ?? undefined,
    notes: row.notes ?? undefined,
    available,
    unavailableReason,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : undefined,
    useCount: row.useCount ?? 0,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
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
  /** Omitted/empty = read-only (GET+HEAD). */
  allowedMethods?: string[];
  notes?: string;
}

/** A field name that may address one key of a stored credential set. Narrow on
 *  purpose: it is looked up in JSON the owner typed, never used as a header name. */
function validateFieldName(raw: unknown, what: string): string {
  const f = String(raw ?? '').trim();
  if (!/^[a-z0-9_]{1,32}$/.test(f)) {
    throw new SecretError(`invalid ${what} "${f}" — lower-case letters, digits and underscore, 1-32 chars`);
  }
  return f;
}

function validateInjection(injection: SecretInjection): SecretInjection {
  const kind = injection?.kind;
  if (kind === 'none') return { kind: 'none' };
  if (kind === 'bearer') return { kind: 'bearer' };
  if (kind === 'basic') {
    const i = injection as { usernameField?: string; passwordField?: string };
    return {
      kind: 'basic',
      usernameField: validateFieldName(i.usernameField ?? 'username', 'username field'),
      passwordField: validateFieldName(i.passwordField ?? 'password', 'password field'),
    };
  }
  if (kind === 'header' || kind === 'query') {
    const name = String((injection as { name?: string }).name ?? '').trim();
    if (!name) throw new SecretError(`injection kind "${kind}" needs a name`);
    // No CRLF / separators smuggled into a header name or query key.
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
      throw new SecretError(`invalid ${kind} name "${name}" — letters, digits, dot, dash, underscore only`);
    }
    const rawField = (injection as { field?: string }).field;
    const field = rawField === undefined || rawField === null || rawField === ''
      ? undefined
      : validateFieldName(rawField, `${kind} field`);
    return kind === 'header' ? { kind: 'header', name, field } : { kind: 'query', name, field };
  }
  throw new SecretError(
    'injection must be {kind:"bearer"} | {kind:"header",name,field?} | {kind:"query",name,field?} | ' +
      '{kind:"basic",usernameField?,passwordField?} | {kind:"none"}',
  );
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

/**
 * Refuse a `ref` row for an OAuth provider whose companion vault row is absent.
 *
 * The two rows for such a provider are one credential wearing two hats: the
 * `<provider>-oauth` vault row holds the client_id/client_secret/refresh_token,
 * and the `<provider>` ref row mints a short-lived access token from it on every
 * request (see oauth-refresh.ts). A ref row on its own is not a credential — it
 * is a handle that resolves to nothing, and every node that references it fails
 * at RUN time with "no credential stored", long after whoever created it has
 * moved on.
 *
 * That is not hypothetical. On 2026-08-02 a migration created the `truelayer`
 * and `paypal` ref rows by direct SQL, leaving the vault halves to be entered
 * later by hand. They never were, nothing surfaced the half-registered state,
 * and the daily-spend-summary canvas failed silently on a cron for a day.
 * Writing the rows in the wrong order is the easiest mistake to make here, so
 * make it impossible rather than documenting it: create the credential set
 * first, then the ref row that mints from it.
 */
async function assertCompanionVaultRow(refKey: string): Promise<void> {
  const provider = OAUTH_PROVIDERS[refKey as keyof typeof OAUTH_PROVIDERS];
  if (!provider) return;

  const [companion] = await db
    .select()
    .from(apiSecrets)
    .where(eq(apiSecrets.handle, provider.vaultHandle))
    .limit(1);

  if (!companion?.payloadEnc) {
    throw new SecretError(
      `"${refKey}" mints its access token from the stored credential set "${provider.vaultHandle}", ` +
        `and that ${companion ? 'row has no value stored' : 'credential has not been added yet'}. ` +
        `Add "${provider.vaultHandle}" first — a store-only credential bound to "${provider.tokenHost}", ` +
        `whose value is a JSON object with client_id, client_secret` +
        `${refKey === 'truelayer' ? ' and refresh_token' : ''} — then save this one. ` +
        `A ref row without it resolves to nothing and every node using it fails at run time.`,
    );
  }
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
      hint = hintOf(value);
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
    await assertCompanionVaultRow(key);
    // A ref source can be legitimately unresolvable at write time (an env var
    // not set on this host, a provider outage). That must not 500 the save —
    // `toMeta` already reports it as unavailable — so only the hint is lost.
    try {
      const resolved = await REF_SOURCES[key].resolve();
      hint = resolved && resolved.length > 4 ? resolved.slice(-4) : null;
    } catch {
      hint = null;
    }
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
    allowedMethods: effectiveMethods(input.allowedMethods),
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

  // Deleting the credential set out from under its ref row recreates exactly the
  // half-registered state `assertCompanionVaultRow` exists to prevent — the ref
  // row survives, still looks registered, and fails at run time. Remove the ref
  // row first; it is the one that is safe to lose, since it holds no value.
  const orphaned = Object.entries(OAUTH_PROVIDERS).find(([, p]) => p.vaultHandle === h);
  if (orphaned) {
    const [refRow] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, orphaned[0])).limit(1);
    if (refRow) {
      throw new SecretError(
        `"${orphaned[0]}" mints its access token from this credential set, so deleting it would leave ` +
          `that handle registered but broken. Delete "${orphaned[0]}" first, then this one.`,
      );
    }
  }

  await db.delete(apiSecrets).where(eq(apiSecrets.handle, h));
  return true;
}

// ---------------------------------------------------------------------------
// Narrow update primitives
//
// `upsertSecret` is a WIDE write: it rewrites allowedHosts, allowedMethods,
// injection and label unconditionally while the value stays optional. That is
// fine for the owner's admin form, where every field is on screen, but it is the
// wrong primitive for "jkai asks to change one thing" — routing an update
// through it means a request that only meant to rotate a value silently
// restates the entire binding, and any bug in assembling that restatement
// re-points a live credential.
//
// So updates get three primitives, each of which can only touch its own slice:
//
//   rotateSecretValue      value + hint + updatedAt.  No binding surface AT ALL.
//   amendSecretValueFields same, for one key of a multi-field credential set.
//   updateSecretBinding    hosts / methods / paths.   Never touches the value.
//
// None of them can change `injection`, `source` or `refKey`. Injection in
// particular is deliberately immutable here: flipping a store-only credential
// SET from {kind:'none'} to {kind:'bearer'} would paste an entire client_id +
// client_secret + refresh_token JSON blob into an Authorization header for any
// caller that resolved it. That change stays an owner action at /admin/ai/apis.
// ---------------------------------------------------------------------------

/**
 * Last-4 identification hint, or null when there is nothing useful to show.
 *
 * A credential SET gets no hint at all: the last four characters of a JSON blob
 * are `"..."}`, which identifies nothing, and the fields it holds are named in
 * the catalogue anyway.
 */
function hintOf(value: string): string | null {
  if (value.trim().startsWith('{')) return null;
  return value.length > 4 ? value.slice(-4) : null;
}

async function requireVaultRow(handle: string): Promise<ApiSecretRow> {
  const h = normaliseHandle(handle);
  if (!h) throw new SecretError('handle is required');
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, h)).limit(1);
  if (!row) {
    throw new SecretError(
      `no secret registered under the handle "${handle}" — use api_secrets_list to see which handles exist`,
    );
  }
  if (row.source !== 'vault') {
    // A `ref` row has no stored value: it resolves from keys.json or an env var
    // on this host every time it is used. There is nothing here to rotate, and
    // writing one through would materialise a plaintext keys.json (which is
    // gitignored AND outside the restic backup set).
    const ref = REF_SOURCES[row.refKey ?? ''];
    throw new SecretError(
      `secret "${row.handle}" is a ref row — its value is not stored in the registry, it resolves from ` +
        `${ref?.label ?? `the ref source "${row.refKey}"`} on this host. Rotate it where it actually lives.`,
    );
  }
  return row;
}

/**
 * Replace a vault secret's stored value. Nothing else about the row changes —
 * not the host binding, not the methods, not the injection.
 */
export async function rotateSecretValue(handle: string, value: string): Promise<SecretMeta> {
  const row = await requireVaultRow(handle);
  const v = String(value ?? '').trim();
  if (!v) throw new SecretError('value is empty');

  await db
    .update(apiSecrets)
    .set({ payloadEnc: encryptPayload(v), hint: hintOf(v), updatedAt: new Date() })
    .where(eq(apiSecrets.handle, row.handle));

  const meta = await getSecretMeta(row.handle);
  if (!meta) throw new SecretError('secret update failed');
  return meta;
}

/**
 * Merge new values into a multi-field credential SET, keeping every field the
 * owner left blank. This is what makes "the refresh token expired" a one-field
 * job instead of re-entering a client_id and client_secret that never changed.
 *
 * The decrypt happens here and the merged blob is re-encrypted immediately; no
 * caller ever receives it, and no error raised on this path quotes any part of
 * it.
 */
export async function amendSecretValueFields(
  handle: string,
  patch: Record<string, string>,
): Promise<SecretMeta> {
  const row = await requireVaultRow(handle);
  if (!row.payloadEnc) throw new SecretError(`secret "${row.handle}" has no stored value to amend`);

  const updates = Object.entries(patch ?? {})
    .map(([k, v]) => [String(k), String(v ?? '').trim()] as const)
    .filter(([k, v]) => k !== '' && v !== '');
  if (updates.length === 0) throw new SecretError('no fields were supplied to change');

  let current: Record<string, unknown>;
  try {
    const parsed = JSON.parse(decryptPayload(row.payloadEnc));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    current = parsed as Record<string, unknown>;
  } catch {
    // Deliberately says nothing about what the value IS beyond "not a field set".
    throw new SecretError(
      `secret "${row.handle}" holds a single value, not a multi-field set — replace the whole value instead of amending a field`,
    );
  }

  for (const [k, v] of updates) current[k] = v;
  const merged = JSON.stringify(current);

  await db
    .update(apiSecrets)
    .set({ payloadEnc: encryptPayload(merged), hint: hintOf(merged), updatedAt: new Date() })
    .where(eq(apiSecrets.handle, row.handle));

  const meta = await getSecretMeta(row.handle);
  if (!meta) throw new SecretError('secret update failed');
  return meta;
}

export interface SecretBinding {
  allowedHosts: string[];
  allowedMethods: string[];
  allowedPathPrefixes: string[];
}

/**
 * Change where a credential may be sent. Never touches `payloadEnc`, `hint`,
 * `source`, `refKey` or `injection` — so this cannot rotate a value, and it
 * cannot turn a store-only credential set into an injectable one.
 */
export async function updateSecretBinding(handle: string, binding: SecretBinding): Promise<SecretMeta> {
  const h = normaliseHandle(handle);
  if (!h) throw new SecretError('handle is required');
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, h)).limit(1);
  if (!row) throw new SecretError(`no secret registered under the handle "${handle}"`);

  const allowedHosts = validateHosts(binding.allowedHosts);
  const allowedPathPrefixes = (binding.allowedPathPrefixes ?? [])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : '/' + p));

  await db
    .update(apiSecrets)
    .set({
      allowedHosts,
      allowedPathPrefixes,
      allowedMethods: effectiveMethods(binding.allowedMethods),
      updatedAt: new Date(),
    })
    .where(eq(apiSecrets.handle, h));

  const meta = await getSecretMeta(h);
  if (!meta) throw new SecretError('secret update failed');
  return meta;
}

// ---------------------------------------------------------------------------
// Binding-change classification
//
// Splits a proposed binding into "strictly reduces reach" and "extends reach".
// The distinction drives the modal: narrowing is one click, widening a HOST
// makes the owner type the hostname themselves, because a new host is the one
// change that can carry a credential somewhere it has never been.
// ---------------------------------------------------------------------------

export interface BindingChange {
  addedHosts: string[];
  removedHosts: string[];
  addedMethods: string[];
  removedMethods: string[];
  addedPathPrefixes: string[];
  removedPathPrefixes: string[];
  /** True when the proposal reaches anywhere the current binding does not. */
  widens: boolean;
  /** True when it reaches a HOST the current binding does not — the exfil case. */
  widensHosts: boolean;
}

/** Is `pattern` already fully covered by an existing allow-list entry? */
function patternCovered(pattern: string, current: string[]): boolean {
  const p = normaliseHost(pattern);
  if (current.some((c) => normaliseHost(c) === p)) return true;
  // A concrete host is covered by an existing wildcard over its parent domain.
  // A wildcard is NEVER covered by a concrete host — `*.example.com` reaches
  // strictly more than `api.example.com`.
  if (p.startsWith('*.')) return false;
  return current.some((c) => normaliseHost(c).startsWith('*.') && hostMatchesPattern(p, c));
}

export function classifyBindingChange(current: SecretBinding, proposed: SecretBinding): BindingChange {
  const curHosts = (current.allowedHosts ?? []).map(normaliseHost);
  const propHosts = (proposed.allowedHosts ?? []).map(normaliseHost);
  const curMethods = effectiveMethods(current.allowedMethods);
  const propMethods = effectiveMethods(proposed.allowedMethods);
  const curPaths = current.allowedPathPrefixes ?? [];
  const propPaths = proposed.allowedPathPrefixes ?? [];

  const addedHosts = propHosts.filter((h) => !patternCovered(h, curHosts));
  const removedHosts = curHosts.filter((h) => !propHosts.includes(h));
  const addedMethods = propMethods.filter((m) => !curMethods.includes(m));
  const removedMethods = curMethods.filter((m) => !propMethods.includes(m));

  // An EMPTY prefix list means "any path". So []→['/v1'] narrows, and
  // ['/v1']→[] widens to the whole host. A proposed prefix is non-widening only
  // when it sits underneath one the owner already allowed.
  const addedPathPrefixes =
    curPaths.length === 0 ? [] : propPaths.filter((p) => !pathAllowed(p, curPaths));
  const removedPathPrefixes = curPaths.filter((c) => !propPaths.some((p) => pathAllowed(p, [c])));
  const pathsWiden = curPaths.length > 0 && (propPaths.length === 0 || addedPathPrefixes.length > 0);

  const widensHosts = addedHosts.length > 0;
  return {
    addedHosts,
    removedHosts,
    addedMethods,
    removedMethods,
    addedPathPrefixes,
    removedPathPrefixes,
    widens: widensHosts || addedMethods.length > 0 || pathsWiden,
    widensHosts,
  };
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

/** Empty/absent list means read-only: a credential does nothing but GET/HEAD until the owner widens it. */
function effectiveMethods(methods: string[] | null | undefined): string[] {
  const list = (methods ?? []).map((m) => String(m).toUpperCase()).filter(Boolean);
  return list.length > 0 ? list : ['GET', 'HEAD'];
}

/** The host/path/method binding check, shared by resolution and per-redirect-hop re-checks. */
function assertBindingAllows(row: ApiSecretRow, url: string, method?: string): void {
  // A store-only row holds a credential SET for one server module to read. It is
  // never attached to an outbound request, so every resolution path refuses it
  // before any binding maths — otherwise the whole JSON blob would be injected.
  if (injectionOf(row).kind === 'none') {
    throw new SecretError(
      `secret "${row.handle}" is store-only and is never attached to a request. ` +
        `It holds a credential set for a specific server module to read.`,
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
  const allowed = effectiveMethods(row.allowedMethods);
  const m = String(method ?? 'GET').toUpperCase();
  if (!allowed.includes(m)) {
    throw new SecretError(
      `secret "${row.handle}" may only authenticate ${allowed.join('/')} requests, not ${m}. ` +
        `Path scoping limits where a key goes; this limits what it can do. Widen it at /admin/ai/apis if that is intended.`,
    );
  }
}

/**
 * Re-check a secret's binding against a NEW url without resolving the value or
 * touching usage counters. Called for every redirect hop that still carries the
 * credential: path scoping would otherwise be a one-hop guarantee, and a
 * same-origin 302 from an in-scope path to an out-of-scope one (say
 * /api/v1/credits -> /api/v1/chat/completions) would carry the key somewhere the
 * owner deliberately excluded.
 */
export async function assertSecretAllowedForUrl(handle: string, url: string, method?: string): Promise<void> {
  const h = normaliseHandle(handle);
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, h)).limit(1);
  if (!row) throw new SecretError(`no secret registered under the handle "${handle}"`);
  assertBindingAllows(row, url, method);
}

/**
 * A stored credential SET — the JSON object a multi-field credential is kept as.
 *
 * Storage is deliberately unchanged: one encrypted string per row, holding JSON
 * when the credential has more than one part. That is the shape
 * `oauth-refresh.ts` has read since the OAuth work, so nothing about the
 * database, the crypto or the "no caller ever receives a value" contract moves
 * to support multi-field credentials.
 */
function parseCredentialSet(handle: string, value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SecretError(
      `secret "${handle}" is configured to send one field of a credential set, but its stored value is a ` +
        `single value, not a set. Re-enter it with the fields the API needs, or bind it as a whole-value credential.`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SecretError(`secret "${handle}" does not hold a credential set (expected a JSON object).`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  }
  return out;
}

function requiredField(handle: string, set: Record<string, string>, field: string): string {
  const v = (set[field] ?? '').trim();
  if (!v) {
    // Names the missing FIELD, never a value or any other field's content.
    throw new SecretError(
      `secret "${handle}" has no "${field}" in its stored credential set. ` +
        `Ask the owner to update it (update_credential with change="value") and fill that field in.`,
    );
  }
  return v;
}

/**
 * Turn a resolved value into the headers/query it authenticates with.
 *
 * Pure and exported so the composition rules — especially which plaintexts the
 * caller must scrub back out — are testable without a database. `plaintexts`
 * carries every secret string that reached the wire, including composed forms
 * like the base64 of a Basic pair, because a response echoing either would
 * otherwise slip past the scrubber.
 */
export function composeInjection(
  handle: string,
  injection: SecretInjection,
  value: string,
): { headers: Record<string, string>; query: Record<string, string>; plaintexts: string[] } {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};

  if (injection.kind === 'bearer') {
    headers.Authorization = `Bearer ${value}`;
    return { headers, query, plaintexts: [value] };
  }

  if (injection.kind === 'basic') {
    const set = parseCredentialSet(handle, value);
    const user = requiredField(handle, set, injection.usernameField ?? 'username');
    const pass = requiredField(handle, set, injection.passwordField ?? 'password');
    const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${encoded}`;
    // The password, the composed pair and its base64 all count as plaintext.
    // The username does not: it is frequently a customer id that appears in
    // ordinary response bodies, and scrubbing it would corrupt them.
    return { headers, query, plaintexts: [pass, `${user}:${pass}`, encoded] };
  }

  if (injection.kind === 'header' || injection.kind === 'query') {
    const sent = injection.field
      ? requiredField(handle, parseCredentialSet(handle, value), injection.field)
      : value;
    if (injection.kind === 'header') headers[injection.name] = sent;
    else query[injection.name] = sent;
    return { headers, query, plaintexts: [sent] };
  }

  // 'none' is unreachable from resolveSecretForUrl — assertBindingAllows throws
  // on store-only rows first. Kept explicit so adding a kind is a compile error
  // here rather than a silent fall-through that injects a value in the wrong place.
  throw new SecretError(`secret "${handle}" has no injectable form`);
}

/**
 * Resolve a secret for a specific request URL, enforcing the owner-set host and
 * path binding. Throws (never returns a partial result) if the binding fails.
 *
 * The URL passed here MUST be the final request URL. Callers that follow
 * redirects must re-check every hop with `assertSecretAllowedForUrl` — see
 * `guardedFetch` in site-tools/tools/apis.ts, which additionally refuses to
 * carry a registry secret across an origin change at all.
 */
export async function resolveSecretForUrl(handle: string, url: string, method?: string): Promise<ResolvedSecret> {
  const h = normaliseHandle(handle);
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, h)).limit(1);
  if (!row) {
    throw new SecretError(
      `no secret registered under the handle "${handle}". The owner adds credentials at /admin/ai/apis; ` +
        `use api_secrets_list to see which handles exist and which hosts they are bound to.`,
    );
  }

  assertBindingAllows(row, url, method);

  const value = await resolveValue(row);
  const { headers, query, plaintexts } = composeInjection(row.handle, injectionOf(row), value);

  void noteSecretUse(h);

  return { handle: row.handle, headers, query, plaintexts };
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
