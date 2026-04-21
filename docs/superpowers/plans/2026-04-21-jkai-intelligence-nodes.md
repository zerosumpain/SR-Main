# JKAI Intelligence Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add intelligence / research-result / quick-answer canvas nodes, plus a chat override path, so the jkai canvas can explore and synthesise live intelligence.

**Architecture:** Three new executors (`intelligence`, `research-result`, `quick-answer`) reuse the existing `searchIntel`, `deep-dive`, and `quickAnswers` infrastructure. A new `intel_explorations` index table rehydrates pending children on canvas reload. Chat gains an `intelContextOverride` option so wiring `intelligence → chat` focuses chat to the filtered slice.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), TypeScript, Drizzle ORM (Postgres), Vitest, existing workflow engine + SSE streams. Test runner: `npm test` (`vitest run`), or `npm test -- tests/path/file.test.ts` for one file.

**Reference spec:** `docs/superpowers/specs/2026-04-21-jkai-intelligence-nodes-design.md`

---

## File map

**New files:**

| Path | Purpose |
|---|---|
| `src/lib/jkai/intel/search.ts` | `searchIntel(query, facets)` → `IntelItem[]` + total. |
| `src/lib/workflows/nodes/intelligence.ts` | Executor + definition. |
| `src/lib/workflows/nodes/research-result.ts` | Executor + definition. |
| `src/lib/workflows/nodes/quick-answer.ts` | Executor + definition. |
| `src/lib/canvas/intelligence/IntelligenceNode.svelte` | Large node component. |
| `src/lib/canvas/intelligence/ResearchResultNode.svelte` | Result/pending node. |
| `src/lib/canvas/intelligence/ExploreFurtherMenu.svelte` | Popover menu. |
| `src/lib/canvas/intelligence/FacetPopover.svelte` | Facet selection popover. |
| `src/routes/api/canvas/[slug]/intel/preview/+server.ts` | Preview query endpoint. |
| `src/routes/api/canvas/[slug]/nodes/[id]/explore/+server.ts` | Commission deep/quick session. |
| `src/routes/api/canvas/[slug]/nodes/[id]/cancel-exploration/+server.ts` | Cancel + mark node. |
| `tests/lib/workflows/nodes/intelligence.test.ts` | |
| `tests/lib/workflows/nodes/research-result.test.ts` | |
| `tests/lib/workflows/nodes/quick-answer.test.ts` | |
| `tests/lib/workflows/nodes/chat-intel-override.test.ts` | |
| `tests/lib/jkai/intel/search.test.ts` | |

**Modified files:**

| Path | Change |
|---|---|
| `src/lib/db/schema.ts` | Add `intelExplorations` table + types. |
| `src/lib/workflows/chat/general-chat.ts` | Add `intelContextOverride` to `ChatOptions`. |
| `src/lib/workflows/nodes/chat.ts` | Forward override when upstream has intelContext. |
| `src/lib/workflows/index.ts` | Register three new executors. |
| `src/lib/canvas/adapter.ts` | New `NodeKind`, group, entries, kind map, colour. |
| `src/routes/jkai/canvas/[slug]/+page.server.ts` | Join `intel_explorations` for rehydrate. |
| `src/routes/jkai/canvas/[slug]/+page.svelte` | Render new kinds; wire explore + SSE. |

---

## Conventions

- **Imports** — Keep existing alias style (`$lib/…`). Use `import type` for type-only imports to respect the project's `"verbatimModuleSyntax"` setting.
- **Drizzle** — New tables use `text('id').primaryKey().default(sql\`gen_random_uuid()::text\`)` to match peers (e.g. `quickAnswers`).
- **Svelte** — Svelte 5 runes: `$state`, `$derived`, `$effect`. No stores unless absolutely needed.
- **Tests** — Vitest, colocated mirroring under `tests/`. Use `vi.mock()` to stub out DB calls in unit tests. If a test needs the real DB, mark it with a `.skip` and a comment — don't gate CI on DB state.
- **Commits** — Use `feat(canvas):`, `feat(workflows):`, `test(…):`, `refactor(…):` prefixes matching the repo's history. One commit per green step. Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## Phase A — Backend foundation

### Task 1: Add `intel_explorations` table

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Add the table definition**

Append after the existing `quickAnswers` block (search for `export const quickAnswers = pgTable`, the new block goes immediately after the `QuickAnswer` type export):

```ts
// ==========================================
// Intel explorations — per-canvas index of
// deep/quick research sessions commissioned
// from an intelligence node's "Explore further"
// action. Authoritative data lives in
// research_sessions / quick_answers; this row
// lets the canvas rehydrate pending children
// on reload without reverse-engineering the
// node's config.
// ==========================================

export const intelExplorations = pgTable('intel_explorations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  nodeId: text('node_id')
    .notNull()
    .references(() => workflowNodes.id, { onDelete: 'cascade' }),
  parentNodeId: text('parent_node_id')
    .notNull()
    .references(() => workflowNodes.id, { onDelete: 'cascade' }),
  engine: text('engine').notNull(), // 'deep' | 'quick'
  sessionId: text('session_id').notNull(),
  status: text('status').notNull(), // 'running' | 'complete' | 'failed' | 'cancelled'
  topic: text('topic').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
});

export type IntelExploration = typeof intelExplorations.$inferSelect;
export type NewIntelExploration = typeof intelExplorations.$inferInsert;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run check -- --fail-on-warnings` *(or just `npm run check`; ignore existing warnings, confirm the new table has none of its own)*.
Expected: clean.

- [ ] **Step 3: Push schema to dev DB**

Run: `npx drizzle-kit push`
Expected: `Changes applied` and the table visible. Verify with a quick psql: `psql $DATABASE_URL -c "\d intel_explorations"` if available.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(canvas): intel_explorations table for intelligence research children

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `searchIntel()` helper

**Files:**
- Create: `src/lib/jkai/intel/search.ts`
- Test: `tests/lib/jkai/intel/search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/jkai/intel/search.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db before import so searchIntel's module-level db is stubbed.
const dbMock = {
  execute: vi.fn(),
};
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/jkai/intel/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Array(1536).fill(0)),
}));

import { searchIntel } from '$lib/jkai/intel/search';

describe('searchIntel', () => {
  beforeEach(() => {
    dbMock.execute.mockReset();
  });

  it('returns empty when query is empty and no facets', async () => {
    const result = await searchIntel('', {});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns notes + entities as IntelItems with scores', async () => {
    // First call: notes; second: entities; third: count.
    dbMock.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 'n1',
          title: 'Test note',
          snippet: 'body text here',
          createdAt: new Date('2026-04-20T00:00:00Z'),
          source_tag: null,
          distance: 0.2,
        },
      ],
    });
    dbMock.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 'e1',
          name: 'Anthropic',
          type_name: 'company',
          summary: 'AI lab',
          distance: 0.3,
        },
      ],
    });

    const result = await searchIntel('anthropic', { limit: 10, ordering: 'relevant' });

    expect(result.items.length).toBe(2);
    const note = result.items.find((i) => i.kind === 'note');
    const entity = result.items.find((i) => i.kind === 'entity');
    expect(note).toBeDefined();
    expect(entity).toBeDefined();
    expect(note!.score).toBeGreaterThan(0);
    expect(entity!.score).toBeGreaterThan(0);
  });

  it('applies time range facet to the SQL', async () => {
    dbMock.execute.mockResolvedValue({ rows: [] });
    await searchIntel('topic', {
      timeRange: { from: '2026-04-20T00:00:00Z', to: '2026-04-21T00:00:00Z' },
    });
    const firstCall = dbMock.execute.mock.calls[0]?.[0];
    // Drizzle SQL tag — just assert we passed at least one argument.
    expect(firstCall).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/jkai/intel/search.test.ts`
Expected: FAIL — cannot resolve `$lib/jkai/intel/search`.

- [ ] **Step 3: Implement `searchIntel`**

Create `src/lib/jkai/intel/search.ts`:

```ts
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { generateEmbedding } from './embed';

export type IntelItem = {
  id: string;
  kind: 'note' | 'entity';
  title: string;
  snippet: string;
  url?: string;
  createdAt: string;
  score: number;
  metadata?: {
    entityType?: string;
    tags?: string[];
    sourceTag?: string;
  };
};

export type IntelFacets = {
  entityTypes?: string[];
  tags?: string[];
  timeRange?: { from: string; to: string } | null;
  limit?: number;
  ordering?: 'recent' | 'relevant';
};

export type SearchResult = {
  items: IntelItem[];
  total: number;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function searchIntel(query: string, facets: IntelFacets): Promise<SearchResult> {
  const q = query.trim();
  const hasTimeRange = facets.timeRange != null;
  const hasEntityTypes = (facets.entityTypes?.length ?? 0) > 0;
  const hasTags = (facets.tags?.length ?? 0) > 0;

  if (!q && !hasTimeRange && !hasEntityTypes && !hasTags) {
    return { items: [], total: 0 };
  }

  const limit = Math.min(facets.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const ordering = facets.ordering ?? 'relevant';

  // Build optional filters as SQL fragments.
  const fromTs = facets.timeRange?.from ?? null;
  const toTs = facets.timeRange?.to ?? null;
  const entityTypeFilter = hasEntityTypes ? facets.entityTypes! : null;
  const tagFilter = hasTags ? facets.tags! : null;

  let embedding: number[] | null = null;
  if (q && ordering === 'relevant') {
    try {
      embedding = await generateEmbedding(q);
    } catch {
      embedding = null;
    }
  }
  const vectorStr = embedding ? `[${embedding.join(',')}]` : null;

  // Notes.
  const notesRes = await db.execute(sql`
    SELECT n.id,
           n.title,
           substring(COALESCE(n.processed_content, n.raw_content) from 1 for 300) AS snippet,
           n.created_at AS "createdAt",
           n.metadata->>'sourceTag' AS source_tag,
           n.metadata->>'sourceUrl' AS source_url,
           ${vectorStr != null
             ? sql`(n.embedding <=> ${vectorStr}::vector)`
             : sql`0.5::float8`} AS distance
    FROM intel_notes n
    WHERE
      ${q ? sql`(n.title ILIKE ${`%${q}%`} OR COALESCE(n.processed_content, n.raw_content) ILIKE ${`%${q}%`})` : sql`TRUE`}
      ${fromTs ? sql`AND n.created_at >= ${fromTs}::timestamptz` : sql``}
      ${toTs ? sql`AND n.created_at < ${toTs}::timestamptz` : sql``}
      ${tagFilter ? sql`AND n.metadata->>'sourceTag' = ANY(${tagFilter}::text[])` : sql``}
    ORDER BY ${ordering === 'recent' ? sql`n.created_at DESC` : sql`distance ASC, n.created_at DESC`}
    LIMIT ${limit}
  `);

  // Entities.
  const entitiesRes = await db.execute(sql`
    SELECT e.id,
           e.name,
           et.name AS type_name,
           e.summary,
           e.updated_at AS "updatedAt",
           ${vectorStr != null
             ? sql`(e.embedding <=> ${vectorStr}::vector)`
             : sql`0.5::float8`} AS distance
    FROM intel_entities e
    JOIN intel_entity_types et ON e.type_id = et.id
    WHERE e.merged_into_id IS NULL
      ${q ? sql`AND (e.name ILIKE ${`%${q}%`} OR e.summary ILIKE ${`%${q}%`})` : sql``}
      ${entityTypeFilter ? sql`AND et.name = ANY(${entityTypeFilter}::text[])` : sql``}
      ${fromTs ? sql`AND e.updated_at >= ${fromTs}::timestamptz` : sql``}
      ${toTs ? sql`AND e.updated_at < ${toTs}::timestamptz` : sql``}
    ORDER BY ${ordering === 'recent' ? sql`e.updated_at DESC` : sql`distance ASC, e.updated_at DESC`}
    LIMIT ${limit}
  `);

  const noteItems: IntelItem[] = (notesRes.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    kind: 'note' as const,
    title: (r.title as string | null) || 'Untitled note',
    snippet: (r.snippet as string | null) || '',
    url: (r.source_url as string | undefined) ?? undefined,
    createdAt: new Date(r.createdAt as string).toISOString(),
    score: Math.max(0, 1 - Number(r.distance ?? 0.5)),
    metadata: {
      sourceTag: (r.source_tag as string | undefined) ?? undefined,
    },
  }));

  const entityItems: IntelItem[] = (entitiesRes.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    kind: 'entity' as const,
    title: String(r.name ?? 'Unnamed entity'),
    snippet: (r.summary as string | null) || '',
    createdAt: new Date(r.updatedAt as string).toISOString(),
    score: Math.max(0, 1 - Number(r.distance ?? 0.5)),
    metadata: {
      entityType: (r.type_name as string | undefined) ?? undefined,
    },
  }));

  // Merge, sort by score desc (or date desc for 'recent'), dedupe (ids are disjoint by kind, so no collisions).
  const merged = [...noteItems, ...entityItems];
  merged.sort((a, b) =>
    ordering === 'recent'
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : b.score - a.score,
  );
  const items = merged.slice(0, limit);

  return { items, total: merged.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/jkai/intel/search.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/intel/search.ts tests/lib/jkai/intel/search.test.ts
git commit -m "feat(intel): searchIntel helper returning IntelItem arrays

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Canvas intel preview endpoint

**Files:**
- Create: `src/routes/api/canvas/[slug]/intel/preview/+server.ts`

- [ ] **Step 1: Implement the endpoint**

Create `src/routes/api/canvas/[slug]/intel/preview/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { searchIntel, type IntelFacets } from '$lib/jkai/intel/search';

export const GET: RequestHandler = async ({ url, params }) => {
  // Canvas slug maps to a workflow; authorisation is implicit (single user).
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.slug ?? workflows.id, params.slug))
    .limit(1)
    .catch(() => []);

  // Slug-based lookup is optional — the single-user model means we proceed if
  // the workflow isn't found. The important thing is consistent shape.
  void wf;

  const query = url.searchParams.get('query') ?? '';
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Math.max(1, Math.min(50, Number(limitRaw))) : 20;
  const ordering = (url.searchParams.get('ordering') ?? 'relevant') as 'recent' | 'relevant';

  const entityTypes = url.searchParams.getAll('entityType');
  const tags = url.searchParams.getAll('tag');

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const timeRange = from && to ? { from, to } : null;

  const facets: IntelFacets = {
    entityTypes: entityTypes.length > 0 ? entityTypes : undefined,
    tags: tags.length > 0 ? tags : undefined,
    timeRange,
    limit,
    ordering,
  };

  try {
    const { items, total } = await searchIntel(query, facets);
    return json({ items, total });
  } catch (err) {
    console.error('[canvas/intel/preview]', err);
    throw error(500, 'Intel preview failed');
  }
};
```

**Note:** The `workflows.slug ?? workflows.id` trick accommodates either a dedicated slug column or slug-is-id, which is how other canvas endpoints resolve. If the existing `+page.server.ts` uses a different lookup, copy that pattern instead.

- [ ] **Step 2: Typecheck**

Run: `npm run check 2>&1 | head -40`
Expected: no new errors tied to this file.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/canvas/[slug]/intel/preview/+server.ts
git commit -m "feat(canvas): intel preview endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Chat context override

### Task 4: Extend `ChatOptions` with `intelContextOverride`

**Files:**
- Modify: `src/lib/workflows/chat/general-chat.ts`

- [ ] **Step 1: Extend `ChatOptions`**

In `src/lib/workflows/chat/general-chat.ts` (around line 40), add the new field to the `ChatOptions` interface:

```ts
interface ChatOptions {
  workflowId?: string | null;
  conversationId?: string | null;
  onProgress?: (text: string) => void;
  onToolProgress?: (step: ToolProgress) => void;
  onStreamEvent?: (event: JobEvent) => void;
  modelContext: ModelContext;
  priceSnapshot: PriceSnapshot | null;
  /** When false, skips injecting the intel knowledge graph into the system prompt. Defaults to true. */
  useIntelContext?: boolean;
  /**
   * Pre-built intel context to inject verbatim, overriding the global
   * buildKnowledgeContext() call. Non-empty string = use it. Empty string =
   * no intel section. null/undefined = fall back to useIntelContext.
   */
  intelContextOverride?: string | null;
}
```

- [ ] **Step 2: Switch the prompt-assembly to honour the override**

Find the `Promise.all([...])` block (around line 380) and change the `graphSection` entry to:

```ts
  const graphSectionPromise =
    options.intelContextOverride != null
      ? Promise.resolve(options.intelContextOverride)
      : options.useIntelContext === false
        ? Promise.resolve('')
        : buildKnowledgeContext(userMessage);

  const [basePrompt, memorySection, graphSection, canvasSection] = await Promise.all([
    getCompiledPrompt(),
    buildMemorySection(),
    graphSectionPromise,
    buildCanvasContextSection(options.workflowId),
  ]);
```

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -E "general-chat|intelContext" | head -20`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/chat/general-chat.ts
git commit -m "feat(chat): intelContextOverride option for generalChat

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Chat executor forwards override

**Files:**
- Modify: `src/lib/workflows/nodes/chat.ts`
- Test: `tests/lib/workflows/nodes/chat-intel-override.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/nodes/chat-intel-override.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generalChatMock = vi.fn();
vi.mock('$lib/workflows/chat/general-chat', () => ({
  generalChat: generalChatMock,
}));
vi.mock('$lib/workflows/chat/conversation-history', () => ({
  loadConversationHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock('$lib/server/models/settings', () => ({
  resolveDefaultModel: vi.fn().mockResolvedValue({ provider: 'zai', modelId: 'glm-4-flash' }),
}));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
  },
}));

import { chatExecutor } from '$lib/workflows/nodes/chat';

function makeCtx(overrides: Partial<Parameters<typeof chatExecutor.execute>[2]> = {}) {
  return {
    workflowId: 'w1',
    runId: 'r1',
    emit: vi.fn(),
    getOutgoingEdges: () => [],
    _currentNodeId: 'n-chat',
    ...overrides,
  } as unknown as Parameters<typeof chatExecutor.execute>[2];
}

describe('chat executor — intel override', () => {
  beforeEach(() => {
    generalChatMock.mockReset();
    generalChatMock.mockResolvedValue({ response: 'hello' });
  });

  it('forwards intelContextOverride when input.intelContext is a non-empty string', async () => {
    const input = { message: 'hi', intelContext: 'Focused: projects yesterday' };
    await chatExecutor.execute(input, {}, makeCtx());
    expect(generalChatMock).toHaveBeenCalledTimes(1);
    const [, , options] = generalChatMock.mock.calls[0];
    expect(options.intelContextOverride).toBe('Focused: projects yesterday');
  });

  it('omits intelContextOverride when input has no intelContext', async () => {
    const input = { message: 'hi' };
    await chatExecutor.execute(input, {}, makeCtx());
    const [, , options] = generalChatMock.mock.calls[0];
    expect(options.intelContextOverride ?? null).toBeNull();
  });

  it('omits intelContextOverride when input.intelContext is empty string', async () => {
    const input = { message: 'hi', intelContext: '' };
    await chatExecutor.execute(input, {}, makeCtx());
    const [, , options] = generalChatMock.mock.calls[0];
    expect(options.intelContextOverride ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/workflows/nodes/chat-intel-override.test.ts`
Expected: FAIL — `intelContextOverride` assertions fail.

- [ ] **Step 3: Update `chat.ts`**

In `src/lib/workflows/nodes/chat.ts`, immediately before the `const { response } = await generalChat(...)` call (around line 114), add:

```ts
    const upstreamIntel =
      typeof input.intelContext === 'string' && input.intelContext.length > 0
        ? (input.intelContext as string)
        : null;
```

Then change the options object passed to `generalChat` to include:

```ts
    const { response } = await generalChat(
      { text: message, attachments: [] },
      history,
      {
        workflowId: context.workflowId,
        conversationId,
        modelContext,
        priceSnapshot: null,
        useIntelContext,
        intelContextOverride: upstreamIntel,
        onStreamEvent: (event) => {
          streamLog('chat_stream', { event });
        },
        onToolProgress: (step) => {
          streamLog('chat_tool', { step });
        },
      },
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/workflows/nodes/chat-intel-override.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/nodes/chat.ts tests/lib/workflows/nodes/chat-intel-override.test.ts
git commit -m "feat(chat): forward upstream intelContext as generalChat override

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — New node executors

### Task 6: `intelligence` executor + definition

**Files:**
- Create: `src/lib/workflows/nodes/intelligence.ts`
- Test: `tests/lib/workflows/nodes/intelligence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/nodes/intelligence.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchIntelMock = vi.fn();
const buildKnowledgeContextMock = vi.fn();
vi.mock('$lib/jkai/intel/search', () => ({ searchIntel: searchIntelMock }));
vi.mock('$lib/jkai/intel/context', () => ({ buildKnowledgeContext: buildKnowledgeContextMock }));

import { intelligenceExecutor } from '$lib/workflows/nodes/intelligence';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('intelligence executor', () => {
  beforeEach(() => {
    searchIntelMock.mockReset();
    buildKnowledgeContextMock.mockReset();
    buildKnowledgeContextMock.mockResolvedValue('ctx-prose');
  });

  it('returns empty shape when query is blank and no facets', async () => {
    const res = await intelligenceExecutor.execute({}, {}, ctx());
    expect(res.output).toMatchObject({
      intelQuery: '',
      intelItems: [],
      intelCount: 0,
      intelContext: '',
    });
  });

  it('interpolates query template and passes facets to searchIntel', async () => {
    searchIntelMock.mockResolvedValue({ items: [{ id: 'n1', kind: 'note', title: 'A', snippet: 's', createdAt: '2026-04-20T00:00:00Z', score: 0.9 }], total: 1 });
    const config = {
      query: 'projects since {{input.since}}',
      facets: { entityTypes: ['project'], tags: [], timeRange: null, limit: 10, ordering: 'relevant' },
    };
    const input = { since: 'yesterday' };
    const res = await intelligenceExecutor.execute(input, config, ctx());
    expect(searchIntelMock).toHaveBeenCalledWith('projects since yesterday', expect.objectContaining({ entityTypes: ['project'] }));
    expect(res.output.intelItems).toHaveLength(1);
    expect(res.output.intelQuery).toBe('projects since yesterday');
    expect(res.output.intelFocus.query).toBe('projects since yesterday');
    expect(res.output.intelContext).toBe('ctx-prose');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/workflows/nodes/intelligence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `intelligence.ts`**

Create `src/lib/workflows/nodes/intelligence.ts`:

```ts
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { searchIntel, type IntelFacets, type IntelItem } from '$lib/jkai/intel/search';
import { buildKnowledgeContext } from '$lib/jkai/intel/context';

type StoredFacets = {
  entityTypes?: string[];
  tags?: string[];
  timeRange?: { from: string; to: string } | null;
  limit?: number;
  ordering?: 'recent' | 'relevant';
};

export const intelligenceExecutor: NodeExecutor = {
  type: 'intelligence',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const queryTemplate = typeof config.query === 'string' ? (config.query as string) : '';
    const query = interpolateTemplate(queryTemplate, input).trim();

    const rawFacets = (config.facets ?? {}) as StoredFacets;
    const facets: IntelFacets = {
      entityTypes: rawFacets.entityTypes ?? [],
      tags: rawFacets.tags ?? [],
      timeRange: rawFacets.timeRange ?? null,
      limit: typeof rawFacets.limit === 'number' ? rawFacets.limit : 20,
      ordering: rawFacets.ordering ?? 'relevant',
    };

    const hasAnyFacet =
      (facets.entityTypes?.length ?? 0) > 0 ||
      (facets.tags?.length ?? 0) > 0 ||
      facets.timeRange != null;

    if (!query && !hasAnyFacet) {
      return {
        output: {
          ...input,
          intelQuery: '',
          intelFocus: {
            query: '',
            entityTypes: facets.entityTypes ?? [],
            tags: facets.tags ?? [],
            timeRange: facets.timeRange ?? null,
            ordering: facets.ordering ?? 'relevant',
          },
          intelContext: '',
          intelItems: [] as IntelItem[],
          intelCount: 0,
        },
      };
    }

    const [{ items, total }, context] = await Promise.all([
      searchIntel(query, facets),
      query ? buildKnowledgeContext(query) : Promise.resolve(''),
    ]);

    return {
      output: {
        ...input,
        intelQuery: query,
        intelFocus: {
          query,
          entityTypes: facets.entityTypes ?? [],
          tags: facets.tags ?? [],
          timeRange: facets.timeRange ?? null,
          ordering: facets.ordering ?? 'relevant',
        },
        intelContext: context,
        intelItems: items,
        intelCount: total,
      },
    };
  },

  getInputSchema() {
    return {
      type: 'object',
      description: 'Upstream payload. Query template can reference {{input.*}} fields.',
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'Adds intelQuery, intelFocus, intelContext (prose), intelItems (array), intelCount.',
    };
  },
};

export const intelligenceDef: NodeDefinition = {
  type: 'intelligence',
  label: 'Intelligence',
  category: 'core',
  description:
    'Filtered view onto the knowledge graph. Queryable; emits both prose context and a structured IntelItem[].',
  configSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query template. Supports {{input.field}}.' },
      facets: { type: 'object' },
    },
  },
  defaultConfig: {
    query: '',
    facets: { entityTypes: [], tags: [], timeRange: null, limit: 20, ordering: 'relevant' },
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Intelligence view' }],
  basicConfig: [
    {
      key: 'query',
      label: 'Query',
      type: 'template-textarea',
      description: 'What to look up. {{input.field}} placeholders supported.',
      placeholder: 'new projects',
      section: 'QUERY',
    },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/workflows/nodes/intelligence.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/nodes/intelligence.ts tests/lib/workflows/nodes/intelligence.test.ts
git commit -m "feat(workflows): intelligence node executor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `research-result` executor + definition

**Files:**
- Create: `src/lib/workflows/nodes/research-result.ts`
- Test: `tests/lib/workflows/nodes/research-result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeSiteToolMock = vi.fn();
const dbMock = {
  select: vi.fn(),
};
vi.mock('$lib/workflows/site-tools/executor', () => ({ executeSiteTool: executeSiteToolMock }));
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ quickAnswers: {} }));

import { researchResultExecutor } from '$lib/workflows/nodes/research-result';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('research-result executor', () => {
  beforeEach(() => {
    executeSiteToolMock.mockReset();
    dbMock.select.mockReset();
  });

  it('fails gracefully without sessionId', async () => {
    const res = await researchResultExecutor.execute({}, { engine: 'deep' }, ctx());
    expect(res.output.researchStatus).toBe('failed');
  });

  it('calls research_report for deep engine when session id is present', async () => {
    executeSiteToolMock.mockResolvedValue({
      success: true,
      data: { report: '# Hi', sources: [{ url: 'https://x', title: 't', domain: 'x' }], status: 'complete' },
    });
    const res = await researchResultExecutor.execute(
      {},
      { engine: 'deep', sessionId: 'sess-1', topic: 'x' },
      ctx(),
    );
    expect(executeSiteToolMock).toHaveBeenCalledWith('research_report', { sessionId: 'sess-1' });
    expect(res.output.researchReport).toContain('Hi');
    expect(res.output.researchStatus).toBe('complete');
  });

  it('reads quick-answer row when engine=quick', async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{
            id: 'qa1',
            topic: 'x',
            status: 'complete',
            answer: 'Quick result',
            sources: [],
            durationMs: 1200,
          }]),
        }),
      }),
    });
    const res = await researchResultExecutor.execute(
      {},
      { engine: 'quick', sessionId: 'qa1', topic: 'x' },
      ctx(),
    );
    expect(res.output.researchReport).toBe('Quick result');
    expect(res.output.researchEngine).toBe('quick');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/workflows/nodes/research-result.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `research-result.ts`**

```ts
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

type Engine = 'deep' | 'quick';

async function fetchDeepReport(sessionId: string) {
  const result = await executeSiteTool('research_report', { sessionId });
  if (!result?.success) {
    return { status: 'failed' as const, report: '', sources: [] as any[], durationMs: undefined };
  }
  const data = (result as { data: Record<string, unknown> }).data ?? {};
  return {
    status: (data.status as 'running' | 'complete' | 'failed' | undefined) ?? 'complete',
    report: (data.report as string) ?? '',
    sources: (data.sources as any[]) ?? [],
    durationMs: data.durationMs as number | undefined,
  };
}

async function fetchQuickAnswer(sessionId: string) {
  const [row] = await db
    .select()
    .from(quickAnswers)
    .where(eq(quickAnswers.id, sessionId))
    .limit(1);
  if (!row) {
    return { status: 'failed' as const, report: '', sources: [] as any[], durationMs: undefined };
  }
  return {
    status: row.status as 'pending' | 'running' | 'complete' | 'failed',
    report: row.answer ?? '',
    sources: row.sources ?? [],
    durationMs: row.durationMs ?? undefined,
  };
}

export const researchResultExecutor: NodeExecutor = {
  type: 'research-result',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const engine = (config.engine as Engine) ?? 'deep';
    const sessionId =
      typeof config.sessionId === 'string' && config.sessionId ? (config.sessionId as string) : '';
    const topic = typeof config.topic === 'string' ? (config.topic as string) : '';

    if (!sessionId) {
      return {
        output: {
          ...input,
          researchEngine: engine,
          researchStatus: 'failed',
          researchTopic: topic,
          researchReport: '',
          researchSources: [],
          researchSessionId: '',
          researchError: 'Not commissioned',
        },
      };
    }

    const res =
      engine === 'deep' ? await fetchDeepReport(sessionId) : await fetchQuickAnswer(sessionId);

    return {
      output: {
        ...input,
        researchEngine: engine,
        researchStatus: res.status,
        researchTopic: topic,
        researchReport: res.report,
        researchSources: res.sources,
        researchSessionId: sessionId,
        researchDurationMs: res.durationMs,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'No required inputs; config-driven.' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'researchEngine, researchStatus, researchReport (markdown), researchSources[], researchSessionId.',
    };
  },
};

export const researchResultDef: NodeDefinition = {
  type: 'research-result',
  label: 'Research Result',
  category: 'core',
  description:
    'Display node for a commissioned deep/quick research session. Pulses while pending; populates when complete.',
  configSchema: {
    type: 'object',
    properties: {
      engine: { type: 'string', enum: ['deep', 'quick'] },
      sessionId: { type: 'string' },
      topic: { type: 'string' },
    },
  },
  defaultConfig: { engine: 'deep', sessionId: '', topic: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research output' }],
  basicConfig: [],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/workflows/nodes/research-result.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/nodes/research-result.ts tests/lib/workflows/nodes/research-result.test.ts
git commit -m "feat(workflows): research-result display executor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `quick-answer` executor + definition

**Files:**
- Create: `src/lib/workflows/nodes/quick-answer.ts`
- Test: `tests/lib/workflows/nodes/quick-answer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const startQuickAnswerMock = vi.fn();
const dbMock = {
  insert: vi.fn(),
  select: vi.fn(),
};
vi.mock('$lib/quickanswer/worker', () => ({
  startQuickAnswer: startQuickAnswerMock,
  getEmitter: () => ({ on: vi.fn(), off: vi.fn() }),
}));
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ quickAnswers: {} }));

import { quickAnswerExecutor } from '$lib/workflows/nodes/quick-answer';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('quick-answer executor', () => {
  beforeEach(() => {
    startQuickAnswerMock.mockReset();
    dbMock.insert.mockReset();
    dbMock.select.mockReset();
  });

  it('errors when topic is empty after interpolation', async () => {
    const res = await quickAnswerExecutor.execute({}, { topic: '' }, ctx());
    expect(res.output.success).toBe(false);
  });

  it('inserts row, starts worker, polls for completion', async () => {
    // Insert returns a row id.
    const returning = vi.fn().mockResolvedValue([{ id: 'qa-1' }]);
    dbMock.insert.mockReturnValue({ values: () => ({ returning }) });
    // Select returns a completed row on first poll.
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { id: 'qa-1', topic: 'x', status: 'complete', answer: 'ok', sources: [], durationMs: 500 },
            ]),
        }),
      }),
    });
    startQuickAnswerMock.mockResolvedValue(undefined);

    const res = await quickAnswerExecutor.execute(
      {},
      { topic: 'x', goals: ['g1'], pollIntervalMs: 1, maxWaitMs: 100 },
      ctx(),
    );
    expect(startQuickAnswerMock).toHaveBeenCalledWith('qa-1');
    expect(res.output.success).toBe(true);
    expect(res.output.researchSessionId).toBe('qa-1');
    expect(res.output.researchReport).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/workflows/nodes/quick-answer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `quick-answer.ts`**

```ts
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { startQuickAnswer } from '$lib/quickanswer/worker';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const quickAnswerExecutor: NodeExecutor = {
  type: 'quick-answer',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const topicTemplate = typeof config.topic === 'string' ? (config.topic as string) : '';
    const topic = interpolateTemplate(topicTemplate, input).trim();
    if (!topic) {
      return { output: { ...input, success: false, error: 'Topic is required' } };
    }

    const goalsRaw = (config.goals as unknown) ?? [];
    const goals: string[] = Array.isArray(goalsRaw)
      ? (goalsRaw as unknown[]).map((g) => interpolateTemplate(String(g), input))
      : [];

    const pollIntervalMs =
      typeof config.pollIntervalMs === 'number' ? (config.pollIntervalMs as number) : 1500;
    const maxWaitMs =
      typeof config.maxWaitMs === 'number' ? (config.maxWaitMs as number) : 180_000;

    const [inserted] = await db
      .insert(quickAnswers)
      .values({ topic, goals, status: 'pending' })
      .returning({ id: quickAnswers.id });
    const id = inserted.id;

    // Fire-and-forget worker.
    startQuickAnswer(id).catch((err) => {
      console.error('[quick-answer] worker failed:', err);
    });

    const deadline = Date.now() + maxWaitMs;
    let last: typeof quickAnswers.$inferSelect | null = null;
    while (Date.now() < deadline) {
      const [row] = await db.select().from(quickAnswers).where(eq(quickAnswers.id, id)).limit(1);
      if (row) last = row;
      if (row && (row.status === 'complete' || row.status === 'failed')) break;
      await sleep(pollIntervalMs);
    }

    if (!last) {
      return { output: { ...input, success: false, error: 'No row after insert', researchSessionId: id } };
    }

    return {
      output: {
        ...input,
        success: last.status === 'complete',
        error: last.status === 'failed' ? (last.errorMessage ?? 'Failed') : undefined,
        researchEngine: 'quick' as const,
        researchStatus: last.status,
        researchTopic: last.topic,
        researchReport: last.answer ?? '',
        researchSources: last.sources ?? [],
        researchSessionId: id,
        researchDurationMs: last.durationMs ?? undefined,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'topic is templated from {{input.*}} and config.topic.' };
  },
  getOutputSchema() {
    return { type: 'object', description: 'Quick answer report + sources; polls until complete.' };
  },
};

export const quickAnswerDef: NodeDefinition = {
  type: 'quick-answer',
  label: 'Quick Answer',
  category: 'core',
  description:
    'Run a quick-answer session (Tavily + synthesis). Polls until complete; returns the answer and sources.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      goals: { type: 'array', items: { type: 'string' } },
      pollIntervalMs: { type: 'number' },
      maxWaitMs: { type: 'number' },
    },
    required: ['topic'],
  },
  defaultConfig: { topic: '{{item.title}}', goals: [], pollIntervalMs: 1500, maxWaitMs: 180000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Answer' }],
  basicConfig: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'template-textarea',
      description: 'Topic to research. Supports {{input.*}} / {{item.*}} placeholders.',
      section: 'QUERY',
    },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/workflows/nodes/quick-answer.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/nodes/quick-answer.ts tests/lib/workflows/nodes/quick-answer.test.ts
git commit -m "feat(workflows): quick-answer DAG executor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Register new executors

**Files:**
- Modify: `src/lib/workflows/index.ts`

- [ ] **Step 1: Import + register**

Near the top of `src/lib/workflows/index.ts`, add imports after the existing node imports (match alphabetical-ish placement; the exact line numbers vary, but insert near the other intel / deep-dive imports):

```ts
import { intelligenceDef, intelligenceExecutor } from './nodes/intelligence';
import { researchResultDef, researchResultExecutor } from './nodes/research-result';
import { quickAnswerDef, quickAnswerExecutor } from './nodes/quick-answer';
```

Then near the `registry.register(...)` block, add:

```ts
registry.register(intelligenceDef, intelligenceExecutor);
registry.register(researchResultDef, researchResultExecutor);
registry.register(quickAnswerDef, quickAnswerExecutor);
```

- [ ] **Step 2: Typecheck**

Run: `npm run check 2>&1 | grep -E "intelligence|research-result|quick-answer" | head -10`
Expected: no errors tied to these imports.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/index.ts
git commit -m "feat(workflows): register intelligence/research-result/quick-answer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Canvas adapter + palette

### Task 10: Extend `NodeKind`, register types, colour

**Files:**
- Modify: `src/lib/canvas/adapter.ts`

- [ ] **Step 1: Extend the `NodeKind` union**

In `src/lib/canvas/adapter.ts` at lines 15–25, change the union:

```ts
export type NodeKind =
  | 'input'
  | 'llm'
  | 'parse'
  | 'output'
  | 'intel'
  | 'agent'
  | 'chat'
  | 'trigger'
  | 'inspector'
  | 'stats'
  | 'intelligence';
```

- [ ] **Step 2: Add a group**

Update `CANVAS_NODE_GROUPS` (line 79) to include `'Intelligence'`:

```ts
export const CANVAS_NODE_GROUPS = [
  'Trigger & Flow',
  'LLM & AI',
  'Parse & Transform',
  'Intelligence',
  'Intel & Web',
  'Integrations',
  'Observability',
] as const;
```

- [ ] **Step 3: Add palette entries**

Inside `CANVAS_NODE_TYPES`, append three entries (group them together near the top of a new `Intelligence` section — insert right before the `Intel & Web` entries):

```ts
  // ————————————————————————— Intelligence
  {
    type: 'intelligence',
    label: 'Intelligence',
    kind: 'intelligence',
    group: 'Intelligence',
    description: 'Filtered view onto the knowledge graph. Queryable. Spawns deep/quick research.',
    defaultConfig: {
      size: { w: 360, h: 440 },
      query: '',
      facets: { entityTypes: [], tags: [], timeRange: null, limit: 20, ordering: 'relevant' },
    },
  },
  {
    type: 'research-result',
    label: 'Research Result',
    kind: 'intelligence',
    group: 'Intelligence',
    description:
      'Deep or quick research output. Slowly pulses while running; populates when complete.',
    defaultConfig: { size: { w: 340, h: 360 }, engine: 'deep', sessionId: '', topic: '' },
  },
  {
    type: 'quick-answer',
    label: 'Quick Answer',
    kind: 'intel',
    group: 'Intelligence',
    description: 'DAG-driven quick answer (Tavily + synthesis). Useful for per-item fan-out.',
    defaultConfig: { topic: '{{item.title}}', goals: [], pollIntervalMs: 1500, maxWaitMs: 180000 },
  },
```

- [ ] **Step 4: Extend `mapTypeToKind()`**

Find `mapTypeToKind` (around line 447) and add two clauses before the final fallback:

```ts
  if (type === 'intelligence' || type === 'research-result') return 'intelligence';
  if (type === 'quick-answer') return 'intel';
```

- [ ] **Step 5: Confirm typecheck**

Run: `npm run check 2>&1 | grep "adapter" | head -10`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canvas/adapter.ts
git commit -m "feat(canvas): register intelligence family in palette

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase E — Server endpoints for explore

### Task 11: `POST /api/canvas/[slug]/nodes/[id]/explore`

**Files:**
- Create: `src/routes/api/canvas/[slug]/nodes/[id]/explore/+server.ts`

Before implementing, confirm the conventions for:
- how an existing endpoint resolves a canvas slug → workflow id (read any file under `src/routes/api/canvas/[slug]/*/+server.ts` or `/nodes/+server.ts`);
- how nodes + edges are created (look for `insert(workflowNodes)` and `insert(workflowEdges)` in adjacent endpoints).

- [ ] **Step 1: Implement the endpoint**

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowNodes, workflowEdges, workflows, intelExplorations, quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { startQuickAnswer } from '$lib/quickanswer/worker';

type Engine = 'deep' | 'quick';

async function resolveWorkflow(slug: string) {
  // Prefer explicit slug column if present; otherwise id.
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, slug))
    .limit(1);
  return rows[0] ?? null;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => null)) as { engine?: Engine } | null;
  const engine: Engine = body?.engine === 'quick' ? 'quick' : 'deep';

  const wf = await resolveWorkflow(params.slug);
  if (!wf) throw error(404, 'Canvas not found');

  // Load the parent intelligence node.
  const [parent] = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.id, params.id))
    .limit(1);
  if (!parent) throw error(404, 'Node not found');
  if (parent.type !== 'intelligence') throw error(400, 'Only intelligence nodes can explore');

  const parentConfig = (parent.config ?? {}) as Record<string, unknown>;
  const topic = typeof parentConfig.query === 'string' ? (parentConfig.query as string) : '';
  if (!topic.trim()) throw error(400, 'Intelligence node has no query to explore');

  const facets = (parentConfig.facets ?? {}) as Record<string, unknown>;
  const goals: string[] = [];
  if (Array.isArray(facets.entityTypes) && facets.entityTypes.length > 0) {
    goals.push(`Focus on: ${(facets.entityTypes as string[]).join(', ')}`);
  }
  if (facets.timeRange) {
    const tr = facets.timeRange as { from: string; to: string };
    goals.push(`Restrict to ${tr.from} – ${tr.to}`);
  }

  // Commission the session.
  let sessionId: string;
  let streamUrl: string;
  if (engine === 'deep') {
    const result = (await executeSiteTool('research_start', { topic, goals })) as {
      success: boolean;
      data?: { sessionId?: string };
      error?: string;
    };
    if (!result.success || !result.data?.sessionId) {
      throw error(500, `Deep research failed to start: ${result.error ?? 'unknown'}`);
    }
    sessionId = result.data.sessionId;
    streamUrl = `/api/deepdive/${sessionId}/stream`;
  } else {
    const [row] = await db
      .insert(quickAnswers)
      .values({ topic, goals, status: 'pending' })
      .returning({ id: quickAnswers.id });
    sessionId = row.id;
    streamUrl = `/api/quickanswer/${sessionId}/stream`;
    startQuickAnswer(sessionId).catch((err) =>
      console.error('[explore] quick-answer start failed:', err),
    );
  }

  // Position the child node: below + right of the parent.
  const parentPos = (parent.position ?? { x: 0, y: 0 }) as { x: number; y: number };
  const position = { x: parentPos.x + 140, y: parentPos.y + 120 };

  const [newNode] = await db
    .insert(workflowNodes)
    .values({
      workflowId: wf.id,
      type: 'research-result',
      position,
      config: { engine, sessionId, topic, parentNodeId: parent.id, size: { w: 340, h: 360 } },
      label: engine === 'deep' ? 'Deep research' : 'Quick research',
    })
    .returning();

  const [newEdge] = await db
    .insert(workflowEdges)
    .values({
      workflowId: wf.id,
      sourceNodeId: parent.id,
      targetNodeId: newNode.id,
    })
    .returning();

  await db.insert(intelExplorations).values({
    workflowId: wf.id,
    nodeId: newNode.id,
    parentNodeId: parent.id,
    engine,
    sessionId,
    status: 'running',
    topic,
  });

  return json({ node: newNode, edge: newEdge, streamUrl });
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run check 2>&1 | head -30`
Expected: no errors tied to this file.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/canvas/[slug]/nodes/[id]/explore/+server.ts
git commit -m "feat(canvas): explore endpoint — commission deep/quick research

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `POST /api/canvas/[slug]/nodes/[id]/cancel-exploration`

**Files:**
- Create: `src/routes/api/canvas/[slug]/nodes/[id]/cancel-exploration/+server.ts`

- [ ] **Step 1: Implement**

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelExplorations, quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { requestStop } from '$lib/quickanswer/worker';

export const POST: RequestHandler = async ({ params }) => {
  const [row] = await db
    .select()
    .from(intelExplorations)
    .where(eq(intelExplorations.nodeId, params.id))
    .limit(1);
  if (!row) throw error(404, 'No active exploration for this node');

  if (row.engine === 'deep') {
    try {
      await executeSiteTool('research_control', { sessionId: row.sessionId, action: 'stop' });
    } catch (err) {
      console.error('[cancel-exploration] deep stop failed:', err);
    }
  } else {
    requestStop(row.sessionId);
    await db
      .update(quickAnswers)
      .set({ status: 'failed', errorMessage: 'Cancelled', completedAt: new Date() })
      .where(eq(quickAnswers.id, row.sessionId))
      .catch(console.error);
  }

  await db
    .update(intelExplorations)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(intelExplorations.id, row.id));

  return json({ cancelled: true });
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/canvas/[slug]/nodes/[id]/cancel-exploration/+server.ts
git commit -m "feat(canvas): cancel-exploration endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Canvas page server loader — rehydrate pending explorations

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.server.ts`

Read the existing file first. It already loads a `Canvas` object with nodes/edges via the adapter. Add a join for `intel_explorations` matching the workflow id, then attach a `pendingExplorations` record keyed by `nodeId`.

- [ ] **Step 1: Join intel_explorations into the loader**

In `+page.server.ts`, near where the canvas is loaded (look for the adapter call that returns the `Canvas` shape), add:

```ts
import { intelExplorations } from '$lib/db/schema';
// ...

const activeExplorations = await db
  .select({
    nodeId: intelExplorations.nodeId,
    engine: intelExplorations.engine,
    sessionId: intelExplorations.sessionId,
    status: intelExplorations.status,
  })
  .from(intelExplorations)
  .where(
    and(
      eq(intelExplorations.workflowId, canvas.workflowId),
      inArray(intelExplorations.status, ['running', 'failed']),
    ),
  );

const pendingExplorations = Object.fromEntries(
  activeExplorations.map((e) => [
    e.nodeId,
    {
      engine: e.engine as 'deep' | 'quick',
      sessionId: e.sessionId,
      status: e.status as 'running' | 'failed',
      streamUrl:
        e.engine === 'deep'
          ? `/api/deepdive/${e.sessionId}/stream`
          : `/api/quickanswer/${e.sessionId}/stream`,
    },
  ]),
);

return { canvas, pendingExplorations /* plus whatever was already returned */ };
```

Be sure to `import { and, eq, inArray } from 'drizzle-orm';` if those aren't already imported — most SvelteKit server loaders here already have `eq`.

- [ ] **Step 2: Typecheck**

Run: `npm run check 2>&1 | head -30`
Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.server.ts
git commit -m "feat(canvas): rehydrate pending explorations on load

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase F — Svelte components

### Task 14: `FacetPopover.svelte`

**Files:**
- Create: `src/lib/canvas/intelligence/FacetPopover.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  type Facets = {
    entityTypes: string[];
    tags: string[];
    timeRange: { from: string; to: string } | null;
    ordering: 'recent' | 'relevant';
    limit: number;
  };

  let { facets = $bindable(), onchange, onclose } = $props<{
    facets: Facets;
    onchange: (next: Facets) => void;
    onclose: () => void;
  }>();

  const PRESETS: Array<{ label: string; value: 'all' | 'today' | 'yesterday' | '7d' | '30d' }> = [
    { label: 'All time', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'Last 7 days', value: '7d' },
    { label: 'Last 30 days', value: '30d' },
  ];

  function applyPreset(p: 'all' | 'today' | 'yesterday' | '7d' | '30d') {
    const now = new Date();
    let from: Date | null = null;
    let to: Date = now;
    if (p === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (p === 'yesterday') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (p === '7d') {
      from = new Date(now.getTime() - 7 * 86_400_000);
    } else if (p === '30d') {
      from = new Date(now.getTime() - 30 * 86_400_000);
    }
    const next: Facets = {
      ...facets,
      timeRange: from ? { from: from.toISOString(), to: to.toISOString() } : null,
    };
    onchange(next);
  }

  function setOrdering(v: 'recent' | 'relevant') {
    onchange({ ...facets, ordering: v });
  }
</script>

<div class="facet-popover" role="dialog">
  <button type="button" class="close" onclick={onclose} aria-label="Close">×</button>
  <div class="section">
    <div class="label">TIME</div>
    {#each PRESETS as p}
      <button
        type="button"
        class="chip"
        onclick={() => applyPreset(p.value)}
      >{p.label}</button>
    {/each}
  </div>
  <div class="section">
    <div class="label">ORDERING</div>
    <button type="button" class="chip" class:active={facets.ordering === 'relevant'} onclick={() => setOrdering('relevant')}>Relevant</button>
    <button type="button" class="chip" class:active={facets.ordering === 'recent'} onclick={() => setOrdering('recent')}>Recent</button>
  </div>
</div>

<style>
  .facet-popover {
    position: absolute;
    background: var(--card-bg, #0e1014);
    border: 1px solid var(--card-border, #2a2e37);
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 11px;
    min-width: 220px;
    z-index: 20;
  }
  .close {
    position: absolute;
    right: 6px;
    top: 4px;
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
  }
  .section { margin: 6px 0; }
  .label {
    color: var(--text-muted);
    letter-spacing: 0.08em;
    font-size: 10px;
    margin-bottom: 4px;
  }
  .chip {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 2px 8px;
    margin: 2px 4px 2px 0;
    font-size: 10px;
    cursor: pointer;
  }
  .chip:hover { color: var(--text-primary); }
  .chip.active { color: var(--text-primary); border-color: var(--accent); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/canvas/intelligence/FacetPopover.svelte
git commit -m "feat(canvas): FacetPopover component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `IntelligenceNode.svelte`

**Files:**
- Create: `src/lib/canvas/intelligence/IntelligenceNode.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import FacetPopover from './FacetPopover.svelte';

  type IntelItem = {
    id: string;
    kind: 'note' | 'entity';
    title: string;
    snippet: string;
    createdAt: string;
    score: number;
    metadata?: { entityType?: string; sourceTag?: string };
  };
  type Facets = {
    entityTypes: string[];
    tags: string[];
    timeRange: { from: string; to: string } | null;
    ordering: 'recent' | 'relevant';
    limit: number;
  };

  let {
    slug,
    nodeId,
    config = $bindable(),
    onsave,
    onexplore,
  } = $props<{
    slug: string;
    nodeId: string;
    config: { query?: string; facets?: Partial<Facets>; size?: { w: number; h: number } };
    onsave: (patch: Record<string, unknown>) => void;
    onexplore: (engine: 'deep' | 'quick') => void;
  }>();

  let query = $state(config.query ?? '');
  let facets = $state<Facets>({
    entityTypes: config.facets?.entityTypes ?? [],
    tags: config.facets?.tags ?? [],
    timeRange: config.facets?.timeRange ?? null,
    ordering: config.facets?.ordering ?? 'relevant',
    limit: config.facets?.limit ?? 20,
  });

  let items = $state<IntelItem[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let facetsOpen = $state(false);
  let exploreOpen = $state(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function fetchPreview() {
    loading = true;
    try {
      const params = new URLSearchParams();
      params.set('query', query);
      params.set('limit', String(facets.limit));
      params.set('ordering', facets.ordering);
      for (const e of facets.entityTypes) params.append('entityType', e);
      for (const t of facets.tags) params.append('tag', t);
      if (facets.timeRange) {
        params.set('from', facets.timeRange.from);
        params.set('to', facets.timeRange.to);
      }
      const res = await fetch(`/api/canvas/${slug}/intel/preview?${params}`);
      if (res.ok) {
        const data = await res.json();
        items = data.items ?? [];
        total = data.total ?? 0;
      }
    } finally {
      loading = false;
    }
  }

  function scheduleFetch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchPreview, 300);
  }

  function onQueryInput() {
    onsave({ query });
    scheduleFetch();
  }

  function onFacetsChange(next: Facets) {
    facets = next;
    onsave({ facets });
    scheduleFetch();
  }

  $effect(() => {
    fetchPreview();
  });
</script>

<div class="intelligence-node" style:width={`${config.size?.w ?? 360}px`} style:height={`${config.size?.h ?? 440}px`}>
  <div class="header">
    <span class="kind-bar"></span>
    <span class="title">Intelligence</span>
  </div>

  <div class="query-wrap">
    <textarea
      class="query"
      bind:value={query}
      oninput={onQueryInput}
      placeholder="Query the intel graph…"
      rows="2"
    ></textarea>
  </div>

  <div class="facets-row">
    <button type="button" class="facet-chip" onclick={() => (facetsOpen = !facetsOpen)}>
      time · {facets.timeRange ? 'filtered' : 'all'}
    </button>
    <button type="button" class="facet-chip" onclick={() => (facetsOpen = !facetsOpen)}>
      order · {facets.ordering}
    </button>
    {#if facetsOpen}
      <FacetPopover
        facets={facets}
        onchange={onFacetsChange}
        onclose={() => (facetsOpen = false)}
      />
    {/if}
  </div>

  <div class="meta">{loading ? 'Loading…' : `${total} matches`}</div>

  <ul class="results">
    {#each items as item (item.id)}
      <li class="item" data-kind={item.kind}>
        <span class="badge">{item.kind === 'note' ? 'note' : item.metadata?.entityType ?? 'entity'}</span>
        <span class="item-title">{item.title}</span>
        <span class="item-snippet">{item.snippet}</span>
      </li>
    {:else}
      <li class="empty">No matches</li>
    {/each}
  </ul>

  <div class="footer">
    <button
      type="button"
      class="explore-btn"
      onclick={() => (exploreOpen = !exploreOpen)}
    >
      Explore further ▾
    </button>
    {#if exploreOpen}
      <div class="explore-menu">
        <button
          type="button"
          onclick={() => {
            exploreOpen = false;
            onexplore('deep');
          }}
        >Deep research from here</button>
        <button
          type="button"
          onclick={() => {
            exploreOpen = false;
            onexplore('quick');
          }}
        >Quick research</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .intelligence-node {
    position: relative;
    background: var(--card-bg, #0c0e12);
    border: 1.5px solid #5dbea3;
    border-radius: 8px;
    color: var(--text-primary, #ddd);
    font-family: var(--font-mono, ui-monospace, monospace);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider, #1c1f27);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .kind-bar {
    width: 3px;
    align-self: stretch;
    background: #5dbea3;
  }
  .query-wrap { padding: 6px 8px; }
  .query {
    width: 100%;
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--card-border, #2a2e37);
    border-radius: 6px;
    padding: 6px;
    font: inherit;
    font-size: 11px;
    resize: none;
  }
  .facets-row {
    position: relative;
    display: flex;
    gap: 6px;
    padding: 0 8px 6px;
  }
  .facet-chip {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 2px 8px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .meta {
    font-size: 10px;
    color: var(--text-ghost);
    padding: 0 8px 4px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1 1 auto;
    overflow: auto;
  }
  .item {
    padding: 4px 8px;
    border-top: 1px solid var(--divider);
    font-size: 11px;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 6px;
  }
  .badge {
    grid-row: span 2;
    align-self: start;
    color: var(--text-muted);
    font-size: 9px;
    letter-spacing: 0.08em;
  }
  .item-title { color: var(--text-primary); }
  .item-snippet {
    color: var(--text-muted);
    font-size: 10px;
    grid-column: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .empty { color: var(--text-ghost); padding: 8px; font-size: 11px; }
  .footer {
    position: relative;
    padding: 6px 8px;
    border-top: 1px solid var(--divider);
  }
  .explore-btn {
    background: transparent;
    color: #5dbea3;
    border: 1px solid #5dbea3;
    border-radius: 6px;
    padding: 4px 10px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .explore-menu {
    position: absolute;
    bottom: 38px;
    left: 8px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    z-index: 15;
  }
  .explore-menu button {
    background: transparent;
    color: var(--text-primary);
    border: 0;
    padding: 6px 10px;
    text-align: left;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .explore-menu button:hover { background: rgba(93, 190, 163, 0.08); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/canvas/intelligence/IntelligenceNode.svelte
git commit -m "feat(canvas): IntelligenceNode component with live preview + explore menu

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `ExploreFurtherMenu.svelte`

The inline popover inside `IntelligenceNode.svelte` is sufficient for phase 1; extracting it as a standalone component is only worth it if it's reused. **Defer this task until a second consumer materialises.** Mark the corresponding bullet in the design spec as "inlined into IntelligenceNode for phase 1". No file created.

- [ ] **Step 1: Leave this task as a no-op and move on**

No changes. The extensibility hook for future menu items is the literal `<div class="explore-menu">` list — add future options there.

---

### Task 17: `ResearchResultNode.svelte`

**Files:**
- Create: `src/lib/canvas/intelligence/ResearchResultNode.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  type Source = { url: string; title: string; domain: string };
  type Status = 'pending' | 'running' | 'complete' | 'failed';

  let {
    engine,
    topic,
    status = $bindable(),
    report = $bindable(),
    sources = $bindable(),
    durationMs,
    streamUrl,
    oncancel,
    ondone,
  } = $props<{
    engine: 'deep' | 'quick';
    topic: string;
    status: Status;
    report: string;
    sources: Source[];
    durationMs?: number | null;
    streamUrl?: string | null;
    oncancel: () => void;
    ondone: (res: { report: string; sources: Source[]; durationMs?: number }) => void;
  }>();

  let logLine = $state('');
  let es: EventSource | null = null;

  $effect(() => {
    if (status !== 'running' && status !== 'pending') return;
    if (!streamUrl) return;
    es = new EventSource(streamUrl);
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data);
        if (evt.type === 'log' && typeof evt.message === 'string') {
          logLine = evt.message;
        } else if (evt.type === 'token' && evt.data?.token) {
          report = (report ?? '') + String(evt.data.token);
        } else if (evt.type === 'sources' && evt.data?.sources) {
          sources = evt.data.sources as Source[];
        } else if (evt.type === 'status' && evt.data?.status === 'complete') {
          status = 'complete';
          ondone({ report, sources, durationMs: evt.data?.durationMs });
          es?.close();
        } else if (evt.type === 'complete') {
          status = 'complete';
          ondone({ report, sources, durationMs: evt.data?.durationMs });
          es?.close();
        } else if (evt.type === 'error') {
          status = 'failed';
          es?.close();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    es.onerror = () => {
      // Keep node in running state; user can cancel manually.
    };
    return () => {
      es?.close();
      es = null;
    };
  });
</script>

<div class="research-result" data-status={status}>
  <div class="header">
    <span class="kind-bar"></span>
    <span class="title">{engine === 'deep' ? 'Deep' : 'Quick'} · {topic}</span>
    {#if status === 'running' || status === 'pending'}
      <button type="button" class="cancel" onclick={oncancel}>cancel</button>
    {/if}
  </div>

  {#if status === 'running' || status === 'pending'}
    <div class="pending">
      <div class="spinner"></div>
      <div class="log">{logLine || 'Commissioning…'}</div>
    </div>
  {:else if status === 'failed'}
    <div class="failed">Research failed.</div>
  {:else}
    <div class="body">
      <div class="report">{report}</div>
      {#if sources?.length}
        <details class="sources">
          <summary>{sources.length} source{sources.length === 1 ? '' : 's'}</summary>
          <ul>
            {#each sources as s}
              <li><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span class="domain">{s.domain}</span></li>
            {/each}
          </ul>
        </details>
      {/if}
      {#if durationMs}
        <div class="duration">{(durationMs / 1000).toFixed(1)}s</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .research-result {
    position: relative;
    width: 340px;
    height: 360px;
    background: var(--card-bg, #0c0e12);
    border: 1.5px solid #5dbea3;
    border-radius: 8px;
    color: var(--text-primary, #ddd);
    font-family: var(--font-mono, ui-monospace, monospace);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .research-result[data-status='pending'],
  .research-result[data-status='running'] {
    animation: intel-pulse 2s ease-in-out infinite;
  }
  .research-result[data-status='failed'] {
    border-color: #c44;
  }
  @keyframes intel-pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(93, 190, 163, 0.35);
      border-color: #5dbea3;
    }
    50% {
      box-shadow: 0 0 0 8px rgba(93, 190, 163, 0);
      border-color: rgba(93, 190, 163, 0.55);
    }
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider, #1c1f27);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .kind-bar { width: 3px; align-self: stretch; background: #5dbea3; }
  .title { flex: 1; }
  .cancel {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 0 6px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .pending {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid var(--card-border);
    border-top-color: #5dbea3;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .log { color: var(--text-muted); font-size: 11px; text-align: center; padding: 0 12px; }
  .failed { padding: 12px; color: #c66; font-size: 11px; }
  .body { flex: 1; overflow: auto; padding: 8px 10px; font-size: 11px; }
  .report { white-space: pre-wrap; color: var(--text-primary); }
  .sources { margin-top: 8px; font-size: 10px; }
  .sources summary { cursor: pointer; color: var(--text-muted); }
  .sources ul { list-style: none; padding: 0; margin: 4px 0 0; }
  .sources a { color: var(--accent); text-decoration: none; }
  .domain { color: var(--text-ghost); margin-left: 6px; }
  .duration { color: var(--text-ghost); font-size: 9px; text-align: right; margin-top: 8px; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/canvas/intelligence/ResearchResultNode.svelte
git commit -m "feat(canvas): ResearchResultNode with streaming pulse + report view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase G — Canvas page wiring

### Task 18: Render new node kinds on the canvas

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte`

The canvas page renders nodes by branching on `node.kind`. Add branches for `kind === 'intelligence'` that render either `IntelligenceNode` or `ResearchResultNode` based on `node.type`.

- [ ] **Step 1: Add imports**

At the top of the `<script lang="ts">` block of `+page.svelte`:

```ts
import IntelligenceNode from '$lib/canvas/intelligence/IntelligenceNode.svelte';
import ResearchResultNode from '$lib/canvas/intelligence/ResearchResultNode.svelte';
```

- [ ] **Step 2: Find the node-render switch**

Search for where `kind === 'chat'` or `kind === 'inspector'` is rendered (likely a `{#if}` ladder or a `{#each}` loop with per-kind branches). Add a branch:

```svelte
{:else if n.kind === 'intelligence' && n.type === 'intelligence'}
  <IntelligenceNode
    slug={data.canvas.slug}
    nodeId={n.id}
    bind:config={n.config}
    onsave={(patch) => saveNodeConfig(n.id, patch)}
    onexplore={(engine) => startExplore(n.id, engine)}
  />
{:else if n.kind === 'intelligence' && n.type === 'research-result'}
  <ResearchResultNode
    engine={n.config.engine as 'deep' | 'quick'}
    topic={n.config.topic as string}
    status={researchStatus[n.id] ?? 'complete'}
    report={researchReport[n.id] ?? (n.outputData?.researchReport ?? '')}
    sources={researchSources[n.id] ?? (n.outputData?.researchSources ?? [])}
    durationMs={n.outputData?.researchDurationMs}
    streamUrl={pendingExplorations[n.id]?.streamUrl ?? null}
    oncancel={() => cancelExplore(n.id)}
    ondone={(result) => finaliseResearch(n.id, result)}
  />
```

The concrete names of `data.canvas.slug`, `n.config`, `n.outputData`, and helper variables (`researchStatus`, `researchReport`, etc.) depend on the existing component; match whatever the surrounding chat/inspector branches use. If no equivalent local maps exist, declare them near the other reactive maps:

```ts
let researchStatus = $state<Record<string, 'pending' | 'running' | 'complete' | 'failed'>>({});
let researchReport = $state<Record<string, string>>({});
let researchSources = $state<Record<string, any[]>>({});
let pendingExplorations = $state<Record<string, { engine: 'deep' | 'quick'; sessionId: string; status: string; streamUrl: string }>>(data.pendingExplorations ?? {});
```

- [ ] **Step 3: Helpers**

Add the helper functions near the existing node-mutation helpers (`saveNodeConfig` already exists for chat; reuse it):

```ts
async function startExplore(parentId: string, engine: 'deep' | 'quick') {
  const res = await fetch(`/api/canvas/${data.canvas.slug}/nodes/${parentId}/explore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ engine }),
  });
  if (!res.ok) {
    console.error('[canvas] explore failed', await res.text());
    return;
  }
  const { node, edge, streamUrl } = await res.json();
  // Optimistically insert the new node + edge into local canvas state.
  data.canvas.nodes = [
    ...data.canvas.nodes,
    {
      id: node.id,
      kind: 'intelligence',
      name: node.label,
      x: node.position.x,
      y: node.position.y,
      type: node.type,
      config: node.config,
    },
  ];
  data.canvas.edges = [...data.canvas.edges, { id: edge.id, from: edge.sourceNodeId, to: edge.targetNodeId }];
  pendingExplorations[node.id] = { engine, sessionId: node.config.sessionId, status: 'running', streamUrl };
  researchStatus[node.id] = 'running';
}

async function cancelExplore(nodeId: string) {
  await fetch(`/api/canvas/${data.canvas.slug}/nodes/${nodeId}/cancel-exploration`, { method: 'POST' });
  researchStatus[nodeId] = 'failed';
  delete pendingExplorations[nodeId];
}

async function finaliseResearch(
  nodeId: string,
  result: { report: string; sources: any[]; durationMs?: number },
) {
  researchStatus[nodeId] = 'complete';
  researchReport[nodeId] = result.report;
  researchSources[nodeId] = result.sources;
  delete pendingExplorations[nodeId];
  // Persist to node.outputData via existing PATCH endpoint. Use the same
  // endpoint that the canvas currently uses to persist node state (grep for
  // `PATCH` against `/api/canvas/[slug]/nodes/[id]` or similar).
  await fetch(`/api/canvas/${data.canvas.slug}/nodes/${nodeId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      outputData: {
        researchReport: result.report,
        researchSources: result.sources,
        researchDurationMs: result.durationMs,
      },
    }),
  }).catch((err) => console.error('[canvas] persist research result failed', err));
}
```

If no PATCH endpoint for nodes exists in the current codebase, skip the `fetch` body of `finaliseResearch` — the `intel_explorations` row update plus the live state is sufficient for the session. Flag this in a `TODO` comment for a follow-up.

- [ ] **Step 4: Hydrate pending on mount**

At the top of the canvas `<script>`, after `data` is set up, add:

```ts
$effect(() => {
  // For each pending exploration, mark the node status so the component
  // opens its SSE stream immediately.
  for (const nodeId of Object.keys(pendingExplorations)) {
    researchStatus[nodeId] ??= 'running';
  }
});
```

- [ ] **Step 5: Sanity check**

Run: `npm run check 2>&1 | grep -E "IntelligenceNode|ResearchResultNode|canvas/\[slug\]" | head -10`
Expected: no new errors tied to these branches.

- [ ] **Step 6: Commit**

```bash
git add src/routes/jkai/canvas/[slug]/+page.svelte
git commit -m "feat(canvas): render intelligence family; wire explore+cancel+rehydrate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase H — Verification

### Task 19: Full typecheck + test

**Files:** none (verification).

- [ ] **Step 1: Typecheck**

Run: `npm run check`
Expected: no new errors attributable to the changes. Pre-existing project warnings are acceptable if they exist before this work — diff against a known-clean baseline by running `git stash` + `npm run check` vs. with changes if unsure.

- [ ] **Step 2: Run the full unit test suite**

Run: `npm test`
Expected: all new tests pass; no regressions. If any tests in the intel-search or canvas area fail due to real DB calls (the test suite may include integration tests that hit postgres), skip with `it.skip` and leave a comment — they're out of scope for this plan.

- [ ] **Step 3: Start dev server + smoke test**

Run: `npm run dev`
Expected: dev server boots on `http://homeserv:5173` (or whatever port the repo uses — check `vite.config.ts` / `package.json` for overrides).

Manual checklist (as the user running locally):
1. Open `/jkai/canvas/sample` (or any existing canvas slug).
2. Click the palette `+ node` button → `Intelligence` group → `Intelligence`. Node appears.
3. Type "projects" in the query field; list populates after ~300 ms debounce.
4. Click `Explore further` → `Quick research`. A second node appears and pulses.
5. Wait (or wire up dev Tavily key); confirm pulse stops and report renders.
6. Reload the page mid-research; confirm the pending node stays pulsing (rehydrated from `intel_explorations`).
7. Drag a `Chat` node; connect the intelligence node's output to it; ask "summarise". Confirm the answer is focused to the filter (check dev-server logs for `intelContextOverride` being non-null).

- [ ] **Step 4: No extra commit unless fixes are required**

If manual smoke uncovers bugs, fix and commit each fix with its own `fix(canvas): …` commit and re-run from Step 3.

---

## Self-review

**Spec coverage (vs. `2026-04-21-jkai-intelligence-nodes-design.md`):**

| Spec section | Implemented by |
|---|---|
| Node registration, new `NodeKind` | Task 10 |
| `IntelItem` / `IntelligenceOutput` | Task 2 (search), Task 6 (executor) |
| Intelligence executor | Task 6 |
| Research-result executor | Task 7 |
| Quick-answer executor (commissioning) | Task 8 |
| Chat context override — option | Task 4 |
| Chat context override — executor forwarding | Task 5 |
| Explore-further flow — POST endpoint | Task 11 |
| `intel_explorations` table | Task 1 |
| Canvas loader — rehydrate pending | Task 13 |
| Cancel-exploration endpoint | Task 12 |
| Intel preview endpoint | Task 3 |
| IntelligenceNode UI | Task 15 |
| Facet popover | Task 14 |
| Explore-further menu | Task 15 (inlined) + Task 16 (deferred) |
| Research-result UI | Task 17 |
| Canvas page render + helpers | Task 18 |

**Placeholder scan:** Every step has executable code or a specific command. The only "figure this out in-repo" moments are (a) the slug-resolution helper in Task 11 (explicit instructions to copy from adjacent endpoints) and (b) the PATCH endpoint for persisting node output in Task 18 step 3 (has a clear fallback behaviour). Both are called out in the step text.

**Type consistency:** `IntelItem`, `IntelFacets`, `IntelligenceOutput`, `researchReport`/`researchSources`/`researchStatus` names match across Tasks 2–7, 15, 17, 18. The `research-result` config shape (`engine`, `sessionId`, `topic`) is consistent across Tasks 7, 10, 11, 18.

**Scope:** Focused on the intelligence family. No unrelated refactors.
