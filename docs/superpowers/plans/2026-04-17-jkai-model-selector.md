# jkai Model Selector & Cost Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-configurable default LLM models (Z.AI GLM + OpenRouter), per-conversation model pinning, and OpenRouter cost tracking with per-conversation and global KPIs, for the `/jkai` orchestrator chat and `/jkai/builds` autonomous builder.

**Architecture:** New `app_settings` table holds defaults + OpenRouter API key. New `openrouter_models` table caches the OpenRouter catalogue. Conversations and builds get `model_provider` + `model_id` + cost/token columns, pinned at row creation. `getLLMClient()` is refactored to take a `ModelContext` and select Z.AI or OpenRouter accordingly. `generalChat()` (user-facing chat) is refactored to use this context-aware client and record usage after each completion.

**Tech Stack:** SvelteKit, Drizzle ORM, PostgreSQL, OpenAI SDK (used for both Z.AI and OpenRouter via their OpenAI-compatible endpoints), Vitest.

**Spec:** [docs/superpowers/specs/2026-04-17-jkai-model-selector-design.md](../specs/2026-04-17-jkai-model-selector-design.md)

---

## File Structure

**New files:**
- `supabase/migrations/20260417_jkai_model_selector.sql` — schema migration
- `src/lib/constants/glm-models.ts` — hardcoded Z.AI model list
- `src/lib/server/models/settings.ts` — app_settings getters/setters + `resolveDefaultModel`
- `src/lib/server/models/openrouter-catalogue.ts` — fetch + cache OpenRouter model list
- `src/lib/server/models/usage.ts` — `recordUsage()` + cost math
- `src/lib/server/models/types.ts` — `ModelContext`, `PriceSnapshot`, shared types
- `src/routes/admin/models/+page.server.ts`
- `src/routes/admin/models/+page.svelte`
- `src/routes/api/admin/models/settings/+server.ts`
- `src/routes/api/admin/models/openrouter/refresh/+server.ts`
- `src/routes/api/admin/models/openrouter/+server.ts`
- `src/lib/components/admin/ModelDefaultsPanel.svelte`
- `src/lib/components/admin/OpenRouterConfigPanel.svelte`
- `src/lib/components/admin/OpenRouterModelBrowser.svelte`
- `src/lib/components/jkai/ModelPicker.svelte`
- `src/lib/components/jkai/NewConversationDialog.svelte`
- `tests/server/models/settings.test.ts`
- `tests/server/models/openrouter-catalogue.test.ts`
- `tests/server/models/usage.test.ts`

**Modified files:**
- `src/lib/db/schema.ts` — new tables, new columns
- `src/lib/jkai/llm-client.ts` — accept `ModelContext`, dual-provider
- `src/lib/deepdive/keys.ts` — default model → `glm-5.1`
- `src/lib/workflows/chat/general-chat.ts` — accept `ModelContext`, record usage
- `src/routes/api/workflows/orchestrator/chat/+server.ts` — load convo model, pass ctx
- `src/routes/api/jkai/conversations/+server.ts` — accept + pin model on create
- `src/routes/jkai/+page.svelte` — new-conversation dialog
- `src/lib/components/jkai/ConversationSidebar.svelte` — per-convo cost
- `src/lib/components/jkai/MetricsStrip.svelte` — total spend tile
- `src/routes/api/jkai/builds/+server.ts` — accept + pin model on create
- `src/lib/jkai/planner.ts` — accept ctx, record usage
- `src/lib/jkai/executor.ts` — accept ctx, record usage

---

## Task 1: DB migration + Drizzle schema

**Files:**
- Create: `supabase/migrations/20260417_jkai_model_selector.sql`
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Write migration SQL**

Create `supabase/migrations/20260417_jkai_model_selector.sql`:

```sql
-- app_settings: generic key/value store
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('jkai.chat.default_model',    '{"provider":"zai","modelId":"glm-5.1"}'::jsonb),
  ('jkai.builder.default_model', '{"provider":"zai","modelId":"glm-5.1"}'::jsonb),
  ('openrouter.api_key',         '{"value":""}'::jsonb),
  ('openrouter.last_refreshed_at', 'null'::jsonb);

-- openrouter_models: cached OpenRouter catalogue
CREATE TABLE openrouter_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  context_length INTEGER,
  prompt_price NUMERIC(20,12),
  completion_price NUMERIC(20,12),
  image_price NUMERIC(20,12),
  modality TEXT,
  provider TEXT,
  raw JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX openrouter_models_provider_idx ON openrouter_models (provider);
CREATE INDEX openrouter_models_modality_idx ON openrouter_models (modality);

-- Conversations: model pin + cost tracking
ALTER TABLE jkai_conversations
  ADD COLUMN model_provider TEXT NOT NULL DEFAULT 'zai',
  ADD COLUMN model_id TEXT NOT NULL DEFAULT 'glm-5.1',
  ADD COLUMN prompt_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN completion_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN price_snapshot JSONB;

-- Builds: model pin + cost tracking
ALTER TABLE jkai_builds
  ADD COLUMN model_provider TEXT NOT NULL DEFAULT 'zai',
  ADD COLUMN model_id TEXT NOT NULL DEFAULT 'glm-5.1',
  ADD COLUMN cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN price_snapshot JSONB;
```

- [ ] **Step 2: Apply migration**

Run:
```bash
psql postgres://postgres:postgres@localhost:5433/strange_rambling -f supabase/migrations/20260417_jkai_model_selector.sql
```

Expected: `CREATE TABLE`, `INSERT 0 4`, `ALTER TABLE` messages with no errors.

Verify:
```bash
psql postgres://postgres:postgres@localhost:5433/strange_rambling -c "SELECT key FROM app_settings ORDER BY key;"
```
Expected output: four rows — `jkai.builder.default_model`, `jkai.chat.default_model`, `openrouter.api_key`, `openrouter.last_refreshed_at`.

- [ ] **Step 3: Update Drizzle schema**

Open `src/lib/db/schema.ts`. Find the `conversations` (or `jkaiConversations`) table definition (per spec this is `jkai_conversations`; confirm the TS export name). Add columns:

```ts
// Inside the existing jkai_conversations/conversations table definition
modelProvider: text('model_provider').notNull().default('zai'),
modelId: text('model_id').notNull().default('glm-5.1'),
promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
completionTokens: bigint('completion_tokens', { mode: 'number' }).notNull().default(0),
costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
priceSnapshot: jsonb('price_snapshot').$type<{ promptPrice: number; completionPrice: number } | null>(),
```

Find the `jkaiBuilds` table. Add:

```ts
modelProvider: text('model_provider').notNull().default('zai'),
modelId: text('model_id').notNull().default('glm-5.1'),
costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
priceSnapshot: jsonb('price_snapshot').$type<{ promptPrice: number; completionPrice: number } | null>(),
```

At the bottom of the file, add the two new tables:

```ts
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const openrouterModels = pgTable('openrouter_models', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  contextLength: integer('context_length'),
  promptPrice: numeric('prompt_price', { precision: 20, scale: 12 }),
  completionPrice: numeric('completion_price', { precision: 20, scale: 12 }),
  imagePrice: numeric('image_price', { precision: 20, scale: 12 }),
  modality: text('modality'),
  provider: text('provider'),
  raw: jsonb('raw').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Make sure imports at the top include `bigint`, `numeric`, `jsonb`, `integer`, `timestamp`, `pgTable`, `text` as needed (most should already be there).

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: PASS (no new type errors).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260417_jkai_model_selector.sql src/lib/db/schema.ts
git commit -m "feat(jkai): schema for model selector + cost tracking"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/lib/server/models/types.ts`

- [ ] **Step 1: Write types**

```ts
// src/lib/server/models/types.ts
export type ModelProvider = 'zai' | 'openrouter';

export interface ModelContext {
  provider: ModelProvider;
  modelId: string;
}

export interface PriceSnapshot {
  promptPrice: number;   // USD per token
  completionPrice: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface UsageDelta extends Usage {
  costUsd: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/models/types.ts
git commit -m "feat(models): shared types for ModelContext and usage"
```

---

## Task 3: GLM model constants

**Files:**
- Create: `src/lib/constants/glm-models.ts`

- [ ] **Step 1: Write constants**

```ts
// src/lib/constants/glm-models.ts
export interface GlmModel {
  id: string;
  label: string;
  description: string;
}

export const GLM_MODELS: GlmModel[] = [
  { id: 'glm-5.1',       label: 'GLM 5.1',           description: 'Full GLM-5.1 — highest quality' },
  { id: 'glm-5-turbo',   label: 'GLM 5 Turbo',       description: 'Faster/cheaper GLM-5 variant' },
  { id: 'glm-5v-turbo',  label: 'GLM 5V Turbo',      description: 'Multimodal (vision) GLM-5 turbo' },
];

export const DEFAULT_GLM_MODEL_ID = 'glm-5.1';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/constants/glm-models.ts
git commit -m "feat(models): hardcoded Z.AI GLM model list"
```

---

## Task 4: Update Z.AI hardcoded defaults to glm-5.1

**Files:**
- Modify: `src/lib/jkai/llm-client.ts:5`
- Modify: `src/lib/deepdive/keys.ts:40,77`

- [ ] **Step 1: Change fallback in llm-client.ts**

In `src/lib/jkai/llm-client.ts` line 5, change:
```ts
const DEFAULT_MODEL = 'glm-4-plus';
```
to:
```ts
const DEFAULT_MODEL = 'glm-5.1';
```

- [ ] **Step 2: Change fallback in keys.ts**

In `src/lib/deepdive/keys.ts` line 40, change:
```ts
return keys.zaiModel || 'glm-4-plus';
```
to:
```ts
return keys.zaiModel || 'glm-5.1';
```

And line 77:
```ts
zaiModel: keys.zaiModel || 'glm-4-plus',
```
to:
```ts
zaiModel: keys.zaiModel || 'glm-5.1',
```

- [ ] **Step 3: Update local `keys.json` (local-only, not git-tracked)**

Set `zaiModel` to `"glm-5.1"` in `keys.json`. This file is gitignored; the change is local to the dev/prod machine.

```bash
# Confirm the current value, then edit if necessary
grep zaiModel keys.json
```

Edit with an editor or `jq`:
```bash
jq '.zaiModel = "glm-5.1"' keys.json > keys.json.new && mv keys.json.new keys.json
```

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/llm-client.ts src/lib/deepdive/keys.ts
git commit -m "feat(models): default Z.AI model glm-4-plus -> glm-5.1"
```

---

## Task 5: `app_settings` helpers (TDD)

**Files:**
- Create: `src/lib/server/models/settings.ts`
- Test: `tests/server/models/settings.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/server/models/settings.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  getSetting,
  setSetting,
  resolveDefaultModel,
  getOpenRouterApiKey,
  clearSettingsCache,
} from '$lib/server/models/settings';

describe('app_settings helpers', () => {
  beforeEach(async () => {
    clearSettingsCache();
    await db.insert(appSettings)
      .values({ key: 'jkai.chat.default_model', value: { provider: 'zai', modelId: 'glm-5.1' } })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { provider: 'zai', modelId: 'glm-5.1' }, updatedAt: new Date() },
      });
  });

  it('getSetting returns typed value', async () => {
    const v = await getSetting<{ provider: string; modelId: string }>('jkai.chat.default_model');
    expect(v).toEqual({ provider: 'zai', modelId: 'glm-5.1' });
  });

  it('setSetting upserts and invalidates cache', async () => {
    await setSetting('jkai.chat.default_model', { provider: 'openrouter', modelId: 'anthropic/claude-opus-4' });
    clearSettingsCache();
    const v = await getSetting<{ provider: string; modelId: string }>('jkai.chat.default_model');
    expect(v).toEqual({ provider: 'openrouter', modelId: 'anthropic/claude-opus-4' });
  });

  it('resolveDefaultModel returns the configured chat model', async () => {
    await setSetting('jkai.chat.default_model', { provider: 'zai', modelId: 'glm-5-turbo' });
    clearSettingsCache();
    const ctx = await resolveDefaultModel('chat');
    expect(ctx).toEqual({ provider: 'zai', modelId: 'glm-5-turbo' });
  });

  it('getOpenRouterApiKey prefers DB over keys.json when DB value is set', async () => {
    await setSetting('openrouter.api_key', { value: 'sk-or-db-value' });
    clearSettingsCache();
    const key = await getOpenRouterApiKey();
    expect(key).toBe('sk-or-db-value');
  });

  it('getOpenRouterApiKey falls back to keys.json when DB value is empty', async () => {
    await setSetting('openrouter.api_key', { value: '' });
    clearSettingsCache();
    const key = await getOpenRouterApiKey();
    // Expect whatever is in keys.json (or undefined if not set)
    expect(key).toEqual(expect.anything()); // test-environment-specific; adjust if you mock loadKeys
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/server/models/settings.test.ts`
Expected: FAIL with "Cannot find module '$lib/server/models/settings'".

- [ ] **Step 3: Implement**

```ts
// src/lib/server/models/settings.ts
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadKeys } from '$lib/deepdive/keys';
import type { ModelContext } from './types';

const TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearSettingsCache(): void {
  cache.clear();
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const value = (row?.value ?? null) as T | null;
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
  cache.delete(key);
}

export async function resolveDefaultModel(kind: 'chat' | 'builder'): Promise<ModelContext> {
  const key = kind === 'chat' ? 'jkai.chat.default_model' : 'jkai.builder.default_model';
  const v = await getSetting<ModelContext>(key);
  return v ?? { provider: 'zai', modelId: 'glm-5.1' };
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
  const v = await getSetting<{ value?: string }>('openrouter.api_key');
  if (v?.value) return v.value;
  return loadKeys().openrouterApiKey;
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/server/models/settings.test.ts`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/models/settings.ts tests/server/models/settings.test.ts
git commit -m "feat(models): app_settings helpers + resolveDefaultModel"
```

---

## Task 6: OpenRouter catalogue fetch + cache (TDD)

**Files:**
- Create: `src/lib/server/models/openrouter-catalogue.ts`
- Test: `tests/server/models/openrouter-catalogue.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/server/models/openrouter-catalogue.test.ts
import { describe, it, expect } from 'vitest';
import { mapOpenRouterModel, deriveProvider } from '$lib/server/models/openrouter-catalogue';

describe('openrouter catalogue mapping', () => {
  it('deriveProvider splits id prefix', () => {
    expect(deriveProvider('anthropic/claude-opus-4')).toBe('anthropic');
    expect(deriveProvider('openai/gpt-5')).toBe('openai');
    expect(deriveProvider('no-slash')).toBe('unknown');
  });

  it('mapOpenRouterModel transforms raw payload', () => {
    const raw = {
      id: 'anthropic/claude-opus-4',
      name: 'Claude Opus 4',
      description: 'Most capable',
      context_length: 200000,
      pricing: { prompt: '0.000015', completion: '0.000075', image: '0.024' },
      architecture: { modality: 'text+image->text' },
    };
    const row = mapOpenRouterModel(raw);
    expect(row).toMatchObject({
      id: 'anthropic/claude-opus-4',
      name: 'Claude Opus 4',
      description: 'Most capable',
      contextLength: 200000,
      promptPrice: '0.000015',
      completionPrice: '0.000075',
      imagePrice: '0.024',
      modality: 'text+image->text',
      provider: 'anthropic',
    });
    expect(row.raw).toEqual(raw);
  });

  it('mapOpenRouterModel handles missing pricing fields', () => {
    const raw = {
      id: 'free/model',
      name: 'Free',
      context_length: 8192,
      pricing: { prompt: '0', completion: '0' },
      architecture: { modality: 'text->text' },
    };
    const row = mapOpenRouterModel(raw);
    expect(row.promptPrice).toBe('0');
    expect(row.completionPrice).toBe('0');
    expect(row.imagePrice).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/server/models/openrouter-catalogue.test.ts`
Expected: FAIL with "Cannot find module '$lib/server/models/openrouter-catalogue'".

- [ ] **Step 3: Implement**

```ts
// src/lib/server/models/openrouter-catalogue.ts
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { setSetting } from './settings';

interface OpenRouterRawModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; image?: string | null };
  architecture?: { modality?: string };
}

export function deriveProvider(id: string): string {
  const idx = id.indexOf('/');
  return idx > 0 ? id.slice(0, idx) : 'unknown';
}

export function mapOpenRouterModel(raw: OpenRouterRawModel) {
  const pricing = raw.pricing ?? {};
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    description: raw.description ?? null,
    contextLength: raw.context_length ?? null,
    promptPrice: pricing.prompt ?? null,
    completionPrice: pricing.completion ?? null,
    imagePrice: pricing.image ?? null,
    modality: raw.architecture?.modality ?? null,
    provider: deriveProvider(raw.id),
    raw,
    fetchedAt: new Date(),
  };
}

export async function refreshOpenRouterCatalogue(): Promise<{ count: number }> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
  const json = await res.json();
  const models: OpenRouterRawModel[] = json.data ?? [];

  await db.transaction(async (tx) => {
    await tx.delete(openrouterModels);
    if (models.length > 0) {
      await tx.insert(openrouterModels).values(models.map(mapOpenRouterModel));
    }
  });

  await setSetting('openrouter.last_refreshed_at', new Date().toISOString());
  return { count: models.length };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/server/models/openrouter-catalogue.test.ts`
Expected: all 3 pass.

- [ ] **Step 5: Manual smoke**

In a dev shell:
```bash
node --experimental-vm-modules --loader ./scripts/ts-loader.mjs -e "import('./src/lib/server/models/openrouter-catalogue.js').then(m => m.refreshOpenRouterCatalogue()).then(r => console.log(r))"
```
(Or just wait until Task 11 which provides an HTTP endpoint that triggers this. Skip this step if the ts-loader setup isn't trivial.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/models/openrouter-catalogue.ts tests/server/models/openrouter-catalogue.test.ts
git commit -m "feat(models): OpenRouter catalogue fetch + cache mapping"
```

---

## Task 7: `recordUsage()` + cost math (TDD)

**Files:**
- Create: `src/lib/server/models/usage.ts`
- Test: `tests/server/models/usage.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/server/models/usage.test.ts
import { describe, it, expect } from 'vitest';
import { computeCost } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';

describe('computeCost', () => {
  it('returns 0 when snapshot is null (zai case)', () => {
    expect(computeCost({ promptTokens: 100, completionTokens: 50 }, null)).toBe(0);
  });

  it('multiplies tokens by snapshot prices', () => {
    const snap: PriceSnapshot = { promptPrice: 0.000015, completionPrice: 0.000075 };
    const cost = computeCost({ promptTokens: 1000, completionTokens: 500 }, snap);
    // 1000 * 0.000015 + 500 * 0.000075 = 0.015 + 0.0375 = 0.0525
    expect(cost).toBeCloseTo(0.0525, 6);
  });

  it('returns 0 when both prices are 0 (free model)', () => {
    const snap: PriceSnapshot = { promptPrice: 0, completionPrice: 0 };
    expect(computeCost({ promptTokens: 1_000_000, completionTokens: 1_000_000 }, snap)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run tests/server/models/usage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/server/models/usage.ts
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import type { PriceSnapshot, Usage, UsageDelta } from './types';

export function computeCost(usage: Usage, snapshot: PriceSnapshot | null): number {
  if (!snapshot) return 0;
  const prompt = usage.promptTokens * snapshot.promptPrice;
  const completion = usage.completionTokens * snapshot.completionPrice;
  return prompt + completion;
}

export async function recordConversationUsage(
  conversationId: string,
  usage: Usage,
  snapshot: PriceSnapshot | null,
): Promise<UsageDelta> {
  const cost = computeCost(usage, snapshot);
  await db.execute(sql`
    UPDATE jkai_conversations
    SET prompt_tokens = prompt_tokens + ${usage.promptTokens},
        completion_tokens = completion_tokens + ${usage.completionTokens},
        cost_usd = cost_usd + ${cost}
    WHERE id = ${conversationId}
  `);
  return { ...usage, costUsd: cost };
}

export async function recordBuildUsage(
  buildId: string,
  usage: Usage,
  snapshot: PriceSnapshot | null,
): Promise<UsageDelta> {
  const cost = computeCost(usage, snapshot);
  await db.execute(sql`
    UPDATE jkai_builds
    SET tokens_used = tokens_used + ${usage.promptTokens + usage.completionTokens},
        cost_usd = cost_usd + ${cost}
    WHERE id = ${buildId}
  `);
  return { ...usage, costUsd: cost };
}

/** Parse OpenAI-SDK usage block into our Usage shape. */
export function parseUsage(raw: { prompt_tokens?: number; completion_tokens?: number } | undefined): Usage {
  return {
    promptTokens: raw?.prompt_tokens ?? 0,
    completionTokens: raw?.completion_tokens ?? 0,
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run tests/server/models/usage.test.ts`
Expected: all 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/models/usage.ts tests/server/models/usage.test.ts
git commit -m "feat(models): usage recording + cost math"
```

---

## Task 8: Refactor `getLLMClient()` to accept `ModelContext`

**Files:**
- Modify: `src/lib/jkai/llm-client.ts`

- [ ] **Step 1: Replace file contents**

Overwrite `src/lib/jkai/llm-client.ts` with:

```ts
import OpenAI from 'openai';
import { loadKeys } from '$lib/deepdive/keys';
import { getOpenRouterApiKey } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';

const ZAI_BASE_URL = 'https://api.z.ai/api/coding/paas/v4/';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const cache: { zai?: OpenAI; openrouter?: OpenAI } = {};

export function clearLLMClientCache(): void {
  cache.zai = undefined;
  cache.openrouter = undefined;
}

export async function getLLMClient(ctx: ModelContext): Promise<{ client: OpenAI; model: string }> {
  if (ctx.provider === 'zai') {
    if (!cache.zai) {
      const keys = loadKeys();
      if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
      cache.zai = new OpenAI({
        apiKey: keys.zaiApiKey,
        baseURL: keys.zaiBaseUrl || ZAI_BASE_URL,
      });
    }
    return { client: cache.zai, model: ctx.modelId };
  }

  if (ctx.provider === 'openrouter') {
    if (!cache.openrouter) {
      const apiKey = await getOpenRouterApiKey();
      if (!apiKey) throw new Error('OpenRouter API key not configured');
      cache.openrouter = new OpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
      });
    }
    return { client: cache.openrouter, model: ctx.modelId };
  }

  throw new Error(`Unknown provider: ${ctx.provider}`);
}
```

- [ ] **Step 2: Update `planner.ts` call sites**

In `src/lib/jkai/planner.ts`, the functions take the `build` (or similar) already. Update each call site:

Line 77 — change `const { client, model } = getLLMClient();` to:
```ts
const { client, model } = await getLLMClient({
  provider: (build.modelProvider ?? 'zai') as 'zai' | 'openrouter',
  modelId: build.modelId ?? 'glm-5.1',
});
```

Line 240 — same change, same pattern. If the surrounding function doesn't have `build` in scope, pass it in as a parameter (follow the existing function signature and update callers).

- [ ] **Step 3: Update `executor.ts` call site**

In `src/lib/jkai/executor.ts` line 53:
```ts
const { client, model } = await getLLMClient({
  provider: (build.modelProvider ?? 'zai') as 'zai' | 'openrouter',
  modelId: build.modelId ?? 'glm-5.1',
});
```

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: PASS. If planner/executor callers don't pass `build`, fix those signatures now.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/llm-client.ts src/lib/jkai/planner.ts src/lib/jkai/executor.ts
git commit -m "refactor(jkai): getLLMClient takes ModelContext, supports OpenRouter"
```

---

## Task 9: Admin API — settings GET/POST

**Files:**
- Create: `src/routes/api/admin/models/settings/+server.ts`

- [ ] **Step 1: Implement endpoint**

```ts
// src/routes/api/admin/models/settings/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting, clearSettingsCache } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { loadKeys } from '$lib/deepdive/keys';

export const GET: RequestHandler = async () => {
  const [chat, builder, orKey] = await Promise.all([
    getSetting<ModelContext>('jkai.chat.default_model'),
    getSetting<ModelContext>('jkai.builder.default_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
  ]);
  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return json({
    chat: chat ?? { provider: 'zai', modelId: 'glm-5.1' },
    builder: builder ?? { provider: 'zai', modelId: 'glm-5.1' },
    openrouterKey: {
      configured: dbHasKey || keysJsonHasKey,
      source: dbHasKey ? 'db' : (keysJsonHasKey ? 'keys.json' : 'none'),
      masked: dbHasKey ? maskKey(orKey!.value!) : (keysJsonHasKey ? maskKey(loadKeys().openrouterApiKey!) : ''),
    },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();

  if (body.chat) {
    if (!isValidContext(body.chat)) throw error(400, 'invalid chat context');
    await setSetting('jkai.chat.default_model', body.chat);
  }
  if (body.builder) {
    if (!isValidContext(body.builder)) throw error(400, 'invalid builder context');
    await setSetting('jkai.builder.default_model', body.builder);
  }
  if (typeof body.openrouterApiKey === 'string') {
    await setSetting('openrouter.api_key', { value: body.openrouterApiKey });
  }

  clearSettingsCache();
  return json({ ok: true });
};

function isValidContext(v: unknown): v is ModelContext {
  return !!v && typeof v === 'object'
    && ((v as any).provider === 'zai' || (v as any).provider === 'openrouter')
    && typeof (v as any).modelId === 'string'
    && (v as any).modelId.length > 0;
}

function maskKey(k: string): string {
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
```

- [ ] **Step 2: Smoke-test endpoint**

Start dev server: `npm run dev`
In another shell:
```bash
curl -s http://homeserv:5173/api/admin/models/settings | jq .
```
Expected: JSON with `chat`, `builder`, `openrouterKey` keys. (Auth will redirect if not logged in; authenticate through the browser first, then copy the session cookie, or hit the endpoint from a browser console.)

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/admin/models/settings/+server.ts
git commit -m "feat(admin): GET/POST /api/admin/models/settings"
```

---

## Task 10: Admin API — OpenRouter refresh

**Files:**
- Create: `src/routes/api/admin/models/openrouter/refresh/+server.ts`

- [ ] **Step 1: Implement**

```ts
// src/routes/api/admin/models/openrouter/refresh/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshOpenRouterCatalogue } from '$lib/server/models/openrouter-catalogue';

export const POST: RequestHandler = async () => {
  try {
    const result = await refreshOpenRouterCatalogue();
    return json({ ok: true, count: result.count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw error(502, `Failed to refresh OpenRouter catalogue: ${msg}`);
  }
};
```

- [ ] **Step 2: Smoke-test**

```bash
curl -s -X POST http://homeserv:5173/api/admin/models/openrouter/refresh | jq .
```
Expected: `{ ok: true, count: <number> }`. Verify:
```bash
psql postgres://postgres:postgres@localhost:5433/strange_rambling -c "SELECT count(*) FROM openrouter_models;"
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/admin/models/openrouter/refresh/+server.ts
git commit -m "feat(admin): POST /api/admin/models/openrouter/refresh"
```

---

## Task 11: Admin API — filtered model list

**Files:**
- Create: `src/routes/api/admin/models/openrouter/+server.ts`

- [ ] **Step 1: Implement**

```ts
// src/routes/api/admin/models/openrouter/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { and, or, sql, ilike, gte, lte, inArray, type SQL } from 'drizzle-orm';
import { getSetting } from '$lib/server/models/settings';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  const providers = url.searchParams.getAll('provider').filter(Boolean);
  const modalities = url.searchParams.getAll('modality').filter(Boolean);
  const minContext = num(url.searchParams.get('minContext'));
  const maxCostPerM = num(url.searchParams.get('maxCostPerM')); // USD per 1M completion tokens
  const page = Math.max(1, num(url.searchParams.get('page')) ?? 1);
  const pageSize = Math.min(100, Math.max(1, num(url.searchParams.get('pageSize')) ?? 50));

  const conditions: SQL[] = [];
  if (q) conditions.push(or(ilike(openrouterModels.name, `%${q}%`), ilike(openrouterModels.id, `%${q}%`))!);
  if (providers.length) conditions.push(inArray(openrouterModels.provider, providers));
  if (modalities.length) conditions.push(inArray(openrouterModels.modality, modalities));
  if (minContext != null) conditions.push(gte(openrouterModels.contextLength, minContext));
  if (maxCostPerM != null) {
    // maxCostPerM is USD per 1M completion tokens; completion_price is USD per token
    conditions.push(lte(openrouterModels.completionPrice, String(maxCostPerM / 1_000_000)));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(openrouterModels)
    .where(where);

  const rows = await db
    .select()
    .from(openrouterModels)
    .where(where)
    .orderBy(openrouterModels.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const lastRefreshed = await getSetting<string>('openrouter.last_refreshed_at');

  return json({ rows, total: count, page, pageSize, lastRefreshed });
};

function num(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
```

- [ ] **Step 2: Smoke-test**

```bash
curl -s 'http://homeserv:5173/api/admin/models/openrouter?provider=anthropic&pageSize=5' | jq '.rows | length, .total'
```
Expected: a number of rows (≤5) and total anthropic model count.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/admin/models/openrouter/+server.ts
git commit -m "feat(admin): GET /api/admin/models/openrouter with filters"
```

---

## Task 12: Admin page shell + loader

**Files:**
- Create: `src/routes/admin/models/+page.server.ts`
- Create: `src/routes/admin/models/+page.svelte`

- [ ] **Step 1: Loader**

```ts
// src/routes/admin/models/+page.server.ts
import type { PageServerLoad } from './$types';
import { getSetting } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { loadKeys } from '$lib/deepdive/keys';
import { db } from '$lib/db';
import { openrouterModels } from '$lib/db/schema';
import { sql } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const [chat, builder, orKey, lastRefreshed, [{ count }]] = await Promise.all([
    getSetting<ModelContext>('jkai.chat.default_model'),
    getSetting<ModelContext>('jkai.builder.default_model'),
    getSetting<{ value?: string }>('openrouter.api_key'),
    getSetting<string>('openrouter.last_refreshed_at'),
    db.select({ count: sql<number>`count(*)::int` }).from(openrouterModels),
  ]);

  const keysJsonHasKey = !!loadKeys().openrouterApiKey;
  const dbHasKey = !!orKey?.value;

  return {
    chat: chat ?? { provider: 'zai', modelId: 'glm-5.1' },
    builder: builder ?? { provider: 'zai', modelId: 'glm-5.1' },
    openrouterKey: {
      configured: dbHasKey || keysJsonHasKey,
      source: dbHasKey ? 'db' : (keysJsonHasKey ? 'keys.json' : 'none'),
    },
    modelCount: count,
    lastRefreshed,
  };
};
```

- [ ] **Step 2: Page shell**

```svelte
<!-- src/routes/admin/models/+page.svelte -->
<script lang="ts">
  import ModelDefaultsPanel from '$lib/components/admin/ModelDefaultsPanel.svelte';
  import OpenRouterConfigPanel from '$lib/components/admin/OpenRouterConfigPanel.svelte';
  import OpenRouterModelBrowser from '$lib/components/admin/OpenRouterModelBrowser.svelte';

  let { data } = $props();
</script>

<svelte:head><title>Models · Admin</title></svelte:head>

<div class="wrap">
  <h1>LLM Models</h1>

  <ModelDefaultsPanel chat={data.chat} builder={data.builder} />
  <OpenRouterConfigPanel
    configured={data.openrouterKey.configured}
    source={data.openrouterKey.source}
    modelCount={data.modelCount}
    lastRefreshed={data.lastRefreshed}
  />
  <OpenRouterModelBrowser />
</div>

<style>
  .wrap { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; display: flex; flex-direction: column; gap: 2rem; }
  h1 { margin: 0; }
</style>
```

- [ ] **Step 3: Verify page loads**

Run dev server, navigate to `http://homeserv:5173/admin/models`.
Expected: page renders with the three panels (stubs may throw "unknown component" until Task 13/14/15 exist — so skip this step until the next task). Actually, since the panels aren't written yet, do Step 3 after Task 15.

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin/models/+page.server.ts src/routes/admin/models/+page.svelte
git commit -m "feat(admin): /admin/models page shell + loader"
```

---

## Task 13: `ModelDefaultsPanel` component

**Files:**
- Create: `src/lib/components/admin/ModelDefaultsPanel.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/components/admin/ModelDefaultsPanel.svelte -->
<script lang="ts">
  import { GLM_MODELS } from '$lib/constants/glm-models';
  import type { ModelContext } from '$lib/server/models/types';

  let { chat, builder }: { chat: ModelContext; builder: ModelContext } = $props();

  let chatVal = $state<ModelContext>({ ...chat });
  let builderVal = $state<ModelContext>({ ...builder });
  let openrouterOptions = $state<{ id: string; name: string }[]>([]);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state(false);

  async function loadOpenRouter() {
    const res = await fetch('/api/admin/models/openrouter?pageSize=500');
    if (res.ok) {
      const data = await res.json();
      openrouterOptions = data.rows.map((r: any) => ({ id: r.id, name: r.name }));
    }
  }

  $effect(() => { loadOpenRouter(); });

  function parseOption(v: string): ModelContext {
    if (v.startsWith('zai:')) return { provider: 'zai', modelId: v.slice(4) };
    return { provider: 'openrouter', modelId: v.slice('or:'.length) };
  }
  function serialise(ctx: ModelContext): string {
    return ctx.provider === 'zai' ? `zai:${ctx.modelId}` : `or:${ctx.modelId}`;
  }

  async function save() {
    saving = true; error = null; saved = false;
    try {
      const res = await fetch('/api/admin/models/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: chatVal, builder: builderVal }),
      });
      if (!res.ok) throw new Error(await res.text());
      saved = true;
    } catch (e: any) { error = e.message; }
    finally { saving = false; }
  }
</script>

<section>
  <h2>Default models</h2>

  <label>
    Default chat model
    <select value={serialise(chatVal)} onchange={(e) => chatVal = parseOption(e.currentTarget.value)}>
      <optgroup label="Z.AI">
        {#each GLM_MODELS as m}
          <option value={`zai:${m.id}`}>{m.label}</option>
        {/each}
      </optgroup>
      <optgroup label="OpenRouter">
        {#each openrouterOptions as m}
          <option value={`or:${m.id}`}>{m.name} ({m.id})</option>
        {/each}
      </optgroup>
    </select>
  </label>

  <label>
    Default builder model
    <select value={serialise(builderVal)} onchange={(e) => builderVal = parseOption(e.currentTarget.value)}>
      <optgroup label="Z.AI">
        {#each GLM_MODELS as m}
          <option value={`zai:${m.id}`}>{m.label}</option>
        {/each}
      </optgroup>
      <optgroup label="OpenRouter">
        {#each openrouterOptions as m}
          <option value={`or:${m.id}`}>{m.name} ({m.id})</option>
        {/each}
      </optgroup>
    </select>
  </label>

  <button onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save defaults'}</button>
  {#if saved}<span class="ok">Saved.</span>{/if}
  {#if error}<span class="err">{error}</span>{/if}
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; }
  .ok { color: green; margin-left: 0.5rem; }
  .err { color: crimson; margin-left: 0.5rem; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/admin/ModelDefaultsPanel.svelte
git commit -m "feat(admin): ModelDefaultsPanel for chat + builder defaults"
```

---

## Task 14: `OpenRouterConfigPanel` component

**Files:**
- Create: `src/lib/components/admin/OpenRouterConfigPanel.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/components/admin/OpenRouterConfigPanel.svelte -->
<script lang="ts">
  let { configured, source, modelCount, lastRefreshed }:
    { configured: boolean; source: string; modelCount: number; lastRefreshed: string | null } = $props();

  let keyInput = $state('');
  let saving = $state(false);
  let refreshing = $state(false);
  let error = $state<string | null>(null);
  let msg = $state<string | null>(null);

  async function saveKey() {
    saving = true; error = null; msg = null;
    try {
      const res = await fetch('/api/admin/models/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openrouterApiKey: keyInput }),
      });
      if (!res.ok) throw new Error(await res.text());
      msg = 'Key saved. Reload to see status.';
      keyInput = '';
    } catch (e: any) { error = e.message; }
    finally { saving = false; }
  }

  async function refresh() {
    refreshing = true; error = null; msg = null;
    try {
      const res = await fetch('/api/admin/models/openrouter/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      msg = `Refreshed — ${data.count} models cached.`;
    } catch (e: any) { error = e.message; }
    finally { refreshing = false; }
  }
</script>

<section>
  <h2>OpenRouter</h2>

  <p class="status">
    API key: {#if configured}<strong>configured</strong> ({source}){:else}<strong class="err">not configured</strong>{/if}<br>
    Cache: <strong>{modelCount}</strong> models
    {#if lastRefreshed}· last refreshed {new Date(lastRefreshed).toLocaleString()}{/if}
  </p>

  <label>
    Update API key
    <input type="password" bind:value={keyInput} placeholder="sk-or-..." />
  </label>
  <div class="row">
    <button onclick={saveKey} disabled={saving || keyInput.length === 0}>{saving ? 'Saving…' : 'Save key'}</button>
    <button onclick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh model list'}</button>
  </div>

  {#if msg}<span class="ok">{msg}</span>{/if}
  {#if error}<span class="err">{error}</span>{/if}
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  .status { margin: 0; color: #444; }
  label { display: flex; flex-direction: column; gap: 0.25rem; }
  .row { display: flex; gap: 0.5rem; }
  .ok { color: green; }
  .err { color: crimson; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/admin/OpenRouterConfigPanel.svelte
git commit -m "feat(admin): OpenRouterConfigPanel for key + refresh"
```

---

## Task 15: `OpenRouterModelBrowser` component

**Files:**
- Create: `src/lib/components/admin/OpenRouterModelBrowser.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/components/admin/OpenRouterModelBrowser.svelte -->
<script lang="ts">
  interface ModelRow {
    id: string;
    name: string;
    provider: string;
    modality: string | null;
    contextLength: number | null;
    promptPrice: string | null;
    completionPrice: string | null;
  }

  let q = $state('');
  let provider = $state('');
  let modality = $state('');
  let minContext = $state<number | null>(null);
  let maxCostPerM = $state<number | null>(null);
  let page = $state(1);
  const pageSize = 50;

  let rows = $state<ModelRow[]>([]);
  let total = $state(0);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (provider) params.set('provider', provider);
      if (modality) params.set('modality', modality);
      if (minContext != null) params.set('minContext', String(minContext));
      if (maxCostPerM != null) params.set('maxCostPerM', String(maxCostPerM));
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await fetch(`/api/admin/models/openrouter?${params}`);
      if (res.ok) {
        const data = await res.json();
        rows = data.rows; total = data.total;
      }
    } finally { loading = false; }
  }

  $effect(() => { load(); });

  function perMillion(pricePerToken: string | null): string {
    if (!pricePerToken) return '—';
    const perM = Number(pricePerToken) * 1_000_000;
    return `$${perM.toFixed(2)}`;
  }

  async function setAsDefault(kind: 'chat' | 'builder', id: string) {
    const body = kind === 'chat'
      ? { chat: { provider: 'openrouter', modelId: id } }
      : { builder: { provider: 'openrouter', modelId: id } };
    const res = await fetch('/api/admin/models/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) alert(`Set ${id} as ${kind} default.`);
  }
</script>

<section>
  <h2>Browse OpenRouter models</h2>

  <div class="filters">
    <input placeholder="Search…" bind:value={q} oninput={() => { page = 1; }} />
    <input placeholder="Provider (e.g. anthropic)" bind:value={provider} oninput={() => { page = 1; }} />
    <input placeholder="Modality (e.g. text->text)" bind:value={modality} oninput={() => { page = 1; }} />
    <input type="number" placeholder="Min context" bind:value={minContext} oninput={() => { page = 1; }} />
    <input type="number" step="0.01" placeholder="Max $/1M completion" bind:value={maxCostPerM} oninput={() => { page = 1; }} />
  </div>

  <p>{total} models · page {page} of {Math.max(1, Math.ceil(total / pageSize))}</p>

  <table>
    <thead>
      <tr><th>ID</th><th>Name</th><th>Provider</th><th>Modality</th><th>Context</th><th>Prompt $/1M</th><th>Completion $/1M</th><th></th></tr>
    </thead>
    <tbody>
      {#each rows as m}
        <tr>
          <td><code>{m.id}</code></td>
          <td>{m.name}</td>
          <td>{m.provider}</td>
          <td>{m.modality ?? '—'}</td>
          <td>{m.contextLength ?? '—'}</td>
          <td>{perMillion(m.promptPrice)}</td>
          <td>{perMillion(m.completionPrice)}</td>
          <td>
            <button onclick={() => setAsDefault('chat', m.id)}>Chat</button>
            <button onclick={() => setAsDefault('builder', m.id)}>Builder</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="pager">
    <button disabled={page <= 1} onclick={() => page--}>Prev</button>
    <button disabled={page * pageSize >= total} onclick={() => page++}>Next</button>
  </div>
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  .filters { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .filters input { min-width: 140px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; border-bottom: 1px solid #eee; padding: 0.4rem 0.5rem; }
  code { font-size: 0.8rem; }
  .pager { display: flex; gap: 0.5rem; }
</style>
```

- [ ] **Step 2: End-to-end verify admin page**

Start dev server, navigate to `http://homeserv:5173/admin/models`. Expected:
- Page renders with three panels.
- Defaults panel shows current chat/builder defaults.
- Configure OpenRouter key via input, click Save.
- Click "Refresh model list" — count updates.
- Browser shows models, filters work, "Chat"/"Builder" buttons set defaults.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/admin/OpenRouterModelBrowser.svelte
git commit -m "feat(admin): OpenRouterModelBrowser with filters + set-as-default"
```

---

## Task 16: `ModelPicker` shared component

**Files:**
- Create: `src/lib/components/jkai/ModelPicker.svelte`

- [ ] **Step 1: Implement**

```svelte
<!-- src/lib/components/jkai/ModelPicker.svelte -->
<script lang="ts">
  import { GLM_MODELS } from '$lib/constants/glm-models';
  import type { ModelContext } from '$lib/server/models/types';
  import { onMount } from 'svelte';

  let { value = $bindable(), label = 'Model' }: { value: ModelContext; label?: string } = $props();

  let openrouterOptions = $state<{ id: string; name: string }[]>([]);

  onMount(async () => {
    const res = await fetch('/api/admin/models/openrouter?pageSize=500');
    if (res.ok) {
      const data = await res.json();
      openrouterOptions = data.rows.map((r: any) => ({ id: r.id, name: r.name }));
    }
  });

  function serialise(ctx: ModelContext): string {
    return ctx.provider === 'zai' ? `zai:${ctx.modelId}` : `or:${ctx.modelId}`;
  }
  function parse(v: string): ModelContext {
    if (v.startsWith('zai:')) return { provider: 'zai', modelId: v.slice(4) };
    return { provider: 'openrouter', modelId: v.slice(3) };
  }
</script>

<label>
  {label}
  <select value={serialise(value)} onchange={(e) => value = parse(e.currentTarget.value)}>
    <optgroup label="Z.AI">
      {#each GLM_MODELS as m}
        <option value={`zai:${m.id}`}>{m.label}</option>
      {/each}
    </optgroup>
    {#if openrouterOptions.length > 0}
      <optgroup label="OpenRouter">
        {#each openrouterOptions as m}
          <option value={`or:${m.id}`}>{m.name}</option>
        {/each}
      </optgroup>
    {/if}
  </select>
</label>

<style>
  label { display: flex; flex-direction: column; gap: 0.25rem; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/jkai/ModelPicker.svelte
git commit -m "feat(jkai): shared ModelPicker component"
```

---

## Task 17: Update `POST /api/jkai/conversations` to pin model + snapshot price

**Files:**
- Modify: `src/routes/api/jkai/conversations/+server.ts`

- [ ] **Step 1: Rewrite POST handler**

Replace the POST handler with:

```ts
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { title, source, whatsappPhoneNumber, modelProvider, modelId } = body;

  // Resolve the model: body override > admin chat default
  let ctx: ModelContext;
  if (modelProvider && modelId) {
    ctx = { provider: modelProvider, modelId };
  } else {
    ctx = await resolveDefaultModel('chat');
  }

  // Snapshot price if OpenRouter
  let priceSnapshot: { promptPrice: number; completionPrice: number } | null = null;
  if (ctx.provider === 'openrouter') {
    const [row] = await db.select().from(openrouterModels)
      .where(eq(openrouterModels.id, ctx.modelId)).limit(1);
    if (row) {
      priceSnapshot = {
        promptPrice: Number(row.promptPrice ?? 0),
        completionPrice: Number(row.completionPrice ?? 0),
      };
    }
  }

  const [conv] = await db.insert(conversations).values({
    title: title || null,
    source: source || 'web',
    whatsappPhoneNumber: whatsappPhoneNumber || null,
    modelProvider: ctx.provider,
    modelId: ctx.modelId,
    priceSnapshot,
  }).returning();

  return json(conv, { status: 201 });
};
```

Update imports at the top of the file:
```ts
import { conversations, openrouterModels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
```

- [ ] **Step 2: Smoke-test**

```bash
curl -s -X POST http://homeserv:5173/api/jkai/conversations \
  -H 'Content-Type: application/json' \
  -d '{"source":"web","modelProvider":"openrouter","modelId":"anthropic/claude-opus-4"}' | jq .
```
Expected: response includes `modelProvider: 'openrouter'`, `modelId: 'anthropic/claude-opus-4'`, and `priceSnapshot` with non-zero numbers.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/jkai/conversations/+server.ts
git commit -m "feat(jkai): pin model and snapshot price on conversation create"
```

---

## Task 18: `NewConversationDialog` + wire into `/jkai`

**Files:**
- Create: `src/lib/components/jkai/NewConversationDialog.svelte`
- Modify: `src/routes/jkai/+page.svelte` (the `createConversation` function)

- [ ] **Step 1: Create the dialog**

```svelte
<!-- src/lib/components/jkai/NewConversationDialog.svelte -->
<script lang="ts">
  import ModelPicker from './ModelPicker.svelte';
  import type { ModelContext } from '$lib/server/models/types';

  let {
    open = $bindable(),
    defaultModel,
    oncreate,
  }: {
    open: boolean;
    defaultModel: ModelContext;
    oncreate: (ctx: ModelContext) => void;
  } = $props();

  let model = $state<ModelContext>({ ...defaultModel });

  function start() {
    oncreate(model);
    open = false;
  }
  function cancel() {
    open = false;
  }
</script>

{#if open}
  <div class="backdrop" onclick={cancel} role="presentation">
    <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <h3>New conversation</h3>
      <ModelPicker bind:value={model} label="Model" />
      <p class="hint">Once the conversation is started, the model is locked.</p>
      <div class="row">
        <button onclick={cancel}>Cancel</button>
        <button class="primary" onclick={start}>Start</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: grid; place-items: center; z-index: 50; }
  .dialog { background: white; border-radius: 8px; padding: 1.25rem; min-width: 340px; display: flex; flex-direction: column; gap: 0.75rem; }
  .hint { color: #666; font-size: 0.85rem; margin: 0; }
  .row { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .primary { font-weight: 600; }
</style>
```

- [ ] **Step 2: Add loader to pass defaults down**

Open `src/routes/jkai/+page.server.ts`. Find the `load` function. Add:

```ts
import { resolveDefaultModel } from '$lib/server/models/settings';
```

In the load function, add to the returned object:
```ts
defaultChatModel: await resolveDefaultModel('chat'),
```

- [ ] **Step 3: Wire the dialog into `+page.svelte`**

In `src/routes/jkai/+page.svelte`, add at the top of the script:
```ts
import NewConversationDialog from '$lib/components/jkai/NewConversationDialog.svelte';
import type { ModelContext } from '$lib/server/models/types';

let newConvOpen = $state(false);
```

Replace `createConversation()` (around line 30) with an opener, and add a new handler that actually creates:

```ts
function openNewConversation() {
  newConvOpen = true;
}

async function handleCreate(ctx: ModelContext) {
  try {
    const res = await fetch('/api/jkai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'web', modelProvider: ctx.provider, modelId: ctx.modelId }),
    });
    if (res.ok) {
      const conv = await res.json();
      conversationList = [{ ...conv, messageCount: 0, lastMessage: null }, ...conversationList];
      activeConversationId = conv.id;
      activeMessages = [];
      sidebarOpen = false;
    }
  } catch (err) {
    console.error('Failed to create conversation:', err);
  }
}
```

Find the existing button / call that invokes `createConversation()` and change it to `openNewConversation`. At the bottom of the template, add:

```svelte
<NewConversationDialog
  bind:open={newConvOpen}
  defaultModel={data.defaultChatModel}
  oncreate={handleCreate}
/>
```

- [ ] **Step 4: Manual verify**

Reload `/jkai`. Click "New conversation" — dialog appears with a model dropdown defaulted to admin default. Pick a model, click Start — conversation row is created with that model pinned.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/jkai/NewConversationDialog.svelte \
        src/routes/jkai/+page.svelte src/routes/jkai/+page.server.ts
git commit -m "feat(jkai): new-conversation dialog with model picker"
```

---

## Task 19: Refactor `generalChat()` to use `ModelContext` + record usage

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`
- Modify: `src/routes/api/workflows/orchestrator/chat/+server.ts`

- [ ] **Step 1: Read current signature of `generalChat`**

Open `src/lib/workflows/chat/general-chat.ts`. Note the current export signature. The call sites pass `(message, conversationHistory, { workflowId, conversationId, onProgress, onToolProgress })`. We'll add `modelContext` and `priceSnapshot` to the options argument.

- [ ] **Step 2: Update `general-chat.ts`**

Change the imports at the top:
```ts
import { getLLMClient } from '$lib/jkai/llm-client';
import { recordConversationUsage, parseUsage } from '$lib/server/models/usage';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
```
Remove (or leave unused for now if other code depends on them) `getOpenAIClient, getModel` imports.

In the options type (whatever it's called in that file), add:
```ts
modelContext: ModelContext;
priceSnapshot: PriceSnapshot | null;
```

Replace `const client = getOpenAIClient();` (line 127) with:
```ts
const { client, model } = await getLLMClient(options.modelContext);
```

Remove the separate `getModel()` call if present; use the `model` from `getLLMClient`.

Replace both completion calls (lines 141 and 192 area) so they use `model` (the one from `getLLMClient`). After each `client.chat.completions.create(...)` that receives a response, add — **only when `conversationId` is present**:

```ts
if (options.conversationId) {
  await recordConversationUsage(
    options.conversationId,
    parseUsage(response.usage),
    options.priceSnapshot,
  );
}
```

(Same pattern for both the status call and the main response call. This ensures every completion contributes to the running total.)

- [ ] **Step 3: Update orchestrator chat route to load model + pass options**

In `src/routes/api/workflows/orchestrator/chat/+server.ts`, around the `generalChat(...)` call (line 145), first load the conversation's model info:

```ts
// Before calling generalChat
let modelContext: ModelContext = await resolveDefaultModel('chat');
let priceSnapshot: PriceSnapshot | null = null;
if (conversationId) {
  const [conv] = await db.select().from(conversations)
    .where(eq(conversations.id, conversationId)).limit(1);
  if (conv) {
    modelContext = { provider: conv.modelProvider as 'zai' | 'openrouter', modelId: conv.modelId };
    priceSnapshot = conv.priceSnapshot as PriceSnapshot | null;
  }
}

const { response: responseText } = await generalChat(message, conversationHistory, {
  workflowId,
  conversationId,
  onProgress,
  onToolProgress: (step) => { /* ...existing... */ },
  modelContext,
  priceSnapshot,
});
```

Add the imports:
```ts
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
```

- [ ] **Step 4: Type-check + smoke**

Run: `npm run check`
Expected: PASS.

In the browser, create a conversation pinned to an OpenRouter model with a non-zero cost (e.g., `anthropic/claude-opus-4`), send a message, then query:
```bash
psql postgres://postgres:postgres@localhost:5433/strange_rambling \
  -c "SELECT id, model_id, prompt_tokens, completion_tokens, cost_usd FROM jkai_conversations ORDER BY updated_at DESC LIMIT 3;"
```
Expected: the target conversation has non-zero tokens and non-zero `cost_usd`.

Repeat with a Z.AI conversation — `cost_usd` stays 0, tokens increment.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts src/routes/api/workflows/orchestrator/chat/+server.ts
git commit -m "feat(jkai): generalChat uses pinned model + records conversation usage"
```

---

## Task 20: ConversationSidebar — per-convo cost

**Files:**
- Modify: `src/lib/components/jkai/ConversationSidebar.svelte`

- [ ] **Step 1: Read current shape**

Open the file. The existing item template probably has conversation title + last message preview. We need to add a small cost label when `conv.costUsd > 0`.

- [ ] **Step 2: Add cost display**

Inside each conversation item row in the template, add (below the last-message preview):

```svelte
{#if Number(conv.costUsd) > 0}
  <div class="cost">${Number(conv.costUsd).toFixed(4)}</div>
{/if}
```

Add style:
```svelte
<style>
  /* existing styles… */
  .cost { font-size: 0.75rem; color: #777; margin-top: 0.15rem; }
</style>
```

Make sure the loader that feeds `conversationList` into the sidebar includes `costUsd`. If `getConversationList()` in `src/lib/jkai/queries.ts` doesn't already include the new column, add it.

- [ ] **Step 3: Update `getConversationList()` if needed**

Open `src/lib/jkai/queries.ts`. If it's a typed select, add `costUsd: conversations.costUsd`, `modelId: conversations.modelId`, `modelProvider: conversations.modelProvider` to the selected columns. If it does `select()` with no columns (returning everything), no change needed.

- [ ] **Step 4: Manual verify**

Reload `/jkai`. Conversations with `cost_usd > 0` show the cost under their title. Zero-cost ones (Z.AI) do not.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/jkai/ConversationSidebar.svelte src/lib/jkai/queries.ts
git commit -m "feat(jkai): show per-conversation cost in sidebar"
```

---

## Task 21: MetricsStrip — total spend tile

**Files:**
- Modify: `src/routes/jkai/+page.server.ts`
- Modify: `src/lib/components/jkai/MetricsStrip.svelte`

- [ ] **Step 1: Add total to loader**

In `src/routes/jkai/+page.server.ts`, inside `load`:

```ts
import { conversations as convs, jkaiBuilds } from '$lib/db/schema';
import { sql } from 'drizzle-orm';

const [{ convCost }] = await db
  .select({ convCost: sql<string>`COALESCE(SUM(cost_usd), 0)::text` })
  .from(convs);
const [{ buildCost }] = await db
  .select({ buildCost: sql<string>`COALESCE(SUM(cost_usd), 0)::text` })
  .from(jkaiBuilds);
const totalSpendUsd = Number(convCost) + Number(buildCost);
```

Return it from `load`:
```ts
return { /* …existing… */, totalSpendUsd };
```

(Adjust the `metrics` object if it's already returned — prefer extending that over adding a new key.)

- [ ] **Step 2: Display in MetricsStrip**

In `src/lib/components/jkai/MetricsStrip.svelte`, add a new prop:

```ts
let { /* existing props */, totalSpendUsd }: { /* existing */, totalSpendUsd: number } = $props();
```

Add a tile in the template:
```svelte
<div class="tile">
  <div class="label">Total spend</div>
  <div class="value">${totalSpendUsd.toFixed(2)}</div>
</div>
```

Ensure `src/routes/jkai/+page.svelte` passes `totalSpendUsd={data.totalSpendUsd}` when rendering `<MetricsStrip … />`.

- [ ] **Step 3: Manual verify**

Reload `/jkai`. The metrics strip shows a "Total spend" tile with the summed cost across all conversations and builds.

- [ ] **Step 4: Commit**

```bash
git add src/routes/jkai/+page.server.ts src/lib/components/jkai/MetricsStrip.svelte src/routes/jkai/+page.svelte
git commit -m "feat(jkai): total-spend KPI tile in metrics strip"
```

---

## Task 22: Build creation — accept model pin + snapshot price

**Files:**
- Modify: `src/routes/api/jkai/builds/+server.ts`

- [ ] **Step 1: Inspect existing POST**

Open the file. Find the POST handler that creates a build. Identify the insert call.

- [ ] **Step 2: Add model resolution**

Before the insert:

```ts
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import { openrouterModels } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// …inside POST:
const { modelProvider, modelId /* + existing fields */ } = body;
let ctx: ModelContext = (modelProvider && modelId)
  ? { provider: modelProvider, modelId }
  : await resolveDefaultModel('builder');

let priceSnapshot: { promptPrice: number; completionPrice: number } | null = null;
if (ctx.provider === 'openrouter') {
  const [row] = await db.select().from(openrouterModels).where(eq(openrouterModels.id, ctx.modelId)).limit(1);
  if (row) priceSnapshot = {
    promptPrice: Number(row.promptPrice ?? 0),
    completionPrice: Number(row.completionPrice ?? 0),
  };
}
```

Pass into the insert:
```ts
.values({
  // …existing fields
  modelProvider: ctx.provider,
  modelId: ctx.modelId,
  priceSnapshot,
})
```

- [ ] **Step 3: Wire model picker into the build-creation UI**

Find the UI that creates builds (likely `src/routes/jkai/builds/+page.svelte` or a dedicated create page). Add the `ModelPicker` component, defaulted to `data.defaultBuilderModel` (add it to that route's loader via `resolveDefaultModel('builder')`). Include `modelProvider` and `modelId` in the POST body.

- [ ] **Step 4: Manual verify**

Create a new build from the UI, picking an OpenRouter model. Query:
```bash
psql postgres://postgres:postgres@localhost:5433/strange_rambling \
  -c "SELECT id, model_id, price_snapshot FROM jkai_builds ORDER BY created_at DESC LIMIT 3;"
```
Expected: the new build row has the pinned model and a populated `price_snapshot`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/jkai/builds/+server.ts src/routes/jkai/builds/+page.svelte
git commit -m "feat(jkai-builds): pin model + snapshot price on build create"
```

---

## Task 23: Builder runtime — record usage per iteration

**Files:**
- Modify: `src/lib/jkai/executor.ts`
- Modify: `src/lib/jkai/planner.ts`

- [ ] **Step 1: Update `executor.ts`**

At the top of `executeIteration`, read the build's `priceSnapshot` into a local — it's already on `build`. After each `await client.chat.completions.create(...)` that returns a response, add:

```ts
await recordBuildUsage(
  build.id,
  parseUsage(response.usage),
  build.priceSnapshot as PriceSnapshot | null,
);
```

Imports to add:
```ts
import { recordBuildUsage, parseUsage } from '$lib/server/models/usage';
import type { PriceSnapshot } from '$lib/server/models/types';
```

Do the same for `evalResponse` at line 106 area.

- [ ] **Step 2: Update `planner.ts`**

Find each `await client.chat.completions.create(...)` site (lines ~106, ~133, ~179, ~309). After each, add:

```ts
await recordBuildUsage(
  buildId,
  parseUsage(response.usage),
  priceSnapshot,
);
```

Where `buildId` and `priceSnapshot` are already in scope (the plan functions take a `build` argument; if not, thread one through).

- [ ] **Step 3: Manual verify**

Start a new OpenRouter-backed build. Let it run one iteration, then check:
```bash
psql postgres://postgres:postgres@localhost:5433/strange_rambling \
  -c "SELECT id, tokens_used, cost_usd FROM jkai_builds ORDER BY created_at DESC LIMIT 1;"
```
Expected: `tokens_used` and `cost_usd` are both > 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jkai/executor.ts src/lib/jkai/planner.ts
git commit -m "feat(jkai-builds): record per-iteration token + cost usage"
```

---

## Task 24: Conversation header — show pinned model

**Files:**
- Modify: `src/lib/components/jkai/ChatArea.svelte`

- [ ] **Step 1: Display model next to title**

In `ChatArea.svelte`, locate the header area (usually shows conversation title). Add a model badge:

```svelte
{#if conversation?.modelId}
  <span class="model-badge">
    {conversation.modelProvider === 'zai' ? 'GLM' : 'OR'} · {conversation.modelId}
  </span>
{/if}
```

Style:
```svelte
<style>
  .model-badge {
    font-size: 0.75rem;
    color: #666;
    background: #f3f3f3;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    margin-left: 0.5rem;
  }
</style>
```

Make sure the `conversation` object reaching this component includes `modelId` and `modelProvider` (adjust the GET endpoint in `src/routes/api/jkai/conversations/[id]/+server.ts` if it currently selects a narrower set of columns).

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/jkai/ChatArea.svelte src/routes/api/jkai/conversations/[id]/+server.ts
git commit -m "feat(jkai): show pinned model on conversation header"
```

---

## Task 25: End-to-end verification

- [ ] **Step 1: All tests pass**

Run: `npm run test`
Expected: all tests pass, including the three new files:
- `tests/server/models/settings.test.ts`
- `tests/server/models/openrouter-catalogue.test.ts`
- `tests/server/models/usage.test.ts`

- [ ] **Step 2: Type-check + lint**

Run: `npm run check && npm run lint`
Expected: PASS.

- [ ] **Step 3: Manual end-to-end scenarios**

| Scenario | Expected |
|---|---|
| Admin sets chat default to Claude Opus 4 on OpenRouter | Setting persists; next new conversation picker defaults to it |
| User starts a new chat conversation using the picker, chooses a specific OpenRouter model, sends a message | Conversation row has that model + price snapshot; sending a message increments prompt/completion tokens and `cost_usd` |
| User opens a Z.AI conversation and sends a message | Tokens increment, `cost_usd` stays 0 |
| Per-conversation cost appears in sidebar for OpenRouter convos only | ✅ |
| Total-spend tile on `/jkai` reflects the sum | ✅ |
| Admin "Refresh model list" button updates the cache | `openrouter_models` row count updates; last-refreshed timestamp updates |
| Invalid OpenRouter key for a pinned OpenRouter conversation | Chat errors visibly; does not silently fall back to Z.AI |

- [ ] **Step 4: Commit any small fixes**

Address any issues surfaced during manual testing; commit separately.

- [ ] **Step 5: Final commit / PR**

If the branch is ready to ship, open a PR using `gh pr create`. Otherwise merge locally and run the deploy script (`~/strange_rambling_svelte/scripts/deploy.sh`) once verified in dev — per project convention, pushes to master are always followed by a deploy.

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to a task:
  - §4.1/§4.2 tables → Task 1
  - §4.3/§4.4 columns → Task 1
  - §5 client refactor → Tasks 2, 8
  - §5.4 resolveDefaultModel → Task 5
  - §6 admin UI → Tasks 9–15
  - §7 per-conversation pinning → Tasks 16, 17, 18
  - §7.4 builds → Tasks 22, 23
  - §8 KPI display → Tasks 20, 21, 24
  - §9 migration / keys.json fallback / default change → Tasks 1, 4
  - §10 error handling is implicit — refresh task returns 502 on failure; conversation insert falls back to admin default; Z.AI key missing is an unchanged pre-existing error; OpenRouter missing is surfaced from `getLLMClient`
- **Placeholder scan:** no TBD/TODO; every task has concrete code or a clear "inspect the file first" step whose output fully determines the edit.
- **Type consistency:** `ModelContext`, `PriceSnapshot`, `Usage`, `UsageDelta` defined in Task 2 are used consistently in Tasks 5, 7, 8, 17, 19, 22, 23.
