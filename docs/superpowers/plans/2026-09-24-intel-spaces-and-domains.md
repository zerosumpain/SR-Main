# Intel spaces and domains (PR A1 + A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every intel row belongs to a *space* (a person, or the shared household), every read is scoped, and `/jkai/intel` can filter by space and by source *domain* (Email / News / Documents / Chat & capture / Research / Automations / Home).

**Architecture:** A `space_id` column (default `'owner'`) on the nine intel tables readers list directly. Writes take the space explicitly at the two funnels and derive it from the note everywhere downstream. Reads take `scope: IntelScope = OWNER_INTEL_SCOPE`, so today's owner call sites stay correct without edits, and a CI ratchet (`check-intel-scope`) holds a baseline of unscoped readers that only shrinks. Domains are a pure mapping over the existing `intel_notes.source`.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Drizzle ORM (node-postgres), PostgreSQL 16 + pgvector, Vitest, `node --test` for gate scripts.

**Spec:** `docs/superpowers/specs/2026-09-24-intel-spaces-and-domains-design.md`

This plan covers **PR A1** (Tasks 1–10) and **PR A2** (Tasks 11–15). PR B (members, member Gmail, household drive folders) gets its own plan once A2 is live, written against merged code.

## Global Constraints

- Space ids: `'owner'` (existing `activity_principals` id), `'household'`, and in PR B `u_<random>`. Constants live ONLY in `src/lib/jkai/intel/scope.ts`.
- Column: `space_id text NOT NULL DEFAULT 'owner'` on `intel_notes`, `intel_entities`, `intel_relationships`, `intel_timeline_events`, `intel_alerts`, `intel_insights`, `intel_lenses`, `intel_dossiers`, `intel_commissions`; `gmail_accounts.principal_id text NOT NULL DEFAULT 'owner'`. No other tables.
- **No unique index** added to any populated table (breaks non-interactive `drizzle-kit push`). Plain indexes only.
- `src/lib/db/schema.ts` must stay self-contained — no `$lib` or relative imports (`gate:schema-imports`).
- Resolution and merge never cross a space. Derived rows take the NOTE's space, never a parameter.
- A request never supplies its own scope; `spaces=` can only narrow within `resolveRequestScope(event)`.
- Empty `domains=` / `sources=` = no filter. Picker counts come from the whole scoped graph, never the filtered view.
- UI follows `sr-design` (read `.claude/skills/sr-design/SKILL.md` before Task 8): existing rail patterns, tokens, fonts; no new fonts, no emoji, radius 0/2px/100px.
- Svelte: read `~/.claude/skills/svelte5-pitfalls/SKILL.md` before writing any `.svelte`.
- en-GB spelling in UI copy and comments.
- Never run the gate on homeserv: `./scripts/gate-remote.sh` (porkserv). Never `gh pr merge --auto`. Never `scripts/deploy.sh`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Q6iYBqPpknkHWqBJApK7La
  ```

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/jkai/intel/scope.ts` | create | Space constants, `IntelScope`, `scopeKey`, `narrowScope`, SQL predicate helper |
| `src/lib/jkai/intel/scope.test.ts` | create | Unit tests |
| `src/lib/jkai/intel/scope.server.ts` | create | `resolveRequestScope(event)`, `noteSpace(noteId, executor)` |
| `src/lib/jkai/intel/domains.ts` | create | Domain table, `domainOf`, `sourcesForDomains`, `domainCounts` |
| `src/lib/jkai/intel/domains.test.ts` | create | Unit tests |
| `src/lib/db/schema.ts` | modify | 10 columns + 3 indexes |
| `src/lib/jkai/intel/ingest.ts` | modify | `createNote` requires `spaceId` |
| `src/lib/jkai/intel/auto-extract.ts` | modify | `extractIntoIntel` requires `spaceId`; `findDerivedNote` keyed by space |
| 9 write callers (Task 3) | modify | pass `OWNER_SPACE` / account principal |
| `src/lib/jkai/intel/graph.ts`, `resolve/ingestion.server.ts`, `resolve/split.ts`, `confirm-link.ts`, `recall.ts`, `routes/api/jkai/intel/mentions/+server.ts` | modify | stamp note's space on derived inserts; candidate search scoped |
| `src/lib/jkai/intel/resolve/merge.ts` | modify | refuse cross-space merge |
| `src/lib/jkai/intel/analytics/model.ts`, `load.ts` | modify | node `space`; scoped snapshot + cache key |
| `src/lib/jkai/intel/analytics/filter.ts` | modify | `spaces` + `domains` in `GraphFilter` |
| `src/routes/api/jkai/intel/network/+server.ts`, `evidence-network/+server.ts` | modify | `spaces=` / `domains=`; `spaceCounts` / `domainCounts` |
| `src/lib/news/actions.ts`, `src/lib/jkai/intel/trust.ts`, `ingest.ts` type | modify | `source: 'news'` |
| `src/routes/api/jkai/intel/backfill/+server.ts` | modify | `{ newsSource: true }` |
| `src/lib/components/intel/ScopePicker.svelte` | create | Space + Domain chips |
| `src/routes/jkai/intel/+page.svelte` | modify | Scope rail section, URL seed |
| `scripts/check-intel-scope.mjs`, `scripts/check-intel-scope.test.mjs`, `scripts/intel-scope-baseline.json` | create | Leak-guard ratchet |
| `scripts/gate-structural.sh`, `package.json` | modify | wire `gate:intel-scope` |

---

## PR A1

### Task 1: Scope and domain modules (pure)

**Files:**
- Create: `src/lib/jkai/intel/scope.ts`, `src/lib/jkai/intel/scope.test.ts`, `src/lib/jkai/intel/domains.ts`, `src/lib/jkai/intel/domains.test.ts`

**Interfaces:**
- Produces:
  - `OWNER_SPACE = 'owner'`, `HOUSEHOLD_SPACE = 'household'`
  - `type IntelScope = readonly string[]`
  - `OWNER_INTEL_SCOPE: IntelScope = ['owner', 'household']`
  - `scopeKey(scope: IntelScope): string` — sorted, comma-joined
  - `narrowScope(allowed: IntelScope, requested: readonly string[]): IntelScope` — intersection; empty request → `allowed`; request with nothing allowed → `[]`
  - `spaceIn(column: SQL | AnyColumn, scope: IntelScope): SQL` — `column = ANY('{…}'::text[])`
  - `INTEL_DOMAINS: readonly IntelDomain[]` where `IntelDomain = { id: DomainId; label: string; hint: string; sources: readonly string[] }`
  - `type DomainId = 'email'|'news'|'documents'|'chat'|'research'|'automations'|'home'|'other'`
  - `domainOf(source: string): DomainId` — facet values (`email:bulk`, `email@x.com`) map by their base source; unknown → `'other'`
  - `sourcesForDomains(domains: readonly string[]): string[]` — base sources for the listed domains (`'other'` contributes nothing; see filter in Task 6)
  - `domainCounts(sourceCounts: Map<string, number>): Array<{ id: DomainId; count: number }>` — only base sources (no `:`/`@`) counted, every domain present (zero allowed), `INTEL_DOMAINS` order

- [ ] **Step 1: Write the failing tests**

`src/lib/jkai/intel/scope.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { OWNER_INTEL_SCOPE, scopeKey, narrowScope } from './scope';

describe('scope', () => {
  it('owner scope is own space plus household', () => {
    expect([...OWNER_INTEL_SCOPE]).toEqual(['owner', 'household']);
  });

  it('scopeKey is order-independent', () => {
    expect(scopeKey(['household', 'owner'])).toBe(scopeKey(['owner', 'household']));
  });

  it('an empty request means everything allowed', () => {
    expect([...narrowScope(OWNER_INTEL_SCOPE, [])]).toEqual(['owner', 'household']);
  });

  it('a request can narrow but never widen', () => {
    expect([...narrowScope(OWNER_INTEL_SCOPE, ['household'])]).toEqual(['household']);
    expect([...narrowScope(OWNER_INTEL_SCOPE, ['u_abc'])]).toEqual([]);
    expect([...narrowScope(OWNER_INTEL_SCOPE, ['owner', 'u_abc'])]).toEqual(['owner']);
  });
});
```

`src/lib/jkai/intel/domains.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { domainOf, sourcesForDomains, domainCounts, INTEL_DOMAINS } from './domains';

describe('domains', () => {
  it('maps every live source to a domain', () => {
    expect(domainOf('email')).toBe('email');
    expect(domainOf('news')).toBe('news');
    expect(domainOf('file')).toBe('documents');
    for (const s of ['chat', 'web', 'pwa']) expect(domainOf(s)).toBe('chat');
    for (const s of ['research', 'daydream', 'notebook']) expect(domainOf(s)).toBe('research');
    expect(domainOf('workflow')).toBe('automations');
    expect(domainOf('home')).toBe('home');
  });

  it('facets follow their base source', () => {
    expect(domainOf('email:bulk')).toBe('email');
    expect(domainOf('email@linkedin.com')).toBe('email');
  });

  it('an unknown source is visible as other, not dropped', () => {
    expect(domainOf('whatsapp')).toBe('other');
  });

  it('expands domains to their sources', () => {
    expect(sourcesForDomains(['research']).sort()).toEqual(['daydream', 'notebook', 'research']);
    expect(sourcesForDomains(['email', 'news']).sort()).toEqual(['email', 'news']);
    expect(sourcesForDomains([])).toEqual([]);
  });

  it('counts every domain, facets excluded, in table order', () => {
    const counts = domainCounts(new Map([
      ['email', 10], ['email:bulk', 7], ['email@x.com', 3], ['chat', 2], ['web', 1],
    ]));
    expect(counts.map((c) => c.id)).toEqual(INTEL_DOMAINS.map((d) => d.id));
    expect(counts.find((c) => c.id === 'email')?.count).toBe(10);
    expect(counts.find((c) => c.id === 'chat')?.count).toBe(3);
    expect(counts.find((c) => c.id === 'home')?.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/jkai/intel/scope.test.ts src/lib/jkai/intel/domains.test.ts`
Expected: FAIL — cannot resolve `./scope` / `./domains`.

- [ ] **Step 3: Implement**

`src/lib/jkai/intel/scope.ts`:
```ts
// Whose intel a reader may see.
//
// A SPACE is a principal id: 'owner' (the existing activity principal every
// AUTH_ALLOWED_EMAILS address maps to), 'household' (shared), and in PR B one
// `u_…` per family member. Every intel note, entity and edge carries one, and a
// reader passes the set it may see. Everyone's scope is their own space plus
// household — the owner's included, so a family member's email-derived graph
// never reaches the owner's chat either.
//
// Library readers default their `scope` parameter to OWNER_INTEL_SCOPE. That
// keeps every existing owner call site correct without an edit; a surface a
// member can reach must pass the scope `resolveRequestScope` returns instead.
import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { pgTextArray } from '$lib/db/sql-array';

export const OWNER_SPACE = 'owner';
export const HOUSEHOLD_SPACE = 'household';

export type IntelScope = readonly string[];

export const OWNER_INTEL_SCOPE: IntelScope = Object.freeze([OWNER_SPACE, HOUSEHOLD_SPACE]);

/** Stable cache key for a scope — the analysis cache is one entry per key. */
export function scopeKey(scope: IntelScope): string {
  return [...scope].sort().join(',');
}

/**
 * The UI's space chips, applied to what the caller may see. A request can only
 * narrow: anything outside `allowed` is dropped, and an empty request means the
 * whole of `allowed` (the picker's "nothing selected = no filter" rule).
 */
export function narrowScope(allowed: IntelScope, requested: readonly string[]): IntelScope {
  if (requested.length === 0) return allowed;
  return allowed.filter((s) => requested.includes(s));
}

/** `column = ANY('{…}'::text[])` — the one predicate every scoped reader adds. */
export function spaceIn(column: SQL | AnyColumn, scope: IntelScope): SQL {
  return sql`${column} = ANY(${pgTextArray(scope)}::text[])`;
}
```

`src/lib/jkai/intel/domains.ts`:
```ts
// Where intel came from, at the grain a person asks about.
//
// `intel_notes.source` is a pipeline detail — 'web' is both a kept news story
// (until 2026-09-24) and a "remember that" from chat, 'daydream' and 'notebook'
// are both research. A DOMAIN is the question "show me what email told me".
// Pure: the network API expands `domains=` through `sourcesForDomains`, and the
// picker labels come from here, so the grouping lives in exactly one place.

export type DomainId =
  | 'email' | 'news' | 'documents' | 'chat' | 'research' | 'automations' | 'home' | 'other';

export interface IntelDomain {
  id: DomainId;
  label: string;
  hint: string;
  sources: readonly string[];
}

export const INTEL_DOMAINS: readonly IntelDomain[] = [
  { id: 'email', label: 'Email', hint: 'Gmail, rolling 12 weeks', sources: ['email'] },
  { id: 'news', label: 'News', hint: 'Stories kept from /news', sources: ['news'] },
  { id: 'documents', label: 'Documents', hint: 'Drive files', sources: ['file'] },
  { id: 'chat', label: 'Chat & capture', hint: 'jkai threads, captures, phone', sources: ['chat', 'web', 'pwa'] },
  { id: 'research', label: 'Research', hint: 'Deep dives, daydream, notebook', sources: ['research', 'daydream', 'notebook'] },
  { id: 'automations', label: 'Automations', hint: 'Workflow output', sources: ['workflow'] },
  { id: 'home', label: 'Home', hint: 'Home Assistant — coming', sources: ['home'] },
  { id: 'other', label: 'Other', hint: 'Sources with no domain yet', sources: [] },
];

const BY_SOURCE = new Map<string, DomainId>(
  INTEL_DOMAINS.flatMap((d) => d.sources.map((s) => [s, d.id] as const)),
);

/** Base source of a facet value: 'email:bulk' and 'email@x.com' are 'email'. */
function baseSource(source: string): string {
  const cut = source.search(/[:@]/);
  return cut > 0 ? source.slice(0, cut) : source;
}

export function domainOf(source: string): DomainId {
  return BY_SOURCE.get(baseSource(source)) ?? 'other';
}

export function sourcesForDomains(domains: readonly string[]): string[] {
  return INTEL_DOMAINS.filter((d) => domains.includes(d.id)).flatMap((d) => [...d.sources]);
}

/** Entity counts per domain from the network API's per-source counts. */
export function domainCounts(sourceCounts: Map<string, number>): Array<{ id: DomainId; count: number }> {
  const totals = new Map<DomainId, number>();
  for (const [source, count] of sourceCounts) {
    if (/[:@]/.test(source)) continue;
    const d = domainOf(source);
    totals.set(d, (totals.get(d) ?? 0) + count);
  }
  return INTEL_DOMAINS.map((d) => ({ id: d.id, count: totals.get(d.id) ?? 0 }));
}
```

Note on `domainCounts`: an entity asserted by both `chat` and `web` counts once per source, so the Chat & capture total can exceed its distinct entities. That matches how the source picker already counts; the chip label says "entities" loosely. Accept it.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/jkai/intel/scope.test.ts src/lib/jkai/intel/domains.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jkai/intel/scope.ts src/lib/jkai/intel/scope.test.ts src/lib/jkai/intel/domains.ts src/lib/jkai/intel/domains.test.ts
git commit -m "Intel: scope and domain modules — who may read what, and where it came from"
```

---

### Task 2: Schema columns

**Files:**
- Modify: `src/lib/db/schema.ts` — `intelNotes` (~2719), `intelEntities` (~2771), `intelRelationships` (~2860), `intelTimelineEvents` (~2976), `intelAlerts` (~2990), `intelInsights` (~3051), `intelLenses` (~3091), `intelDossiers` (~3117), `intelCommissions` (~3159), `gmailAccounts` (~3398)

**Interfaces:**
- Produces: `intelNotes.spaceId`, `intelEntities.spaceId`, `intelRelationships.spaceId`, `intelTimelineEvents.spaceId`, `intelAlerts.spaceId`, `intelInsights.spaceId`, `intelLenses.spaceId`, `intelDossiers.spaceId`, `intelCommissions.spaceId`, `gmailAccounts.principalId` — all `string`, non-null.

- [ ] **Step 1: Add the columns**

In each of the nine intel tables add, immediately before `createdAt`:
```ts
  /** Whose intel this is — see $lib/jkai/intel/scope. 'owner' | 'household' | 'u_…'. */
  spaceId: text('space_id').notNull().default('owner'),
```
(The comment is written out rather than imported: schema.ts must stay self-contained.)

In `gmailAccounts`, after `status`:
```ts
  /** The principal this mailbox belongs to; its intel lands in that space. */
  principalId: text('principal_id').notNull().default('owner'),
```

Add plain indexes. `intelNotes` already has a table callback returning an object — add:
```ts
  bySpace: index('intel_notes_space_idx').on(t.spaceId, t.graphState),
```
`intelEntities` callback (the `byType`… object) — add:
```ts
    bySpace: index('intel_entities_space_idx').on(t.spaceId),
```
`intelRelationships` — if it has a callback add `bySpace: index('intel_relationships_space_idx').on(t.spaceId)`; if it has none, add `(t) => ({ bySpace: index('intel_relationships_space_idx').on(t.spaceId) })` as the third `pgTable` argument.

- [ ] **Step 2: Type-check the schema alone**

Run: `node scripts/check-schema-imports.mjs && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "schema.ts" | head`
Expected: check passes; no schema.ts errors.

- [ ] **Step 3: Push to the local dev DB and verify**

Run: `npx drizzle-kit push 2>&1 | tail -20`
Then read the output: it must list only `ADD COLUMN "space_id"` / `"principal_id"` and `CREATE INDEX` statements. If it shows ANY rename prompt or a `DROP`, stop — see memory `reference_drizzle_push_exits_zero_on_tty_prompt` (push exits 0 on a prompt without applying).
Verify:
```bash
psql "$(grep ^DATABASE_URL .env | cut -d= -f2-)" -Atc "select table_name from information_schema.columns where column_name in ('space_id','principal_id') order by 1"
```
Expected: `gmail_accounts intel_alerts intel_commissions intel_dossiers intel_entities intel_insights intel_lenses intel_notes intel_relationships intel_timeline_events` (10 rows).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "Intel: space_id on the nine intel tables readers list; principal on gmail accounts"
```

---

### Task 3: Writes carry a space

**Files:**
- Create: `src/lib/jkai/intel/scope.server.ts`
- Modify: `src/lib/jkai/intel/ingest.ts:20-45`, `src/lib/jkai/intel/auto-extract.ts:46-80,151-163,285-305,416,637`
- Modify callers: `src/routes/api/jkai/intel/ingest/+server.ts:77`, `src/lib/jkai/intel/mail-admit.ts:352`, `src/lib/jkai/intel/chat-extract.ts:175`, `src/lib/news/actions.ts:46`, `src/lib/deepdive/graph-commit.ts:397`, `src/lib/workflows/chat/general-chat.ts:383`, `src/lib/workflows/nodes/intel-write.ts:71`, `src/lib/daydream/weave.ts:136`, `src/lib/daydream/notebook/cards.ts:142`, plus the Gmail sweep's `extractIntoIntel` call and header-note insert in `src/lib/jkai/intel/gmail-ingest.ts` (~1185, ~1495)
- Modify derived inserts: `src/lib/jkai/intel/graph.ts:571,603`, `src/lib/jkai/intel/resolve/ingestion.server.ts:79`, `src/lib/jkai/intel/resolve/split.ts:143`, `src/lib/jkai/intel/confirm-link.ts:93,152`, `src/lib/jkai/intel/recall.ts:179`, `src/routes/api/jkai/intel/mentions/+server.ts:53`
- Test: `src/lib/jkai/intel/spaces.integration.test.ts`

**Interfaces:**
- Consumes: `OWNER_SPACE` (Task 1), `intelNotes.spaceId` etc. (Task 2)
- Produces:
  - `IngestInput.spaceId: string` (required)
  - `AutoExtractInput.spaceId: string` (required)
  - `noteSpace(noteId: string, executor?: DbExecutor): Promise<string>` in `scope.server.ts` — the note's `space_id`, throws if the note is missing
  - `entitySpace(entityId: string, executor?: DbExecutor): Promise<string>` in `scope.server.ts`

- [ ] **Step 1: Write the failing integration test**

Copy the DB setup/teardown shape from `src/lib/jkai/intel/cleanup.integration.test.ts` (same imports of `db`, same skip-when-no-DATABASE_URL guard). Test body:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes, intelEntities, intelRelationships } from '$lib/db/schema';
import { createNote } from './ingest';
import { persistExtraction } from './graph';

const created: string[] = [];

describe('writes carry the note space', () => {
  afterAll(async () => {
    if (created.length) await db.delete(intelNotes).where(inArray(intelNotes.id, created));
  });

  it('entities and edges extracted from a u_test note are stamped u_test', async () => {
    const noteId = await createNote({
      title: 'space test', rawContent: 'Zorblat Ltd employs Quennel Vasquez.',
      source: 'web', format: 'text', spaceId: 'u_test',
    });
    created.push(noteId);
    await persistExtraction(noteId, {
      entities: [
        { name: 'Zorblat Ltd', type: 'organisation', properties: {}, confidence: 'high' },
        { name: 'Quennel Vasquez', type: 'person', properties: {}, confidence: 'high' },
      ],
      relationships: [
        { source: 'Zorblat Ltd', target: 'Quennel Vasquez', type: 'employs', confidence: 'high' },
      ],
      timelineEvents: [],
      proposedNewTypes: [],
    } as never);

    const ents = await db.select({ space: intelEntities.spaceId }).from(intelEntities)
      .where(eq(intelEntities.firstSeenIn, noteId));
    expect(ents.length).toBeGreaterThan(0);
    expect(ents.every((e) => e.space === 'u_test')).toBe(true);

    const edges = await db.select({ space: intelRelationships.spaceId }).from(intelRelationships)
      .where(eq(intelRelationships.sourceNoteId, noteId));
    expect(edges.every((e) => e.space === 'u_test')).toBe(true);
  });
});
```
Before running, open `src/lib/jkai/intel/extract.ts` and correct the `ExtractionResult` literal field names to match the real type (drop the `as never` once it type-checks). Entity cleanup: add `await db.delete(intelEntities).where(eq(intelEntities.firstSeenIn, id))` for each created note in `afterAll`, before deleting the notes (edges cascade or delete them the same way — check the FK `onDelete` in schema.ts).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/jkai/intel/spaces.integration.test.ts`
Expected: FAIL — `spaceId` not in `IngestInput` (type error surfaces as a test compile error), or entities stamped `owner`.

- [ ] **Step 3: `scope.server.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';
import { OWNER_INTEL_SCOPE, type IntelScope } from './scope';

/**
 * The scope a request may read. Phase A: every intel route is owner-only (the
 * hook 403s anyone else), so this is the owner scope. PR B extends it with the
 * member lookup — this is the ONE seam that changes, and no route may build a
 * scope any other way.
 */
export async function resolveRequestScope(_event: { locals: App.Locals }): Promise<IntelScope> {
  return OWNER_INTEL_SCOPE;
}

/** A derived row's space is its note's — never a parameter a caller could get wrong. */
export async function noteSpace(noteId: string, executor: DbExecutor = db): Promise<string> {
  const [row] = await executor.select({ space: intelNotes.spaceId }).from(intelNotes)
    .where(eq(intelNotes.id, noteId)).limit(1);
  if (!row) throw new Error(`intel note ${noteId} not found`);
  return row.space;
}

export async function entitySpace(entityId: string, executor: DbExecutor = db): Promise<string> {
  const [row] = await executor.select({ space: intelEntities.spaceId }).from(intelEntities)
    .where(eq(intelEntities.id, entityId)).limit(1);
  if (!row) throw new Error(`intel entity ${entityId} not found`);
  return row.space;
}
```

- [ ] **Step 4: Funnels require `spaceId`**

`ingest.ts` — add to `IngestInput` (and add `'news'` to the `source` union now, used in Task 7):
```ts
  /** Whose intel this is. Required so every caller decides — see ./scope. */
  spaceId: string;
```
and in `createNote`'s `.values({…})` add `spaceId: input.spaceId,`.

`auto-extract.ts` — add the same field to `AutoExtractInput`. Change `findDerivedNote(kind, refId)` to `findDerivedNote(kind, refId, spaceId)` and add `eq(intelNotes.spaceId, spaceId)` to its `and(...)` (two people receiving the same Gmail thread must not share one note). Pass `input.spaceId` at its call site (~229). In the insert branch (~298) add `spaceId: input.spaceId,`. Do NOT set it in the update branch — a note never changes space. `queueDerivedIntelDelete(kind, refId)` (~540) and any other `findDerivedNote` caller: add a `spaceId = OWNER_SPACE` parameter and thread it through.

- [ ] **Step 5: Fix every caller `tsc` names**

Run: `npm run gate:check:only 2>&1 | grep -E "spaceId|findDerivedNote" | head -30`
For each error, pass `spaceId: OWNER_SPACE` (import from `$lib/jkai/intel/scope`), EXCEPT:
- `gmail-ingest.ts` — pass `spaceId: acct.principalId` (the account row already loaded by `resolveAccount`; add `principalId` to its select if it selects columns explicitly). Same for the header-only note insert (~1185).
- `mail-admit.ts:352` — admitting a held thread must keep the held note's space: pass `spaceId: note.spaceId` from the note row it already loaded (add `spaceId` to that select).
Re-run until no `spaceId` errors remain.

- [ ] **Step 6: Derived inserts take the note's space**

Stamp each insert:
- `graph.ts` `persistExtraction`: after loading `noteRow` (~432), `const space = await noteSpace(noteId);` Add `spaceId: space` to the `intelRelationships` insert (~571) and `intelTimelineEvents` insert (~603).
- `resolve/ingestion.server.ts` `persistMention`: `const space = await noteSpace(noteId);` before `resolveMention`; add `spaceId: space` to the `intelEntities` insert (~79). (Candidate scoping is Task 4.)
- `resolve/split.ts:143` raw SQL: add `space_id` to the column list and select it from the entity being split (`SELECT … , e.space_id FROM intel_entities e WHERE e.id = …`), or look it up with `entitySpace(originalId)` and bind it.
- `confirm-link.ts:93,152`: `const space = await entitySpace(sourceId)`; if `await entitySpace(targetId) !== space` throw `new Error('cannot link entities in different spaces')`; add `spaceId: space` to both inserts.
- `recall.ts:179`: `spaceId: await noteSpace(noteId)` (use whatever the note id variable is called there).
- `routes/api/jkai/intel/mentions/+server.ts:53`: `spaceId: await noteSpace(mention.noteId, tx)`.

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/lib/jkai/intel/spaces.integration.test.ts && npx vitest run src/lib/jkai/intel`
Expected: PASS. Then `npm run gate:check:only` — expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add -A src/lib src/routes
git commit -m "Intel: every write carries a space — funnels require it, derived rows take the note's"
```

---

### Task 4: Resolution and merge never cross a space

**Files:**
- Modify: `src/lib/jkai/intel/resolve/ingestion.server.ts:11-45`, `src/lib/jkai/intel/resolve/merge.ts:58-90`
- Test: extend `src/lib/jkai/intel/spaces.integration.test.ts`

**Interfaces:**
- Consumes: `noteSpace` (Task 3)
- Produces: `mentionCandidates(entity, executor, semantic, spaceId: string)`, `resolveMention(entity, typeId, executor, semantic, spaceId: string)` — `spaceId` is a new REQUIRED trailing parameter. `mergeEntities` throws `Error('cannot merge entities from different spaces')`.

- [ ] **Step 1: Failing tests** (append to `spaces.integration.test.ts`)

```ts
import { mergeEntities } from './resolve/merge';
import { mentionCandidates } from './resolve/ingestion.server';
import { intelEntityTypes } from '$lib/db/schema';

it('an owner mention never matches a u_test entity of the same name', async () => {
  const cands = await mentionCandidates(
    { name: 'Zorblat Ltd', type: 'organisation', properties: {}, confidence: 'high' } as never,
    db, false, 'owner',
  );
  expect(cands.some((c) => c.name === 'Zorblat Ltd')).toBe(false);
});

it('refuses to merge across spaces', async () => {
  const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);
  const [a] = await db.insert(intelEntities).values({ name: 'Space A thing', typeId: type.id, spaceId: 'owner' }).returning();
  const [b] = await db.insert(intelEntities).values({ name: 'Space B thing', typeId: type.id, spaceId: 'u_test' }).returning();
  try {
    await expect(mergeEntities(a.id, b.id)).rejects.toThrow(/different spaces/);
  } finally {
    await db.delete(intelEntities).where(inArray(intelEntities.id, [a.id, b.id]));
  }
});
```
(Correct any required `intelEntities` insert fields against schema.ts.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/jkai/intel/spaces.integration.test.ts`
Expected: FAIL — owner candidates include the u_test `Zorblat Ltd`; merge succeeds.

- [ ] **Step 3: Scope candidate retrieval**

In `mentionCandidates` add parameter `spaceId: string` and `AND e.space_id = ${spaceId}` to BOTH queries' `WHERE` (lexical and the ANN `nearest` query). In `resolveMention` add `spaceId: string`, pass it to `mentionCandidates`, and scope the `identities` count query: `FROM intel_entities WHERE space_id = ${spaceId} AND properties->>'email' IS NOT NULL`. In `persistMention`, pass the `space` from Task 3 to both `resolveMention` calls. Run `npm run gate:check:only` and fix any other caller of either function (pass the note's or entity's space; for a caller with neither, use `OWNER_SPACE` and leave a one-line comment saying why).

- [ ] **Step 4: Guard merge**

In `mergeEntities` add `spaceId: intelEntities.spaceId` to the select, and after the `merge.mergedIntoId` check:
```ts
  // A space is a person's graph. Folding one person's "Tesco" into another's
  // would carry their summary, aliases and evidence across — the exact leak
  // spaces exist to stop.
  if (keep.spaceId !== merge.spaceId) throw new Error('cannot merge entities from different spaces');
```
Then find the auto-merge / adjudication candidate generators (`grep -rn "mergeEntities(" src/lib`) — any that pair entities from a whole-table scan must add `a.space_id = b.space_id` to the pairing SQL, so the nightly sweep never proposes a pair the guard will throw on. List each in the commit message.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/jkai/intel` — expected PASS; `npm run gate:check:only` — 0 errors.

- [ ] **Step 6: Commit**

```bash
git commit -am "Intel: resolution and merge stay inside a space"
```

---

### Task 5: Scoped graph snapshot

**Files:**
- Modify: `src/lib/jkai/intel/analytics/model.ts` (the `GraphNode` / snapshot node type), `src/lib/jkai/intel/analytics/load.ts:56-80,106-300,403-440`
- Test: `src/lib/jkai/intel/analytics/filter.test.ts` fixture (`node()` helper gains `space: 'owner'`)

**Interfaces:**
- Consumes: `IntelScope`, `OWNER_INTEL_SCOPE`, `scopeKey` (Task 1)
- Produces: `getGraphAnalysis(force = false, { includeArtefacts = false, scope = OWNER_INTEL_SCOPE }: { includeArtefacts?: boolean; scope?: IntelScope } = {})`; every snapshot node has `space: string`.

- [ ] **Step 1: Node carries its space**

In `model.ts` add `space: string;` to the node type with the comment `/** The space this entity belongs to — see $lib/jkai/intel/scope. */`. Update the `node()` helper in `analytics/filter.test.ts` (and any other test fixture `tsc` flags) with `space: 'owner',`.

- [ ] **Step 2: Scope the loader**

`loadSnapshot(includeArtefacts)` → `loadSnapshot(includeArtefacts, scope: IntelScope)`. In the entity query select `e.space_id` and add `AND e.space_id = ANY(${pgTextArray(scope)}::text[])` to `WHERE e.merged_into_id IS NULL`; also add `AND n.space_id = ANY(...)` inside the sources sub-select's `JOIN intel_notes n` (belt and braces — a note link from another space must not leak a source label). In the relationships query add `AND r.space_id = ANY(...)` to `WHERE r.suppressed IS NOT TRUE`. Map `space: String(r.space_id)` onto each node. If `suppressedPairs` / `channelArtefactIds` query entities, scope them the same way.

- [ ] **Step 3: Cache per scope**

```ts
const variantKey = (includeArtefacts: boolean, scope: IntelScope) =>
  `${includeArtefacts ? 'with-artefacts' : 'analysed'}|${scopeKey(scope)}`;
```
Update `getGraphAnalysis` to take `scope = OWNER_INTEL_SCOPE` in its options object, compute `key` with it and call `loadSnapshot(includeArtefacts, scope)`. `invalidateGraphAnalysis` already clears the whole map — leave it.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/jkai/intel/analytics && npm run gate:check:only`
Expected: PASS, 0 errors. No `getGraphAnalysis` call site changes — they all get the owner scope by default.

- [ ] **Step 5: Commit**

```bash
git commit -am "Intel: the graph snapshot is scoped and cached per scope"
```

---

### Task 6: `spaces=` and `domains=` on the network APIs

**Files:**
- Modify: `src/lib/jkai/intel/analytics/filter.ts:66-186`, `src/routes/api/jkai/intel/network/+server.ts:29-110,320-375`, `src/routes/api/jkai/intel/evidence-network/+server.ts`
- Test: `src/lib/jkai/intel/analytics/filter.test.ts`

**Interfaces:**
- Consumes: `narrowScope`, `resolveRequestScope`, `sourcesForDomains`, `domainOf`, `domainCounts`
- Produces: `GraphFilter.spaces?: string[]`, `GraphFilter.domains?: string[]`; API response gains `domains: Array<{ id; count }>` and `spaces: Array<{ id; count }>`.

- [ ] **Step 1: Failing filter tests** (in `filter.test.ts`, reusing its fixture builders)

```ts
describe('spaces and domains', () => {
  it('keeps only nodes in the requested spaces', () => {
    const idx = buildIndex({ nodes: [node('ada', { space: 'owner' }), node('hal', { space: 'household' })], edges: [] } as never);
    const out = applyGraphFilter(idx, new Map(), { spaces: ['household'] });
    expect([...out.keep]).toEqual(['hal']);
  });

  it('a domain keeps any node with a source in it, facets included', () => {
    const idx = buildIndex({ nodes: [
      node('ada', { sources: ['daydream'] }),
      node('bob', { sources: ['email', 'email:bulk'] }),
    ], edges: [] } as never);
    const out = applyGraphFilter(idx, new Map(), { domains: ['research'] });
    expect([...out.keep]).toEqual(['ada']);
  });

  it('domains and sources intersect', () => {
    const idx = buildIndex({ nodes: [
      node('ada', { sources: ['daydream'] }),
      node('bob', { sources: ['research'] }),
    ], edges: [] } as never);
    const out = applyGraphFilter(idx, new Map(), { domains: ['research'], sources: ['research'] });
    expect([...out.keep]).toEqual(['bob']);
  });

  it('the other domain keeps nodes whose sources map nowhere', () => {
    const idx = buildIndex({ nodes: [node('wes', { sources: ['whatsapp'] }), node('ada', { sources: ['email'] })], edges: [] } as never);
    const out = applyGraphFilter(idx, new Map(), { domains: ['other'] });
    expect([...out.keep]).toEqual(['wes']);
  });
});
```
Adjust `buildIndex` / `applyGraphFilter` call shapes and the `keep` accessor to the real signatures used elsewhere in that test file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/jkai/intel/analytics/filter.test.ts`
Expected: FAIL — unknown filter keys ignored.

- [ ] **Step 3: Implement in `filter.ts`**

Add to `GraphFilter`:
```ts
  /** Space ids to keep. Empty/absent = every space the snapshot holds (it is already scoped). */
  spaces?: string[];
  /** Domain ids (see ../domains). A node passes if ANY of its sources falls in ANY of them. Intersects with `sources`. */
  domains?: string[];
```
In `applyGraphFilter`, beside the existing `sources` block, add two predicates applied the same way the sources predicate is (same place in the chain, same "unsourced entities always kept" rule for domains as for sources — read the comment at ~178 and mirror it):
```ts
  const spaces = (filter.spaces ?? []).filter(Boolean);
  if (spaces.length > 0) {
    /* keep ids whose index.byId.get(id)?.space is in spaces */
  }
  const domains = (filter.domains ?? []).filter(Boolean);
  if (domains.length > 0) {
    /* keep ids where (index.byId.get(id)?.sources ?? []).some((s) => domains.includes(domainOf(s))) */
  }
```
Write those two blocks in the exact idiom of the neighbouring `sources` block (same set/array it narrows). Import `domainOf` from `../domains`.

- [ ] **Step 4: Wire the API**

In `network/+server.ts` `GET` — change the handler signature to `async (event) => { const { url } = event; …`, then:
```ts
  const allowed = await resolveRequestScope(event);
  const scope = narrowScope(allowed, parseCsv(url.searchParams.get('spaces')));
  const domainFilter = parseCsv(url.searchParams.get('domains'));
  const analysis = await getGraphAnalysis(false, { scope: allowed });
```
Pass `spaces: [...scope]` (only when the request sent `spaces=`; otherwise omit) and `domains: domainFilter` into `applyGraphFilter`. Use `allowed` (not the narrowed scope) for the snapshot so the chip counts stay whole-graph. After the `sourceCounts` loop add:
```ts
  const spaceCounts = new Map<string, number>();
  for (const id of index.ids) {
    const s = index.byId.get(id)?.space;
    if (s) spaceCounts.set(s, (spaceCounts.get(s) ?? 0) + 1);
  }
```
and add to the JSON: `domains: domainCounts(sourceCounts), spaces: [...allowed].map((id) => ({ id, count: spaceCounts.get(id) ?? 0 })),`.

Apply the same four changes to `evidence-network/+server.ts`.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/jkai/intel/analytics && npm run gate:check:only`
Expected: PASS, 0 errors.

- [ ] **Step 6: Commit**

```bash
git commit -am "Intel: network APIs filter by space and domain and report both"
```

---

### Task 7: News gets its own source

**Files:**
- Modify: `src/lib/news/actions.ts:46-50`, `src/lib/jkai/intel/trust.ts:~65`, `src/lib/components/intel/SourcePicker.svelte` (`LABELS`), `src/routes/api/jkai/intel/backfill/+server.ts`

- [ ] **Step 1: Write `'news'`**

`news/actions.ts`: `source: 'news',` (the `IngestInput` union already includes it from Task 3). `trust.ts`: find the source→grade map, add `news:` with the same grade as `web`. `SourcePicker.svelte` `LABELS`: add `news: { name: 'News', hint: 'Stories kept from /news' },`.

- [ ] **Step 2: Backfill option**

In the backfill `POST` handler, before the kinds branch, add:
```ts
  // Kept news stories were written as source 'web' until 2026-09-24. Every one
  // carries metadata.newsKey, so the relabel is exact. Idempotent.
  if (body?.newsSource === true) {
    const res = await db.execute(sql`
      UPDATE intel_notes SET source = 'news', updated_at = now()
      WHERE source = 'web' AND metadata ? 'newsKey'`);
    invalidateGraphAnalysis();
    return json({ newsSource: res.rowCount ?? 0 });
  }
```
(Import `invalidateGraphAnalysis` from `$lib/jkai/intel/analytics/load`; match how the handler already reads `body`.) Add `POST { newsSource: true } → relabel kept news from 'web' to 'news'` to the header comment's list.

- [ ] **Step 3: Verify locally**

Run: `npm run gate:check:only` → 0 errors. With the dev server running (`local-qa` skill), `curl -s -X POST localhost:5173/api/jkai/intel/backfill -H 'content-type: application/json' -d '{"newsSource":true}'` → `{"newsSource":N}`; running it again → `{"newsSource":0}`.

- [ ] **Step 4: Commit**

```bash
git commit -am "News: kept stories are source 'news', with a relabel for the old 'web' rows"
```

---

### Task 8: Scope rail on `/jkai/intel`

**Files:**
- Create: `src/lib/components/intel/ScopePicker.svelte`
- Modify: `src/routes/jkai/intel/+page.svelte` (state ~73, `query` ~434, rail ~1057/1164, network type)

**Interfaces:**
- Consumes: API `domains` / `spaces` arrays (Task 6), `INTEL_DOMAINS` (Task 1)
- Produces: component props `{ spaces: Array<{id; count}>; domains: Array<{id; count}>; activeSpaces: string[]; activeDomains: string[]; onToggleSpace(id); onToggleDomain(id); onClear() }`

Read `.claude/skills/sr-design/SKILL.md` and `~/.claude/skills/svelte5-pitfalls/SKILL.md` first. Mirror `SourcePicker.svelte`'s markup, class names and styles (copy its chip/row CSS rather than inventing).

- [ ] **Step 1: Component**

`ScopePicker.svelte` — two groups, each a row of toggle chips in `SourcePicker`'s chip style:
- **Space** — `spaces` mapped with labels `{ owner: 'Mine', household: 'Household' }` (unknown id → the id). Chip shows label + count.
- **Domain** — `INTEL_DOMAINS` order, label from `INTEL_DOMAINS`, `title={hint}`, count from `domains`. A domain with `count === 0` renders `disabled` with `aria-disabled="true"` (Home reads as coming), EXCEPT when it is active (so it can be switched off). Hide `other` when its count is 0.
- A "Clear" text button when anything is active, calling `onClear`.
- Empty selection = no filter; chips show pressed state via `aria-pressed`.
No `$effect` needed — pure props-in, callbacks-out.

- [ ] **Step 2: Page state and query**

Beside `activeSources`:
```ts
  /** Space chips. Empty = every space this reader may see (own + household). */
  let activeSpaces = $state<string[]>(initialCsv('spaces'));
  /** Domain chips. Empty = no filter. */
  let activeDomains = $state<string[]>(initialCsv('domains'));
```
with a plain helper above them (seeded once from the page URL so a link like `/jkai/intel?domains=news` opens filtered):
```ts
  function initialCsv(key: string): string[] {
    return (page.url.searchParams.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }
```
(Use whatever `page` / `$page` import the file already uses.) In `query`: `if (activeSpaces.length) p.set('spaces', activeSpaces.join(','));` and `if (activeDomains.length) p.set('domains', activeDomains.join(','));`. Add toggle helpers in the style of `toggleSource` (they must assign a NEW array, never mutate). Extend the network response type with `domains` and `spaces`.

- [ ] **Step 3: Rail**

Insert as the FIRST `RailSection` in the rail:
```svelte
      <RailSection title="Scope" badge={activeSpaces.length + activeDomains.length || null} open={true}>
        <ScopePicker
          spaces={network?.spaces ?? []}
          domains={network?.domains ?? []}
          {activeSpaces}
          {activeDomains}
          onToggleSpace={toggleSpace}
          onToggleDomain={toggleDomain}
          onClear={clearScope}
        />
      </RailSection>
```

- [ ] **Step 4: Verify in the browser**

`vite dev` in the worktree (memory `reference_jkai_chat_ui_local_verification`: dev server, not a build; hard-linked `node_modules` already in place). Open `http://homeserv:<port>/jkai/intel`:
- Scope section shows Mine/Household with counts; Email/Chat/Research/Documents with counts; News count > 0 only after Task 7's backfill ran on this DB; Home disabled.
- Click Email → graph shrinks, URL to `/api/jkai/intel/network` carries `domains=email` (DevTools network tab).
- Click Household → empty graph (no household data yet) and the Clear button restores it.
- `/jkai/intel?domains=research` opens pre-filtered.
Screenshot light and dark.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/intel/ScopePicker.svelte src/routes/jkai/intel/+page.svelte
git commit -m "Intel: Scope rail — filter the graph by space and by domain"
```

---

### Task 9: Leak guard with a baseline

**Files:**
- Create: `scripts/check-intel-scope.mjs`, `scripts/check-intel-scope.test.mjs`, `scripts/intel-scope-baseline.json`
- Modify: `package.json` (scripts), `scripts/gate-structural.sh`

**Interfaces:**
- Produces: `export function classify(files: Array<{ path: string; src: string }>, baseline: string[], maintenance: Record<string,string>): { unscoped: string[]; fixed: string[] }` — `unscoped` = readers that are neither scoped, maintenance, nor in the baseline; `fixed` = baseline entries that are now scoped or gone (must be removed from the baseline).
  CLI flags: `--write-baseline` (regenerate), `--strict` (baseline must be empty).

A file is a **reader** if its source matches `/\b(intelNotes|intelEntities|intelRelationships|intelTimelineEvents|intelAlerts|intelInsights|intelLenses|intelDossiers|intelCommissions)\b|\bintel_(notes|entities|relationships|timeline_events|alerts|insights|lenses|dossiers|commissions)\b/`. It is **scoped** if it also matches a READ predicate — deliberately not a bare `spaceId` / `space_id`, because Task 3 adds `spaceId:` to every writer and a writer's own reads would otherwise slip past the baseline unscoped: `/\bspaceIn\(|\bspace_id\s*=|eq\(\w+\.spaceId|OWNER_INTEL_SCOPE|resolveRequestScope|\bscope\s*:\s*IntelScope/`. Files scanned: `src/**/*.{ts,svelte}` excluding `*.test.ts`, `src/lib/db/schema.ts`, and `src/lib/jkai/intel/scope*.ts`.

The heuristic is deliberately coarse — it proves a file THOUGHT about space, not that every query in it is right. The integration test (Task 13) is the semantic check; this is the ratchet that stops a brand-new reader arriving with no thought at all.

- [ ] **Step 1: Failing test** — `scripts/check-intel-scope.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './check-intel-scope.mjs';

const reader = (path, extra = '') => ({ path, src: `import { intelEntities } from '$lib/db/schema';\n${extra}` });

test('a new unscoped reader fails', () => {
  const r = classify([reader('src/new.ts')], [], {});
  assert.deepEqual(r.unscoped, ['src/new.ts']);
});

test('a scoped reader passes', () => {
  const r = classify([reader('src/a.ts', 'where(spaceIn(intelEntities.spaceId, scope))')], [], {});
  assert.deepEqual(r.unscoped, []);
});

test('a baselined reader passes, and one that became scoped must leave the baseline', () => {
  const r = classify(
    [reader('src/old.ts'), reader('src/done.ts', 'const s: IntelScope = OWNER_INTEL_SCOPE')],
    ['src/old.ts', 'src/done.ts', 'src/deleted.ts'], {},
  );
  assert.deepEqual(r.unscoped, []);
  assert.deepEqual(r.fixed.sort(), ['src/deleted.ts', 'src/done.ts']);
});

test('maintenance files are exempt', () => {
  const r = classify([reader('src/cleanup.ts')], [], { 'src/cleanup.ts': 'nightly sweep over every space' });
  assert.deepEqual(r.unscoped, []);
});

test('a file that does not touch intel tables is ignored', () => {
  const r = classify([{ path: 'src/x.ts', src: 'const a = 1' }], [], {});
  assert.deepEqual(r.unscoped, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/check-intel-scope.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/check-intel-scope.mjs`**

```js
#!/usr/bin/env node
// Guard: every reader of the intel tables must be scoped to a space.
//
// Intel rows belong to a person (see src/lib/jkai/intel/scope.ts). A query
// with no space predicate reads everyone's graph — the owner's chat would
// quote a family member's email, or worse the other way round. Postgres RLS
// is not used for this; the check is in code: a file that reads an intel table
// must show it thought about space, or be named below with a reason.
//
// The baseline is the readers that existed before spaces did. It may only
// shrink: an entry that is now scoped or deleted fails the check until it is
// removed, so the list cannot rot. `--strict` requires it to be empty — PR B
// (member data) turns that on.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const READS = /\b(intelNotes|intelEntities|intelRelationships|intelTimelineEvents|intelAlerts|intelInsights|intelLenses|intelDossiers|intelCommissions)\b|\bintel_(notes|entities|relationships|timeline_events|alerts|insights|lenses|dossiers|commissions)\b/;
const SCOPED = /\bspaceIn\(|\bspace_id\s*=|eq\(\w+\.spaceId|OWNER_INTEL_SCOPE|resolveRequestScope|\bscope\s*:\s*IntelScope/;
const SKIP = /(\.test\.ts$|^src\/lib\/db\/schema\.ts$|^src\/lib\/jkai\/intel\/scope(\.server)?\.ts$)/;
const BASELINE = 'scripts/intel-scope-baseline.json';

/** Readers that legitimately span every space, each with the reason. */
export const MAINTENANCE = {
  // Filled in by PR A2 as each maintenance file is reviewed — see the plan.
};

export function classify(files, baseline, maintenance) {
  const readers = files.filter((f) => !SKIP.test(f.path) && READS.test(f.src));
  const scoped = new Set(readers.filter((f) => SCOPED.test(f.src)).map((f) => f.path));
  const readerPaths = new Set(readers.map((f) => f.path));
  const base = new Set(baseline);
  const unscoped = readers
    .map((f) => f.path)
    .filter((p) => !scoped.has(p) && !(p in maintenance) && !base.has(p))
    .sort();
  const fixed = baseline.filter((p) => !readerPaths.has(p) || scoped.has(p) || p in maintenance).sort();
  return { unscoped, fixed };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|svelte)$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const files = walk('src').map((path) => ({ path, src: readFileSync(path, 'utf8') }));
  if (args.has('--write-baseline')) {
    const { unscoped } = classify(files, [], MAINTENANCE);
    writeFileSync(BASELINE, JSON.stringify(unscoped, null, 2) + '\n');
    console.log(`check-intel-scope: wrote ${unscoped.length} baseline readers to ${BASELINE}`);
    return;
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : [];
  const { unscoped, fixed } = classify(files, baseline, MAINTENANCE);
  let fail = false;
  if (unscoped.length) {
    fail = true;
    console.error('check-intel-scope: FAIL — these files read intel tables with no space scope:\n');
    for (const p of unscoped) console.error(`  ${p}`);
    console.error('\nPass a `scope: IntelScope` (default OWNER_INTEL_SCOPE) and add spaceIn(...) /');
    console.error('space_id to every query. See src/lib/jkai/intel/scope.ts.');
  }
  if (fixed.length) {
    fail = true;
    console.error('\ncheck-intel-scope: FAIL — remove these from the baseline (now scoped or gone):\n');
    for (const p of fixed) console.error(`  ${p}`);
  }
  if (args.has('--strict') && baseline.length) {
    fail = true;
    console.error(`\ncheck-intel-scope: FAIL — --strict and ${baseline.length} baseline readers remain.`);
  }
  if (fail) process.exit(1);
  console.log(`check-intel-scope: ok (${baseline.length} baseline readers left to scope)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run test, seed the baseline, wire the gate**

Run: `node --test scripts/check-intel-scope.test.mjs` → PASS (5 tests).
Run: `node scripts/check-intel-scope.mjs --write-baseline` → prints the count (expect roughly 80–100). Then `node scripts/check-intel-scope.mjs` → `ok (N baseline readers left to scope)`.
`package.json`: add `"gate:intel-scope": "node scripts/check-intel-scope.mjs",` after `gate:boundaries`.
`scripts/gate-structural.sh`: add after `npm run gate:boundaries`:
```bash
node --test scripts/check-intel-scope.test.mjs
npm run gate:intel-scope
```
Run `./scripts/gate-structural.sh` → passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-intel-scope.mjs scripts/check-intel-scope.test.mjs scripts/intel-scope-baseline.json package.json scripts/gate-structural.sh
git commit -m "Gate: intel readers must be scoped to a space — ratchet from today's baseline"
```

---

### Task 10: Ship A1

- [ ] **Step 1: Full gate on porkserv**

Run: `./scripts/gate-remote.sh`
Expected: green. Read the `Errors N errors` line too (memory `reference_gate_teardown_flake_lookups` — a gate can fail with 0 failed tests).

- [ ] **Step 2: Integration test locally**

Run: `npx vitest run src/lib/jkai/intel/spaces.integration.test.ts` → PASS (it is excluded from the merge gate).

- [ ] **Step 3: PR**

```bash
git push -u origin feat/intel-spaces
gh pr create --title "Intel spaces and domains (A1): every row has an owner, the graph filters by domain" --body "$(cat <<'EOF'
Phase A1 of docs/superpowers/specs/2026-09-24-intel-spaces-and-domains-design.md.

- `space_id` on the nine intel tables readers list; `principal_id` on gmail_accounts. All default 'owner', so existing data and every owner view are unchanged.
- Writes take a space explicitly; derived rows take the note's. Resolution and merge never cross a space.
- The graph snapshot is scoped and cached per scope.
- `/api/jkai/intel/network` takes `spaces=` and `domains=`; `/jkai/intel` gains a Scope rail.
- Kept news stories are source `news` (backfill: `POST /api/jkai/intel/backfill {"newsSource":true}`).
- `gate:intel-scope` ratchets the readers not yet scoped (baseline in scripts/intel-scope-baseline.json); A2 empties it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Q6iYBqPpknkHWqBJApK7La
EOF
)"
```

- [ ] **Step 4: Wait for CI, merge explicitly**

```bash
BRANCH=feat/intel-spaces
until [ "$(gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion')" != "" ]; do sleep 45; done
gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion'   # must be "success"
gh pr merge <N> --squash
```
Then watch the master release run to `success` and confirm the deployed sha (memory `reference_ci_pending_deploy_cancelled`).

- [ ] **Step 5: Verify live**

On the VPS (read-only first):
```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling -Atc "select space_id, count(*) from intel_notes group by 1; select space_id, count(*) from intel_entities group by 1; select count(*) from gmail_accounts where principal_id = '"'"'owner'"'"'"'
```
Expected: every row `owner`; counts equal the pre-deploy totals (5,807 notes on 2026-09-24 plus anything ingested since).
Run the news backfill with the maintenance secret from the VPS (`x-maintenance-secret`, as the intel memory describes) → `{"newsSource":2}` or thereabouts.
Then: `/api/jkai/intel/network?domains=news` (owner session) returns only nodes whose sources include `news`; `/jkai/intel` renders the Scope rail. Screenshot.

- [ ] **Step 6: Memory**

Update `project_intel_command_centre.md` with a dated "Spaces + domains (A1)" section (columns, `scope.ts`, the ratchet, why scoping lives in code) and add one index line to `MEMORY.md` under *Intel*.

---

## PR A2 — scope every baseline reader

Branch `feat/intel-spaces-a2` from the merged master. Each task below takes a slice of `scripts/intel-scope-baseline.json`, and ends with that slice REMOVED from the baseline and `npm run gate:intel-scope` passing.

**The rule for every reader:**
- A library function gets a trailing `scope: IntelScope = OWNER_INTEL_SCOPE` parameter (or a `scope` field on its existing options object) and adds a predicate to **every** intel-table query it runs:
  - Drizzle: `.where(and(…existing, spaceIn(intelEntities.spaceId, scope)))`
  - Raw SQL: `AND e.space_id = ANY(${pgTextArray(scope)}::text[])` on each aliased intel table in the FROM/JOIN list (entities, notes, relationships — every one, not just the first).
  - `getGraphAnalysis(...)` calls pass `{ scope }` through.
- A route handler gets `const scope = await resolveRequestScope(event);` and passes it down.
- Lookup by primary key (`where id = $1`) still gets the predicate — an id guessed from another space must 404, not load.
- A file that genuinely spans every space (nightly maintenance, cleanup, backfill) goes into `MAINTENANCE` in `check-intel-scope.mjs` with a one-line reason instead — and must not RETURN rows to any user-facing caller.

### Task 11: Core intel library (`src/lib/jkai/intel/**` baseline entries)

Readers include `search.ts`, `context.ts`, `recall.ts`, `queries.ts`, `entity-query.server.ts`, `entity-card-store.ts`, `lenses.ts`, `lenses.server.ts`, `watchlist.ts`, `brief.ts`, `cluster-roster.ts`, `taxonomy*.ts`, `trust-refresh.ts`, `cleanup.server.ts`, `resolve/*`, `mail-admit.ts`, `gmail-ingest.ts`, `engine.ts` — take the exact list from the baseline file with `jq -r '.[] | select(startswith("src/lib/jkai/intel/"))' scripts/intel-scope-baseline.json`.

- [ ] **Step 1:** Extend `spaces.integration.test.ts` with a u_test note + entity named `Plimsworth Quarry` (admitted, embedded via `embedNote`) and assert it is absent from: `searchIntel('Plimsworth')`, `buildKnowledgeContext('Plimsworth Quarry')` output text, `fetchMentionIndex()` names. Run → FAIL.
- [ ] **Step 2:** Apply the rule to each file in the slice. Maintenance candidates (review each; move to `MAINTENANCE` only if it never returns rows to a user): `cleanup.server.ts`, `trust-refresh.ts`, `taxonomy-governance.server.ts`, the embeddings backfill.
- [ ] **Step 3:** Run `npx vitest run src/lib/jkai/intel` → PASS; `npm run gate:check:only` → 0; remove the slice from the baseline; `npm run gate:intel-scope` → ok.
- [ ] **Step 4:** Commit `Intel: scope the core intel library`.

### Task 12: Intel routes (`src/routes/api/jkai/intel/**`, `src/routes/jkai/intel/**`)

- [ ] **Step 1:** For each route in the slice, `const scope = await resolveRequestScope(event)` and pass it to every library call and query. `+layout.server.ts` badge counts included.
- [ ] **Step 2:** Writes in these routes that create owner-authored artefacts (lenses, dossiers, commissions, insights) set `spaceId` explicitly from `scope[0]` — add a helper `writeSpace(scope)` in `scope.ts` returning `scope[0]` and document that a request scope is always `[own, 'household']`, own first. Add a unit test for it in `scope.test.ts`.
- [ ] **Step 3:** `npm run gate:check:only`, remove slice, `npm run gate:intel-scope`, commit `Intel: scope every intel route`.

### Task 13: Every other consumer

Slice: daydream (`src/lib/daydream/**`), news (`correlate.server.ts`, `stats.ts`), `mail-index/*`, `jkai/thread-graph*.ts`, `jkai/memory/*`, `jkai/context-panel/*`, `jkai/grounding/*`, `jkai/graph-colors.ts`, canvas `intel/{graph,geo}`, `workflows/**` intel nodes and `site-tools/tools/intel-graph.ts` + `knowledge.ts`, `heartbeat/activities/*`, `deepdive/graph-commit.ts`.

- [ ] **Step 1:** Apply the rule. These are owner-only consumers: they call the library with no scope argument (owner default) and add the predicate to their OWN raw queries with `OWNER_INTEL_SCOPE`.
- [ ] **Step 2:** Extend the integration test: `Plimsworth Quarry` absent from the `intel_find` tool's handler output and from `/api/canvas/[slug]/intel/graph` (call the route's `GET` with a stub event, as other route tests in the repo do — find one with `grep -rln "RequestEvent" src/routes --include=*.test.ts`).
- [ ] **Step 3:** Gate check, remove slice, commit `Intel: scope every consumer outside the intel library`.

### Task 14: Nightly engine iterates spaces

**Files:** `src/lib/jkai/intel/engine.ts:166-464`

- [ ] **Step 1:** Add `async function activeSpaces(): Promise<string[]>` — `SELECT DISTINCT space_id FROM intel_entities` — and run the resolve, adjudicate, conflation, watchlist and lens stages once per space with `scope = [space]` (resolution must see exactly ONE space, never the household alongside). Confidence, embeddings and cleanup stay single global passes (per-row work, in `MAINTENANCE`).
- [ ] **Step 2:** Gmail rolling: replace `resolveAccount()`'s "most recent active account" with a loop over `SELECT * FROM gmail_accounts WHERE status = 'active' AND principal_id = 'owner'` for now (PR B drops the `owner` filter once the baseline is empty). Each iteration passes `spaceId: acct.principalId`.
- [ ] **Step 3:** Unit-test `activeSpaces`' consumer shape with a stubbed stage runner if the engine has one; otherwise rely on the integration test and a manual `INTEL_ENGINE` dry run locally (`grep -n "runNow\|dryRun" engine.ts` for an entry point).
- [ ] **Step 4:** Commit `Intel: the nightly engine runs per space`.

### Task 15: Flip strict, ship A2

- [ ] **Step 1:** `node scripts/check-intel-scope.mjs --strict` → ok with 0 baseline readers. Delete `scripts/intel-scope-baseline.json`'s contents to `[]` and change the gate line to `npm run gate:intel-scope -- --strict`.
- [ ] **Step 2:** Add one sentence to the spec's Delivery section: "From A2 the gate runs `--strict`, so no PR can reintroduce an unscoped intel reader; that — not a runtime check — is what makes member data safe to write in PR B." Commit with the gate change.
- [ ] **Step 3:** `./scripts/gate-remote.sh`, integration test locally, PR, wait for CI, merge explicitly, verify live exactly as Task 10 Step 5 (counts unchanged; `/jkai/intel`, `/jkai` chat, daydream page, a canvas with an intel node all still render with data).
- [ ] **Step 4:** Update the memory section, then write the PR B plan against merged master.

---

## Self-review notes

- Spec §1 columns → Task 2; funnels + derived → Task 3; resolution → Task 4. §2 scope helpers → Tasks 1/3; snapshot → Task 5; readers → Tasks 11–13; leak guard → Task 9/15; engine → Task 14. §3 domains → Tasks 1/6/7. §4 UI → Task 8. §5 members → PR B plan (deferred by design). Verification → Tasks 3/4/6/10/11/13/15.
- Deviation from spec §4: the per-node space outline is dropped for A1 — household has no content until PR B, so there is nothing to tell apart. Revisit in PR B when household drive folders exist. The spec's "state in the URL" is honoured as read-on-load (`?spaces=` / `?domains=`); writing filter state back to the address bar is not in scope.
- Deviation from spec §1: `intel_insights.dedupe_key` / lens and dossier slug prefixing is a PR B concern (only the owner writes those until members exist); Task 12 makes the space explicit on write so B only has to prefix.
- Deviation from spec §4: SourcePicker does not nest under its domain. The Scope section sits above it and SourcePicker is unchanged (controller ruling in Task 8). WhatsApp, which ingest still accepts, is mapped to Chat & capture rather than falling through to Other.
