# Curate Foundation — Generic Integrations Infrastructure (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the reusable integrations layer that the curate experience will sit on top of — generic credentials store with AES-256-GCM encryption, generic OAuth callback / options / test routes, an admin UI, and three new panel widgets — without any curate-specific code.

**Architecture:** A single `integrationCredentials` table backs all current and future third-party integrations (Apple Calendar, Trello, Notion, …). A small **integration adapter registry** lets each integration plug in its own OAuth config, options resolver, and test handler without bespoke routes per service. New widgets sit in `src/lib/canvas/nodes/panels/widgets/` alongside existing ones (`ResourcePicker`, `TemplatedInput`, …) and follow the same Svelte 5 + project design-system patterns.

**Tech Stack:** SvelteKit 2 + Svelte 5, TypeScript, Drizzle ORM (Postgres 16), `node:crypto` (AES-256-GCM mirroring `src/lib/workflows/gmail/crypto.ts`), vitest for tests.

**Reference spec:** `docs/plans/curate-experience.md` §4.3, §4.4, §5.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/integrations/crypto.ts` | AES-256-GCM `encryptPayload` / `decryptPayload`. Reads `INTEGRATION_CREDENTIALS_KEY` (32-byte hex). |
| `src/lib/integrations/types.ts` | `CredentialKind`, `CredentialPayload<K>`, `IntegrationCredential`, `IntegrationAdapter` types. |
| `src/lib/integrations/credentials.ts` | CRUD service: `createCredential`, `listCredentials`, `getCredential` (decrypts), `updateCredential`, `deleteCredential`, `ensureFreshAccessToken`. |
| `src/lib/integrations/registry.ts` | Adapter registry: `registerIntegrationAdapter(adapter)`, `getIntegrationAdapter(type)`. Empty adapter set on day one — adapters get registered as integrations are added (curate / hand-written nodes). |
| `src/lib/integrations/index.ts` | Barrel export. |
| `src/routes/api/integrations/oauth/[integrationType]/start/+server.ts` | Begins an OAuth flow: builds the auth URL using the adapter's `oauthSpec`, persists `state` + label, returns redirect. |
| `src/routes/api/integrations/oauth/[integrationType]/callback/+server.ts` | Handles the OAuth code exchange, writes/updates a credential row. |
| `src/routes/api/integrations/options/[integrationType]/[fieldName]/+server.ts` | Generic resource-picker resolver. Dispatches to `adapter.resolveOptions(fieldName, credentialId)`. |
| `src/routes/api/integrations/test/[integrationType]/+server.ts` | Generic credential health-check. Dispatches to `adapter.testCredential(credentialId)`. |
| `src/routes/admin/integrations/+page.server.ts` | Admin loader: lists credentials grouped by `integrationType`. |
| `src/routes/admin/integrations/+page.svelte` | Admin UI. |
| `src/routes/admin/integrations/[id]/+server.ts` | PATCH (rename / update metadata) and DELETE handlers for a credential row. |
| `src/lib/canvas/nodes/panels/widgets/CredentialPicker.svelte` | Dropdown filtered by `integrationType` + "+ New" inline form. |
| `src/lib/canvas/nodes/panels/widgets/CredentialStatusBanner.svelte` | Inline banner: "Credential expired — re-authenticate" / "OK" / "Untested". |
| `src/lib/canvas/nodes/panels/widgets/TestConnectionAction.svelte` | "Test credential" button that calls the generic test endpoint and shows result inline. |
| `tests/lib/integrations/crypto.test.ts` | Round-trip + tamper-detection tests. |
| `tests/lib/integrations/credentials.test.ts` | Service-level tests against a test DB (or mocked Drizzle). |
| `tests/lib/integrations/oauth-callback.test.ts` | OAuth callback handler tests with a stub adapter. |

### Files to modify

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | Add `integrationCredentials` and `integrationOauthConfigs` tables. |
| `.env.example` | Add `INTEGRATION_CREDENTIALS_KEY` line with documentation. |

---

## Pre-flight

- [ ] **Step 0a: Generate the encryption key** (one-time, locally)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save the output as `INTEGRATION_CREDENTIALS_KEY` in your local `.env` (and the prod `.env` on the VPS — the same key must exist on both, or encrypted rows written on one machine can't be decrypted on the other).

- [ ] **Step 0b: Add to `.env.example`**

Edit `.env.example` and append:

```
# AES-256-GCM key for encrypting integrationCredentials payloads.
# 32 bytes as 64 hex chars. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# WARNING: losing this key makes every integrationCredentials row unrecoverable.
INTEGRATION_CREDENTIALS_KEY=
```

- [ ] **Step 0c: Commit**

```bash
git add .env.example
git commit -m "chore(integrations): document INTEGRATION_CREDENTIALS_KEY env var"
```

---

## Phase 1 — Database schema

### Task 1: Add `integrationCredentials` and `integrationOauthConfigs` tables

**Files:**
- Modify: `src/lib/db/schema.ts` (append at end)

- [ ] **Step 1: Add the table definitions**

Open `src/lib/db/schema.ts` and append (at the bottom of the file, after the last existing table):

```ts
// ── Integrations ────────────────────────────────────────────────────────

export const integrationCredentials = pgTable('integration_credentials', {
  id: text('id').primaryKey(), // uuid (caller-provided via crypto.randomUUID())
  integrationType: text('integration_type').notNull(),
  label: text('label').notNull(),
  kind: text('kind').notNull(), // 'apikey' | 'basic' | 'oauth2'
  // Encrypted JSON: format `${iv-hex}:${tag-hex}:${ciphertext-hex}` produced
  // by src/lib/integrations/crypto.ts. Shape of the decrypted JSON depends
  // on `kind` — see CredentialPayload<K> in src/lib/integrations/types.ts.
  payloadEnc: text('payload_enc').notNull(),
  // Non-secret config (e.g. CalDAV server URL, OAuth callback override).
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  // Health tracking — written by /api/integrations/test/[integrationType].
  lastTestedAt: timestamp('last_tested_at'),
  lastTestStatus: text('last_test_status'), // 'ok' | 'failed' | null
  lastTestError: text('last_test_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  byType: index('integration_credentials_type_idx').on(t.integrationType),
}));

export const integrationOauthConfigs = pgTable('integration_oauth_configs', {
  integrationType: text('integration_type').primaryKey(),
  authorizationUrl: text('authorization_url').notNull(),
  tokenUrl: text('token_url').notNull(),
  defaultScopes: jsonb('default_scopes').$type<string[]>().notNull().default([]),
  clientIdEnvVar: text('client_id_env_var').notNull(),
  clientSecretEnvVar: text('client_secret_env_var').notNull(),
  // Used to construct the absolute callback URL when redirecting to the
  // provider. Defaults to env.PUBLIC_BASE_URL + the generic callback path.
  callbackUrlOverride: text('callback_url_override'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type IntegrationCredentialRow = typeof integrationCredentials.$inferSelect;
export type IntegrationOauthConfigRow = typeof integrationOauthConfigs.$inferSelect;
```

- [ ] **Step 2: Push schema to local Postgres**

Run:

```bash
npx drizzle-kit push
```

Expected: prompts to create the two new tables. Confirm. Output ends with `Changes applied`.

- [ ] **Step 3: Verify tables exist**

Run:

```bash
psql -d strange_rambling -c '\d integration_credentials' && psql -d strange_rambling -c '\d integration_oauth_configs'
```

Expected: both `\d` commands return non-empty schemas. (If your DB connection differs, adjust the psql args — see your existing `.env` for DATABASE_URL.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(db): add integrationCredentials + integrationOauthConfigs tables"
```

---

## Phase 2 — Crypto + service layer

### Task 2: Crypto helpers

**Files:**
- Create: `src/lib/integrations/crypto.ts`
- Test: `tests/lib/integrations/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/integrations/crypto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';

// 32 random bytes as hex (deterministic for tests).
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
});

describe('integrations/crypto', () => {
  it('round-trips a payload', async () => {
    const { encryptPayload, decryptPayload } = await import('$lib/integrations/crypto');
    const plain = JSON.stringify({ username: 'john', password: 'hunter2' });
    const enc = encryptPayload(plain);
    expect(enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(decryptPayload(enc)).toBe(plain);
  });

  it('detects tampering via auth tag', async () => {
    const { encryptPayload, decryptPayload } = await import('$lib/integrations/crypto');
    const enc = encryptPayload('hello');
    const [iv, tag, ct] = enc.split(':');
    // Flip the last byte of ciphertext.
    const flippedCt = ct.slice(0, -2) + (ct.slice(-2) === 'ff' ? '00' : 'ff');
    const tampered = `${iv}:${tag}:${flippedCt}`;
    expect(() => decryptPayload(tampered)).toThrow();
  });

  it('rejects malformed encrypted strings', async () => {
    const { decryptPayload } = await import('$lib/integrations/crypto');
    expect(() => decryptPayload('not-a-real-cipher')).toThrow(/Malformed/);
  });

  it('rejects a missing or wrong-length key', async () => {
    const original = process.env.INTEGRATION_CREDENTIALS_KEY;
    process.env.INTEGRATION_CREDENTIALS_KEY = 'tooshort';
    // Re-import to pick up the new env (vitest caches modules).
    await expect(async () => {
      const mod = await import('$lib/integrations/crypto?bust=' + Date.now());
      mod.encryptPayload('x');
    }).rejects.toThrow(/64 hex chars/);
    process.env.INTEGRATION_CREDENTIALS_KEY = original;
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run:

```bash
npm test -- tests/lib/integrations/crypto.test.ts
```

Expected: FAIL with "Cannot find module '$lib/integrations/crypto'" (or similar). The module doesn't exist yet.

- [ ] **Step 3: Implement crypto.ts**

Create `src/lib/integrations/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('INTEGRATION_CREDENTIALS_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** Format: `<iv-hex>:<auth-tag-hex>:<ciphertext-hex>`. */
export function encryptPayload(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptPayload(enc: string): string {
  const parts = enc.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted payload');
  const [ivH, tagH, ctH] = parts;
  if (!ivH || !tagH || !ctH) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- tests/lib/integrations/crypto.test.ts
```

Expected: all 4 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/crypto.ts tests/lib/integrations/crypto.test.ts
git commit -m "feat(integrations): AES-256-GCM crypto helpers for credentials"
```

### Task 3: Type definitions

**Files:**
- Create: `src/lib/integrations/types.ts`

- [ ] **Step 1: Write the types**

Create `src/lib/integrations/types.ts`:

```ts
import type { IntegrationCredentialRow } from '$lib/db/schema';

export type CredentialKind = 'apikey' | 'basic' | 'oauth2';

export type CredentialPayload<K extends CredentialKind = CredentialKind> =
  K extends 'apikey'
    ? { key: string }
    : K extends 'basic'
      ? { username: string; password: string }
      : K extends 'oauth2'
        ? {
            accessToken: string;
            refreshToken: string;
            expiresAt: number; // unix epoch ms
            scopes?: string[];
          }
        : never;

/** Decrypted-and-typed view of a row. */
export type IntegrationCredential<K extends CredentialKind = CredentialKind> =
  Omit<IntegrationCredentialRow, 'payloadEnc' | 'kind'> & {
    kind: K;
    payload: CredentialPayload<K>;
  };

/** Adapter for one specific integration type (e.g. 'apple-calendar'). */
export interface IntegrationAdapter {
  integrationType: string;
  /** Optional. Required if `kind === 'oauth2'`. */
  oauthSpec?: {
    authorizationUrl: string;
    tokenUrl: string;
    defaultScopes: string[];
    clientIdEnvVar: string;
    clientSecretEnvVar: string;
    /** Build extra query params for the auth-url (e.g. PKCE, response_type). */
    extraAuthParams?: () => Record<string, string>;
  };
  /**
   * Resolves dropdown options for a `resource-picker` widget.
   * Called from /api/integrations/options/[integrationType]/[fieldName].
   * Returns an array of `{ value, label }`.
   */
  resolveOptions?: (
    fieldName: string,
    credentialId: string,
  ) => Promise<{ value: string; label: string }[]>;
  /**
   * Health-check. Called from /api/integrations/test/[integrationType].
   * Resolves on success; rejects with a human-readable error message
   * if the credential is invalid / expired / unreachable.
   */
  testCredential?: (credentialId: string) => Promise<void>;
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run check
```

Expected: PASS, no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/types.ts
git commit -m "feat(integrations): credential + adapter type definitions"
```

### Task 4: Adapter registry

**Files:**
- Create: `src/lib/integrations/registry.ts`

- [ ] **Step 1: Write the registry**

Create `src/lib/integrations/registry.ts`:

```ts
import type { IntegrationAdapter } from './types';

const adapters = new Map<string, IntegrationAdapter>();

export function registerIntegrationAdapter(adapter: IntegrationAdapter): void {
  if (adapters.has(adapter.integrationType)) {
    throw new Error(
      `Integration adapter already registered: ${adapter.integrationType}`,
    );
  }
  adapters.set(adapter.integrationType, adapter);
}

export function getIntegrationAdapter(integrationType: string): IntegrationAdapter | undefined {
  return adapters.get(integrationType);
}

export function listIntegrationAdapters(): IntegrationAdapter[] {
  return Array.from(adapters.values());
}

/** Test-only: clears the registry so test files can register fresh adapters. */
export function __clearIntegrationAdapters(): void {
  adapters.clear();
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/registry.ts
git commit -m "feat(integrations): adapter registry"
```

### Task 5: Credentials service

**Files:**
- Create: `src/lib/integrations/credentials.ts`
- Test: `tests/lib/integrations/credentials.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/integrations/credentials.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
});

// These tests run against the dev DB. They isolate by using a synthetic
// integrationType prefixed with 'test-' and clean up between tests.
const TEST_TYPE_PREFIX = 'test-creds-';

beforeEach(async () => {
  const { db } = await import('$lib/db');
  const { integrationCredentials } = await import('$lib/db/schema');
  const { like } = await import('drizzle-orm');
  await db
    .delete(integrationCredentials)
    .where(like(integrationCredentials.integrationType, `${TEST_TYPE_PREFIX}%`));
});

describe('integrations/credentials', () => {
  it('creates and retrieves a basic credential', async () => {
    const { createCredential, getCredential } = await import('$lib/integrations/credentials');
    const integrationType = `${TEST_TYPE_PREFIX}basic`;
    const id = await createCredential({
      integrationType,
      label: 'My Test',
      kind: 'basic',
      payload: { username: 'john', password: 's3cret' },
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const got = await getCredential(id);
    expect(got).not.toBeNull();
    expect(got!.kind).toBe('basic');
    expect(got!.label).toBe('My Test');
    expect(got!.payload).toEqual({ username: 'john', password: 's3cret' });
  });

  it('lists credentials filtered by integrationType', async () => {
    const { createCredential, listCredentials } = await import('$lib/integrations/credentials');
    const t = `${TEST_TYPE_PREFIX}list`;
    await createCredential({ integrationType: t, label: 'A', kind: 'apikey', payload: { key: 'k1' } });
    await createCredential({ integrationType: t, label: 'B', kind: 'apikey', payload: { key: 'k2' } });
    const list = await listCredentials(t);
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.label).sort()).toEqual(['A', 'B']);
    // listCredentials must NOT decrypt payloads (it returns row metadata only).
    expect((list[0] as unknown as { payload?: unknown }).payload).toBeUndefined();
  });

  it('updates label and payload', async () => {
    const { createCredential, updateCredential, getCredential } = await import('$lib/integrations/credentials');
    const t = `${TEST_TYPE_PREFIX}update`;
    const id = await createCredential({ integrationType: t, label: 'old', kind: 'apikey', payload: { key: 'k1' } });
    await updateCredential(id, { label: 'new', payload: { key: 'k2' } });
    const got = await getCredential(id);
    expect(got!.label).toBe('new');
    expect(got!.payload).toEqual({ key: 'k2' });
  });

  it('deletes', async () => {
    const { createCredential, deleteCredential, getCredential } = await import('$lib/integrations/credentials');
    const t = `${TEST_TYPE_PREFIX}delete`;
    const id = await createCredential({ integrationType: t, label: 'gone', kind: 'apikey', payload: { key: 'x' } });
    await deleteCredential(id);
    expect(await getCredential(id)).toBeNull();
  });

  it('returns null for unknown id', async () => {
    const { getCredential } = await import('$lib/integrations/credentials');
    expect(await getCredential('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/lib/integrations/credentials.test.ts
```

Expected: module-not-found / function-not-defined errors.

- [ ] **Step 3: Implement the service**

Create `src/lib/integrations/credentials.ts`:

```ts
import { db } from '$lib/db';
import { integrationCredentials } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptPayload, decryptPayload } from './crypto';
import type {
  CredentialKind,
  CredentialPayload,
  IntegrationCredential,
} from './types';

interface CreateInput<K extends CredentialKind> {
  integrationType: string;
  label: string;
  kind: K;
  payload: CredentialPayload<K>;
  metadata?: Record<string, unknown>;
}

export async function createCredential<K extends CredentialKind>(
  input: CreateInput<K>,
): Promise<string> {
  const id = crypto.randomUUID();
  const payloadEnc = encryptPayload(JSON.stringify(input.payload));
  const now = new Date();
  await db.insert(integrationCredentials).values({
    id,
    integrationType: input.integrationType,
    label: input.label,
    kind: input.kind,
    payloadEnc,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getCredential<K extends CredentialKind = CredentialKind>(
  id: string,
): Promise<IntegrationCredential<K> | null> {
  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(eq(integrationCredentials.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const payload = JSON.parse(decryptPayload(row.payloadEnc)) as CredentialPayload<K>;
  return {
    id: row.id,
    integrationType: row.integrationType,
    label: row.label,
    kind: row.kind as K,
    metadata: row.metadata,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    payload,
  };
}

/** Returns row-level metadata only, never decrypted payloads. */
export async function listCredentials(integrationType?: string) {
  const q = db.select({
    id: integrationCredentials.id,
    integrationType: integrationCredentials.integrationType,
    label: integrationCredentials.label,
    kind: integrationCredentials.kind,
    metadata: integrationCredentials.metadata,
    lastTestedAt: integrationCredentials.lastTestedAt,
    lastTestStatus: integrationCredentials.lastTestStatus,
    lastTestError: integrationCredentials.lastTestError,
    createdAt: integrationCredentials.createdAt,
    updatedAt: integrationCredentials.updatedAt,
  }).from(integrationCredentials);
  if (integrationType) {
    return q.where(eq(integrationCredentials.integrationType, integrationType));
  }
  return q;
}

interface UpdateInput {
  label?: string;
  payload?: CredentialPayload;
  metadata?: Record<string, unknown>;
  lastTestedAt?: Date;
  lastTestStatus?: 'ok' | 'failed' | null;
  lastTestError?: string | null;
}

export async function updateCredential(id: string, patch: UpdateInput): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.payload !== undefined) update.payloadEnc = encryptPayload(JSON.stringify(patch.payload));
  if (patch.metadata !== undefined) update.metadata = patch.metadata;
  if (patch.lastTestedAt !== undefined) update.lastTestedAt = patch.lastTestedAt;
  if (patch.lastTestStatus !== undefined) update.lastTestStatus = patch.lastTestStatus;
  if (patch.lastTestError !== undefined) update.lastTestError = patch.lastTestError;
  await db.update(integrationCredentials).set(update).where(eq(integrationCredentials.id, id));
}

export async function deleteCredential(id: string): Promise<void> {
  await db.delete(integrationCredentials).where(eq(integrationCredentials.id, id));
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/lib/integrations/credentials.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/credentials.ts tests/lib/integrations/credentials.test.ts
git commit -m "feat(integrations): credentials CRUD service"
```

### Task 6: OAuth refresh helper

**Files:**
- Modify: `src/lib/integrations/credentials.ts`
- Test: `tests/lib/integrations/credentials.test.ts` (extend)

- [ ] **Step 1: Add the failing test**

Append to `tests/lib/integrations/credentials.test.ts`:

```ts
describe('ensureFreshAccessToken', () => {
  it('returns the existing access token when not yet expired', async () => {
    const { createCredential, ensureFreshAccessToken } = await import('$lib/integrations/credentials');
    const id = await createCredential({
      integrationType: `${TEST_TYPE_PREFIX}oauth-fresh`,
      label: 'fresh',
      kind: 'oauth2',
      payload: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 60 * 60 * 1000,
      },
    });
    const token = await ensureFreshAccessToken(id);
    expect(token).toBe('access-1');
  });

  it('refreshes via the adapter when expired', async () => {
    const { createCredential, ensureFreshAccessToken, getCredential } = await import('$lib/integrations/credentials');
    const { registerIntegrationAdapter, __clearIntegrationAdapters } = await import('$lib/integrations/registry');
    __clearIntegrationAdapters();
    const integrationType = `${TEST_TYPE_PREFIX}oauth-stale`;
    process.env.TEST_OAUTH_CLIENT_ID = 'cid';
    process.env.TEST_OAUTH_CLIENT_SECRET = 'csecret';
    let tokenUrlHit: string | undefined;
    const originalFetch = global.fetch;
    global.fetch = (async (url: RequestInfo | URL) => {
      tokenUrlHit = String(url);
      return new Response(
        JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    registerIntegrationAdapter({
      integrationType,
      oauthSpec: {
        authorizationUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        defaultScopes: [],
        clientIdEnvVar: 'TEST_OAUTH_CLIENT_ID',
        clientSecretEnvVar: 'TEST_OAUTH_CLIENT_SECRET',
      },
    });
    const id = await createCredential({
      integrationType,
      label: 'stale',
      kind: 'oauth2',
      payload: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() - 1000,
      },
    });
    const token = await ensureFreshAccessToken(id);
    expect(token).toBe('access-2');
    expect(tokenUrlHit).toBe('https://example.com/token');
    const got = await getCredential(id);
    expect(got!.payload).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
    global.fetch = originalFetch;
  });

  it('throws if credential is not oauth2', async () => {
    const { createCredential, ensureFreshAccessToken } = await import('$lib/integrations/credentials');
    const id = await createCredential({
      integrationType: `${TEST_TYPE_PREFIX}wrong-kind`,
      label: 'x',
      kind: 'apikey',
      payload: { key: 'k' },
    });
    await expect(ensureFreshAccessToken(id)).rejects.toThrow(/oauth2/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/lib/integrations/credentials.test.ts
```

Expected: missing-export errors for `ensureFreshAccessToken`.

- [ ] **Step 3: Implement**

Append to `src/lib/integrations/credentials.ts`:

```ts
import { getIntegrationAdapter } from './registry';

const REFRESH_BUFFER_MS = 60 * 1000; // refresh 1 minute before expiry

export async function ensureFreshAccessToken(id: string): Promise<string> {
  const cred = await getCredential<'oauth2'>(id);
  if (!cred) throw new Error(`Credential not found: ${id}`);
  if (cred.kind !== 'oauth2') {
    throw new Error(`Credential ${id} is not oauth2 (kind=${cred.kind})`);
  }
  const expiresAt = cred.payload.expiresAt;
  if (Date.now() < expiresAt - REFRESH_BUFFER_MS) {
    return cred.payload.accessToken;
  }

  const adapter = getIntegrationAdapter(cred.integrationType);
  if (!adapter || !adapter.oauthSpec) {
    throw new Error(`No OAuth adapter for ${cred.integrationType}`);
  }
  const clientId = process.env[adapter.oauthSpec.clientIdEnvVar];
  const clientSecret = process.env[adapter.oauthSpec.clientSecretEnvVar];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing ${adapter.oauthSpec.clientIdEnvVar} or ${adapter.oauthSpec.clientSecretEnvVar} env var`,
    );
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cred.payload.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(adapter.oauthSpec.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  const newPayload = {
    accessToken: json.access_token as string,
    refreshToken: (json.refresh_token as string | undefined) ?? cred.payload.refreshToken,
    expiresAt: Date.now() + (Number(json.expires_in) * 1000),
    scopes: cred.payload.scopes,
  };
  await updateCredential(id, { payload: newPayload });
  return newPayload.accessToken;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/lib/integrations/credentials.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/credentials.ts tests/lib/integrations/credentials.test.ts
git commit -m "feat(integrations): ensureFreshAccessToken for oauth2 credentials"
```

### Task 7: Index barrel

**Files:**
- Create: `src/lib/integrations/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
export * from './types';
export * from './crypto';
export * from './credentials';
export * from './registry';
```

- [ ] **Step 2: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/index.ts
git commit -m "feat(integrations): index barrel"
```

---

## Phase 3 — Generic API routes

### Task 8: OAuth start

**Files:**
- Create: `src/routes/api/integrations/oauth/[integrationType]/start/+server.ts`

- [ ] **Step 1: Implement**

Create the file:

```ts
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { getIntegrationAdapter } from '$lib/integrations';
import { env as publicEnv } from '$env/dynamic/public';

// In-memory store for in-flight OAuth state. Per-process is fine; OAuth flows
// always complete on the same process that initiated them (the user is
// redirected back to *some* node, but state ties to a single launch).
// If multi-process is ever needed, swap for a small DB table.
const pending = new Map<string, {
  integrationType: string;
  label: string;
  scopes: string[];
  createdAt: number;
}>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function pruneExpired() {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [k, v] of pending) if (v.createdAt < cutoff) pending.delete(k);
}

export const pendingState = pending; // exported for the callback handler

export const POST: RequestHandler = async ({ params, request }) => {
  pruneExpired();
  const integrationType = params.integrationType!;
  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter) throw error(404, `Unknown integrationType: ${integrationType}`);
  if (!adapter.oauthSpec) throw error(400, `${integrationType} does not use OAuth`);

  const body = (await request.json().catch(() => ({}))) as {
    label?: string;
    scopes?: string[];
  };
  const label = body.label ?? `${integrationType} ${new Date().toISOString().slice(0, 10)}`;
  const scopes = body.scopes ?? adapter.oauthSpec.defaultScopes;
  const clientId = process.env[adapter.oauthSpec.clientIdEnvVar];
  if (!clientId) throw error(500, `Missing env var ${adapter.oauthSpec.clientIdEnvVar}`);

  const state = randomBytes(16).toString('hex');
  pending.set(state, { integrationType, label, scopes, createdAt: Date.now() });

  const baseUrl = publicEnv.PUBLIC_BASE_URL || 'http://localhost:5173';
  const callback = adapter.oauthSpec.extraAuthParams?.()['redirect_uri']
    ?? `${baseUrl}/api/integrations/oauth/${integrationType}/callback`;

  const url = new URL(adapter.oauthSpec.authorizationUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
  if (adapter.oauthSpec.extraAuthParams) {
    for (const [k, v] of Object.entries(adapter.oauthSpec.extraAuthParams())) {
      if (k !== 'redirect_uri') url.searchParams.set(k, v);
    }
  }
  return json({ authorizationUrl: url.toString(), state });
};
```

- [ ] **Step 2: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/integrations/oauth/[integrationType]/start/+server.ts
git commit -m "feat(integrations): generic OAuth start endpoint"
```

### Task 9: OAuth callback

**Files:**
- Create: `src/routes/api/integrations/oauth/[integrationType]/callback/+server.ts`
- Test: `tests/lib/integrations/oauth-callback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/integrations/oauth-callback.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
});

beforeEach(async () => {
  const { __clearIntegrationAdapters } = await import('$lib/integrations/registry');
  __clearIntegrationAdapters();
});

describe('oauth callback', () => {
  it('exchanges code for tokens and writes a credential', async () => {
    const { registerIntegrationAdapter } = await import('$lib/integrations/registry');
    const { pendingState } = await import('$lib/../routes/api/integrations/oauth/[integrationType]/start/+server');
    const { GET } = await import('$lib/../routes/api/integrations/oauth/[integrationType]/callback/+server');
    process.env.TEST_OAUTH_CLIENT_ID = 'cid';
    process.env.TEST_OAUTH_CLIENT_SECRET = 'csecret';
    registerIntegrationAdapter({
      integrationType: 'test-callback',
      oauthSpec: {
        authorizationUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        defaultScopes: ['read'],
        clientIdEnvVar: 'TEST_OAUTH_CLIENT_ID',
        clientSecretEnvVar: 'TEST_OAUTH_CLIENT_SECRET',
      },
    });
    pendingState.set('teststate', {
      integrationType: 'test-callback',
      label: 'My Test',
      scopes: ['read'],
      createdAt: Date.now(),
    });
    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const url = new URL('http://localhost/api/integrations/oauth/test-callback/callback?code=abc&state=teststate');
    const res = await GET({
      params: { integrationType: 'test-callback' },
      url,
    } as any);
    expect(res.status).toBe(303);
    const location = res.headers.get('location');
    expect(location).toMatch(/\/admin\/integrations\?credential=/);
    global.fetch = originalFetch;
  });

  it('errors on unknown state', async () => {
    const { registerIntegrationAdapter } = await import('$lib/integrations/registry');
    const { GET } = await import('$lib/../routes/api/integrations/oauth/[integrationType]/callback/+server');
    registerIntegrationAdapter({
      integrationType: 'test-bad-state',
      oauthSpec: {
        authorizationUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        defaultScopes: [],
        clientIdEnvVar: 'TEST_OAUTH_CLIENT_ID',
        clientSecretEnvVar: 'TEST_OAUTH_CLIENT_SECRET',
      },
    });
    const url = new URL('http://localhost/?code=abc&state=nope');
    await expect(
      GET({ params: { integrationType: 'test-bad-state' }, url } as any),
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- tests/lib/integrations/oauth-callback.test.ts
```

Expected: missing-module error.

- [ ] **Step 3: Implement the callback**

Create `src/routes/api/integrations/oauth/[integrationType]/callback/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { getIntegrationAdapter } from '$lib/integrations';
import { createCredential } from '$lib/integrations/credentials';
import { pendingState } from '../start/+server';
import { env as publicEnv } from '$env/dynamic/public';

export const GET: RequestHandler = async ({ params, url }) => {
  const integrationType = params.integrationType!;
  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter || !adapter.oauthSpec) throw error(404, 'Unknown integration');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw error(400, 'Missing code or state');

  const pending = pendingState.get(state);
  if (!pending || pending.integrationType !== integrationType) {
    throw error(400, 'Unknown or mismatched state');
  }
  pendingState.delete(state);

  const clientId = process.env[adapter.oauthSpec.clientIdEnvVar]!;
  const clientSecret = process.env[adapter.oauthSpec.clientSecretEnvVar]!;
  const baseUrl = publicEnv.PUBLIC_BASE_URL || 'http://localhost:5173';
  const callback = `${baseUrl}/api/integrations/oauth/${integrationType}/callback`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callback,
  });
  const res = await fetch(adapter.oauthSpec.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw error(502, `Token exchange failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  const id = await createCredential({
    integrationType,
    label: pending.label,
    kind: 'oauth2',
    payload: {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + Number(json.expires_in) * 1000,
      scopes: pending.scopes,
    },
  });
  throw redirect(303, `/admin/integrations?credential=${id}`);
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- tests/lib/integrations/oauth-callback.test.ts
```

Expected: both cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/integrations/oauth/[integrationType]/callback/+server.ts tests/lib/integrations/oauth-callback.test.ts
git commit -m "feat(integrations): generic OAuth callback handler"
```

### Task 10: Options endpoint

**Files:**
- Create: `src/routes/api/integrations/options/[integrationType]/[fieldName]/+server.ts`

- [ ] **Step 1: Implement**

```ts
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getIntegrationAdapter } from '$lib/integrations';

export const GET: RequestHandler = async ({ params, url }) => {
  const integrationType = params.integrationType!;
  const fieldName = params.fieldName!;
  const credentialId = url.searchParams.get('credentialId');
  if (!credentialId) throw error(400, 'Missing credentialId');

  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter) throw error(404, `Unknown integrationType: ${integrationType}`);
  if (!adapter.resolveOptions) {
    throw error(400, `${integrationType} does not provide options`);
  }
  try {
    const options = await adapter.resolveOptions(fieldName, credentialId);
    return json({ options });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(502, `resolveOptions failed: ${msg}`);
  }
};
```

- [ ] **Step 2: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/integrations/options/[integrationType]/[fieldName]/+server.ts
git commit -m "feat(integrations): generic options resolver endpoint"
```

### Task 11: Test endpoint

**Files:**
- Create: `src/routes/api/integrations/test/[integrationType]/+server.ts`

- [ ] **Step 1: Implement**

```ts
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getIntegrationAdapter } from '$lib/integrations';
import { updateCredential } from '$lib/integrations/credentials';

export const POST: RequestHandler = async ({ params, request }) => {
  const integrationType = params.integrationType!;
  const body = (await request.json().catch(() => ({}))) as { credentialId?: string };
  if (!body.credentialId) throw error(400, 'Missing credentialId');

  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter) throw error(404, `Unknown integrationType: ${integrationType}`);
  if (!adapter.testCredential) {
    throw error(400, `${integrationType} does not provide a test handler`);
  }
  try {
    await adapter.testCredential(body.credentialId);
    await updateCredential(body.credentialId, {
      lastTestedAt: new Date(),
      lastTestStatus: 'ok',
      lastTestError: null,
    });
    return json({ status: 'ok' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateCredential(body.credentialId, {
      lastTestedAt: new Date(),
      lastTestStatus: 'failed',
      lastTestError: msg,
    });
    return json({ status: 'failed', error: msg }, { status: 200 });
  }
};
```

- [ ] **Step 2: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/integrations/test/[integrationType]/+server.ts
git commit -m "feat(integrations): generic credential test endpoint"
```

---

## Phase 4 — Admin UI at `/admin/integrations`

### Task 12: Loader + delete/patch endpoint

**Files:**
- Create: `src/routes/admin/integrations/+page.server.ts`
- Create: `src/routes/admin/integrations/[id]/+server.ts`

- [ ] **Step 1: Loader**

Create `src/routes/admin/integrations/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { listCredentials } from '$lib/integrations/credentials';
import { listIntegrationAdapters } from '$lib/integrations/registry';

export const load: PageServerLoad = async () => {
  const credentials = await listCredentials();
  const adapters = listIntegrationAdapters().map((a) => ({
    integrationType: a.integrationType,
    hasOauth: !!a.oauthSpec,
    hasOptions: !!a.resolveOptions,
    hasTest: !!a.testCredential,
  }));
  // Group credentials by integrationType for display.
  const grouped: Record<string, typeof credentials> = {};
  for (const c of credentials) {
    (grouped[c.integrationType] ??= []).push(c);
  }
  return { grouped, adapters };
};
```

- [ ] **Step 2: Per-credential endpoint**

Create `src/routes/admin/integrations/[id]/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { updateCredential, deleteCredential } from '$lib/integrations/credentials';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = (await request.json()) as {
    label?: string;
    metadata?: Record<string, unknown>;
  };
  await updateCredential(params.id!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  await deleteCredential(params.id!);
  return json({ ok: true });
};
```

- [ ] **Step 3: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/integrations/+page.server.ts src/routes/admin/integrations/[id]/+server.ts
git commit -m "feat(admin): integrations loader + per-credential endpoint"
```

### Task 13: Admin UI page

**Files:**
- Create: `src/routes/admin/integrations/+page.svelte`

- [ ] **Step 1: Implement the page**

Mirror the visual style of `src/routes/admin/files/+page.svelte` (per-project memory: `feedback_sr_design_language` — uses `.nm-sec`, `.nm-text-input`, `.nm-save-btn`, `.row-link`, CSS-var palette). Read that file first to copy its layout primitives.

Create `src/routes/admin/integrations/+page.svelte`:

```svelte
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  async function deleteCredential(id: string) {
    if (!confirm('Delete this credential? Workflows using it will fail.')) return;
    const res = await fetch(`/admin/integrations/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert('Delete failed'); return; }
    location.reload();
  }

  async function renameCredential(id: string, currentLabel: string) {
    const next = prompt('New label', currentLabel);
    if (!next || next === currentLabel) return;
    const res = await fetch(`/admin/integrations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: next }),
    });
    if (!res.ok) { alert('Rename failed'); return; }
    location.reload();
  }

  async function testCredential(integrationType: string, id: string) {
    const res = await fetch(`/api/integrations/test/${integrationType}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentialId: id }),
    });
    const body = await res.json();
    alert(body.status === 'ok' ? 'OK' : `Failed: ${body.error ?? 'unknown'}`);
    location.reload();
  }
</script>

<svelte:head><title>Integrations — admin</title></svelte:head>

<section class="nm-sec">
  <h1>Integrations</h1>
  <p>Connect third-party services. Credentials are encrypted at rest.</p>

  {#if data.adapters.length === 0}
    <p><em>No integration adapters are registered yet. Adapters are added by workflow nodes (Apple Calendar, Trello, etc.).</em></p>
  {/if}

  {#each Object.entries(data.grouped) as [integrationType, creds]}
    <h2>{integrationType}</h2>
    <table>
      <thead>
        <tr>
          <th>Label</th>
          <th>Kind</th>
          <th>Last tested</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each creds as c}
          <tr>
            <td>{c.label}</td>
            <td>{c.kind}</td>
            <td>{c.lastTestedAt ? new Date(c.lastTestedAt).toLocaleString() : '—'}</td>
            <td>{c.lastTestStatus ?? '—'}{c.lastTestError ? ` (${c.lastTestError})` : ''}</td>
            <td>
              <button onclick={() => testCredential(c.integrationType, c.id)}>Test</button>
              <button onclick={() => renameCredential(c.id, c.label)}>Rename</button>
              <button onclick={() => deleteCredential(c.id)}>Delete</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if data.adapters.find((a) => a.integrationType === integrationType)?.hasOauth}
      <a class="row-link" href="/api/integrations/oauth/{integrationType}/start" data-method="POST">+ New via OAuth</a>
    {/if}
  {/each}
</section>

<style>
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid var(--nm-border, #ddd); }
  button { margin-right: 0.25rem; }
</style>
```

- [ ] **Step 2: Verify the page renders**

Start the dev server:

```bash
npm run dev
```

Navigate to `http://homeserv:5173/admin/integrations`. You should see the page with no credentials and a message about no adapters being registered.

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/integrations/+page.svelte
git commit -m "feat(admin): integrations admin UI"
```

---

## Phase 5 — Widgets

### Task 14: `CredentialPicker.svelte`

**Files:**
- Create: `src/lib/canvas/nodes/panels/widgets/CredentialPicker.svelte`

- [ ] **Step 1: Read existing widget patterns**

Read `src/lib/canvas/nodes/panels/widgets/GmailAccountPicker.svelte` and `src/lib/canvas/nodes/panels/shared/ResourcePicker.svelte` to mirror the conventions. Note: prop interface, the way they fetch options on mount, and the in-panel "+ New" button pattern.

- [ ] **Step 2: Implement**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    integrationType: string;
    value: string | undefined;
    onChange: (id: string | undefined) => void;
    label?: string;
    hint?: string;
  }
  let { integrationType, value, onChange, label = 'Credential', hint }: Props = $props();

  let credentials: { id: string; label: string }[] = $state([]);
  let loading = $state(true);

  async function refresh() {
    loading = true;
    const res = await fetch(`/api/admin/integrations/list?integrationType=${encodeURIComponent(integrationType)}`);
    if (res.ok) credentials = (await res.json()).credentials;
    loading = false;
  }

  onMount(refresh);

  function pickNewVia(_kind: 'oauth') {
    const url = `/api/integrations/oauth/${integrationType}/start`;
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.json())
      .then((b) => {
        if (b?.authorizationUrl) window.location.href = b.authorizationUrl;
        else alert('OAuth start failed');
      });
  }
</script>

<div class="picker">
  <label>{label}</label>
  {#if hint}<p class="hint">{hint}</p>{/if}
  {#if loading}
    <div>Loading…</div>
  {:else if credentials.length === 0}
    <div class="empty">
      No credentials for <code>{integrationType}</code>.
      <a href="/admin/integrations" target="_blank">Add one</a>
    </div>
  {:else}
    <select value={value ?? ''} onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value || undefined)}>
      <option value="">— select —</option>
      {#each credentials as c}
        <option value={c.id}>{c.label}</option>
      {/each}
    </select>
  {/if}
  <a class="new-link" href="/admin/integrations" target="_blank">+ New via admin</a>
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 0.25rem; }
  .hint { color: var(--nm-muted, #666); font-size: 0.85rem; margin: 0; }
  .empty { color: var(--nm-muted, #666); font-size: 0.85rem; }
  .new-link { font-size: 0.85rem; }
</style>
```

- [ ] **Step 3: Add the small list endpoint the widget hits**

Create `src/routes/api/admin/integrations/list/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { listCredentials } from '$lib/integrations/credentials';

export const GET: RequestHandler = async ({ url }) => {
  const integrationType = url.searchParams.get('integrationType') ?? undefined;
  const credentials = await listCredentials(integrationType);
  return json({
    credentials: credentials.map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
  });
};
```

- [ ] **Step 4: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canvas/nodes/panels/widgets/CredentialPicker.svelte src/routes/api/admin/integrations/list/+server.ts
git commit -m "feat(widgets): CredentialPicker"
```

### Task 15: `CredentialStatusBanner.svelte`

**Files:**
- Create: `src/lib/canvas/nodes/panels/widgets/CredentialStatusBanner.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    credentialId: string | undefined;
  }
  let { credentialId }: Props = $props();

  let status = $state<'ok' | 'failed' | 'untested' | 'loading' | 'no-cred'>('loading');
  let lastError = $state<string | null>(null);

  async function refresh() {
    if (!credentialId) { status = 'no-cred'; return; }
    status = 'loading';
    const res = await fetch(`/admin/integrations/${credentialId}/status`);
    if (!res.ok) { status = 'failed'; lastError = `Status fetch ${res.status}`; return; }
    const b = await res.json();
    status = (b.lastTestStatus as 'ok' | 'failed' | null) ?? 'untested';
    lastError = b.lastTestError ?? null;
  }

  onMount(refresh);
  $effect(() => { if (credentialId) refresh(); });
</script>

{#if status === 'no-cred'}
  <div class="banner muted">No credential selected.</div>
{:else if status === 'loading'}
  <div class="banner muted">Checking credential…</div>
{:else if status === 'ok'}
  <div class="banner ok">✓ Credential OK</div>
{:else if status === 'failed'}
  <div class="banner err">✗ Credential failed: {lastError ?? 'unknown error'}</div>
{:else}
  <div class="banner warn">Credential not yet tested.</div>
{/if}

<style>
  .banner { padding: 0.5rem; border-radius: 4px; font-size: 0.9rem; margin: 0.5rem 0; }
  .muted { background: var(--nm-bg-muted, #f5f5f5); }
  .ok    { background: #e8f5e9; color: #1b5e20; }
  .warn  { background: #fff8e1; color: #6d4c00; }
  .err   { background: #ffebee; color: #b71c1c; }
</style>
```

- [ ] **Step 2: Add the per-credential status endpoint**

Create `src/routes/admin/integrations/[id]/status/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { integrationCredentials } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const rows = await db
    .select({
      lastTestedAt: integrationCredentials.lastTestedAt,
      lastTestStatus: integrationCredentials.lastTestStatus,
      lastTestError: integrationCredentials.lastTestError,
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.id, params.id!))
    .limit(1);
  if (rows.length === 0) throw error(404, 'Not found');
  return json(rows[0]);
};
```

- [ ] **Step 3: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvas/nodes/panels/widgets/CredentialStatusBanner.svelte src/routes/admin/integrations/[id]/status/+server.ts
git commit -m "feat(widgets): CredentialStatusBanner + status endpoint"
```

### Task 16: `TestConnectionAction.svelte`

**Files:**
- Create: `src/lib/canvas/nodes/panels/widgets/TestConnectionAction.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  interface Props {
    integrationType: string;
    credentialId: string | undefined;
    onResult?: (status: 'ok' | 'failed', error?: string) => void;
  }
  let { integrationType, credentialId, onResult }: Props = $props();

  let busy = $state(false);
  let lastResult = $state<{ status: 'ok' | 'failed'; error?: string } | null>(null);

  async function run() {
    if (!credentialId) return;
    busy = true;
    try {
      const res = await fetch(`/api/integrations/test/${integrationType}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      });
      const body = await res.json();
      lastResult = { status: body.status, error: body.error };
      onResult?.(body.status, body.error);
    } catch (err) {
      lastResult = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      onResult?.('failed', lastResult.error);
    } finally {
      busy = false;
    }
  }
</script>

<div class="action">
  <button disabled={!credentialId || busy} onclick={run}>
    {busy ? 'Testing…' : 'Test credential'}
  </button>
  {#if lastResult}
    <span class:ok={lastResult.status === 'ok'} class:err={lastResult.status === 'failed'}>
      {lastResult.status === 'ok' ? 'OK' : `Failed: ${lastResult.error ?? 'unknown'}`}
    </span>
  {/if}
</div>

<style>
  .action { display: flex; align-items: center; gap: 0.5rem; }
  .ok { color: #1b5e20; }
  .err { color: #b71c1c; }
</style>
```

- [ ] **Step 2: Verify**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/canvas/nodes/panels/widgets/TestConnectionAction.svelte
git commit -m "feat(widgets): TestConnectionAction"
```

---

## Phase 6 — End-to-end smoke test

This phase proves Phases 1-5 work as a whole, by registering a stub adapter and exercising the full create → test → delete flow through real HTTP.

### Task 17: Stub adapter for E2E test

**Files:**
- Create: `tests/lib/integrations/e2e.test.ts`

- [ ] **Step 1: Write the E2E test**

Create `tests/lib/integrations/e2e.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
});

beforeEach(async () => {
  const { __clearIntegrationAdapters, registerIntegrationAdapter } = await import('$lib/integrations/registry');
  __clearIntegrationAdapters();
  registerIntegrationAdapter({
    integrationType: 'test-e2e',
    resolveOptions: async (_field, credId) => [
      { value: `opt-${credId}-1`, label: 'One' },
      { value: `opt-${credId}-2`, label: 'Two' },
    ],
    testCredential: async (credId) => {
      if (credId === 'fail') throw new Error('intentional');
    },
  });
});

describe('integrations e2e', () => {
  it('options endpoint returns adapter results', async () => {
    const { GET } = await import('$lib/../routes/api/integrations/options/[integrationType]/[fieldName]/+server');
    const res = await GET({
      params: { integrationType: 'test-e2e', fieldName: 'thing' },
      url: new URL('http://localhost/?credentialId=cred-x'),
    } as any);
    const body = await res.json();
    expect(body.options).toEqual([
      { value: 'opt-cred-x-1', label: 'One' },
      { value: 'opt-cred-x-2', label: 'Two' },
    ]);
  });

  it('test endpoint records ok status', async () => {
    const { createCredential, getCredential } = await import('$lib/integrations/credentials');
    const { POST } = await import('$lib/../routes/api/integrations/test/[integrationType]/+server');
    const id = await createCredential({
      integrationType: 'test-e2e',
      label: 'e2e ok',
      kind: 'apikey',
      payload: { key: 'k' },
    });
    const res = await POST({
      params: { integrationType: 'test-e2e' },
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ credentialId: id }),
        headers: { 'content-type': 'application/json' },
      }),
    } as any);
    expect((await res.json()).status).toBe('ok');
    const got = await getCredential(id);
    expect(got!.lastTestStatus).toBe('ok');
  });

  it('test endpoint records failed status', async () => {
    const { POST } = await import('$lib/../routes/api/integrations/test/[integrationType]/+server');
    // Use 'fail' as the credentialId — the stub adapter throws.
    // Note: the real updateCredential would 404 on this fake id; for the
    // test, the assertion is just that the endpoint returns failed status.
    const res = await POST({
      params: { integrationType: 'test-e2e' },
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ credentialId: 'fail' }),
        headers: { 'content-type': 'application/json' },
      }),
    } as any);
    const body = await res.json();
    expect(body.status).toBe('failed');
    expect(body.error).toMatch(/intentional/);
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npm test -- tests/lib/integrations/e2e.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/integrations/e2e.test.ts
git commit -m "test(integrations): e2e smoke for options + test endpoints"
```

### Task 18: Manual UI verification

- [ ] **Step 1: Run the full suite**

```bash
npm test
```

Expected: all integration tests pass; existing tests still pass.

- [ ] **Step 2: Type check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Browser sanity check**

```bash
npm run dev
```

Open `http://homeserv:5173/admin/integrations` and confirm:
- Page renders without errors
- "No integration adapters registered" message shows (since no adapters are wired in production code yet)
- Browser console is clean (no errors / 404s on the page)

(Network-tab note: the `/api/admin/integrations/list` endpoint is exercised by `CredentialPicker` widgets, which aren't on this page — so it's normal to see no traffic to it here.)

- [ ] **Step 4: Final commit (if anything was tweaked during smoke test)**

If no changes, skip. Otherwise:

```bash
git add -A
git commit -m "chore(integrations): post-smoke cleanup"
```

---

## Self-Review Checklist

Run through this before declaring Plan A done:

- [ ] All Phase 1-6 tasks complete and committed
- [ ] `npm test` clean
- [ ] `npm run check` clean
- [ ] `/admin/integrations` page renders
- [ ] No new entries in `package.json` other than what's needed (none expected for Plan A — this is all stdlib + existing deps)
- [ ] `INTEGRATION_CREDENTIALS_KEY` is documented in `.env.example`
- [ ] No references to `dynamicNodes`, `vendor`, or `rsync` in any new file (those concepts were dropped during brainstorming)

---

## Out of scope for Plan A — handled in Plan B

- Curate session orchestration, worktree management, dev-server pool
- Discovery toolkit (web search wrapper, context7 wrapper, repo readers, sandbox probe)
- Canonical node spec types
- uiSchema declarative type + Svelte codegen
- Generate / Live-test / Promote pipelines
- `/jkai/curate` UI routes
- `curateSessions` Drizzle table
- The "Apple Calendar" worked example end-to-end run

---

## Notes for the executing agent

- **Imports**: SvelteKit `$lib/...` aliases work in `src/`. In tests under `tests/`, use the same `$lib/...` alias — it's configured in `vitest.config.ts`. For routes, the test files use `$lib/../routes/...` because routes aren't under `$lib`. If you find a cleaner test-side import pattern in existing tests (`tests/lib/jkai/promote-endpoint.test.ts` is a good reference), prefer that.
- **DB tests**: tests in this plan write to the dev DB and clean up by `integrationType` prefix (`test-creds-`, etc.). If a CI environment exists with a separate test DB, route tests there. For local dev, the prefix-based cleanup is safe because `integrationType` is namespaced.
- **Svelte 5 runes**: all new components use `$props()`, `$state()`, `$effect()`. The codebase is already on Svelte 5 — confirm by reading any `.svelte` file under `src/lib/canvas/nodes/panels/`.
- **Design tokens**: existing nodes use `.nm-sec`, `.nm-text-input`, `.nm-save-btn`, `.row-link` and CSS variables (`--nm-border`, `--nm-muted`, `--nm-bg-muted`). Plan A's UI uses these where natural; promotion-phase Plan B will apply them more rigorously to generated panels.
- **No deploys**: Plan A doesn't touch prod. Don't run `scripts/deploy.sh`. The `INTEGRATION_CREDENTIALS_KEY` env var must be added to the VPS's `.env` *before* the first prod deploy that includes Plan A code, but that's a Plan B concern.
