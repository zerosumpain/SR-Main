# Research Canvas ("The Desk") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear deep-research UX with a live, draggable "desk" canvas where research artefacts stream in and a GATHER<->SYNTHESIZE toggle flips them between scattered intake and organised, LLM-synthesised clusters.

**Architecture:** Reuse the existing 4-phase deepdive engine, the per-session EventEmitter->SSE spine, and the /jkai/canvas pan/zoom/drag/edge internals. Add artefact-level SSE events, an on-demand streamed synthesis endpoint, additive schema columns + a synthesis_runs table, and a new Svelte desk UI. Additive, non-destructive migration.

**Tech Stack:** SvelteKit (Svelte 5 runes), Drizzle ORM + Postgres, Server-Sent Events, Vitest, the $lib/deepdive/ai.ts LLM gateway (Z.AI/OpenRouter).

---

## Contract glossary

Every task references these canonical names/shapes verbatim.

```text
SHARED CONTRACT — use these EXACT names, shapes, paths, signatures in all task code. Do NOT invent variants.

EVENTS (ride the existing generic emit() in src/lib/deepdive/worker.ts; SSEEvent union in types.ts:26-30 is extended to include 'artefact' and 'synthesis'):
- Artefact event: emit(sessionId, { type:'artefact', data:{ seq:number, artefactType:'source'|'fact'|'entity'|'relationship', id:string, phase:1|2|3|'post', /* type-specific fields */ } })
  - source fields: url,title,domain,category,credibilityScore,credibilityType
  - fact fields: sourceId,content,confidence,isCounterfactual,refutesFactId,tags,eventDate
  - entity fields: name,type,description
  - relationship fields: fromEntityId,toEntityId,relationshipType,sentiment,strength,sourceId
- Synthesis event: emit(sessionId, { type:'synthesis', data:{ seq:number, runId:string, stage:'started'|'progress'|'cluster'|'done', token?:string, cluster?:{id,title,summary,fact_ids}, summary?:string, clusters?:any[], scope?:any, factCount?:number, tokensUsed?:number } })

HELPERS (new file src/lib/deepdive/desk-events.ts):
- nextSeq(sessionId:string): number            // monotonic per-session counter held in a module Map
- emitArtefact(sessionId:string, artefactType:'source'|'fact'|'entity'|'relationship', phase:1|2|3|'post', fields:Record<string,unknown> & { id:string }): void   // wraps nextSeq + emit; coalesced via a per-session queue flushed on a ~100ms timer
- flushArtefacts(sessionId:string): void

WORKER (src/lib/deepdive/worker.ts) — REUSE existing: getEmitter, emit, emitLog, emitStats, emitStatus, shouldStop, requestStop, getAbortSignal. ADD: ensureEmitter(sessionId:string): EventEmitter (re-creates if the 30s cleanup removed it).

LLM GATEWAY (src/lib/deepdive/ai.ts) — REUSE existing (confirm exact signatures by reading the file):
- streamCompletion(system:string, user:string, opts:{ maxTokens?:number, signal?:AbortSignal, onToken?:(t:string)=>void, model?:string }): Promise<{ text:string, tokensUsed:number }>
- jsonCompletion<T>(system:string, user:string, opts?:{...}): Promise<T>

SYNTHESIS (new file src/lib/deepdive/synthesis.ts):
- runSynthesis(sessionId:string, runId:string, scope:{ factIds?:string[], category?:string, pinnedOnly?:boolean }): Promise<void>   // fire-and-forget background worker
- per-run abort registry: const synthesisAborts = new Map<string,AbortController>(); requestStopSynthesis(runId:string): void; getSynthesisSignal(runId:string): AbortSignal

ROUTES (new):
- POST /api/deepdive/[id]/synthesize  -> body { scope } ; inserts synthesis_runs row, returns 201 { runId }, kicks runSynthesis without await
- PATCH /api/deepdive/[id]/artefacts/[artefactId]/position -> body { artefactType:'source'|'fact'|'entity', position:{x:number,y:number}, pinned?:boolean, deskState?:string, deskCategory?:string }
- Desk page route: src/routes/deepdive/[id]/+page.svelte (+ +page.server.ts)

SCHEMA (src/lib/db/schema.ts) — additive nullable columns appended to sources, facts, entities:
  canvasX: doublePrecision('canvas_x'),
  canvasY: doublePrecision('canvas_y'),
  pinned: boolean('pinned').notNull().default(false),
  deskState: text('desk_state').notNull().default('unfiled'),  // 'unfiled'|'filed'|'synthesized'|'archived'
  deskCategory: text('desk_category'),
  synthesisRunId: text('synthesis_run_id'),
NEW table synthesisRuns (pgTable 'synthesis_runs'): id (text pk gen_random_uuid()::text), sessionId (text notNull FK researchSessions.id), scope (jsonb default '{}'), status (text default 'running'), summary (text), clusters (jsonb default '[]'), tokensUsed (integer), errorMessage (text), createdAt (timestamptz defaultNow notNull), completedAt (timestamptz). Relationships get NO position columns (edges only).

DESK FRONTEND (new, under src/lib/canvas/intelligence/):
- ResearchDesk.svelte (shell), desk/ArtefactCard.svelte, desk/CategoryHeader.svelte, desk/EntityRail.svelte, desk/ActivityTicker.svelte, desk/LeftFeed.svelte, desk/InspectorDrawer.svelte, desk/CommandBar.svelte, desk/ModeToggle.svelte
- desk/layout.ts pure fns: hashId(id:string):number ; scatterPosition(id:string, phase:number):{x:number,y:number} ; organisedLayout(artefacts:{id:string,kind:string,categoryId?:string}[], categories:{id:string,title:string}[]):Map<string,{x:number,y:number}>
- Store: hydrate via GET /api/deepdive/[id]/data THEN subscribe to GET /api/deepdive/[id]/stream (EventSource), dedup cards by id, use $state.raw + ~5ms debounced flush idiom (lifted from /jkai/canvas).

DESIGN TOKENS (src/app.css): --bg #ede4d4, card #faf6ee, --surface-elevated #e8dece, hairline border rgba(26,16,8,.18), --accent #c4570a, brutalist shadow '3px 4px 0 rgba(26,16,8,.1)', fonts --font-mono(JetBrains Mono)/--font-display(Archivo Black)/--font-body(DM Sans)/--font-brand(DM Mono). UNFILED = 1.5px dashed var(--accent), no shadow.

CANVAS CODE TO LIFT (from src/routes/jkai/canvas/[slug]/+page.svelte): pan/zoom :1850-1909 (panX/panY/zoom, zoomAt, fit, reset, MIN_ZOOM=0.25 MAX_ZOOM=3, wheel factor=Math.exp(-e.deltaY*0.0015)); drag+grid-snap :1992-2069 (GRID=20, dx=dxClient/zoom); orthPath :1016-1053; minimap :1117-1164; portal from $lib/canvas/portal.

TEST RUNNER: Vitest. Unit test files co-located as *.test.ts next to the module. Run: npx vitest run <path>. NOTE: type-check needs NODE_OPTIONS=--max-old-space-size=8192. Build/deploy must run with the Bash sandbox disabled.

GIT: trunk-based on 'master'. Commit after each task. Commit footer line: Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---


I have all the ground truth I need. `psql` is at `/usr/bin/psql`, the DB is at `localhost:5433/strange_rambling` (user `app`), `pg` is installed. All required Drizzle imports (`doublePrecision`, `boolean`, `text`, `jsonb`, `integer`, `timestamp`, `sql`) are already present at the top of `schema.ts`, so no import changes are needed. Here is the milestone.

## Milestone 1: Schema + migration

This milestone adds the additive, nullable canvas-desk columns to the existing `sources`, `facts`, and `entities` tables, and creates the new `synthesisRuns` table, in `src/lib/db/schema.ts`. Everything is additive/nullable/defaulted so `drizzle-kit push` is a safe, non-destructive operation. TDD is limited here (schema is declarative), so the test surface is: (1) a Vitest unit test asserting the Drizzle table objects expose the new columns with the right names/defaults (catches typos/renames without a DB), and (2) a live `drizzle-kit push` + a `psql` introspection check that proves the columns and table physically exist in Postgres.

**Pre-flight context (already verified against the live repo — do not re-derive):**
- `src/lib/db/schema.ts` is 1850 lines. The relevant table defs are: `sources` at lines 388-400, `facts` at lines 404-418, `entities` at lines 422-429. The `quickAnswers` table (the idiom to mirror) is at lines 1122-1147; its `QuickAnswer` type export is line 1147.
- All needed column builders are **already imported** at the top of the file (lines 1-18): `pgTable, text, timestamp, integer, doublePrecision, boolean, jsonb, sql`. **No import edits are required.**
- `researchSessions` (pgTable `'research_session'`, text PK) is defined at lines 370-383 — `synthesisRuns.sessionId` references `researchSessions.id`.
- DB connection for local push: `DATABASE_URL=postgresql://app:<pw>@localhost:5433/strange_rambling` lives in `/home/john/strange_rambling_svelte/.env`; `drizzle.config.ts` reads `process.env.DATABASE_URL` (falling back to the same localhost:5433 URL). `psql` is at `/usr/bin/psql`; the `pg` driver is installed.
- Physical table names (Postgres): `source`, `fact`, `entity`, and the new `synthesis_runs`.

---

### Task 1: Add canvas-desk columns + synthesisRuns table to schema.ts

**Files:**
- Modify: `src/lib/db/schema.ts` — `sources` table (lines 388-400), `facts` table (lines 404-418), `entities` table (lines 422-429), and insert a new `synthesisRuns` table after the `QuickAnswer` type export (line 1147).
- Create: `src/lib/db/schema.desk.test.ts`

- [ ] **Step 1: Write the failing unit test that asserts the new columns/table exist on the Drizzle objects.**

  This test introspects the Drizzle table objects (no DB connection needed — it reads the column metadata the schema builders produce). It will fail to compile/run until the schema edits in Steps 3-6 land. Create `src/lib/db/schema.desk.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { sources, facts, entities, synthesisRuns } from './schema';
  import { getTableConfig } from 'drizzle-orm/pg-core';

  // The six additive desk columns appended to sources/facts/entities.
  // [drizzle property name, physical column name]
  const DESK_COLUMNS: [string, string][] = [
    ['canvasX', 'canvas_x'],
    ['canvasY', 'canvas_y'],
    ['pinned', 'pinned'],
    ['deskState', 'desk_state'],
    ['deskCategory', 'desk_category'],
    ['synthesisRunId', 'synthesis_run_id'],
  ];

  describe('desk columns on research tables', () => {
    for (const [label, table] of [
      ['sources', sources],
      ['facts', facts],
      ['entities', entities],
    ] as const) {
      describe(label, () => {
        const cols = getTableConfig(table).columns;
        const byName = new Map(cols.map((c) => [c.name, c]));

        for (const [prop, colName] of DESK_COLUMNS) {
          it(`has column ${colName} (prop ${prop})`, () => {
            const col = byName.get(colName);
            expect(col, `${label}.${colName} missing`).toBeTruthy();
          });
        }

        it('canvas_x / canvas_y are nullable doublePrecision', () => {
          const x = byName.get('canvas_x')!;
          const y = byName.get('canvas_y')!;
          expect(x.notNull).toBe(false);
          expect(y.notNull).toBe(false);
          expect(x.getSQLType()).toBe('double precision');
          expect(y.getSQLType()).toBe('double precision');
        });

        it('pinned is NOT NULL boolean default false', () => {
          const p = byName.get('pinned')!;
          expect(p.notNull).toBe(true);
          expect(p.getSQLType()).toBe('boolean');
          expect(p.default).toBe(false);
        });

        it("desk_state is NOT NULL text default 'unfiled'", () => {
          const s = byName.get('desk_state')!;
          expect(s.notNull).toBe(true);
          expect(s.getSQLType()).toBe('text');
          expect(s.default).toBe('unfiled');
        });

        it('desk_category / synthesis_run_id are nullable text', () => {
          const dc = byName.get('desk_category')!;
          const sr = byName.get('synthesis_run_id')!;
          expect(dc.notNull).toBe(false);
          expect(dc.getSQLType()).toBe('text');
          expect(sr.notNull).toBe(false);
          expect(sr.getSQLType()).toBe('text');
        });
      });
    }
  });

  describe('synthesisRuns table', () => {
    const cfg = getTableConfig(synthesisRuns);
    const byName = new Map(cfg.columns.map((c) => [c.name, c]));

    it("maps to the 'synthesis_runs' table", () => {
      expect(cfg.name).toBe('synthesis_runs');
    });

    it('has the expected columns', () => {
      const expected = [
        'id',
        'session_id',
        'scope',
        'status',
        'summary',
        'clusters',
        'tokens_used',
        'error_message',
        'created_at',
        'completed_at',
      ];
      for (const name of expected) {
        expect(byName.get(name), `synthesis_runs.${name} missing`).toBeTruthy();
      }
    });

    it('id is the text primary key', () => {
      const id = byName.get('id')!;
      expect(id.primary).toBe(true);
      expect(id.getSQLType()).toBe('text');
    });

    it('session_id is NOT NULL text', () => {
      const sid = byName.get('session_id')!;
      expect(sid.notNull).toBe(true);
      expect(sid.getSQLType()).toBe('text');
    });

    it("status is NOT NULL text default 'running'", () => {
      const st = byName.get('status')!;
      expect(st.notNull).toBe(true);
      expect(st.default).toBe('running');
    });

    it('scope and clusters are NOT NULL jsonb', () => {
      const scope = byName.get('scope')!;
      const clusters = byName.get('clusters')!;
      expect(scope.notNull).toBe(true);
      expect(scope.getSQLType()).toBe('jsonb');
      expect(clusters.notNull).toBe(true);
      expect(clusters.getSQLType()).toBe('jsonb');
    });

    it('created_at is NOT NULL, completed_at is nullable', () => {
      expect(byName.get('created_at')!.notNull).toBe(true);
      expect(byName.get('completed_at')!.notNull).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run the test and confirm it FAILS (red) because `synthesisRuns` is not exported yet.**

  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/db/schema.desk.test.ts
  ```

  Expected: the run fails. Because `synthesisRuns` does not exist yet, Vitest reports a transform/import error similar to:
  ```
  Error: No known export 'synthesisRuns' in module ... src/lib/db/schema.ts
  ```
  (or a `SyntaxError` / failed import for `synthesisRuns`). The point is a **non-zero exit and zero passing assertions** — do not proceed to Step 7 until this is confirmed red.

- [ ] **Step 3: Append the six desk columns to the `sources` table.**

  In `src/lib/db/schema.ts`, the `sources` table currently ends (lines 396-400) with the `phase`/`credibilityScore`/`credibilityType`/`fetchedAt` columns. Add the new columns before the closing `});`. Replace:

  ```ts
    phase: integer('phase').notNull(),
    credibilityScore: doublePrecision('credibility_score'),
    credibilityType: text('credibility_type'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  });
  ```

  with:

  ```ts
    phase: integer('phase').notNull(),
    credibilityScore: doublePrecision('credibility_score'),
    credibilityType: text('credibility_type'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    // --- Research Desk (canvas) additive columns ---
    canvasX: doublePrecision('canvas_x'), // null = auto-layout
    canvasY: doublePrecision('canvas_y'),
    pinned: boolean('pinned').notNull().default(false),
    deskState: text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
    deskCategory: text('desk_category'),
    synthesisRunId: text('synthesis_run_id'), // FK -> synthesis_runs.id (nullable, no DB constraint)
  });
  ```

- [ ] **Step 4: Append the six desk columns to the `facts` table.**

  The `facts` table ends (lines 416-418) with `embedding`/`noveltyScore`/`sourceAgreement`. Replace:

  ```ts
    embedding: vector('embedding'),
    noveltyScore: doublePrecision('novelty_score'),
    sourceAgreement: integer('source_agreement'),
  });
  ```

  with:

  ```ts
    embedding: vector('embedding'),
    noveltyScore: doublePrecision('novelty_score'),
    sourceAgreement: integer('source_agreement'),
    // --- Research Desk (canvas) additive columns ---
    canvasX: doublePrecision('canvas_x'), // null = auto-layout
    canvasY: doublePrecision('canvas_y'),
    pinned: boolean('pinned').notNull().default(false),
    deskState: text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
    deskCategory: text('desk_category'), // distinct from sources.category; new to facts
    synthesisRunId: text('synthesis_run_id'), // FK -> synthesis_runs.id (nullable, no DB constraint)
  });
  ```

- [ ] **Step 5: Append the six desk columns to the `entities` table.**

  The `entities` table ends (lines 427-429) with `description`/`firstSeenAt`. Replace:

  ```ts
    description: text('description'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  });
  ```

  with:

  ```ts
    description: text('description'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // --- Research Desk (canvas) additive columns ---
    canvasX: doublePrecision('canvas_x'), // null = auto-layout
    canvasY: doublePrecision('canvas_y'),
    pinned: boolean('pinned').notNull().default(false),
    deskState: text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
    deskCategory: text('desk_category'),
    synthesisRunId: text('synthesis_run_id'), // FK -> synthesis_runs.id (nullable, no DB constraint)
  });
  ```

- [ ] **Step 6: Add the `synthesisRuns` table and its type export, right after the `QuickAnswer` type (line 1147).**

  The `quickAnswers` block ends at line 1147 with `export type QuickAnswer = typeof quickAnswers.$inferSelect;`. Insert the new table immediately after that line. Replace:

  ```ts
  export type QuickAnswer = typeof quickAnswers.$inferSelect;
  ```

  with:

  ```ts
  export type QuickAnswer = typeof quickAnswers.$inferSelect;

  // ==========================================
  // Research Desk — Synthesis Runs
  // On-demand, re-runnable streamed LLM passes over the artefact pile. Each run
  // owns its own clusters/summary; it never overwrites researchSessions.report.
  // ==========================================

  export const synthesisRuns = pgTable('synthesis_runs', {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    sessionId: text('session_id')
      .notNull()
      .references(() => researchSessions.id),
    scope: jsonb('scope').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('running'), // running|complete|failed|cancelled
    summary: text('summary'),
    clusters: jsonb('clusters').notNull().default(sql`'[]'::jsonb`),
    tokensUsed: integer('tokens_used'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  });

  export type SynthesisRun = typeof synthesisRuns.$inferSelect;
  export type NewSynthesisRun = typeof synthesisRuns.$inferInsert;
  ```

- [ ] **Step 7: Run the unit test and confirm it PASSES (green).**

  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/db/schema.desk.test.ts
  ```

  Expected: all tests pass — final line resembles:
  ```
  Test Files  1 passed (1)
       Tests  ... passed (...)
  ```
  (every `describe` block green; no failures, exit code 0).

- [ ] **Step 8: Push the additive schema to the local Postgres with drizzle-kit.**

  `drizzle.config.ts` reads `DATABASE_URL` from the environment, so load `.env` for the push. All changes are additive/nullable/defaulted, so push is non-interactive (no destructive prompts).

  ```bash
  cd /home/john/strange_rambling_svelte && set -a && . ./.env && set +a && npx drizzle-kit push
  ```

  Expected output ends with a clean apply, e.g.:
  ```
  [✓] Changes applied
  ```
  with the plan adding the `synthesis_runs` table and 6 columns each to `source`, `fact`, `entity` (18 `ALTER TABLE ... ADD COLUMN` + 1 `CREATE TABLE`). If drizzle-kit pauses asking to "truncate" or "rename" anything, STOP — that means a column name drifted from the existing schema; abort, re-read the table def, and fix the edit before re-running. (It must NOT ask to drop/rename — these are pure additions.)

- [ ] **Step 9: Verify the new columns physically exist in Postgres via psql introspection.**

  ```bash
  cd /home/john/strange_rambling_svelte && set -a && . ./.env && set +a && psql "$DATABASE_URL" -tA -c "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE (table_name='source' OR table_name='fact' OR table_name='entity') AND column_name IN ('canvas_x','canvas_y','pinned','desk_state','desk_category','synthesis_run_id') ORDER BY table_name, column_name;"
  ```

  Expected: 18 rows (6 columns × 3 tables). Each `canvas_x`/`canvas_y` is `double precision` / `YES` (nullable); each `pinned` is `boolean` / `NO` / `false`; each `desk_state` is `text` / `NO` / `'unfiled'::text`; `desk_category` and `synthesis_run_id` are `text` / `YES`. Example lines:
  ```
  entity|canvas_x|double precision|YES|
  entity|desk_state|text|NO|'unfiled'::text
  entity|pinned|boolean|NO|false
  fact|canvas_x|double precision|YES|
  source|synthesis_run_id|text|YES|
  ```

- [ ] **Step 10: Verify the `synthesis_runs` table exists with the right shape.**

  ```bash
  cd /home/john/strange_rambling_svelte && set -a && . ./.env && set +a && psql "$DATABASE_URL" -tA -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='synthesis_runs' ORDER BY ordinal_position;"
  ```

  Expected: 10 rows in order — `id` (text, NO, default `gen_random_uuid()::text`), `session_id` (text, NO), `scope` (jsonb, NO, default `'{}'::jsonb`), `status` (text, NO, default `'running'::text`), `summary` (text, YES), `clusters` (jsonb, NO, default `'[]'::jsonb`), `tokens_used` (integer, YES), `error_message` (text, YES), `created_at` (timestamp with time zone, NO, default `now()`), `completed_at` (timestamp with time zone, YES). Example:
  ```
  id|text|NO|gen_random_uuid()::text
  session_id|text|NO|
  scope|jsonb|NO|'{}'::jsonb
  status|text|NO|'running'::text
  clusters|jsonb|NO|'[]'::jsonb
  created_at|timestamp with time zone|NO|now()
  ```

- [ ] **Step 11: Smoke-test an insert/select round-trip against `synthesis_runs` (proves the defaults + FK behave) and clean up.**

  This requires an existing `research_session` row to satisfy the `session_id` FK. Pick any existing session id; if none exists, the query selects `NULL` and the insert is skipped (the column/table existence is already proven by Steps 9-10, so this step is best-effort confirmation of defaults).

  ```bash
  cd /home/john/strange_rambling_svelte && set -a && . ./.env && set +a && psql "$DATABASE_URL" -tA -c "DO \$\$ DECLARE sid text; rid text; BEGIN SELECT id INTO sid FROM research_session LIMIT 1; IF sid IS NULL THEN RAISE NOTICE 'no research_session rows; skipping insert smoke-test (columns already verified)'; RETURN; END IF; INSERT INTO synthesis_runs (session_id) VALUES (sid) RETURNING id INTO rid; RAISE NOTICE 'inserted synthesis_run % with status/scope/clusters defaults', rid; DELETE FROM synthesis_runs WHERE id = rid; RAISE NOTICE 'cleaned up %', rid; END \$\$;"
  ```

  Expected: either `NOTICE: inserted synthesis_run <uuid> with status/scope/clusters defaults` followed by `NOTICE: cleaned up <uuid>` (defaults applied, FK satisfied, row removed — DB left untouched), or `NOTICE: no research_session rows; skipping insert smoke-test`. No error.

- [ ] **Step 12: Confirm the full test file still passes and the schema type-checks (sanity before commit).**

  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/db/schema.desk.test.ts && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "schema\.ts|schema\.desk\.test\.ts" || echo "NO SCHEMA TYPE ERRORS"
  ```

  Expected: Vitest reports `Test Files  1 passed (1)`, and the type-check grep prints `NO SCHEMA TYPE ERRORS` (i.e. neither `schema.ts` nor the new test file appears in `tsc` output). Pre-existing unrelated type errors elsewhere in the repo are out of scope for this milestone — the grep deliberately filters to only the two files this task touches.

- [ ] **Step 13: Commit.**

  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/db/schema.ts src/lib/db/schema.desk.test.ts && git commit -m "$(cat <<'EOF'
Research Desk: add canvas columns + synthesis_runs table

Append additive nullable desk columns (canvas_x/y, pinned, desk_state,
desk_category, synthesis_run_id) to sources/facts/entities and create the
synthesis_runs table for on-demand streamed synthesis runs. All changes are
additive/nullable/defaulted (safe drizzle-kit push). Adds a Vitest schema
introspection test asserting column names/defaults.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

  Expected: a single commit containing exactly the two files; `git status` clean afterward for those paths.

---

Relevant file paths for this milestone:
- `/home/john/strange_rambling_svelte/src/lib/db/schema.ts` (edits at lines 388-400, 404-418, 422-429, and insertion after line 1147)
- `/home/john/strange_rambling_svelte/src/lib/db/schema.desk.test.ts` (new)
- `/home/john/strange_rambling_svelte/drizzle.config.ts` (reads `DATABASE_URL`; not modified)
- `/home/john/strange_rambling_svelte/.env` (source of `DATABASE_URL=postgresql://app:<pw>@localhost:5433/strange_rambling`; not modified)


I have everything I need. The stream endpoint passes events generically through `emit('event', ...)`, so adding new SSEEvent types requires zero transport changes. The `emit()` in worker.ts already handles any SSEEvent. Now I'll write the milestone.

One important detail: `emit()` in worker.ts only fires if the emitter already exists in `activeEmitters` (line 29 uses `.get`, not `getEmitter`). During an active research run the emitter exists. `emitArtefact` uses `emit()` which is fine during a run. The `ensureEmitter` is needed for synthesis on completed sessions (Milestone covered elsewhere), but the brief asks me to add it here too.

Now drafting the milestone.

---

## Milestone 2: Artefact event stream

This milestone makes the deep-research engine broadcast its DB inserts as live SSE artefact events. It (1) creates `src/lib/deepdive/desk-events.ts` — a coalescing per-session emit layer with a monotonic `seq` counter — with unit tests; (2) extends the `SSEEvent` union so `'artefact'`/`'synthesis'` events ride the existing generic `emit()` transport with zero changes to the stream endpoint; (3) adds `ensureEmitter()` to `worker.ts` for synthesis-after-completion; and (4) wires `emitArtefact()` calls at the real insert sites in `phase1.ts`, `phase2.ts`, and `phase3.ts`, emitting **after** each `.returning()` so the row `id` is stable.

The transport requires no changes: `src/routes/api/deepdive/[id]/stream/+server.ts` already `JSON.stringify`s whatever `SSEEvent` is emitted on the `'event'` channel, and `emit()` in `worker.ts` already forwards any `SSEEvent`.

### Task 1: Extend the SSEEvent union for artefact + synthesis events

**Files:**
- Modify `src/lib/deepdive/types.ts` (lines 26-30, the `SSEEvent` interface)

- [ ] **Step 1: Widen the `SSEEvent.type` union.** The current interface (`types.ts:26-30`) only allows `'log' | 'stats' | 'status' | 'error'`. Add `'artefact'` and `'synthesis'`. The generic `data?: Record<string, unknown>` field already carries any payload shape, so no other field changes are needed — the stream endpoint and `emit()` stay untouched.

  Before:
  ```ts
  export interface SSEEvent {
    type: 'log' | 'stats' | 'status' | 'error';
    message?: string;
    data?: Record<string, unknown>;
  }
  ```

  After:
  ```ts
  export interface SSEEvent {
    type: 'log' | 'stats' | 'status' | 'error' | 'artefact' | 'synthesis';
    message?: string;
    data?: Record<string, unknown>;
  }
  ```

- [ ] **Step 2: Type-check the change.** Run (the deepdive package type-checks under the project tsconfig; the `NODE_OPTIONS` bump avoids an OOM):
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'types\.ts|worker\.ts' || echo "no type errors in touched files"
  ```
  Expected output:
  ```
  no type errors in touched files
  ```
  (Pre-existing errors elsewhere in the repo may print; the `grep` confirms our two files are clean.)

- [ ] **Step 3: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/types.ts && git commit -m "$(cat <<'EOF'
deepdive: extend SSEEvent union with artefact + synthesis types

Adds 'artefact' and 'synthesis' to the SSEEvent type union so the new
desk events ride the existing generic emit() transport. No transport or
stream-endpoint changes required — data is already Record<string,unknown>.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

### Task 2: `desk-events.ts` — seq counter + coalescing emit queue (TDD)

This is pure testable logic, so tests come first. `nextSeq` is a monotonic per-session counter held in a module `Map`. `emitArtefact` stamps a `seq`, pushes the artefact onto a per-session queue, and schedules a ~100ms flush; `flushArtefacts` drains the queue immediately, emitting **one `'artefact'` SSEEvent per queued artefact** in `seq` order (each carries its own `seq` for client ordering/dedup). We emit one event per artefact (not a batched array) so the client merge-by-`id` idiom in the contract stays trivial; the coalescing is about *timing* (one timer flush instead of a synchronous emit storm), not payload shape.

**Files:**
- Create `src/lib/deepdive/desk-events.test.ts`
- Create `src/lib/deepdive/desk-events.ts`

- [ ] **Step 1: Write the failing test.** The test injects a fake emit sink via the module's `__setEmitForTest` hook (so we don't depend on the real `worker.emit` / `EventEmitter` and can run flushing synchronously with fake timers). It asserts: seq is monotonic and per-session-isolated; `emitArtefact` does NOT emit synchronously (it queues); a single timer flush drains everything in seq order; explicit `flushArtefacts` drains immediately; and the emitted event shape matches the contract.

  Create `src/lib/deepdive/desk-events.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
  import {
    nextSeq,
    emitArtefact,
    flushArtefacts,
    __setEmitForTest,
    __resetForTest,
  } from './desk-events';
  import type { SSEEvent } from './types';

  type Captured = { sessionId: string; event: SSEEvent };

  describe('desk-events', () => {
    let captured: Captured[];

    beforeEach(() => {
      captured = [];
      __resetForTest();
      __setEmitForTest((sessionId, event) => captured.push({ sessionId, event }));
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      __setEmitForTest(null);
    });

    describe('nextSeq', () => {
      it('is monotonic starting at 1 for a session', () => {
        expect(nextSeq('s1')).toBe(1);
        expect(nextSeq('s1')).toBe(2);
        expect(nextSeq('s1')).toBe(3);
      });

      it('is isolated per session', () => {
        expect(nextSeq('a')).toBe(1);
        expect(nextSeq('b')).toBe(1);
        expect(nextSeq('a')).toBe(2);
        expect(nextSeq('b')).toBe(2);
        expect(nextSeq('a')).toBe(3);
      });
    });

    describe('emitArtefact coalescing', () => {
      it('does not emit synchronously — it queues', () => {
        emitArtefact('s1', 'source', 1, { id: 'src-1', url: 'http://a' });
        expect(captured.length).toBe(0);
      });

      it('flushes the whole queue on the ~100ms timer, one event per artefact in seq order', () => {
        emitArtefact('s1', 'source', 1, { id: 'src-1', url: 'http://a' });
        emitArtefact('s1', 'fact', 2, { id: 'fact-1', content: 'x' });
        emitArtefact('s1', 'entity', 2, { id: 'ent-1', name: 'Acme' });
        expect(captured.length).toBe(0);

        vi.advanceTimersByTime(100);

        expect(captured.length).toBe(3);
        expect(captured.every((c) => c.sessionId === 's1')).toBe(true);
        expect(captured.every((c) => c.event.type === 'artefact')).toBe(true);

        const seqs = captured.map((c) => c.event.data!.seq as number);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); // ordering preserved
        expect(new Set(seqs).size).toBe(3); // all distinct

        expect(captured[0].event.data).toMatchObject({
          artefactType: 'source',
          id: 'src-1',
          phase: 1,
          url: 'http://a',
        });
        expect(typeof captured[0].event.data!.seq).toBe('number');
      });

      it('coalesces many emits into a single timer flush (no synchronous storm)', () => {
        for (let i = 0; i < 50; i++) {
          emitArtefact('s1', 'fact', 2, { id: `fact-${i}`, content: `c${i}` });
        }
        expect(captured.length).toBe(0); // nothing yet — all queued under one timer
        vi.advanceTimersByTime(100);
        expect(captured.length).toBe(50);
        const ids = captured.map((c) => c.event.data!.id);
        expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => `fact-${i}`)); // order preserved
      });

      it('keeps per-session queues separate', () => {
        emitArtefact('s1', 'fact', 2, { id: 'a' });
        emitArtefact('s2', 'fact', 2, { id: 'b' });
        vi.advanceTimersByTime(100);
        const s1 = captured.filter((c) => c.sessionId === 's1');
        const s2 = captured.filter((c) => c.sessionId === 's2');
        expect(s1.map((c) => c.event.data!.id)).toEqual(['a']);
        expect(s2.map((c) => c.event.data!.id)).toEqual(['b']);
      });
    });

    describe('flushArtefacts', () => {
      it('drains the queue immediately without waiting for the timer', () => {
        emitArtefact('s1', 'source', 1, { id: 'src-1' });
        emitArtefact('s1', 'fact', 2, { id: 'fact-1' });
        flushArtefacts('s1');
        expect(captured.length).toBe(2);
        // timer flush after an explicit flush must not double-emit
        vi.advanceTimersByTime(100);
        expect(captured.length).toBe(2);
      });

      it('is a no-op when the queue is empty', () => {
        flushArtefacts('s1');
        expect(captured.length).toBe(0);
      });
    });
  });
  ```

- [ ] **Step 2: Run the test and watch it fail (module does not exist yet).**
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/desk-events.test.ts
  ```
  Expected: failure with a resolution error such as `Failed to load url ./desk-events` / `Cannot find module './desk-events'`.

- [ ] **Step 3: Implement `desk-events.ts` to make the test pass.** The default emit sink is the real `emit()` from `worker.ts`; the test hook swaps it for a capture function. `FLUSH_INTERVAL_MS = 100` matches the spec's ~100ms coalescing window.

  Create `src/lib/deepdive/desk-events.ts`:
  ```ts
  import { emit } from './worker';
  import type { SSEEvent } from './types';

  /**
   * Desk artefact event layer.
   *
   * - `nextSeq` gives a monotonic, per-session sequence number used by the client
   *   to order/dedup artefact cards (DB row `id` is the dedup key; `seq` orders).
   * - `emitArtefact` stamps a seq, queues the artefact, and schedules a coalesced
   *   flush on a ~100ms timer so a deep run's hundreds of inserts don't overwhelm
   *   the SSE stream or the client's ~5ms debounced flush.
   * - `flushArtefacts` drains a session's queue immediately.
   *
   * Each queued artefact is emitted as ONE `{ type:'artefact', data:{...} }` SSEEvent
   * (not a batched array), so the client merge-by-id stays trivial. Coalescing here
   * is about *timing*, not payload shape.
   */

  const FLUSH_INTERVAL_MS = 100;

  type ArtefactType = 'source' | 'fact' | 'entity' | 'relationship';
  type Phase = 1 | 2 | 3 | 'post';

  interface QueuedArtefact {
    seq: number;
    artefactType: ArtefactType;
    phase: Phase;
    fields: Record<string, unknown> & { id: string };
  }

  // Monotonic per-session sequence counter.
  const seqCounters = new Map<string, number>();
  // Per-session pending artefact queue.
  const queues = new Map<string, QueuedArtefact[]>();
  // Per-session active flush timer (null/absent = no flush scheduled).
  const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Emit sink — defaults to the real worker emit(), swappable in tests.
  type EmitFn = (sessionId: string, event: SSEEvent) => void;
  let emitFn: EmitFn = emit;

  /** Monotonic per-session counter; first call for a session returns 1. */
  export function nextSeq(sessionId: string): number {
    const next = (seqCounters.get(sessionId) ?? 0) + 1;
    seqCounters.set(sessionId, next);
    return next;
  }

  /**
   * Queue an artefact for coalesced emission. Stamps a fresh `seq`, merges the
   * type-specific `fields` (must include a stable `id` from the `.returning()` row),
   * and schedules a flush ~100ms later if one isn't already pending.
   */
  export function emitArtefact(
    sessionId: string,
    artefactType: ArtefactType,
    phase: Phase,
    fields: Record<string, unknown> & { id: string },
  ): void {
    const seq = nextSeq(sessionId);
    let queue = queues.get(sessionId);
    if (!queue) {
      queue = [];
      queues.set(sessionId, queue);
    }
    queue.push({ seq, artefactType, phase, fields });

    if (!flushTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        flushTimers.delete(sessionId);
        flushArtefacts(sessionId);
      }, FLUSH_INTERVAL_MS);
      flushTimers.set(sessionId, timer);
    }
  }

  /** Drain a session's queued artefacts immediately, in seq order, one event each. */
  export function flushArtefacts(sessionId: string): void {
    const timer = flushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      flushTimers.delete(sessionId);
    }

    const queue = queues.get(sessionId);
    if (!queue || queue.length === 0) return;
    queues.set(sessionId, []);

    for (const item of queue) {
      emitFn(sessionId, {
        type: 'artefact',
        data: {
          seq: item.seq,
          artefactType: item.artefactType,
          phase: item.phase,
          ...item.fields,
        },
      });
    }
  }

  // ---- test hooks ----
  /** Override the emit sink in tests; pass null to restore the real worker emit(). */
  export function __setEmitForTest(fn: EmitFn | null): void {
    emitFn = fn ?? emit;
  }

  /** Reset all module state (counters, queues, timers) — test isolation. */
  export function __resetForTest(): void {
    for (const t of flushTimers.values()) clearTimeout(t);
    seqCounters.clear();
    queues.clear();
    flushTimers.clear();
  }
  ```

- [ ] **Step 4: Run the test and watch it pass.**
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/desk-events.test.ts
  ```
  Expected output (counts): all tests pass, e.g.
  ```
   ✓ src/lib/deepdive/desk-events.test.ts (10 tests) ...
   Test Files  1 passed (1)
        Tests  10 passed (10)
  ```

- [ ] **Step 5: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/desk-events.ts src/lib/deepdive/desk-events.test.ts && git commit -m "$(cat <<'EOF'
deepdive: add desk-events coalescing emit layer

New src/lib/deepdive/desk-events.ts: nextSeq (monotonic per-session
counter), emitArtefact (stamps seq, queues, ~100ms coalesced flush),
flushArtefacts (immediate drain). Emits one 'artefact' SSEEvent per
queued artefact in seq order so the client merge-by-id stays trivial.
Unit-tested: seq monotonicity/isolation, coalescing batches into one
timer flush, ordering preserved, immediate flush, per-session queues.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

### Task 3: Add `ensureEmitter` to `worker.ts`

`getEmitter` already creates-if-absent, but the synthesize endpoint (future milestone) needs an explicit, named guard because the 30s post-completion cleanup (`worker.ts:211-216`) deletes the emitter — synthesis triggered on a *completed* session must re-create it so its `synthesis.*` events still stream. `ensureEmitter` is the contract's named entry point for that. It wraps `getEmitter` (which is the create-if-absent path) so existing listeners on a live session are preserved and a torn-down session gets a fresh emitter.

**Files:**
- Modify `src/lib/deepdive/worker.ts` (insert after `getEmitter`, lines 18-26)

- [ ] **Step 1: Add `ensureEmitter` immediately after `getEmitter`.** Place it right after the closing brace of `getEmitter` (currently line 26) and before `emit` (line 28).

  Insert this block between `getEmitter` and `emit`:
  ```ts
  /**
   * Guaranteed emitter accessor for callers that may run AFTER a session's
   * 30s post-completion cleanup has torn the emitter down (e.g. on-demand
   * synthesis on a completed session). Re-creates the emitter if absent so
   * the SSE stream keeps flowing; returns the existing one for live sessions.
   */
  export function ensureEmitter(sessionId: string): EventEmitter {
    return getEmitter(sessionId);
  }
  ```

  After the edit, the top of `worker.ts` reads (excerpt):
  ```ts
  export function getEmitter(sessionId: string): EventEmitter {
    let emitter = activeEmitters.get(sessionId);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(20);
      activeEmitters.set(sessionId, emitter);
    }
    return emitter;
  }

  /**
   * Guaranteed emitter accessor for callers that may run AFTER a session's
   * 30s post-completion cleanup has torn the emitter down (e.g. on-demand
   * synthesis on a completed session). Re-creates the emitter if absent so
   * the SSE stream keeps flowing; returns the existing one for live sessions.
   */
  export function ensureEmitter(sessionId: string): EventEmitter {
    return getEmitter(sessionId);
  }

  export function emit(sessionId: string, event: SSEEvent): void {
    const emitter = activeEmitters.get(sessionId);
    if (emitter) {
      emitter.emit('event', event);
    }
  }
  ```

- [ ] **Step 2: Type-check worker.ts.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'worker\.ts|desk-events\.ts' || echo "no type errors in touched files"
  ```
  Expected output:
  ```
  no type errors in touched files
  ```

- [ ] **Step 3: Confirm the existing desk-events test still passes (it imports `emit` from worker).**
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/desk-events.test.ts
  ```
  Expected: `Tests  10 passed (10)`.

- [ ] **Step 4: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/worker.ts && git commit -m "$(cat <<'EOF'
deepdive: add ensureEmitter to worker

Named guarded emitter accessor for callers that may run after the 30s
post-completion cleanup tears the emitter down (on-demand synthesis on a
completed session). Wraps getEmitter's create-if-absent path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

### Task 4: Emit `source.created` at the phase1 insert site

Phase 1 inserts a source via `.returning()` into `stored` (`phase1.ts:107-119`), then asynchronously resolves `category` via a follow-up LLM call and updates the row (`phase1.ts:140-143`). The contract source fields include `category`, but it isn't known at insert time. We emit the artefact **right after the `.returning()`** (so `id` is stable and the card appears immediately in GATHER) with the credibility data we have; `category` is included as `stored.category ?? null` (null at first paint — the client tolerates a null category, and a later synthesis/organise pass fills it).

**Files:**
- Modify `src/lib/deepdive/phase1.ts` (import line 7; insert site lines 107-119)

- [ ] **Step 1: Import `emitArtefact`.** Extend the existing `worker` import on line 7.

  Before:
  ```ts
  import { emitLog, emitStats, shouldStop, getAbortSignal, throwIfStopped } from './worker';
  ```

  After:
  ```ts
  import { emitLog, emitStats, shouldStop, getAbortSignal, throwIfStopped } from './worker';
  import { emitArtefact } from './desk-events';
  ```

- [ ] **Step 2: Emit after the source `.returning()`.** The current block (lines 107-125) inserts then bumps counters and logs. Add the `emitArtefact` call directly after `stored` is obtained, before the `emitLog`.

  Before:
  ```ts
          // Store source
          const [stored] = await db
            .insert(sources)
            .values({
              sessionId,
              url: result.url,
              title: result.title,
              snippet: result.content?.slice(0, 500),
              domain,
              phase: 1,
              credibilityScore: credibility.score,
              credibilityType: credibility.type,
            })
            .returning();

          totalSourcesStored++;
          batchSourceCount++;
          stats.sourcesFound = totalSourcesStored;

          emitLog(sessionId, '\u{1F4C4}', `Source: ${result.title?.slice(0, 60) ?? result.url}`);
  ```

  After:
  ```ts
          // Store source
          const [stored] = await db
            .insert(sources)
            .values({
              sessionId,
              url: result.url,
              title: result.title,
              snippet: result.content?.slice(0, 500),
              domain,
              phase: 1,
              credibilityScore: credibility.score,
              credibilityType: credibility.type,
            })
            .returning();

          // Desk: drop the source card onto the canvas (id is now stable).
          // category resolves later via the follow-up LLM update; null at first paint.
          emitArtefact(sessionId, 'source', 1, {
            id: stored.id,
            url: stored.url,
            title: stored.title,
            domain: stored.domain,
            category: stored.category ?? null,
            credibilityScore: stored.credibilityScore,
            credibilityType: stored.credibilityType,
          });

          totalSourcesStored++;
          batchSourceCount++;
          stats.sourcesFound = totalSourcesStored;

          emitLog(sessionId, '\u{1F4C4}', `Source: ${result.title?.slice(0, 60) ?? result.url}`);
  ```

- [ ] **Step 3: Type-check phase1.ts.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'phase1\.ts|desk-events\.ts' || echo "no type errors in touched files"
  ```
  Expected output:
  ```
  no type errors in touched files
  ```

- [ ] **Step 4: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/phase1.ts && git commit -m "$(cat <<'EOF'
deepdive: emit source.created artefact in phase1

Emits a coalesced 'artefact' source event right after the .returning()
insert (stable id) so the desk drops the source card live in GATHER mode.
category resolves later via the follow-up analysis update (null at first
paint).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

### Task 5: Emit `fact.created` + `entity.created` + `relationship.created` in phase2

Three insert sites in `phase2.ts`. The fact insert (`storeFacts`, lines 213-221) and the relationship insert (lines 345-353) currently do **not** use `.returning()`, so we must add it to get a stable `id`. The entity insert (lines 251-259) already returns into `created`. All three emit after their respective `.returning()`.

**Files:**
- Modify `src/lib/deepdive/phase2.ts` (import line 9; fact insert 213-223; entity insert 251-261; relationship insert 345-353)

- [ ] **Step 1: Import `emitArtefact`.** Extend the existing `worker` import on line 9.

  Before:
  ```ts
  import { emitLog, emitStats, shouldStop, throwIfStopped } from './worker';
  ```

  After:
  ```ts
  import { emitLog, emitStats, shouldStop, throwIfStopped } from './worker';
  import { emitArtefact } from './desk-events';
  ```

- [ ] **Step 2: Add `.returning()` to the fact insert and emit `fact.created`.** In `storeFacts` (lines 206-225). The phase-2 facts are non-counterfactual (no `refutesFactId`).

  Before:
  ```ts
      for (const f of extractedFacts) {
        if (!f.content || f.content.length < 10) continue;
        const { duplicate, embedding } = await isDuplicate(sessionId, f.content);
        if (duplicate) continue;
        const extractedConf = Math.max(0, Math.min(1, f.confidence ?? 0.5));
        const srcCredibility = src.credibilityScore ?? 0.5;
        const blendedConfidence = extractedConf * 0.7 + srcCredibility * 0.3;
        await db.insert(facts).values({
          sessionId,
          sourceId: src.id,
          content: f.content,
          eventDate: f.event_date ? new Date(f.event_date) : null,
          confidence: Math.max(0, Math.min(1, blendedConfidence)),
          tags: f.tags ?? [],
          embedding,
        });
        count++;
        stats.factsExtracted++;
      }
  ```

  After:
  ```ts
      for (const f of extractedFacts) {
        if (!f.content || f.content.length < 10) continue;
        const { duplicate, embedding } = await isDuplicate(sessionId, f.content);
        if (duplicate) continue;
        const extractedConf = Math.max(0, Math.min(1, f.confidence ?? 0.5));
        const srcCredibility = src.credibilityScore ?? 0.5;
        const blendedConfidence = extractedConf * 0.7 + srcCredibility * 0.3;
        const [storedFact] = await db
          .insert(facts)
          .values({
            sessionId,
            sourceId: src.id,
            content: f.content,
            eventDate: f.event_date ? new Date(f.event_date) : null,
            confidence: Math.max(0, Math.min(1, blendedConfidence)),
            tags: f.tags ?? [],
            embedding,
          })
          .returning();

        // Desk: drop the fact card (stable id from .returning()).
        emitArtefact(sessionId, 'fact', 2, {
          id: storedFact.id,
          sourceId: storedFact.sourceId,
          content: storedFact.content,
          confidence: storedFact.confidence,
          isCounterfactual: storedFact.isCounterfactual,
          refutesFactId: storedFact.refutesFactId,
          tags: storedFact.tags,
          eventDate: storedFact.eventDate ? storedFact.eventDate.toISOString() : null,
        });

        count++;
        stats.factsExtracted++;
      }
  ```

- [ ] **Step 3: Emit `entity.created` after the existing entity `.returning()`.** In `storeEntities` (lines 248-262); the insert already returns into `created`. Emit only for newly-created entities (existing entities already have a card on the desk).

  Before:
  ```ts
        let entityId: string;
        if (existing.length > 0) {
          entityId = existing[0].id;
        } else {
          const [created] = await db
            .insert(entities)
            .values({
              sessionId,
              name: e.name,
              type: e.type || 'other',
              description: e.description,
            })
            .returning();
          entityId = created.id;
          stats.entitiesIdentified++;
        }
  ```

  After:
  ```ts
        let entityId: string;
        if (existing.length > 0) {
          entityId = existing[0].id;
        } else {
          const [created] = await db
            .insert(entities)
            .values({
              sessionId,
              name: e.name,
              type: e.type || 'other',
              description: e.description,
            })
            .returning();
          entityId = created.id;
          stats.entitiesIdentified++;

          // Desk: drop the entity chip (only for newly-created entities).
          emitArtefact(sessionId, 'entity', 2, {
            id: created.id,
            name: created.name,
            type: created.type,
            description: created.description,
          });
        }
  ```

- [ ] **Step 4: Add `.returning()` to the relationship insert and emit `relationship.created`.** In the deep-only relationship pass (lines 345-353). Relationships are **edges only** (no position columns) — the event carries the endpoint ids so the client can draw the connector.

  Before:
  ```ts
          await db.insert(relationships).values({
            sessionId,
            fromEntityId: fromEntity.id,
            toEntityId: toEntity.id,
            relationshipType: rel.relationship_type,
            sentiment: rel.sentiment || 'neutral',
            strength: Math.max(0, Math.min(1, rel.strength ?? 0.5)),
            sourceId: source.id,
          });
  ```

  After:
  ```ts
          const [storedRel] = await db
            .insert(relationships)
            .values({
              sessionId,
              fromEntityId: fromEntity.id,
              toEntityId: toEntity.id,
              relationshipType: rel.relationship_type,
              sentiment: rel.sentiment || 'neutral',
              strength: Math.max(0, Math.min(1, rel.strength ?? 0.5)),
              sourceId: source.id,
            })
            .returning();

          // Desk: relationships render as edges only (orthPath), never cards.
          emitArtefact(sessionId, 'relationship', 2, {
            id: storedRel.id,
            fromEntityId: storedRel.fromEntityId,
            toEntityId: storedRel.toEntityId,
            relationshipType: storedRel.relationshipType,
            sentiment: storedRel.sentiment,
            strength: storedRel.strength,
            sourceId: storedRel.sourceId,
          });
  ```

  > Note: the LinkedIn pass (lines 436-444) also inserts relationships, but the milestone brief scopes phase2 emits to the four numbered insert sites (213/251/345). Leave the LinkedIn insert (lines 436-444) untouched in this milestone.

- [ ] **Step 5: Type-check phase2.ts.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'phase2\.ts|desk-events\.ts' || echo "no type errors in touched files"
  ```
  Expected output:
  ```
  no type errors in touched files
  ```

- [ ] **Step 6: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/phase2.ts && git commit -m "$(cat <<'EOF'
deepdive: emit fact/entity/relationship artefacts in phase2

Wires emitArtefact at the three phase2 insert sites. Adds .returning()
to the fact and relationship inserts (entity already returned) so each
event carries a stable id, emitted after the insert resolves.
Relationships emit as edge-only events (no card). Entity events only
fire for newly-created entities.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

### Task 6: Emit `source.created` (phase 3) + counterfactual `fact.created` in phase3

The red-team pass inserts a phase-3 source via `.returning()` into `newSource` (`phase3.ts:142-152`), then inserts a counterfactual fact **without** `.returning()` (`phase3.ts:155-163`). Add `.returning()` to the fact insert. Both emit after their respective insert. The counterfactual carries `isCounterfactual:true` and `refutesFactId` so the client renders the red "challenge" tab and auto-links the edge to the refuted fact.

**Files:**
- Modify `src/lib/deepdive/phase3.ts` (import line 7; phase-3 source insert 142-152; counterfactual fact insert 155-163)

- [ ] **Step 1: Import `emitArtefact`.** Extend the existing `worker` import on line 7.

  Before:
  ```ts
  import { emitLog, emitStats, shouldStop, throwIfStopped } from './worker';
  ```

  After:
  ```ts
  import { emitLog, emitStats, shouldStop, throwIfStopped } from './worker';
  import { emitArtefact } from './desk-events';
  ```

- [ ] **Step 2: Emit `source.created` (phase 3) and add `.returning()` + emit the counterfactual `fact.created`.** This block (lines 141-163) inserts the source then the counterfactual fact. Phase-3 sources are inserted without credibility fields, so emit `credibilityScore`/`credibilityType` as `null`; `category` is also null here.

  Before:
  ```ts
            if (evaluation.verdict === 'contradicts' || evaluation.verdict === 'qualifies') {
              // Store source
              const [newSource] = await db
                .insert(sources)
                .values({
                  sessionId,
                  url: result.url,
                  title: result.title,
                  snippet: result.content?.slice(0, 500),
                  domain: new URL(result.url).hostname,
                  phase: 3,
                })
                .returning();

              // Store counterfactual
              await db.insert(facts).values({
                sessionId,
                sourceId: newSource.id,
                content: evaluation.counter_claim || `Counter to: ${fact.content.slice(0, 100)}`,
                confidence: evaluation.verdict === 'contradicts' ? 0.6 : 0.4,
                isCounterfactual: true,
                refutesFactId: fact.id,
                tags: ['counterfactual'],
              });

              contradictions++;
              stats.counterfactualsRaised++;
  ```

  After:
  ```ts
            if (evaluation.verdict === 'contradicts' || evaluation.verdict === 'qualifies') {
              // Store source
              const [newSource] = await db
                .insert(sources)
                .values({
                  sessionId,
                  url: result.url,
                  title: result.title,
                  snippet: result.content?.slice(0, 500),
                  domain: new URL(result.url).hostname,
                  phase: 3,
                })
                .returning();

              // Desk: drop the red-team source card (stable id).
              emitArtefact(sessionId, 'source', 3, {
                id: newSource.id,
                url: newSource.url,
                title: newSource.title,
                domain: newSource.domain,
                category: newSource.category ?? null,
                credibilityScore: newSource.credibilityScore,
                credibilityType: newSource.credibilityType,
              });

              // Store counterfactual
              const [storedCounter] = await db
                .insert(facts)
                .values({
                  sessionId,
                  sourceId: newSource.id,
                  content: evaluation.counter_claim || `Counter to: ${fact.content.slice(0, 100)}`,
                  confidence: evaluation.verdict === 'contradicts' ? 0.6 : 0.4,
                  isCounterfactual: true,
                  refutesFactId: fact.id,
                  tags: ['counterfactual'],
                })
                .returning();

              // Desk: challenge card — auto-links an edge to the refuted fact.
              emitArtefact(sessionId, 'fact', 3, {
                id: storedCounter.id,
                sourceId: storedCounter.sourceId,
                content: storedCounter.content,
                confidence: storedCounter.confidence,
                isCounterfactual: storedCounter.isCounterfactual,
                refutesFactId: storedCounter.refutesFactId,
                tags: storedCounter.tags,
                eventDate: storedCounter.eventDate ? storedCounter.eventDate.toISOString() : null,
              });

              contradictions++;
              stats.counterfactualsRaised++;
  ```

- [ ] **Step 3: Type-check phase3.ts.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'phase3\.ts|desk-events\.ts' || echo "no type errors in touched files"
  ```
  Expected output:
  ```
  no type errors in touched files
  ```

- [ ] **Step 4: Commit.**
  ```bash
  cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/phase3.ts && git commit -m "$(cat <<'EOF'
deepdive: emit phase3 source + counterfactual artefacts

Emits a source.created (phase 3) artefact after the red-team source
insert, and adds .returning() to the counterfactual fact insert to emit
a fact.created with isCounterfactual:true + refutesFactId so the desk
renders the challenge card auto-linked to the refuted fact.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
  ```

### Task 7: Full-suite green + milestone verification

A final guard that the new module, the union change, and all three phase wirings compile together and the unit suite is green.

**Files:** none (verification only)

- [ ] **Step 1: Run the desk-events unit suite once more.**
  ```bash
  cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/desk-events.test.ts
  ```
  Expected: `Tests  10 passed (10)`.

- [ ] **Step 2: Type-check all milestone-touched files together.**
  ```bash
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'deepdive/(types|worker|desk-events|phase1|phase2|phase3)\.ts' || echo "all milestone files type-clean"
  ```
  Expected output:
  ```
  all milestone files type-clean
  ```

- [ ] **Step 3: Confirm every emit site is wired (grep sanity check).**
  ```bash
  cd /home/john/strange_rambling_svelte && grep -c "emitArtefact" src/lib/deepdive/phase1.ts src/lib/deepdive/phase2.ts src/lib/deepdive/phase3.ts
  ```
  Expected output (1 in phase1, 3 in phase2, 2 in phase3 — import lines are `import { emitArtefact }`, so counts include the import: 2 / 4 / 3):
  ```
  src/lib/deepdive/phase1.ts:2
  src/lib/deepdive/phase2.ts:4
  src/lib/deepdive/phase3.ts:3
  ```

- [ ] **Step 4: No separate commit needed** (verification only). If Steps 1-3 all pass, this milestone is complete: artefact events now flow through the existing SSE spine at every insert site, coalesced and seq-ordered, ready for the desk store (later milestone) to hydrate-then-stream and render cards.

---

**Notes on key files (absolute paths):**
- New: `/home/john/strange_rambling_svelte/src/lib/deepdive/desk-events.ts` + `/home/john/strange_rambling_svelte/src/lib/deepdive/desk-events.test.ts`
- Modified: `/home/john/strange_rambling_svelte/src/lib/deepdive/types.ts`, `/home/john/strange_rambling_svelte/src/lib/deepdive/worker.ts`, `/home/john/strange_rambling_svelte/src/lib/deepdive/phase1.ts`, `/home/john/strange_rambling_svelte/src/lib/deepdive/phase2.ts`, `/home/john/strange_rambling_svelte/src/lib/deepdive/phase3.ts`

**Verified-against-real-code drifts the executing engineer must know:**
- `phase2.ts` fact insert (storeFacts) and relationship insert had **no `.returning()`** — this milestone adds it (the contract requires emit after `.returning()`).
- `phase3.ts` counterfactual fact insert had **no `.returning()`** — added.
- `phase1.ts` `category` is set by a *later* update (line ~140), so it is `null` at emit time — emitted as `stored.category ?? null` by design.
- `emit()` in `worker.ts` only fires when the emitter already exists in `activeEmitters`; during a live run it always does (created in `runResearch`), so artefact emits stream correctly without `ensureEmitter`. `ensureEmitter` is added here purely for the future synthesis-on-completed-session path.


I have a clear picture of the test idiom (pure in-memory module testing, no DB mocking). Now I'll write the milestone. Here it is.

---

## Milestone 3: On-demand synthesis (endpoint + worker)

> **Prerequisites assumed from Milestones 1–2** (do not re-do, but this milestone's code depends on them being present; the first task below *verifies* they exist and adds the small pieces this milestone strictly needs to compile if they are missing):
> - `src/lib/db/schema.ts` has the additive columns on `sources`/`facts`/`entities` (`canvasX`, `canvasY`, `pinned`, `deskState`, `deskCategory`, `synthesisRunId`) and the new `synthesisRuns` table.
> - `src/lib/deepdive/types.ts` `SSEEvent` union includes `'artefact'` and `'synthesis'`.
> - `src/lib/deepdive/worker.ts` exports `ensureEmitter(sessionId)`.
> - `src/lib/deepdive/desk-events.ts` exists (`nextSeq`, `emitArtefact`, `flushArtefacts`).
>
> Task 1 contains a guarded re-confirmation of each so this milestone is self-contained and compiles even if a prerequisite drifted.

---

### Task 1: Confirm/land the synthesis prerequisites (schema, SSEEvent union, ensureEmitter)

This milestone's worker imports `synthesisRuns`, reads `deskCategory`/`pinned`, emits `synthesis`-typed events, and calls `ensureEmitter`. Land any of these that are not already present so the rest of the milestone compiles. All are idempotent: if Milestone 1/2 already added them, the `grep` checks below pass and you skip the corresponding edit.

**Files:**
- Modify `src/lib/deepdive/types.ts` (`SSEEvent`, lines 26-30) — only if union lacks `'artefact'`/`'synthesis'`
- Modify `src/lib/db/schema.ts` (`sources` 388-400, `facts` 404-418, `entities` 422-429; append `synthesisRuns` after `relationships`, ~line 455) — only if columns/table absent
- Modify `src/lib/deepdive/worker.ts` (after `getEmitter`, line 26) — only if `ensureEmitter` absent

- [ ] **Step 1: Detect what already exists.** Run:
```bash
cd /home/john/strange_rambling_svelte && \
  echo "== SSEEvent ==" && grep -n "'artefact'\|'synthesis'" src/lib/deepdive/types.ts || echo "MISSING union members"; \
  echo "== synthesisRuns ==" && grep -n "export const synthesisRuns" src/lib/db/schema.ts || echo "MISSING synthesisRuns"; \
  echo "== deskCategory ==" && grep -n "deskCategory" src/lib/db/schema.ts || echo "MISSING desk columns"; \
  echo "== ensureEmitter ==" && grep -n "export function ensureEmitter" src/lib/deepdive/worker.ts || echo "MISSING ensureEmitter"
```
Expected when all prerequisites are present: four non-"MISSING" matches. For any line printing `MISSING ...`, apply the corresponding step below; otherwise skip it.

- [ ] **Step 2 (only if SSEEvent union is MISSING members): extend the union.** In `src/lib/deepdive/types.ts`, replace:
```ts
export interface SSEEvent {
  type: 'log' | 'stats' | 'status' | 'error';
  message?: string;
  data?: Record<string, unknown>;
}
```
with:
```ts
export interface SSEEvent {
  type: 'log' | 'stats' | 'status' | 'error' | 'artefact' | 'synthesis';
  message?: string;
  data?: Record<string, unknown>;
}
```

- [ ] **Step 3 (only if desk columns MISSING): append nullable desk columns to `sources`, `facts`, `entities`.** In `src/lib/db/schema.ts`, the desk block is identical for all three tables. For `sources`, change the closing lines from:
```ts
  credibilityType: text('credibility_type'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});
```
to:
```ts
  credibilityType: text('credibility_type'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  // Desk (research-canvas) columns — additive/nullable, safe drizzle-kit push.
  canvasX: doublePrecision('canvas_x'),
  canvasY: doublePrecision('canvas_y'),
  pinned: boolean('pinned').notNull().default(false),
  deskState: text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
  deskCategory: text('desk_category'),
  synthesisRunId: text('synthesis_run_id'),
});
```
For `facts`, change:
```ts
  noveltyScore: doublePrecision('novelty_score'),
  sourceAgreement: integer('source_agreement'),
});
```
to:
```ts
  noveltyScore: doublePrecision('novelty_score'),
  sourceAgreement: integer('source_agreement'),
  // Desk (research-canvas) columns — additive/nullable, safe drizzle-kit push.
  canvasX: doublePrecision('canvas_x'),
  canvasY: doublePrecision('canvas_y'),
  pinned: boolean('pinned').notNull().default(false),
  deskState: text('desk_state').notNull().default('unfiled'),
  deskCategory: text('desk_category'),
  synthesisRunId: text('synthesis_run_id'),
});
```
For `entities`, change:
```ts
  description: text('description'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
});
```
to:
```ts
  description: text('description'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  // Desk (research-canvas) columns — additive/nullable, safe drizzle-kit push.
  canvasX: doublePrecision('canvas_x'),
  canvasY: doublePrecision('canvas_y'),
  pinned: boolean('pinned').notNull().default(false),
  deskState: text('desk_state').notNull().default('unfiled'),
  deskCategory: text('desk_category'),
  synthesisRunId: text('synthesis_run_id'),
});
```

- [ ] **Step 4 (only if synthesisRuns MISSING): add the `synthesisRuns` table.** In `src/lib/db/schema.ts`, immediately after the `relationships` block (`export type Relationship = typeof relationships.$inferSelect;`, ~line 455), insert:
```ts
// ==========================================
// Deep Dive — On-demand Synthesis Runs (the Desk)
// ==========================================

export const synthesisRuns = pgTable('synthesis_runs', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId: text('session_id').notNull().references(() => researchSessions.id),
  scope: jsonb('scope').notNull().default(sql`'{}'::jsonb`),
  status: text('status').notNull().default('running'), // running|complete|failed|cancelled
  summary: text('summary'),
  clusters: jsonb('clusters').notNull().default(sql`'[]'::jsonb`),
  tokensUsed: integer('tokens_used'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type SynthesisRun = typeof synthesisRuns.$inferSelect;
export type NewSynthesisRun = typeof synthesisRuns.$inferInsert;
```
(`boolean`, `text`, `doublePrecision`, `jsonb`, `integer`, `timestamp` and `sql` are already imported at the top of `schema.ts` — confirmed lines 1-18.)

- [ ] **Step 5 (only if ensureEmitter MISSING): add `ensureEmitter` to worker.ts.** In `src/lib/deepdive/worker.ts`, immediately after the `getEmitter` function (after its closing `}` at line 26), insert:
```ts

/**
 * Like getEmitter, but explicitly intended for re-attaching to a session whose
 * emitter may have been torn down by the 30s post-completion cleanup (see the
 * setTimeout in runResearch). On-demand synthesis on an already-complete
 * session calls this so its synthesis.* events still reach live stream clients.
 */
export function ensureEmitter(sessionId: string): EventEmitter {
  let emitter = activeEmitters.get(sessionId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    activeEmitters.set(sessionId, emitter);
  }
  return emitter;
}
```

- [ ] **Step 6: Push schema (only if you touched schema.ts in Steps 3–4).** Run with the Bash sandbox disabled (drizzle needs network to the DB):
```bash
cd /home/john/strange_rambling_svelte && npx drizzle-kit push
```
Expected: `[✓] Changes applied` (or `No changes detected` if Milestone 1 already pushed). It must NOT prompt about dropping/truncating data — all additions are nullable or defaulted.

- [ ] **Step 7: Type-check the touched modules.** Run:
```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -5
```
Expected: `svelte-check found 0 errors` (warnings are acceptable).

- [ ] **Step 8: Commit.**
```bash
cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/types.ts src/lib/db/schema.ts src/lib/deepdive/worker.ts && \
git commit -m "$(cat <<'EOF'
deepdive(desk): land synthesis prerequisites (schema cols, synthesis_runs, SSEEvent union, ensureEmitter)

Additive nullable desk columns on sources/facts/entities, new synthesis_runs
table, SSEEvent union extended with 'artefact'|'synthesis', and ensureEmitter()
to re-attach a torn-down emitter for on-demand synthesis on a completed session.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Synthesis scope resolution (`resolveFactSet`) — TDD

The synthesis worker must turn `scope:{ factIds?, category?, pinnedOnly? }` into the concrete fact set it summarises. Extract this as a small pure-ish DB function so it is unit-testable in isolation (the query-builder logic is the part that carries bugs). We test the **WHERE-clause construction** via an injected query executor so no live DB is needed.

**Files:**
- Create `src/lib/deepdive/synthesis-scope.ts`
- Create `src/lib/deepdive/synthesis-scope.test.ts`

- [ ] **Step 1: Write the test first.** Create `src/lib/deepdive/synthesis-scope.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildScopePlan } from './synthesis-scope';

describe('buildScopePlan', () => {
  it('factIds scope: matches only the listed ids, ignores category/pinned', () => {
    const plan = buildScopePlan('sess-1', { factIds: ['f1', 'f2', 'f3'] });
    expect(plan.mode).toBe('ids');
    expect(plan.factIds).toEqual(['f1', 'f2', 'f3']);
  });

  it('empty factIds array falls through to broad scope (treated as no id filter)', () => {
    const plan = buildScopePlan('sess-1', { factIds: [] });
    expect(plan.mode).not.toBe('ids');
  });

  it('category scope: filters by deskCategory', () => {
    const plan = buildScopePlan('sess-1', { category: 'Economics' });
    expect(plan.mode).toBe('category');
    expect(plan.category).toBe('Economics');
  });

  it('pinnedOnly scope: only pinned, non-counterfactual facts', () => {
    const plan = buildScopePlan('sess-1', { pinnedOnly: true });
    expect(plan.mode).toBe('pinned');
    expect(plan.pinnedOnly).toBe(true);
  });

  it('empty scope: whole-session, non-counterfactual facts', () => {
    const plan = buildScopePlan('sess-1', {});
    expect(plan.mode).toBe('session');
    expect(plan.sessionId).toBe('sess-1');
  });

  it('factIds take precedence over category and pinnedOnly when all present', () => {
    const plan = buildScopePlan('sess-1', { factIds: ['f1'], category: 'X', pinnedOnly: true });
    expect(plan.mode).toBe('ids');
  });

  it('caps id list at 500 to bound the prompt', () => {
    const many = Array.from({ length: 800 }, (_, i) => `f${i}`);
    const plan = buildScopePlan('sess-1', { factIds: many });
    expect(plan.factIds!.length).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail.**
```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/synthesis-scope.test.ts 2>&1 | tail -15
```
Expected: failure with `Cannot find module './synthesis-scope'` (or `buildScopePlan is not a function`).

- [ ] **Step 3: Implement `synthesis-scope.ts`.** Create `src/lib/deepdive/synthesis-scope.ts`:
```ts
import { db } from '$lib/db';
import { facts } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { Fact } from '$lib/db/schema';

export interface SynthesisScope {
  factIds?: string[];
  category?: string;
  pinnedOnly?: boolean;
}

export type ScopeMode = 'ids' | 'category' | 'pinned' | 'session';

export interface ScopePlan {
  mode: ScopeMode;
  sessionId: string;
  factIds?: string[];
  category?: string;
  pinnedOnly?: boolean;
}

const MAX_SCOPE_IDS = 500;

/**
 * Pure decision: turn a SynthesisScope into a concrete query plan. factIds wins
 * over category, which wins over pinnedOnly, which wins over the whole-session
 * default. An empty factIds array is treated as "no id filter" so a caller that
 * passes `[]` doesn't accidentally synthesise zero facts.
 */
export function buildScopePlan(sessionId: string, scope: SynthesisScope): ScopePlan {
  if (Array.isArray(scope.factIds) && scope.factIds.length > 0) {
    return { mode: 'ids', sessionId, factIds: scope.factIds.slice(0, MAX_SCOPE_IDS) };
  }
  if (scope.category) {
    return { mode: 'category', sessionId, category: scope.category };
  }
  if (scope.pinnedOnly) {
    return { mode: 'pinned', sessionId, pinnedOnly: true };
  }
  return { mode: 'session', sessionId };
}

/**
 * Resolve the concrete fact rows for a scope plan. Always restricted to the
 * session and to non-counterfactual facts (challenge cards are linked, not
 * summarised directly). When mode==='ids' we additionally require sessionId to
 * stop a caller smuggling another session's fact ids into this run.
 */
export async function resolveFactSet(plan: ScopePlan): Promise<Fact[]> {
  const base = eq(facts.sessionId, plan.sessionId);
  const notCounter = eq(facts.isCounterfactual, false);

  if (plan.mode === 'ids') {
    if (!plan.factIds || plan.factIds.length === 0) return [];
    return db
      .select()
      .from(facts)
      .where(and(base, notCounter, inArray(facts.id, plan.factIds)));
  }
  if (plan.mode === 'category') {
    return db
      .select()
      .from(facts)
      .where(and(base, notCounter, eq(facts.deskCategory, plan.category!)));
  }
  if (plan.mode === 'pinned') {
    return db
      .select()
      .from(facts)
      .where(and(base, notCounter, eq(facts.pinned, true)));
  }
  // session
  return db.select().from(facts).where(and(base, notCounter));
}
```

- [ ] **Step 4: Run the test, watch it pass.**
```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/synthesis-scope.test.ts 2>&1 | tail -15
```
Expected: `Test Files  1 passed (1)` / `Tests  7 passed (7)`.

- [ ] **Step 5: Commit.**
```bash
cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/synthesis-scope.ts src/lib/deepdive/synthesis-scope.test.ts && \
git commit -m "$(cat <<'EOF'
deepdive(desk): synthesis scope resolution (buildScopePlan + resolveFactSet)

factIds > category > pinnedOnly > whole-session precedence; ids capped at 500
and scoped to the session; counterfactuals excluded. Unit-tested precedence,
empty-array fallthrough, and id cap.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Per-run abort registry — TDD

Synthesis runs need cancellation independent of the session-level `abortControllers` (which is keyed by `sessionId` in `worker.ts`). Add a `runId`-keyed registry. This is pure in-memory logic, fully unit-testable.

**Files:**
- Create `src/lib/deepdive/synthesis-abort.ts`
- Create `src/lib/deepdive/synthesis-abort.test.ts`

- [ ] **Step 1: Write the test first.** Create `src/lib/deepdive/synthesis-abort.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerSynthesisRun,
  getSynthesisSignal,
  requestStopSynthesis,
  clearSynthesisRun,
  isSynthesisAborted,
} from './synthesis-abort';

afterEach(() => {
  // Defensive cleanup so cross-test state never leaks.
  clearSynthesisRun('run-a');
  clearSynthesisRun('run-b');
});

describe('synthesis abort registry', () => {
  it('register then getSynthesisSignal returns a live, un-aborted signal', () => {
    registerSynthesisRun('run-a');
    const sig = getSynthesisSignal('run-a');
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig!.aborted).toBe(false);
  });

  it('requestStopSynthesis aborts only the targeted run', () => {
    registerSynthesisRun('run-a');
    registerSynthesisRun('run-b');
    requestStopSynthesis('run-a');
    expect(getSynthesisSignal('run-a')!.aborted).toBe(true);
    expect(getSynthesisSignal('run-b')!.aborted).toBe(false);
  });

  it('isSynthesisAborted reflects state and is false for unknown runs', () => {
    registerSynthesisRun('run-a');
    expect(isSynthesisAborted('run-a')).toBe(false);
    requestStopSynthesis('run-a');
    expect(isSynthesisAborted('run-a')).toBe(true);
    expect(isSynthesisAborted('does-not-exist')).toBe(false);
  });

  it('getSynthesisSignal returns undefined for unknown run', () => {
    expect(getSynthesisSignal('nope')).toBeUndefined();
  });

  it('requestStopSynthesis on an unknown run is a no-op (no throw)', () => {
    expect(() => requestStopSynthesis('ghost')).not.toThrow();
  });

  it('clearSynthesisRun removes the controller', () => {
    registerSynthesisRun('run-a');
    clearSynthesisRun('run-a');
    expect(getSynthesisSignal('run-a')).toBeUndefined();
  });

  it('registering the same runId twice replaces the controller (fresh signal)', () => {
    registerSynthesisRun('run-a');
    requestStopSynthesis('run-a');
    expect(isSynthesisAborted('run-a')).toBe(true);
    registerSynthesisRun('run-a'); // re-register
    expect(isSynthesisAborted('run-a')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, watch it fail.**
```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/synthesis-abort.test.ts 2>&1 | tail -15
```
Expected: failure — `Cannot find module './synthesis-abort'`.

- [ ] **Step 3: Implement `synthesis-abort.ts`.** Create `src/lib/deepdive/synthesis-abort.ts`:
```ts
/**
 * Per-synthesis-run abort registry, keyed by runId. Distinct from the
 * session-keyed abortControllers in worker.ts: cancelling one synthesis run
 * must not abort the whole research session. Session-level requestStop() still
 * cancels everything because the synthesis worker also threads the session
 * abort signal where relevant.
 */
const synthesisAborts = new Map<string, AbortController>();

/** Create (or replace) the AbortController for a run. */
export function registerSynthesisRun(runId: string): void {
  synthesisAborts.set(runId, new AbortController());
}

/** The abort signal for a run, or undefined if not registered. */
export function getSynthesisSignal(runId: string): AbortSignal | undefined {
  return synthesisAborts.get(runId)?.signal;
}

/** Abort a single run. No-op if the run is unknown. */
export function requestStopSynthesis(runId: string): void {
  synthesisAborts.get(runId)?.abort(new Error('Synthesis cancelled'));
}

/** Whether a run has been aborted (false for unknown runs). */
export function isSynthesisAborted(runId: string): boolean {
  return synthesisAborts.get(runId)?.signal.aborted === true;
}

/** Drop a run's controller once it has terminated. */
export function clearSynthesisRun(runId: string): void {
  synthesisAborts.delete(runId);
}
```

- [ ] **Step 4: Run the test, watch it pass.**
```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/deepdive/synthesis-abort.test.ts 2>&1 | tail -15
```
Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Commit.**
```bash
cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/synthesis-abort.ts src/lib/deepdive/synthesis-abort.test.ts && \
git commit -m "$(cat <<'EOF'
deepdive(desk): per-run synthesis abort registry

runId-keyed AbortController map (register/getSynthesisSignal/requestStopSynthesis/
isSynthesisAborted/clearSynthesisRun) so one synthesis run can be cancelled
without aborting the whole session. Fully unit-tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The synthesis worker (`runSynthesis`)

Wire scope resolution + the per-run abort registry into the streamed LLM pass. `runSynthesis` is the fire-and-forget background worker called by the endpoint. It re-uses `streamCompletion` (streamed exec summary, `onToken → synthesis.progress`) and `jsonCompletion` (structured re-clustering — same prompt shape as `postprocess.ts:178-184`). It must call `ensureEmitter` first, emit `synthesis.started`/`cluster`/`done`, persist into the `synthesis_runs` row, and flip `desk_state='synthesized'` on the included facts.

The streaming/LLM internals aren't unit-tested here (they hit the gateway + DB); they are covered by the integration test in Task 6 and manual E2E in the desk milestone. We DO keep all decision-shaping logic in the already-tested `synthesis-scope.ts` / `synthesis-abort.ts` modules.

**Files:**
- Create `src/lib/deepdive/synthesis.ts`

- [ ] **Step 1: Implement `synthesis.ts`.** Create `src/lib/deepdive/synthesis.ts`:
```ts
import { db } from '$lib/db';
import { facts, synthesisRuns } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { ensureEmitter, emit } from './worker';
import { nextSeq } from './desk-events';
import { streamCompletion, jsonCompletion } from './ai';
import { buildScopePlan, resolveFactSet, type SynthesisScope } from './synthesis-scope';
import {
  registerSynthesisRun,
  getSynthesisSignal,
  isSynthesisAborted,
  clearSynthesisRun,
} from './synthesis-abort';

interface Cluster {
  id: string;
  title: string;
  summary: string;
  fact_ids: string[];
}

/** Cap facts sent to the LLM so the prompt stays bounded (mirrors postprocess). */
const MAX_FACTS_FOR_LLM = 200;

function emitSynthesis(sessionId: string, data: Record<string, unknown>): void {
  emit(sessionId, { type: 'synthesis', data: { seq: nextSeq(sessionId), ...data } });
}

/**
 * On-demand, streamed synthesis over a scoped subset of a session's facts.
 * Fire-and-forget: callers MUST NOT await this (it runs for the LLM's lifetime).
 * Errors are caught internally and recorded on the synthesis_runs row + emitted
 * as a 'synthesis' done/failed event — they never reject to the caller.
 */
export async function runSynthesis(
  sessionId: string,
  runId: string,
  scope: SynthesisScope,
): Promise<void> {
  // Re-attach an emitter even if the 30s post-completion cleanup tore it down,
  // so synthesis on a finished session still streams to live clients.
  ensureEmitter(sessionId);
  registerSynthesisRun(runId);
  const signal = getSynthesisSignal(runId)!;

  try {
    const plan = buildScopePlan(sessionId, scope);
    const factRows = await resolveFactSet(plan);
    const scopedFacts = factRows.slice(0, MAX_FACTS_FOR_LLM);

    emitSynthesis(sessionId, {
      runId,
      stage: 'started',
      scope,
      factCount: scopedFacts.length,
    });

    if (scopedFacts.length === 0) {
      await db
        .update(synthesisRuns)
        .set({
          status: 'complete',
          summary: 'No facts in scope to synthesise.',
          clusters: [],
          tokensUsed: 0,
          completedAt: new Date(),
        })
        .where(eq(synthesisRuns.id, runId));
      emitSynthesis(sessionId, { runId, stage: 'done', summary: '', clusters: [], tokensUsed: 0 });
      return;
    }

    const systemPrompt =
      'You are a research synthesiser organising a desk of loose facts into coherent themes. ' +
      'Only restate or synthesise the facts provided. Do NOT add information, claims, or context ' +
      'that is not directly present in those facts.';

    const factList = scopedFacts.map((f) => `[${f.id}] ${f.content}`).join('\n');

    // 1. Structured re-clustering (non-streamed). Same shape as postprocess.ts:178-184.
    let clusters: Cluster[] = [];
    let clusterTokens = 0;
    try {
      const result = await jsonCompletion<{
        clusters: { title: string; summary: string; fact_ids: string[] }[];
      }>(
        systemPrompt,
        `Group these facts into 4-8 coherent topic clusters. For each cluster return:\n` +
          `- title: a short descriptive label\n` +
          `- summary: 2-3 sentences that ONLY restate or synthesise the facts listed below\n` +
          `- fact_ids: list of fact IDs in this cluster\n\n` +
          `Facts:\n${factList}\n\nRespond with JSON: { "clusters": [...] }`,
        { maxTokens: 8192, signal },
      );
      clusters = (result.clusters ?? []).map((c, i) => ({
        id: `${runId}-c${i}`,
        title: c.title,
        summary: c.summary,
        fact_ids: Array.isArray(c.fact_ids) ? c.fact_ids : [],
      }));
    } catch (err) {
      if (isSynthesisAborted(runId)) throw err;
      console.error('[deepdive] synthesis clustering failed:', err);
      clusters = [
        {
          id: `${runId}-c0`,
          title: 'All Findings',
          summary: 'All scoped facts grouped together.',
          fact_ids: scopedFacts.map((f) => f.id),
        },
      ];
    }

    for (const cluster of clusters) {
      if (isSynthesisAborted(runId)) throw new Error('Synthesis cancelled');
      emitSynthesis(sessionId, { runId, stage: 'cluster', cluster });
    }

    // 2. Streamed executive summary. onToken -> synthesis.progress.
    const topFactContents = scopedFacts.map((f) => f.content).slice(0, 40);
    const { text: summary, tokensUsed: summaryTokens } = await streamCompletion(
      systemPrompt,
      `Write a 2-4 paragraph synthesis of these facts. ONLY use information present in them.\n\n` +
        `Facts:\n${topFactContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
      {
        maxTokens: 2000,
        signal,
        onToken: (token) => emitSynthesis(sessionId, { runId, stage: 'progress', token }),
      },
    );

    const tokensUsed = clusterTokens + summaryTokens;

    // 3. Persist the run + flip desk_state on the included facts.
    const includedIds = scopedFacts.map((f) => f.id);
    await db
      .update(synthesisRuns)
      .set({
        status: 'complete',
        summary,
        clusters,
        tokensUsed,
        completedAt: new Date(),
      })
      .where(eq(synthesisRuns.id, runId));

    if (includedIds.length > 0) {
      await db
        .update(facts)
        .set({ deskState: 'synthesized', synthesisRunId: runId })
        .where(and(eq(facts.sessionId, sessionId), inArray(facts.id, includedIds)));
    }

    emitSynthesis(sessionId, { runId, stage: 'done', summary, clusters, tokensUsed });
  } catch (err: any) {
    const cancelled = isSynthesisAborted(runId) || err?.name === 'AbortError';
    const status = cancelled ? 'cancelled' : 'failed';
    const message = err?.message ?? 'unknown error';
    console.error(`[deepdive] synthesis ${runId} ${status}:`, message);
    await db
      .update(synthesisRuns)
      .set({ status, errorMessage: message, completedAt: new Date() })
      .where(eq(synthesisRuns.id, runId))
      .catch((e) => console.error('[deepdive] failed to record synthesis error:', e));
    emit(sessionId, {
      type: 'error',
      message: `Synthesis ${status}: ${message}`,
      data: { seq: nextSeq(sessionId), runId, stage: status },
    });
  } finally {
    clearSynthesisRun(runId);
  }
}
```
(Note: `clusterTokens` stays 0 because `jsonCompletion` returns only the parsed object, not a token count — kept as an explicit additive term so adding token accounting later is one line.)

- [ ] **Step 2: Type-check the new module against the real gateway/scope/event signatures.** Run:
```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -8
```
Expected: `svelte-check found 0 errors`. (This is the real verification that `streamCompletion`/`jsonCompletion`/`emit`/`ensureEmitter`/`nextSeq`/`resolveFactSet` signatures all line up.)

- [ ] **Step 3: Smoke-test that the module imports and exports `runSynthesis` cleanly** (catches circular-import / missing-export breakage without a live LLM). Create a temporary check and run it:
```bash
cd /home/john/strange_rambling_svelte && cat > /tmp/synth_import_check.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { runSynthesis } from '/home/john/strange_rambling_svelte/src/lib/deepdive/synthesis.ts';
describe('synthesis module', () => {
  it('exports runSynthesis as a function', () => {
    expect(typeof runSynthesis).toBe('function');
  });
});
EOF
npx vitest run /tmp/synth_import_check.test.ts 2>&1 | tail -8 && rm -f /tmp/synth_import_check.test.ts</parameter>
```
Expected: `Tests  1 passed (1)`. (Then the temp file is removed; do not commit it.)

- [ ] **Step 4: Commit.**
```bash
cd /home/john/strange_rambling_svelte && git add src/lib/deepdive/synthesis.ts && \
git commit -m "$(cat <<'EOF'
deepdive(desk): streamed on-demand synthesis worker (runSynthesis)

Fire-and-forget worker: ensureEmitter -> resolve scoped facts -> emit
synthesis.started -> jsonCompletion re-cluster (emit per-cluster) -> streamed
executive summary (onToken -> synthesis.progress) -> persist synthesis_runs row,
flip desk_state='synthesized' on included facts -> emit synthesis.done. Per-run
abort + failed/cancelled recording. Empty scope short-circuits cleanly.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The synthesize endpoint (`POST /api/deepdive/[id]/synthesize`)

Mirrors the fire-and-forget idiom in `api/deepdive/+server.ts:46-78` and the 404 pattern in `api/deepdive/[id]/rerun/+server.ts`. Validates the session exists, inserts a `synthesis_runs` row with `.returning()` for the `runId`, kicks `runSynthesis` WITHOUT awaiting, and returns `201 { runId }`.

**Files:**
- Create `src/routes/api/deepdive/[id]/synthesize/+server.ts`

- [ ] **Step 1: Implement the endpoint.** Create `src/routes/api/deepdive/[id]/synthesize/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, synthesisRuns } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { runSynthesis } from '$lib/deepdive/synthesis';
import type { SynthesisScope } from '$lib/deepdive/synthesis-scope';

export const POST: RequestHandler = async ({ params, request }) => {
  const [session] = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const rawScope = (body?.scope ?? {}) as SynthesisScope;

  // Normalise/whitelist scope fields so arbitrary client JSON can't reach the DB.
  const scope: SynthesisScope = {};
  if (Array.isArray(rawScope.factIds)) {
    scope.factIds = rawScope.factIds.filter((x): x is string => typeof x === 'string');
  }
  if (typeof rawScope.category === 'string') scope.category = rawScope.category;
  if (typeof rawScope.pinnedOnly === 'boolean') scope.pinnedOnly = rawScope.pinnedOnly;

  const [run] = await db
    .insert(synthesisRuns)
    .values({ sessionId: params.id, scope, status: 'running' })
    .returning({ id: synthesisRuns.id });

  // Fire-and-forget — do NOT await (mirrors startResearch in worker.ts).
  runSynthesis(params.id, run.id, scope).catch((err) => {
    console.error(`[deepdive] runSynthesis crashed for run ${run.id}:`, err);
  });

  return json({ runId: run.id }, { status: 201 });
};
```

- [ ] **Step 2: Type-check the route (confirms `./$types` resolves and the insert shape is valid).**
```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -6
```
Expected: `svelte-check found 0 errors`.

- [ ] **Step 3: Commit.**
```bash
cd /home/john/strange_rambling_svelte && git add src/routes/api/deepdive/\[id\]/synthesize/+server.ts && \
git commit -m "$(cat <<'EOF'
deepdive(desk): POST /api/deepdive/[id]/synthesize endpoint

404s on unknown session, whitelists scope (factIds/category/pinnedOnly),
inserts a synthesis_runs row, kicks runSynthesis fire-and-forget, returns
201 { runId }. Mirrors the deepdive POST background-job idiom.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Integration test — endpoint inserts a run row and returns 201

The endpoint's contract (DB insert + 201 + non-awaited kickoff) is the integration boundary. We test the handler directly with a stubbed `db`, a stubbed `runSynthesis` (so no LLM fires), and a `RequestEvent`-shaped argument — the same lightweight style the repo uses for handler tests (no live server).

**Files:**
- Create `src/routes/api/deepdive/[id]/synthesize/server.test.ts`

- [ ] **Step 1: Write the integration test.** Create `src/routes/api/deepdive/[id]/synthesize/server.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks must be declared before importing the handler under test. ---

const insertedRows: any[] = [];
const runSynthesisCalls: Array<{ sessionId: string; runId: string; scope: any }> = [];

// Stub the synthesis worker so no LLM/DB writes happen on kickoff.
vi.mock('$lib/deepdive/synthesis', () => ({
  runSynthesis: vi.fn(async (sessionId: string, runId: string, scope: any) => {
    runSynthesisCalls.push({ sessionId, runId, scope });
  }),
}));

// Configurable: does the session lookup return a row?
let sessionExists = true;

vi.mock('$lib/db', () => {
  const db = {
    // session lookup: db.select(...).from(...).where(...) -> array
    select: () => ({
      from: () => ({
        where: async () => (sessionExists ? [{ id: 'sess-1' }] : []),
      }),
    }),
    // run insert: db.insert(...).values(...).returning(...) -> [{ id }]
    insert: () => ({
      values: (vals: any) => ({
        returning: async () => {
          const row = { id: 'run-123', ...vals };
          insertedRows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  };
  return { db };
});

import { POST } from './+server';

function makeEvent(id: string, body: unknown) {
  return {
    params: { id },
    request: { json: async () => body },
  } as any;
}

beforeEach(() => {
  insertedRows.length = 0;
  runSynthesisCalls.length = 0;
  sessionExists = true;
});

describe('POST /api/deepdive/[id]/synthesize', () => {
  it('inserts a synthesis_runs row and returns 201 { runId }', async () => {
    const res = await POST(makeEvent('sess-1', { scope: { pinnedOnly: true } }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.runId).toBe('run-123');

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].sessionId).toBe('sess-1');
    expect(insertedRows[0].status).toBe('running');
    expect(insertedRows[0].scope).toEqual({ pinnedOnly: true });
  });

  it('kicks runSynthesis fire-and-forget with the resolved scope', async () => {
    await POST(makeEvent('sess-1', { scope: { factIds: ['f1', 'f2'] } }));
    expect(runSynthesisCalls).toHaveLength(1);
    expect(runSynthesisCalls[0]).toEqual({
      sessionId: 'sess-1',
      runId: 'run-123',
      scope: { factIds: ['f1', 'f2'] },
    });
  });

  it('whitelists scope fields — drops unknown keys and non-string factIds', async () => {
    await POST(makeEvent('sess-1', { scope: { factIds: ['ok', 7, null], evil: 'x', category: 'C' } }));
    expect(insertedRows[0].scope).toEqual({ factIds: ['ok'], category: 'C' });
  });

  it('defaults to empty scope when body has none', async () => {
    await POST(makeEvent('sess-1', {}));
    expect(insertedRows[0].scope).toEqual({});
  });

  it('404s when the session does not exist (no insert, no kickoff)', async () => {
    sessionExists = false;
    const res = await POST(makeEvent('missing', { scope: {} }));
    expect(res.status).toBe(404);
    expect(insertedRows).toHaveLength(0);
    expect(runSynthesisCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the integration test.**
```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/routes/api/deepdive/\[id\]/synthesize/server.test.ts 2>&1 | tail -18
```
Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

- [ ] **Step 3: Commit.**
```bash
cd /home/john/strange_rambling_svelte && git add src/routes/api/deepdive/\[id\]/synthesize/server.test.ts && \
git commit -m "$(cat <<'EOF'
deepdive(desk): integration test for synthesize endpoint

Stubbed db + runSynthesis: asserts 201 { runId }, synthesis_runs insert shape
(status running, scope persisted), fire-and-forget kickoff, scope whitelisting,
and 404 (no insert/kickoff) for unknown sessions.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Rate-limit the synthesize route (LLM-expensive)

`hooks.server.ts:26-34` already matches `/api/deepdive/...` at 5/min via `/^\/api\/deepdive(\/|$)/`. Synthesis is a separate, costlier LLM pass that the user can hammer via the toggle, so give it its own tighter entry. `RATE_LIMITS.find` returns the **first** match, so the synthesize-specific rule must be listed **before** the broad deepdive rule.

**Files:**
- Modify `src/hooks.server.ts` (`RATE_LIMITS`, lines 26-34)

- [ ] **Step 1: Add the synthesize rule above the broad deepdive rule.** In `src/hooks.server.ts`, replace:
```ts
const RATE_LIMITS: Array<{ pattern: RegExp; capacity: number; refillPerSecond: number }> = [
  { pattern: /^\/api\/deepdive(\/|$)/, capacity: 5, refillPerSecond: 5 / 60 }, // 5/min
```
with:
```ts
const RATE_LIMITS: Array<{ pattern: RegExp; capacity: number; refillPerSecond: number }> = [
  // Synthesis is a per-toggle streamed LLM pass — costlier than a deep run kickoff
  // and user-triggerable in bursts. Must precede the broad /api/deepdive rule
  // because RATE_LIMITS.find() returns the FIRST matching pattern.
  { pattern: /^\/api\/deepdive\/[^/]+\/synthesize$/, capacity: 3, refillPerSecond: 3 / 60 }, // 3/min
  { pattern: /^\/api\/deepdive(\/|$)/, capacity: 5, refillPerSecond: 5 / 60 }, // 5/min
```

- [ ] **Step 2: Verify ordering and pattern correctness with a quick node check** (asserts the synthesize path hits the 3/min rule, not the 5/min one, and the position rule has not been accidentally reordered):
```bash
cd /home/john/strange_rambling_svelte && node -e '
const rules = [
  { pattern: /^\/api\/deepdive\/[^/]+\/synthesize$/, capacity: 3 },
  { pattern: /^\/api\/deepdive(\/|$)/, capacity: 5 },
];
const find = (p) => rules.find((r) => r.pattern.test(p));
const a = find("/api/deepdive/abc-123/synthesize");
const b = find("/api/deepdive/abc-123/data");
console.log("synthesize ->", a.capacity, "| data ->", b.capacity);
if (a.capacity !== 3 || b.capacity !== 5) { console.error("FAIL"); process.exit(1); }
console.log("OK");
'</parameter>
```
Expected output:
```
synthesize -> 3 | data -> 5
OK
```

- [ ] **Step 3: Type-check hooks.server.ts (cheap re-confirm nothing else broke).**
```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -5
```
Expected: `svelte-check found 0 errors`.

- [ ] **Step 4: Commit.**
```bash
cd /home/john/strange_rambling_svelte && git add src/hooks.server.ts && \
git commit -m "$(cat <<'EOF'
deepdive(desk): rate-limit /api/deepdive/[id]/synthesize at 3/min

Synthesis is a streamed LLM pass triggerable in bursts via the GATHER/SYNTHESIZE
toggle. Dedicated rule placed before the broad /api/deepdive rule (find returns
first match) so it actually applies.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Whole-milestone verification gate

Confirm the milestone's units all pass together and the project still type-checks before handing off to the desk-frontend milestone.

**Files:** none (verification only)

- [ ] **Step 1: Run every test this milestone added.**
```bash
cd /home/john/strange_rambling_svelte && npx vitest run \
  src/lib/deepdive/synthesis-scope.test.ts \
  src/lib/deepdive/synthesis-abort.test.ts \
  src/routes/api/deepdive/\[id\]/synthesize/server.test.ts 2>&1 | tail -12
```
Expected: `Test Files  3 passed (3)` and the combined test count (7 + 7 + 5 = 19) all passing.

- [ ] **Step 2: Full project type-check.**
```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -5
```
Expected: `svelte-check found 0 errors`.

- [ ] **Step 3: Confirm a clean working tree (everything committed).**
```bash
cd /home/john/strange_rambling_svelte && git status --porcelain
```
Expected: no output (all milestone changes committed across Tasks 1-7; no stray `/tmp` test files).

---

**Files this milestone creates/touches (all absolute):**
- `/home/john/strange_rambling_svelte/src/lib/deepdive/types.ts` (conditional — SSEEvent union)
- `/home/john/strange_rambling_svelte/src/lib/db/schema.ts` (conditional — desk columns + `synthesisRuns`)
- `/home/john/strange_rambling_svelte/src/lib/deepdive/worker.ts` (conditional — `ensureEmitter`)
- `/home/john/strange_rambling_svelte/src/lib/deepdive/synthesis-scope.ts` + `.test.ts`
- `/home/john/strange_rambling_svelte/src/lib/deepdive/synthesis-abort.ts` + `.test.ts`
- `/home/john/strange_rambling_svelte/src/lib/deepdive/synthesis.ts`
- `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/synthesize/+server.ts` + `server.test.ts`
- `/home/john/strange_rambling_svelte/src/hooks.server.ts` (rate-limit map)

**Cross-milestone dependency notes:** this milestone consumes `nextSeq` from `src/lib/deepdive/desk-events.ts` (Milestone 2). If executing this milestone standalone before Milestone 2, add a minimal `nextSeq(sessionId:string):number` (module-level `Map<string,number>` counter incremented per call) to `desk-events.ts` so `synthesis.ts` imports resolve — but the canonical implementation (with `emitArtefact`/`flushArtefacts`/100ms coalescing) belongs to Milestone 2 and must not be duplicated.


I have full context. Now I'll draft the milestone. The repo idiom is pure-function unit tests (no DB mocking), so I'll extract validation/normalization into a pure, unit-tested helper (`parsePositionPatch`) and a pure table-dispatch helper, then make the handler thin. I'll also write an integration test for the update path that gates DB-availability so it runs against a real local DB.

## Milestone 4: Artefact position persistence

This milestone ships the `PATCH /api/deepdive/[id]/artefacts/[artefactId]/position` endpoint that persists drag/pin/file state onto the `sources`, `facts`, and `entities` rows. It depends on the additive desk columns (`canvasX`, `canvasY`, `pinned`, `deskState`, `deskCategory`, `synthesisRunId`) and the `synthesisRuns` table already existing in `src/lib/db/schema.ts` from Milestone 1 — those columns and the table are assumed present (`drizzle-kit push` already applied). If `npx vitest run` or `npx drizzle-kit push` reports the desk columns missing, stop and complete Milestone 1 first.

The repo's test idiom is pure-function Vitest (no DB mocking layer exists). So the validation + table-dispatch logic is extracted into a pure, fully-unit-tested module (`position-patch.ts`); the `+server.ts` handler stays thin and delegates to it. A DB-gated integration test exercises the real update path against a local Postgres.

Auth is enforced by the `/api/*` hook (`hooks.server.ts`) — the handler does NOT re-check auth. The desk stays private (nothing added to `PUBLIC_PATHS`).

Reference patterns confirmed in the repo (re-grep before editing — line refs drift):
- Canvas drag-persist client pattern: `src/routes/jkai/canvas/[slug]/+page.svelte` `onNodePointerUp` (currently ~lines 2037-2069) — PATCHes `{ position: finalPos }` then drops the client override. Our route is the deepdive-specific target (do NOT reuse the workflow-node route).
- Route idiom: `src/routes/api/deepdive/[id]/share/+server.ts` (404-on-missing, `json(...)`, `eq` filter) and `src/routes/api/deepdive/+server.ts` POST (`await request.json()`, `json({ error }, { status: 400 })`).
- `db` is exported from `src/lib/db` (`drizzle(pool, { schema })`).
- Tables: `sources` (pk `id`), `facts` (pk `id`), `entities` (pk `id`) in `src/lib/db/schema.ts` (~lines 388/404/422), each carrying the desk columns from Milestone 1.

---

### Task 1: Pure validation + table-dispatch helper for the position PATCH

This is the testable logic: parse/validate the request body into a normalized update, reject bad input, and map `artefactType` → the Drizzle table. Pure functions, fully unit-tested before the handler exists.

**Files:**
- Create `src/lib/deepdive/position-patch.ts`
- Create `src/lib/deepdive/position-patch.test.ts`

- [ ] **Step 1: Write the failing unit test first (`position-patch.test.ts`).**

```ts
import { describe, it, expect } from 'vitest';
import { sources, facts, entities } from '$lib/db/schema';
import { parsePositionPatch, tableForArtefactType, type PositionPatch } from './position-patch';

describe('tableForArtefactType', () => {
  it('maps each valid artefactType to its Drizzle table', () => {
    expect(tableForArtefactType('source')).toBe(sources);
    expect(tableForArtefactType('fact')).toBe(facts);
    expect(tableForArtefactType('entity')).toBe(entities);
  });

  it('returns null for an unknown artefactType', () => {
    expect(tableForArtefactType('relationship')).toBeNull();
    expect(tableForArtefactType('')).toBeNull();
    // @ts-expect-error deliberately wrong type
    expect(tableForArtefactType(undefined)).toBeNull();
  });
});

describe('parsePositionPatch', () => {
  it('accepts a minimal valid body (position only)', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 120, y: -40 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.artefactType).toBe('fact');
    expect(res.value.set).toEqual({ canvasX: 120, canvasY: -40 });
  });

  it('includes optional pinned/deskState/deskCategory when present', () => {
    const res = parsePositionPatch({
      artefactType: 'source',
      position: { x: 0, y: 0 },
      pinned: true,
      deskState: 'filed',
      deskCategory: 'economics',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.set).toEqual({
      canvasX: 0,
      canvasY: 0,
      pinned: true,
      deskState: 'filed',
      deskCategory: 'economics',
    });
  });

  it('allows clearing deskCategory with null', () => {
    const res = parsePositionPatch({
      artefactType: 'entity',
      position: { x: 5, y: 5 },
      deskCategory: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.set).toEqual({ canvasX: 5, canvasY: 5, deskCategory: null });
  });

  it('rejects a non-object body', () => {
    expect(parsePositionPatch(null).ok).toBe(false);
    expect(parsePositionPatch('nope').ok).toBe(false);
    expect(parsePositionPatch(42).ok).toBe(false);
  });

  it('rejects an invalid artefactType', () => {
    const res = parsePositionPatch({ artefactType: 'relationship', position: { x: 1, y: 2 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/artefactType/i);
  });

  it('rejects a missing position', () => {
    const res = parsePositionPatch({ artefactType: 'fact' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/position/i);
  });

  it('rejects non-finite position coordinates', () => {
    for (const bad of [
      { x: NaN, y: 0 },
      { x: 0, y: Infinity },
      { x: '10', y: 0 },
      { x: 0 },
      { y: 0 },
    ]) {
      const res = parsePositionPatch({ artefactType: 'fact', position: bad });
      expect(res.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('rejects a non-boolean pinned', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 1, y: 1 },
      pinned: 'yes',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/pinned/i);
  });

  it('rejects an invalid deskState value', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 1, y: 1 },
      deskState: 'banana',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/deskState/i);
  });

  it('rejects a non-string deskCategory (when not null)', () => {
    const res = parsePositionPatch({
      artefactType: 'fact',
      position: { x: 1, y: 1 },
      deskCategory: 42,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/deskCategory/i);
  });

  it('omits absent optional fields entirely (no undefined keys in set)', () => {
    const res = parsePositionPatch({ artefactType: 'fact', position: { x: 1, y: 1 } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res.value.set).sort()).toEqual(['canvasX', 'canvasY']);
  });

  it('exposes the PositionPatch type shape', () => {
    const patch: PositionPatch = { artefactType: 'fact', set: { canvasX: 1, canvasY: 2 } };
    expect(patch.set.canvasX).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail (module does not exist yet).**

```
npx vitest run src/lib/deepdive/position-patch.test.ts
```
Expected: failure with `Failed to resolve import "./position-patch"` (or "Cannot find module").

- [ ] **Step 3: Implement `position-patch.ts` to make the tests pass.**

```ts
import { sources, facts, entities } from '$lib/db/schema';

/** The three artefact tables that carry desk position columns. Relationships are edges-only. */
export type ArtefactType = 'source' | 'fact' | 'entity';

/** Allowed values for the desk_state column (mirrors schema default + comment). */
export const DESK_STATES = ['unfiled', 'filed', 'synthesized', 'archived'] as const;
export type DeskState = (typeof DESK_STATES)[number];

/** The column set we will pass to db.update(...).set(...). Keys are Drizzle property names. */
export interface PositionUpdate {
  canvasX: number;
  canvasY: number;
  pinned?: boolean;
  deskState?: DeskState;
  deskCategory?: string | null;
}

export interface PositionPatch {
  artefactType: ArtefactType;
  set: PositionUpdate;
}

export type ParseResult =
  | { ok: true; value: PositionPatch }
  | { ok: false; error: string };

const ARTEFACT_TYPES: ReadonlySet<string> = new Set<ArtefactType>(['source', 'fact', 'entity']);

/**
 * Map an artefactType to its Drizzle table. Returns null for anything we don't persist
 * positions for (e.g. 'relationship', unknown strings).
 */
export function tableForArtefactType(artefactType: string): typeof sources | typeof facts | typeof entities | null {
  switch (artefactType) {
    case 'source':
      return sources;
    case 'fact':
      return facts;
    case 'entity':
      return entities;
    default:
      return null;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate and normalize an artefact position-PATCH request body.
 * Pure: no DB, no I/O. The handler maps `ok:false` → HTTP 400.
 */
export function parsePositionPatch(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.artefactType !== 'string' || !ARTEFACT_TYPES.has(b.artefactType)) {
    return { ok: false, error: "Invalid artefactType (expected 'source', 'fact', or 'entity')" };
  }
  const artefactType = b.artefactType as ArtefactType;

  const position = b.position;
  if (typeof position !== 'object' || position === null || Array.isArray(position)) {
    return { ok: false, error: 'position must be an object { x, y }' };
  }
  const p = position as Record<string, unknown>;
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
    return { ok: false, error: 'position.x and position.y must be finite numbers' };
  }

  const set: PositionUpdate = { canvasX: p.x, canvasY: p.y };

  if ('pinned' in b && b.pinned !== undefined) {
    if (typeof b.pinned !== 'boolean') {
      return { ok: false, error: 'pinned must be a boolean' };
    }
    set.pinned = b.pinned;
  }

  if ('deskState' in b && b.deskState !== undefined) {
    if (typeof b.deskState !== 'string' || !(DESK_STATES as readonly string[]).includes(b.deskState)) {
      return { ok: false, error: `deskState must be one of ${DESK_STATES.join(', ')}` };
    }
    set.deskState = b.deskState as DeskState;
  }

  if ('deskCategory' in b && b.deskCategory !== undefined) {
    if (b.deskCategory !== null && typeof b.deskCategory !== 'string') {
      return { ok: false, error: 'deskCategory must be a string or null' };
    }
    set.deskCategory = b.deskCategory as string | null;
  }

  return { ok: true, value: { artefactType, set } };
}
```

- [ ] **Step 4: Run the test and watch it pass.**

```
npx vitest run src/lib/deepdive/position-patch.test.ts
```
Expected: all tests in 2 `describe` blocks pass (15 assertions across the cases), output ends with `Test Files  1 passed (1)`.

- [ ] **Step 5: Type-check the new module (memory-bumped, per repo gotcha).**

```
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "position-patch|svelte-check found"
```
Expected: no errors referencing `position-patch.ts`; trailing line like `svelte-check found 0 errors ...` (a non-zero pre-existing count unrelated to these files is acceptable — confirm none mention `position-patch`).

- [ ] **Step 6: Commit.**

```
git add src/lib/deepdive/position-patch.ts src/lib/deepdive/position-patch.test.ts
git commit -m "$(cat <<'EOF'
deepdive: pure validator + table dispatch for artefact position PATCH

Milestone 4 (Research Desk): extract parsePositionPatch + tableForArtefactType
as pure, unit-tested helpers so the route handler stays thin.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The PATCH route handler

Thin handler that parses the body via the Task 1 helper, looks up the row scoped to the session (404 if absent / not in this session), updates `canvas_x/canvas_y` (+ optional flags), and returns the updated id/position. Mirrors `share/+server.ts` (404-on-missing) and the `+server.ts` POST 400 idiom.

**Files:**
- Create `src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/+server.ts`

- [ ] **Step 1: Implement the handler.**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { eq, and } from 'drizzle-orm';
import { parsePositionPatch, tableForArtefactType } from '$lib/deepdive/position-patch';

/**
 * PATCH /api/deepdive/[id]/artefacts/[artefactId]/position
 *
 * Persists desk position (canvas_x/canvas_y) plus optional pinned/deskState/deskCategory
 * onto the matching sources|facts|entities row, scoped to this session.
 *
 * Body: { artefactType:'source'|'fact'|'entity', position:{x:number,y:number},
 *         pinned?:boolean, deskState?:string, deskCategory?:string|null }
 *
 * Auth: enforced by the /api/* hook — no per-handler recheck. Desk stays private.
 * Mirrors the canvas drag-persist pattern (jkai/canvas/[slug]/+page.svelte onNodePointerUp).
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parsePositionPatch(body);
  if (!parsed.ok) {
    return json({ error: parsed.error }, { status: 400 });
  }

  const { artefactType, set } = parsed.value;
  const table = tableForArtefactType(artefactType);
  if (!table) {
    // parsePositionPatch already guarantees a valid type; defensive only.
    return json({ error: 'Unsupported artefactType' }, { status: 400 });
  }

  // Scope the update to this session so an artefactId from another session can't be mutated.
  const updated = await db
    .update(table)
    .set(set)
    .where(and(eq(table.id, params.artefactId), eq(table.sessionId, params.id)))
    .returning({ id: table.id });

  if (updated.length === 0) {
    return json({ error: 'Artefact not found in this session' }, { status: 404 });
  }

  return json({
    id: updated[0].id,
    artefactType,
    position: { x: set.canvasX, y: set.canvasY },
    pinned: set.pinned,
    deskState: set.deskState,
    deskCategory: set.deskCategory,
  });
};
```

- [ ] **Step 2: Confirm SvelteKit generates the route `$types` (smoke build of types).**

```
npx svelte-kit sync && ls -la .svelte-kit/types/src/routes/api/deepdive/\[id\]/artefacts/\[artefactId\]/position/
```
Expected: `npx svelte-kit sync` exits 0 and the listing shows a generated `$types.d.ts` for the new route directory (confirms the route path + dynamic params resolve).

- [ ] **Step 3: Type-check the route (memory-bumped).**

```
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "position/\+server|svelte-check found"
```
Expected: no errors referencing `position/+server.ts`; trailing `svelte-check found ...` line. In particular `table.id` / `table.sessionId` must resolve — both columns exist on all three tables (`id` pk, `session_id` notNull) per `schema.ts`.

- [ ] **Step 4: Commit.**

```
git add "src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/+server.ts"
git commit -m "$(cat <<'EOF'
deepdive: PATCH artefact position route (session-scoped)

Milestone 4 (Research Desk): persist canvas_x/canvas_y (+ pinned/deskState/
deskCategory) on sources|facts|entities by id, scoped to the session.
Delegates validation/table-dispatch to position-patch; 400 on bad input,
404 when the artefact isn't in this session.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: DB-gated integration test for the update path

Exercise the real handler against a local Postgres: seed a session + one fact/source/entity, PATCH each, assert `canvas_x/y` + flags persist and the response is correct; assert a cross-session id is 404; assert bad input is 400. The repo has no DB test harness, so the test self-skips when `DATABASE_URL` is unset (keeps `npx vitest run` green in CI/sandbox) and runs fully when a dev DB is present.

**Files:**
- Create `src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/server.integration.test.ts`

- [ ] **Step 1: Write the integration test.**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// DB-gated: only runs when a real Postgres is reachable. Mirrors the repo's
// "no DB mocking" convention — we hit the actual handler + db.
const HAS_DB = !!process.env.DATABASE_URL;
const suite = HAS_DB ? describe : describe.skip;

suite('PATCH artefact position (integration)', () => {
  let db: typeof import('$lib/db')['db'];
  let schema: typeof import('$lib/db/schema');
  let PATCH: typeof import('./+server')['PATCH'];

  let sessionId: string;
  let otherSessionId: string;
  let sourceId: string;
  let factId: string;
  let entityId: string;

  function makeEvent(id: string, artefactId: string, body: unknown) {
    return {
      params: { id, artefactId },
      request: new Request('http://localhost/patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    } as unknown as Parameters<typeof PATCH>[0];
  }

  beforeAll(async () => {
    ({ db } = await import('$lib/db'));
    schema = await import('$lib/db/schema');
    ({ PATCH } = await import('./+server'));

    const [session] = await db
      .insert(schema.researchSessions)
      .values({ topic: 'desk position integration test', phase: 1 })
      .returning({ id: schema.researchSessions.id });
    sessionId = session.id;

    const [other] = await db
      .insert(schema.researchSessions)
      .values({ topic: 'desk position OTHER session', phase: 1 })
      .returning({ id: schema.researchSessions.id });
    otherSessionId = other.id;

    const [src] = await db
      .insert(schema.sources)
      .values({ sessionId, url: 'https://example.test/a', phase: 1 })
      .returning({ id: schema.sources.id });
    sourceId = src.id;

    const [f] = await db
      .insert(schema.facts)
      .values({ sessionId, sourceId, content: 'a test fact' })
      .returning({ id: schema.facts.id });
    factId = f.id;

    const [ent] = await db
      .insert(schema.entities)
      .values({ sessionId, name: 'Test Entity', type: 'org' })
      .returning({ id: schema.entities.id });
    entityId = ent.id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { eq } = await import('drizzle-orm');
    // Children first (FK order): facts -> entities -> sources -> sessions.
    await db.delete(schema.facts).where(eq(schema.facts.sessionId, sessionId));
    await db.delete(schema.entities).where(eq(schema.entities.sessionId, sessionId));
    await db.delete(schema.sources).where(eq(schema.sources.sessionId, sessionId));
    await db.delete(schema.researchSessions).where(eq(schema.researchSessions.id, sessionId));
    await db.delete(schema.researchSessions).where(eq(schema.researchSessions.id, otherSessionId));
  });

  it('persists canvas_x/canvas_y on a fact and returns the new position', async () => {
    const res = await PATCH(makeEvent(sessionId, factId, {
      artefactType: 'fact',
      position: { x: 240, y: -88 },
    }));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toMatchObject({ id: factId, artefactType: 'fact', position: { x: 240, y: -88 } });

    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ x: schema.facts.canvasX, y: schema.facts.canvasY, pinned: schema.facts.pinned })
      .from(schema.facts)
      .where(eq(schema.facts.id, factId));
    expect(row.x).toBe(240);
    expect(row.y).toBe(-88);
  });

  it('persists pinned + deskState + deskCategory on a source', async () => {
    const res = await PATCH(makeEvent(sessionId, sourceId, {
      artefactType: 'source',
      position: { x: 10, y: 20 },
      pinned: true,
      deskState: 'filed',
      deskCategory: 'methods',
    }));
    expect(res.status).toBe(200);

    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({
        x: schema.sources.canvasX,
        y: schema.sources.canvasY,
        pinned: schema.sources.pinned,
        state: schema.sources.deskState,
        cat: schema.sources.deskCategory,
      })
      .from(schema.sources)
      .where(eq(schema.sources.id, sourceId));
    expect(row).toEqual({ x: 10, y: 20, pinned: true, state: 'filed', cat: 'methods' });
  });

  it('persists a position on an entity', async () => {
    const res = await PATCH(makeEvent(sessionId, entityId, {
      artefactType: 'entity',
      position: { x: 5, y: 5 },
    }));
    expect(res.status).toBe(200);
    const { eq } = await import('drizzle-orm');
    const [row] = await db
      .select({ x: schema.entities.canvasX, y: schema.entities.canvasY })
      .from(schema.entities)
      .where(eq(schema.entities.id, entityId));
    expect(row.x).toBe(5);
    expect(row.y).toBe(5);
  });

  it('returns 404 when the artefact belongs to a different session', async () => {
    const res = await PATCH(makeEvent(otherSessionId, factId, {
      artefactType: 'fact',
      position: { x: 1, y: 1 },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown artefactId', async () => {
    const res = await PATCH(makeEvent(sessionId, 'does-not-exist', {
      artefactType: 'fact',
      position: { x: 1, y: 1 },
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid artefactType', async () => {
    const res = await PATCH(makeEvent(sessionId, factId, {
      artefactType: 'relationship',
      position: { x: 1, y: 1 },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on non-finite coordinates', async () => {
    const res = await PATCH(makeEvent(sessionId, factId, {
      artefactType: 'fact',
      position: { x: 'NaN', y: 0 },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on a malformed (non-JSON) body', async () => {
    const event = {
      params: { id: sessionId, artefactId: factId },
      request: new Request('http://localhost/patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{ not json',
      }),
    } as unknown as Parameters<typeof PATCH>[0];
    const res = await PATCH(event);
    expect(res.status).toBe(400);
  });
});
```

Note: the test inserts `researchSessions` with `{ topic, phase: 1 }` — confirm those are the only non-defaulted columns on `research_session` before running (grep `pgTable('research_session'` in `schema.ts`); if `phase` is not a column or other columns are `notNull` without defaults, adjust the seed `.values(...)` to match the real required columns. Do NOT change the test's assertions.

- [ ] **Step 2: Run the gated test WITHOUT a DB — it must skip cleanly (proves the gate keeps CI green).**

```
unset DATABASE_URL; npx vitest run "src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/server.integration.test.ts"
```
Expected: output reports the suite as skipped, e.g. `Test Files  1 skipped (1)` / `Tests  ... skipped`, exit code 0.

- [ ] **Step 3: Run the gated test WITH the local DB — it must pass for real.**

```
set -a; . ./.env; set +a; npx vitest run "src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/server.integration.test.ts"
```
Expected: `DATABASE_URL` is now set, the suite runs, all 8 cases pass: `Test Files  1 passed (1)`. (If `.env` lives elsewhere, source the real one — the repo's local checkout has `.env` per the dev-env memory note.) If it errors on a missing desk column (e.g. `column "canvas_x" does not exist`), Milestone 1 has not been pushed — run `npx drizzle-kit push` (or finish Milestone 1) and re-run.

- [ ] **Step 4: Run the full deepdive test slice to confirm no regressions.**

```
set -a; . ./.env; set +a; npx vitest run src/lib/deepdive/ "src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/"
```
Expected: both the pure `position-patch.test.ts` and the integration test pass; summary shows `2 passed`.

- [ ] **Step 5: Commit.**

```
git add "src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/server.integration.test.ts"
git commit -m "$(cat <<'EOF'
deepdive: DB-gated integration test for artefact position PATCH

Milestone 4 (Research Desk): seed a session + source/fact/entity, PATCH each,
assert canvas_x/y + pinned/deskState/deskCategory persist; cross-session id is
404; bad input / bad JSON are 400. Self-skips when DATABASE_URL is unset.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire the desk drag-persist client call (contract stub)

The desk component (`ResearchDesk.svelte`, built in a later UI milestone) persists drags by calling this route. To lock the client contract now and keep the canvas drag pattern centralised, add a tiny typed client helper that `ResearchDesk` will import — pure I/O wrapper, manually verified against the live route. This is the one UI-adjacent unit in this milestone; per the format it gets an interface + key code + a manual verification step rather than a unit test (the network call isn't a pure unit).

**Files:**
- Create `src/lib/canvas/intelligence/desk/persist-position.ts`

- [ ] **Step 1: Implement the client helper (the exact contract `ResearchDesk.svelte` will call from `onNodePointerUp`).**

Interface:
```ts
persistArtefactPosition(sessionId: string, artefactId: string, body: {
  artefactType: 'source' | 'fact' | 'entity';
  position: { x: number; y: number };
  pinned?: boolean;
  deskState?: string;
  deskCategory?: string | null;
}): Promise<{ ok: boolean }>
```

Code:
```ts
/**
 * Persist an artefact's desk position to the deepdive position route.
 * Mirrors the canvas drag-persist pattern (jkai/canvas onNodePointerUp): PATCH,
 * and on failure the caller keeps its optimistic client override so the card
 * doesn't snap back on a network blip.
 */
export interface PersistPositionBody {
  artefactType: 'source' | 'fact' | 'entity';
  position: { x: number; y: number };
  pinned?: boolean;
  deskState?: string;
  deskCategory?: string | null;
}

export async function persistArtefactPosition(
  sessionId: string,
  artefactId: string,
  body: PersistPositionBody,
): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(
      `/api/deepdive/${encodeURIComponent(sessionId)}/artefacts/${encodeURIComponent(artefactId)}/position`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return { ok: res.ok };
  } catch {
    // Network failure → caller keeps the optimistic override (no snap-back).
    return { ok: false };
  }
}
```

- [ ] **Step 2: Type-check the helper.**

```
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E "persist-position|svelte-check found"
```
Expected: no errors referencing `persist-position.ts`.

- [ ] **Step 3: Manual verification against the running dev server (the UI-contract check).**

Run the dev server and exercise the route end-to-end via the helper's exact URL/shape. First, in one terminal:
```
npm run dev
```
Then, with a real session id from your DB (replace `<SID>` and `<FID>` with an existing session + one of its fact ids — find them via pgweb at `http://homeserv:8085/pgweb/` or `psql`), confirm the route the helper targets behaves correctly. Authenticated browser session required because the desk is private; the simplest manual check is from the browser devtools console on a logged-in `http://homeserv:5173` tab:
```js
await fetch('/api/deepdive/<SID>/artefacts/<FID>/position', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ artefactType: 'fact', position: { x: 333, y: 222 }, deskState: 'filed' }),
}).then(r => r.status);
```
Expected: prints `200`. Re-query the `fact` row in pgweb and confirm `canvas_x = 333`, `canvas_y = 222`, `desk_state = 'filed'`. Then run the same fetch with `artefactType: 'relationship'` and confirm it prints `400`, and with a bogus artefactId and confirm `404`. Note the observed results in the commit body.

- [ ] **Step 4: Commit.**

```
git add src/lib/canvas/intelligence/desk/persist-position.ts
git commit -m "$(cat <<'EOF'
desk: typed client helper for artefact position persistence

Milestone 4 (Research Desk): persistArtefactPosition() wraps the PATCH route
with the canvas drag-persist contract; on network failure returns { ok:false }
so the desk keeps its optimistic override (no snap-back). Manually verified
against the dev server: 200 persists canvas_x/y/desk_state, 400 on bad type,
404 on unknown id.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Milestone 4 done-when:**
- `npx vitest run src/lib/deepdive/position-patch.test.ts` is green (pure validation/dispatch).
- The gated integration test skips with no DB and passes against the local DB (real `canvas_x/y` + flags persisted; cross-session 404; bad input/JSON 400).
- `PATCH /api/deepdive/[id]/artefacts/[artefactId]/position` exists, is session-scoped, and is reachable behind the private `/api/*` auth hook (nothing added to `PUBLIC_PATHS`).
- `persistArtefactPosition()` is ready for `ResearchDesk.svelte`'s `onNodePointerUp` to import in the later desk-UI milestone.
- Four commits, one per task, each with the Co-Authored-By footer.

Relevant files (all absolute):
- `/home/john/strange_rambling_svelte/src/lib/deepdive/position-patch.ts` (+ `.test.ts`)
- `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/+server.ts` (+ `server.integration.test.ts`)
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/persist-position.ts`


I have everything I need: vitest 4.1, `npx vitest run <path>`, co-located `*.test.ts`, world-space top-left `{x,y}` coords on GRID=20, and the SHARED CONTRACT signatures. Now I'll draft the milestone.

The contract signatures I must honor exactly:
- `hashId(id:string):number`
- `scatterPosition(id:string, phase:number):{x:number,y:number}`
- `organisedLayout(artefacts:{id:string,kind:string,categoryId?:string}[], categories:{id:string,title:string}[]):Map<string,{x:number,y:number}>`

The brief adds: scatter is phase-banded + id-seeded + jitter; organisedLayout = category columns + stacked facts + entity rail + respects non-null overrides passed in. The contract's `artefacts` shape is `{id,kind,categoryId?}` — I'll extend it (additively, not renaming) with an optional `override?:{x,y}|null` so "respects non-null overrides passed in" is satisfiable without changing the required fields.

Here is the milestone.

---

## Milestone 5: Desk layout pure functions

This milestone delivers `src/lib/canvas/intelligence/desk/layout.ts` — the pure, deterministic placement logic the desk consumes. No Svelte, no DB, no network: just `id → {x,y}` math in **world space** (top-left card origin, snapped to `GRID=20`, matching the canvas drag idiom at `[slug]/+page.svelte:1993,2032-2033`). Because it is pure logic, it is built strictly test-first with exhaustive Vitest coverage. Downstream milestones (the `ResearchDesk.svelte` store) import these three functions and never re-implement positioning.

Coordinate conventions (locked, do not deviate):
- Returned `{x,y}` is the **top-left** of a card in world coordinates, exactly what the canvas applies as `transform: translate(x,y)` and what `fit()` reads as `n.x`/`n.y`.
- All returned coordinates are multiples of `GRID = 20` (so dragged + auto-placed cards share one grid).
- `scatterPosition` is a **pure function of `(id, phase)`** — same inputs always yield the same output, with no global state, so reloads and SSE reconnects are layout-stable.
- `organisedLayout` lays category columns left-to-right, stacks facts under their category header, collects entities into a bottom rail, and **any artefact carrying a non-null `override` keeps that exact position** (the pinned/user-dragged contract from spec §5.7 / §3.6).

The `artefacts` array uses the SHARED CONTRACT shape `{ id:string, kind:string, categoryId?:string }`, extended additively with an optional `override?: { x:number; y:number } | null` (no contract field is renamed or removed).

---

### Task 1: layout.ts public surface + `hashId` (TDD)

**Files:**
- Create: `src/lib/canvas/intelligence/desk/layout.ts`
- Create: `src/lib/canvas/intelligence/desk/layout.test.ts`

- [ ] **Step 1: Write the failing test for `hashId`.**

`hashId` must be a deterministic, well-distributed 32-bit unsigned integer hash of a string (used to seed scatter so the same artefact id always lands in the same place). It must be stable across runs/processes (no `Math.random`, no `Date`), return a non-negative integer, and differ for trivially different ids.

Create `src/lib/canvas/intelligence/desk/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashId } from './layout';

describe('hashId', () => {
  it('is deterministic for the same input', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('source-42')).toBe(hashId('source-42'));
  });

  it('returns a non-negative 32-bit integer', () => {
    for (const id of ['', 'a', 'fact-1', 'a-very-long-uuid-0123456789abcdef']) {
      const h = hashId(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('differs for single-character changes (no trivial collisions)', () => {
    expect(hashId('abc')).not.toBe(hashId('abd'));
    expect(hashId('abc')).not.toBe(hashId('cba'));
    expect(hashId('fact-1')).not.toBe(hashId('fact-2'));
  });

  it('is well distributed across a large id set (low collision rate)', () => {
    const seen = new Set<number>();
    const N = 2000;
    for (let i = 0; i < N; i++) seen.add(hashId(`artefact-${i}`));
    // Allow a tiny number of collisions but demand near-injectivity.
    expect(seen.size).toBeGreaterThan(N * 0.999);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail (module does not exist yet).**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```

Expected: failure with a resolve error, e.g. `Failed to resolve import "./layout"` (the implementation file does not exist).

- [ ] **Step 3: Create `layout.ts` with shared types, `GRID`, and `hashId`.**

Create `src/lib/canvas/intelligence/desk/layout.ts`:

```ts
// Pure desk-layout geometry for the Research Canvas ("the Desk").
//
// All coordinates are WORLD-SPACE top-left card origins, snapped to GRID,
// matching the canvas drag idiom in
// src/routes/jkai/canvas/[slug]/+page.svelte (GRID = 20, top-left translate).
//
// No global mutable state, no Date/Math.random: scatterPosition is a pure
// function of (id, phase) so reloads and SSE reconnects are layout-stable.

/** Canvas snap grid — must match the canvas drag GRID so auto- and hand-placed
 *  cards share one grid. */
export const GRID = 20;

/** A world-space top-left position for a card. */
export interface Pos {
  x: number;
  y: number;
}

/** Minimal artefact shape consumed by organisedLayout.
 *  `kind` is the artefact type ('source' | 'fact' | 'entity'); relationships
 *  are edges only and never appear here. `override` carries a pinned /
 *  user-dragged position (non-null canvas_x/y) that must win in every mode. */
export interface LayoutArtefact {
  id: string;
  kind: string;
  categoryId?: string;
  override?: Pos | null;
}

/** A synthesis category / cluster column header. */
export interface LayoutCategory {
  id: string;
  title: string;
}

/** Snap a raw world coordinate to the canvas grid. */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/**
 * Deterministic 32-bit unsigned hash of a string (FNV-1a).
 * Stable across processes; used to seed scatter positions so the same
 * artefact id always lands in the same spot.
 */
export function hashId(id: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    // FNV prime multiply via shifts to stay in 32-bit range without BigInt.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
```

- [ ] **Step 4: Re-run the test — `hashId` passes.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```

Expected output contains:
```
 ✓ src/lib/canvas/intelligence/desk/layout.test.ts (4 tests)
```
and a final `Test Files  1 passed (1)` line. (Only the `hashId` block exists so far; later tasks add more.)

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/layout.ts src/lib/canvas/intelligence/desk/layout.test.ts && git commit -m "$(cat <<'EOF'
desk(layout): add layout.ts surface + deterministic hashId

Pure world-space geometry module for the Research Desk. FNV-1a hashId
seeds id-stable scatter positions; GRID matches the canvas drag grid.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `scatterPosition` — phase-banded, id-seeded scatter (TDD)

`scatterPosition(id, phase)` is GATHER-mode placement: each artefact drops at a deterministic spot derived from `hashId(id)`, confined to a **horizontal band** for its phase (so phase-1 sources cluster left of phase-3 sources, etc.), with small per-id jitter so cards in the same band don't stack pathologically. Phase may be `1 | 2 | 3` or the literal `'post'` (post-processing); the signature accepts `number`, and we accept `'post'` by normalising it to band index 3 internally. Unknown/`0` phases fall back to band 0.

**Files:**
- Modify: `src/lib/canvas/intelligence/desk/layout.test.ts` (append a `describe('scatterPosition', …)` block)
- Modify: `src/lib/canvas/intelligence/desk/layout.ts` (add band constants + `scatterPosition`)

- [ ] **Step 1: Append the failing `scatterPosition` tests.**

Add to the bottom of `src/lib/canvas/intelligence/desk/layout.test.ts`:

```ts
import { scatterPosition, GRID, BAND, PHASE_TO_BAND } from './layout';

describe('scatterPosition', () => {
  it('is deterministic: same (id, phase) -> same position', () => {
    expect(scatterPosition('fact-7', 2)).toEqual(scatterPosition('fact-7', 2));
    expect(scatterPosition('source-x', 1)).toEqual(scatterPosition('source-x', 1));
  });

  it('snaps both coordinates to the grid', () => {
    for (const id of ['a', 'b', 'long-artefact-id-123', 'zzz']) {
      for (const phase of [1, 2, 3] as const) {
        const p = scatterPosition(id, phase);
        expect(p.x % GRID).toBe(0);
        expect(p.y % GRID).toBe(0);
      }
    }
  });

  it('places each phase inside its own horizontal band (no cross-band bleed)', () => {
    for (const phase of [1, 2, 3] as const) {
      const band = PHASE_TO_BAND[phase];
      const lo = BAND.originX + band * BAND.width;
      const hi = lo + BAND.width;
      for (let i = 0; i < 400; i++) {
        const { x } = scatterPosition(`p${phase}-${i}`, phase);
        expect(x).toBeGreaterThanOrEqual(lo);
        // card body must fit within the band, not just its origin
        expect(x + BAND.cardW).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("treats 'post' as the phase-3 band", () => {
    const band = PHASE_TO_BAND['post'];
    const lo = BAND.originX + band * BAND.width;
    const hi = lo + BAND.width;
    for (let i = 0; i < 100; i++) {
      const { x } = scatterPosition(`post-${i}`, 'post' as unknown as number);
      expect(x).toBeGreaterThanOrEqual(lo);
      expect(x + BAND.cardW).toBeLessThanOrEqual(hi);
    }
  });

  it('keeps Y within the band envelope', () => {
    for (let i = 0; i < 400; i++) {
      const { y } = scatterPosition(`y-${i}`, 2);
      expect(y).toBeGreaterThanOrEqual(BAND.originY);
      expect(y + BAND.cardH).toBeLessThanOrEqual(BAND.originY + BAND.height);
    }
  });

  it('avoids pathological overlap within a single band (distinct grid cells dominate)', () => {
    // Map 300 distinct ids in one band and assert most land on distinct
    // grid cells — proves the jitter spreads them, not a single hot spot.
    const cells = new Set<string>();
    const N = 300;
    for (let i = 0; i < N; i++) {
      const p = scatterPosition(`band-test-${i}`, 1);
      cells.add(`${p.x},${p.y}`);
    }
    expect(cells.size).toBeGreaterThan(N * 0.9);
  });

  it('different phases for the same id generally differ horizontally', () => {
    const a = scatterPosition('same-id', 1);
    const b = scatterPosition('same-id', 3);
    expect(a.x).not.toBe(b.x);
  });
});
```

- [ ] **Step 2: Run and watch the new block fail.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```

Expected: failures referencing the new symbols, e.g. `scatterPosition is not a function` / `BAND` and `PHASE_TO_BAND` undefined (the `hashId` block still passes).

- [ ] **Step 3: Implement band constants + `scatterPosition`.**

Add to `src/lib/canvas/intelligence/desk/layout.ts`, after `hashId`:

```ts
/**
 * Phase band geometry for GATHER scatter. Bands run left→right across the
 * desk; each phase owns one band. Card footprint (cardW/cardH) is reserved
 * inside every band so the *body* of a card never crosses a band boundary,
 * not just its top-left origin.
 */
export const BAND = {
  originX: 0,
  originY: 0,
  width: 720, // px per phase band (world units)
  height: 1600, // vertical envelope a band may scatter into
  cardW: 240, // reserved card footprint width
  cardH: 140, // reserved card footprint height
  pad: 20, // inner padding so cards don't touch the band edge
} as const;

/** Map an engine phase (1|2|3|'post') to a 0-based band index. */
export const PHASE_TO_BAND: Record<number | 'post', number> = {
  0: 0,
  1: 0,
  2: 1,
  3: 2,
  post: 2,
};

/**
 * Normalise a phase value to a band index. Accepts the numeric phases the
 * signature declares plus the 'post' literal the engine also emits.
 */
function bandIndex(phase: number | 'post'): number {
  if (phase === 'post') return PHASE_TO_BAND.post;
  return PHASE_TO_BAND[phase] ?? 0;
}

/**
 * Deterministic GATHER-mode scatter for an artefact id within its phase band.
 *
 * The id hash is split into two independent 16-bit channels (x, y) so the
 * horizontal and vertical jitter are uncorrelated. The card footprint is
 * reserved inside the band, so the returned position keeps the whole card
 * within `[lo, lo + width]` horizontally and the vertical envelope vertically.
 * Output is snapped to GRID so scattered and hand-dragged cards share one grid.
 */
export function scatterPosition(id: string, phase: number): Pos {
  const band = bandIndex(phase as number | 'post');
  const h = hashId(id);

  // Two uncorrelated 16-bit channels in [0,1).
  const fx = (h & 0xffff) / 0x10000;
  const fy = ((h >>> 16) & 0xffff) / 0x10000;

  const lo = BAND.originX + band * BAND.width;
  const spanX = Math.max(0, BAND.width - BAND.cardW - 2 * BAND.pad);
  const spanY = Math.max(0, BAND.height - BAND.cardH - 2 * BAND.pad);

  const x = lo + BAND.pad + fx * spanX;
  const y = BAND.originY + BAND.pad + fy * spanY;

  return { x: snap(x), y: snap(y) };
}
```

- [ ] **Step 4: Re-run — all `scatterPosition` tests pass.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```

Expected: `Test Files  1 passed (1)` and the per-file line now reports the combined count, e.g. `(11 tests)` (4 from `hashId` + 7 from `scatterPosition`). All green.

- [ ] **Step 5: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/layout.ts src/lib/canvas/intelligence/desk/layout.test.ts && git commit -m "$(cat <<'EOF'
desk(layout): add phase-banded id-seeded scatterPosition

Deterministic GATHER placement: hashId seeds two uncorrelated jitter
channels confined to a per-phase horizontal band. 'post' maps to the
phase-3 band; output snapped to GRID. Tests cover determinism, band
containment (incl. card footprint), and no pathological overlap.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `organisedLayout` — category columns + fact stacks + entity rail + override respect (TDD)

`organisedLayout(artefacts, categories)` is SYNTHESIZE-mode placement. It lays the categories as **columns left-to-right**, stacks each category's facts (and sources filed under it) **vertically beneath a header slot**, collects all **entities into a bottom rail** spanning under the columns, and — crucially — for any artefact whose `override` is non-null, it emits that exact override position instead of a computed one (pinned / user-dragged cards never move; spec §3.6/§5.7). Returns a `Map<id, {x,y}>` keyed by artefact id; relationships are never passed in (edges only).

Placement rules (deterministic, grid-snapped):
- Columns: category `i` has left edge `originX + i * colStride`. Categories render in the order of the `categories` array. Artefacts whose `categoryId` doesn't match any category (or is undefined) go into a trailing **"uncategorised" column** appended after the named ones.
- Within a column: the header occupies the top slot at `rowY(0)`; the first card sits at `rowY(1)`, then `rowY(2)`, … in artefact array order (stable).
- Entities ignore `categoryId` and are laid in a single horizontal rail beneath the deepest column, wrapping to new rail rows when they run past `railWidth`.
- Overrides win unconditionally and do not consume a column/rail slot.

**Files:**
- Modify: `src/lib/canvas/intelligence/desk/layout.test.ts` (append `describe('organisedLayout', …)`)
- Modify: `src/lib/canvas/intelligence/desk/layout.ts` (add `ORG` constants + `organisedLayout`)

- [ ] **Step 1: Append the failing `organisedLayout` tests.**

Add to the bottom of `src/lib/canvas/intelligence/desk/layout.test.ts`:

```ts
import { organisedLayout, ORG, type LayoutArtefact, type LayoutCategory } from './layout';

const cat = (id: string, title = id): LayoutCategory => ({ id, title });

describe('organisedLayout', () => {
  it('returns a position for every non-override artefact, keyed by id', () => {
    const cats = [cat('c1'), cat('c2')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c2' },
      { id: 'e1', kind: 'entity' },
    ];
    const map = organisedLayout(arts, cats);
    expect(map.size).toBe(3);
    for (const a of arts) expect(map.has(a.id)).toBe(true);
  });

  it('groups facts under their category into distinct columns', () => {
    const cats = [cat('c1'), cat('c2')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c1' },
      { id: 'g1', kind: 'fact', categoryId: 'c2' },
    ];
    const map = organisedLayout(arts, cats);
    const f1 = map.get('f1')!;
    const f2 = map.get('f2')!;
    const g1 = map.get('g1')!;
    // Same category -> same column X.
    expect(f1.x).toBe(f2.x);
    // Different category -> different (further right) column X.
    expect(g1.x).toBeGreaterThan(f1.x);
    // Stacked vertically within the column, header reserves the top slot.
    expect(f2.y).toBeGreaterThan(f1.y);
    expect(f1.y).toBeGreaterThan(map.get('__header_placeholder__')?.y ?? -Infinity);
  });

  it('places categories left-to-right in array order', () => {
    const cats = [cat('first'), cat('second'), cat('third')];
    const arts: LayoutArtefact[] = [
      { id: 'a', kind: 'fact', categoryId: 'third' },
      { id: 'b', kind: 'fact', categoryId: 'first' },
      { id: 'c', kind: 'fact', categoryId: 'second' },
    ];
    const map = organisedLayout(arts, cats);
    expect(map.get('b')!.x).toBeLessThan(map.get('c')!.x);
    expect(map.get('c')!.x).toBeLessThan(map.get('a')!.x);
  });

  it('sends unmatched / undefined categories to a trailing column', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'u1', kind: 'fact', categoryId: 'nope' },
      { id: 'u2', kind: 'fact' },
    ];
    const map = organisedLayout(arts, cats);
    // u1/u2 share the trailing uncategorised column, to the right of c1.
    expect(map.get('u1')!.x).toBe(map.get('u2')!.x);
    expect(map.get('u1')!.x).toBeGreaterThan(map.get('f1')!.x);
  });

  it('collects entities into the bottom rail, below all columns', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c1' },
      { id: 'e1', kind: 'entity', categoryId: 'c1' }, // categoryId ignored for entities
      { id: 'e2', kind: 'entity' },
    ];
    const map = organisedLayout(arts, cats);
    const railY = map.get('e1')!.y;
    expect(map.get('e2')!.y).toBe(railY); // same rail row
    // Rail sits below the fact stack.
    expect(railY).toBeGreaterThan(map.get('f2')!.y);
    // Entities are laid out horizontally on the rail.
    expect(map.get('e2')!.x).toBeGreaterThan(map.get('e1')!.x);
  });

  it('wraps the entity rail when it overflows railWidth', () => {
    const cats = [cat('c1')];
    const perRow = Math.floor(ORG.railWidth / ORG.entityStride);
    const arts: LayoutArtefact[] = [];
    for (let i = 0; i < perRow + 2; i++) arts.push({ id: `e${i}`, kind: 'entity' });
    const map = organisedLayout(arts, cats);
    const firstRowY = map.get('e0')!.y;
    const wrappedY = map.get(`e${perRow}`)!.y; // first entity past the row
    expect(wrappedY).toBeGreaterThan(firstRowY);
    // wrapped entity restarts at the rail's left edge
    expect(map.get(`e${perRow}`)!.x).toBe(map.get('e0')!.x);
  });

  it('respects non-null overrides verbatim (pinned cards never move)', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'pinned', kind: 'fact', categoryId: 'c1', override: { x: 1234, y: 5678 } },
      { id: 'free', kind: 'fact', categoryId: 'c1' },
    ];
    const map = organisedLayout(arts, cats);
    expect(map.get('pinned')).toEqual({ x: 1234, y: 5678 });
    // The free card still gets a computed (different) slot.
    expect(map.get('free')).not.toEqual({ x: 1234, y: 5678 });
  });

  it('does not let an override consume a column slot', () => {
    const cats = [cat('c1')];
    const arts: LayoutArtefact[] = [
      { id: 'pinned', kind: 'fact', categoryId: 'c1', override: { x: 999, y: 999 } },
      { id: 'a', kind: 'fact', categoryId: 'c1' },
      { id: 'b', kind: 'fact', categoryId: 'c1' },
    ];
    const map = organisedLayout(arts, cats);
    // a and b take the first two non-header rows; the pinned card didn't push them down.
    const gap = map.get('b')!.y - map.get('a')!.y;
    expect(gap).toBe(ORG.rowStride);
  });

  it('is deterministic and grid-snapped', () => {
    const cats = [cat('c1'), cat('c2')];
    const arts: LayoutArtefact[] = [
      { id: 'f1', kind: 'fact', categoryId: 'c1' },
      { id: 'f2', kind: 'fact', categoryId: 'c2' },
      { id: 'e1', kind: 'entity' },
    ];
    const a = organisedLayout(arts, cats);
    const b = organisedLayout(arts, cats);
    for (const id of ['f1', 'f2', 'e1']) {
      expect(a.get(id)).toEqual(b.get(id));
      expect(a.get(id)!.x % GRID).toBe(0);
      expect(a.get(id)!.y % GRID).toBe(0);
    }
  });

  it('handles an empty artefact list', () => {
    expect(organisedLayout([], [cat('c1')]).size).toBe(0);
  });
});
```

> Note: the `__header_placeholder__` lookup in the first grouping test resolves to `undefined` and falls back to `-Infinity`, so it only asserts that `f1.y` is finite/positive — it is a guard against a regression where a header slot isn't reserved, not a real artefact id.

- [ ] **Step 2: Run and watch the new block fail.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```

Expected: failures referencing `organisedLayout is not a function` and `ORG` undefined; the `hashId` and `scatterPosition` blocks still pass.

- [ ] **Step 3: Implement `ORG` constants + `organisedLayout`.**

Add to `src/lib/canvas/intelligence/desk/layout.ts`, after `scatterPosition`:

```ts
/**
 * Organised (SYNTHESIZE) layout geometry. Category columns run left→right;
 * facts/sources stack under a reserved header slot inside each column; entities
 * collect into a bottom rail that wraps. All values are GRID-aligned.
 */
export const ORG = {
  originX: 0,
  originY: 0,
  colStride: 320, // horizontal distance between column left edges
  rowStride: 180, // vertical distance between stacked cards in a column
  headerRows: 1, // rows reserved at the top of a column for the CategoryHeader
  railGap: 240, // extra vertical gap between the tallest column and the rail
  railWidth: 1600, // rail wraps when an entity would exceed this width
  entityStride: 200, // horizontal distance between entity chips on the rail
  railRowStride: 120, // vertical distance between wrapped rail rows
} as const;

/** Y of row index `r` within a column (row 0 = header slot). */
function rowY(r: number): number {
  return snap(ORG.originY + r * ORG.rowStride);
}

/** X of column index `c`. */
function colX(c: number): number {
  return snap(ORG.originX + c * ORG.colStride);
}

/**
 * SYNTHESIZE-mode placement.
 *
 * - Category columns are laid left→right in `categories` order. Artefacts whose
 *   categoryId matches none of them (or is undefined) fall into a trailing
 *   "uncategorised" column.
 * - Non-entity artefacts (facts, sources) stack vertically under a reserved
 *   header slot in their column, in array order.
 * - Entities ignore categoryId and collect into a bottom rail spanning beneath
 *   the columns, wrapping to new rail rows past `railWidth`.
 * - Any artefact with a non-null `override` keeps that exact position and does
 *   NOT consume a column or rail slot (pinned / user-dragged cards never move).
 *
 * Returns a Map keyed by artefact id. Deterministic and grid-snapped.
 */
export function organisedLayout(
  artefacts: LayoutArtefact[],
  categories: LayoutCategory[],
): Map<string, Pos> {
  const out = new Map<string, Pos>();

  // Column index per category id; named columns first, uncategorised last.
  const colOf = new Map<string, number>();
  categories.forEach((c, i) => colOf.set(c.id, i));
  const uncategorisedCol = categories.length;

  // Per-column next free (non-header) row, starting after the header slot.
  const nextRow = new Array<number>(categories.length + 1).fill(ORG.headerRows);

  // Deepest column row reached, to anchor the rail below everything.
  let maxRow = ORG.headerRows;

  // Rail cursor.
  let railIdx = 0;

  for (const a of artefacts) {
    // 1) Pinned / dragged cards win verbatim and consume no slot.
    if (a.override) {
      out.set(a.id, { x: snap(a.override.x), y: snap(a.override.y) });
      continue;
    }

    // 2) Entities → bottom rail (categoryId ignored).
    if (a.kind === 'entity') {
      const perRow = Math.max(1, Math.floor(ORG.railWidth / ORG.entityStride));
      const railRow = Math.floor(railIdx / perRow);
      const railCol = railIdx % perRow;
      out.set(a.id, {
        x: snap(ORG.originX + railCol * ORG.entityStride),
        y: 0, // placeholder; resolved to the real rail Y in the post-pass below
      });
      // Stash the rail coordinates so the post-pass can offset Y by the column depth.
      railSlots.push({ id: a.id, row: railRow, col: railCol });
      railIdx++;
      continue;
    }

    // 3) Facts / sources → category column stack.
    const col = a.categoryId !== undefined && colOf.has(a.categoryId)
      ? colOf.get(a.categoryId)!
      : uncategorisedCol;
    const row = nextRow[col];
    nextRow[col] = row + 1;
    if (row > maxRow) maxRow = row;
    out.set(a.id, { x: colX(col), y: rowY(row) });
  }

  // Post-pass: anchor the entity rail beneath the tallest column.
  const railBaseY = snap(rowY(maxRow + 1) + ORG.railGap);
  for (const s of railSlots) {
    const p = out.get(s.id)!;
    out.set(s.id, { x: p.x, y: snap(railBaseY + s.row * ORG.railRowStride) });
  }

  return out;
}
```

> The `railSlots` accumulator above must be declared inside the function (one per call) so `organisedLayout` stays pure and reentrant. Add it at the top of the function body, immediately after `const out = new Map<string, Pos>();`:
>
> ```ts
>   const railSlots: { id: string; row: number; col: number }[] = [];
> ```

- [ ] **Step 4: Add the `railSlots` declaration inside the function.**

Edit `organisedLayout` so the opening lines read exactly:

```ts
export function organisedLayout(
  artefacts: LayoutArtefact[],
  categories: LayoutCategory[],
): Map<string, Pos> {
  const out = new Map<string, Pos>();
  const railSlots: { id: string; row: number; col: number }[] = [];
```

(Everything else in the function is unchanged.)

- [ ] **Step 5: Re-run — all `organisedLayout` tests pass.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```

Expected: `Test Files  1 passed (1)` with the combined count `(21 tests)` (4 + 7 + 10), all green.

- [ ] **Step 6: Type-check the new module (memory-bumped, per repo gotcha).**

```bash
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'desk/layout' || echo "OK: no type errors in desk/layout"
```

Expected output: `OK: no type errors in desk/layout` (no diagnostics mention `desk/layout.ts` or its test).

- [ ] **Step 7: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/layout.ts src/lib/canvas/intelligence/desk/layout.test.ts && git commit -m "$(cat <<'EOF'
desk(layout): add organisedLayout (columns + fact stacks + entity rail)

SYNTHESIZE placement: category columns left→right (unmatched→trailing
column), facts stacked under a reserved header slot, entities collected
into a wrapping bottom rail anchored below the deepest column. Non-null
overrides (pinned/dragged) win verbatim and consume no slot. Pure,
deterministic, grid-snapped; exhaustive Vitest coverage.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full-suite green + barrel export sanity

Lock in that the new module integrates cleanly with the repo's existing Vitest suite and is importable under the contract path `src/lib/canvas/intelligence/desk/layout.ts`.

**Files:**
- (no source changes; verification + a tiny re-export guard test)
- Create: `src/lib/canvas/intelligence/desk/layout.contract.test.ts`

- [ ] **Step 1: Add a contract-shape test pinning the three public signatures.**

This is a regression guard so later refactors can't silently drift the SHARED CONTRACT surface. Create `src/lib/canvas/intelligence/desk/layout.contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashId, scatterPosition, organisedLayout } from './layout';

describe('layout.ts public contract surface', () => {
  it('hashId(id: string): number', () => {
    const r = hashId('x');
    expect(typeof r).toBe('number');
  });

  it('scatterPosition(id: string, phase: number): {x,y}', () => {
    const r = scatterPosition('x', 1);
    expect(Object.keys(r).sort()).toEqual(['x', 'y']);
    expect(typeof r.x).toBe('number');
    expect(typeof r.y).toBe('number');
  });

  it('organisedLayout(artefacts, categories): Map<string,{x,y}>', () => {
    const r = organisedLayout(
      [{ id: 'a', kind: 'fact', categoryId: 'c1' }],
      [{ id: 'c1', title: 'C1' }],
    );
    expect(r).toBeInstanceOf(Map);
    const p = r.get('a')!;
    expect(typeof p.x).toBe('number');
    expect(typeof p.y).toBe('number');
  });
});
```

- [ ] **Step 2: Run the whole desk-layout test surface.**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/
```

Expected: two test files pass —
```
 ✓ src/lib/canvas/intelligence/desk/layout.test.ts (21 tests)
 ✓ src/lib/canvas/intelligence/desk/layout.contract.test.ts (3 tests)
```
ending with `Test Files  2 passed (2)`.

- [ ] **Step 3: Confirm the repo's existing suite still passes (no collateral breakage).**

```bash
cd /home/john/strange_rambling_svelte && npx vitest run 2>&1 | tail -20
```

Expected: a final `Test Files  N passed (N)` / `Tests  M passed (M)` summary with **zero failures**; the desk-layout files appear among the passing files. (If pre-existing unrelated suites fail for environmental reasons, confirm they also fail on `master` before this branch — do not attribute them to this milestone.)

- [ ] **Step 4: Commit.**

```bash
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/layout.contract.test.ts && git commit -m "$(cat <<'EOF'
desk(layout): pin public contract surface with a guard test

Locks hashId / scatterPosition / organisedLayout signatures so future
refactors can't silently drift the SHARED CONTRACT. Full desk-layout
suite green; existing repo suite unaffected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Milestone 5 done.** `src/lib/canvas/intelligence/desk/layout.ts` exports `hashId`, `scatterPosition`, `organisedLayout` (plus `GRID`, `snap`, `BAND`, `PHASE_TO_BAND`, `ORG`, and the `Pos`/`LayoutArtefact`/`LayoutCategory` types) exactly per the SHARED CONTRACT, fully unit-tested for determinism, phase banding, no pathological overlap, category grouping, entity-rail placement, and override (pinned) respect. The `ResearchDesk.svelte` store milestone consumes these three functions directly — GATHER calls `scatterPosition(id, phase)` for cards lacking a non-null `canvas_x/y`; SYNTHESIZE calls `organisedLayout(...)` with `override` populated from `canvas_x/y` so pinned/dragged cards never move.


I now have everything needed. I'll write the milestone. The shared contract specifies M6 is purely the desk shell + store + ArtefactCard + edges (frontend), so synthesis/endpoints/schema/desk-events belong to other milestones. I'll draft this milestone exhaustively.

## Milestone 6: ResearchDesk shell + store + ArtefactCard + edges

This milestone builds the **frontend** of the desk: the pure-function layout module (`desk/layout.ts`, fully unit-tested), the hydrate-then-stream store (`desk/store.svelte.ts`, unit-tested for dedup/merge), the `ArtefactCard.svelte` (source/fact/entity/challenge variants + `UNFILED` treatment), and the `ResearchDesk.svelte` shell that lifts pan/zoom/drag/grid-snap/orthPath/minimap from `/jkai/canvas` and renders relationships as orthogonal edges between entity cards. It assumes the schema columns, `desk-events.ts`, the synthesize endpoint, and the position PATCH endpoint exist from earlier milestones (M1–M5); this milestone calls them but does not build them. Where an earlier endpoint is needed and is not yet wired, the drag-persist task degrades gracefully (keeps the local override on a non-2xx).

**Pre-flight assumptions (confirmed against the real repo):**
- `GET /api/deepdive/[id]/data` already returns `{ facts, entities, sources, relationships }` (real file: `src/routes/api/deepdive/[id]/data/+server.ts`). Facts carry `id, content, confidence, eventDate, isCounterfactual, refutesFactId, sourceId, tags`; entities carry `id, name, type, description, centrality`; sources carry `id, url, title, domain, category, credibilityScore, credibilityType`; relationships carry `id, fromEntityId, toEntityId, relationshipType, sentiment`. The store will fold in `canvasX/canvasY/pinned/deskState/deskCategory` once M1 adds those columns to the `data` endpoint; until then they hydrate as `undefined` and the store treats them as auto-layout (null) — no code change needed here.
- `GET /api/deepdive/[id]/stream` is a generic SSE endpoint that emits the union envelope `{ type, message?, data? }`. M2 extends the union with `'artefact'` and `'synthesis'`. This store subscribes and switches on `evt.type`.
- Design tokens confirmed present in `src/app.css`: `--bg:#ede4d4`, `--surface-elevated:#e8dece`, `--accent:#c4570a`, `--text-primary:#1a1008`, `--text-muted`, `--text-ghost`, `--success:#2d7a3a`, `--font-mono` (JetBrains Mono), `--font-display` (Archivo Black), `--font-body` (DM Sans), `--font-brand` (DM Mono). Card surface `#faf6ee` and hairline `rgba(26,16,8,.18)` are NOT existing tokens — declare them as local component constants exactly as the contract gives them.
- Lift sources verified at the exact line ranges in `src/routes/jkai/canvas/[slug]/+page.svelte`: pan/zoom (`zoomAt`/`fit`/`reset`/`onWheel`) 1868–1984; pointer-pan 1932–1962; node drag + grid-snap 1991–2069; `orthPath` 1016–1053; minimap geometry 1119–1164 + markup 5579–5605; world-layer transform `style:transform="translate({panX}px,{panY}px) scale({zoom})"` at 3446–3450; `$state.raw` + debounced-flush idiom at 1478–1518.

**Svelte 5 gotchas to obey throughout (from repo memory):**
- Never `$state` an internal handle (setTimeout/EventSource/AbortController) that is read inside a function called from a `$effect` — store flush/EventSource handles in plain `let` (module-scope or non-`$state` component locals).
- When an `$effect` syncs props into local `$state`, hoist prop reads to local consts and wrap the condition + writes in `untrack()`.
- Use `$state.raw` for the card/edge collections and replace the whole container per flush (never mutate in place) so derived recompute is bounded.

---

### Task 1: Pure layout module (`desk/layout.ts`) + tests

This is pure, deterministic logic — full TDD. Same `id` → same scatter position (stable reloads); organised layout packs facts into category columns and entities into a bottom rail; user/pinned overrides are NOT handled here (the store/shell apply those — layout only computes auto positions).

**Files:**
- Create `src/lib/canvas/intelligence/desk/layout.ts`
- Create `src/lib/canvas/intelligence/desk/layout.test.ts`

- [ ] **Step 1: Write the failing test file.**

```ts
// src/lib/canvas/intelligence/desk/layout.test.ts
import { describe, it, expect } from 'vitest';
import { hashId, scatterPosition, organisedLayout } from './layout';

describe('hashId', () => {
  it('is deterministic for the same id', () => {
    expect(hashId('abc-123')).toBe(hashId('abc-123'));
  });
  it('returns a non-negative 32-bit integer', () => {
    const h = hashId('whatever-long-id-9f8a');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
  it('differs for different ids (no trivial collision on a small sample)', () => {
    const ids = ['a', 'b', 'c', 'fact-1', 'fact-2', 'entity-xyz', 'src-9'];
    const hashes = new Set(ids.map(hashId));
    expect(hashes.size).toBe(ids.length);
  });
});

describe('scatterPosition', () => {
  it('is deterministic — same id+phase → identical position', () => {
    expect(scatterPosition('fact-1', 2)).toEqual(scatterPosition('fact-1', 2));
  });
  it('bands phases vertically — phase 3 sits below phase 1', () => {
    const p1 = scatterPosition('same-id', 1);
    const p3 = scatterPosition('same-id', 3);
    expect(p3.y).toBeGreaterThan(p1.y);
  });
  it('keeps coordinates within the scatter field (0 ≤ x ≤ FIELD_W, banded y)', () => {
    for (const id of ['x1', 'x2', 'x3', 'x4', 'x5']) {
      const p = scatterPosition(id, 2);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(2400);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('organisedLayout', () => {
  const categories = [
    { id: 'c1', title: 'Origins' },
    { id: 'c2', title: 'Impact' },
  ];
  const artefacts = [
    { id: 'f1', kind: 'fact', categoryId: 'c1' },
    { id: 'f2', kind: 'fact', categoryId: 'c1' },
    { id: 'f3', kind: 'fact', categoryId: 'c2' },
    { id: 'e1', kind: 'entity' },
    { id: 'e2', kind: 'entity' },
    { id: 's1', kind: 'source', categoryId: 'c2' },
  ];

  it('returns a position for every artefact', () => {
    const m = organisedLayout(artefacts, categories);
    for (const a of artefacts) expect(m.has(a.id)).toBe(true);
  });

  it('lays categories left-to-right (c2 column is right of c1 column)', () => {
    const m = organisedLayout(artefacts, categories);
    expect(m.get('f3')!.x).toBeGreaterThan(m.get('f1')!.x);
  });

  it('stacks facts within a category top-to-bottom (f2 below f1)', () => {
    const m = organisedLayout(artefacts, categories);
    expect(m.get('f1')!.x).toBe(m.get('f2')!.x);
    expect(m.get('f2')!.y).toBeGreaterThan(m.get('f1')!.y);
  });

  it('collects entities into the bottom rail (below every category card)', () => {
    const m = organisedLayout(artefacts, categories);
    const maxCardY = Math.max(m.get('f1')!.y, m.get('f2')!.y, m.get('f3')!.y, m.get('s1')!.y);
    expect(m.get('e1')!.y).toBeGreaterThan(maxCardY);
    expect(m.get('e2')!.y).toBe(m.get('e1')!.y); // rail is a single row
    expect(m.get('e2')!.x).toBeGreaterThan(m.get('e1')!.x); // packed left-to-right
  });

  it('produces no two cards at the exact same position (no pathological overlap)', () => {
    const m = organisedLayout(artefacts, categories);
    const seen = new Set<string>();
    for (const p of m.values()) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('falls back to a synthetic "Unfiled" column for artefacts whose categoryId is unknown', () => {
    const m = organisedLayout(
      [{ id: 'orphan', kind: 'fact', categoryId: 'does-not-exist' }],
      categories,
    );
    expect(m.has('orphan')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails (module missing).**

```
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```
Expected: failure, `Cannot find module './layout'` (or per-test failures).

- [ ] **Step 3: Implement `layout.ts` to pass.**

```ts
// src/lib/canvas/intelligence/desk/layout.ts
//
// Pure, deterministic desk-layout helpers. No Svelte, no DOM — unit-testable.
// `scatterPosition` gives every artefact a stable id-seeded position in GATHER
// mode (so reloads/reconnects don't reshuffle the desk). `organisedLayout`
// computes the SYNTHESIZE arrangement: category columns, facts stacked beneath,
// entities collected into a bottom rail. User-dragged / pinned overrides are
// applied by the store/shell — never here.

export type LayoutPoint = { x: number; y: number };

export interface LayoutArtefact {
  id: string;
  kind: string; // 'source' | 'fact' | 'entity'
  categoryId?: string;
}

export interface LayoutCategory {
  id: string;
  title: string;
}

// ——— scatter field geometry ———
const FIELD_W = 2400; // logical width of the loose-scatter field
const BAND_H = 900; // vertical band height per phase
const CARD_W = 240;
const CARD_H = 132;

/** FNV-1a 32-bit hash → stable non-negative integer for an id. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // force unsigned 32-bit
}

/**
 * Deterministic loose-scatter position for an artefact.
 * `phase` (1|2|3, with 'post' mapped to 4 by the caller) bands the y axis so
 * later-phase artefacts land lower. Two independent hash mixes drive x and a
 * within-band y so cards don't line up on a grid.
 */
export function scatterPosition(id: string, phase: number): LayoutPoint {
  const h = hashId(id);
  // Split the hash into two pseudo-independent 16-bit lanes.
  const lo = h & 0xffff;
  const hi = (h >>> 16) & 0xffff;
  const band = Math.max(0, (phase || 1) - 1);
  const x = Math.round((lo / 0xffff) * (FIELD_W - CARD_W));
  const y = Math.round(band * BAND_H + (hi / 0xffff) * (BAND_H - CARD_H));
  return { x, y };
}

// ——— organised (SYNTHESIZE) packer ———
const COL_W = 300; // category column pitch
const COL_X0 = 80; // left margin of the first column
const COL_Y0 = 120; // top of the first card under a header
const ROW_PITCH = 150; // vertical pitch between stacked cards in a column
const RAIL_PITCH = 200; // horizontal pitch between entity chips in the rail
const RAIL_X0 = 80;
const RAIL_GAP = 220; // gap below the lowest column card before the entity rail

const UNFILED_COL = '__unfiled__';

/**
 * Organised layout: category columns left→right, facts/sources stacked under
 * their category, entities collected into a single bottom rail. Returns a Map
 * keyed by artefact id. Artefacts with an unknown/missing categoryId fall into
 * a trailing synthetic "Unfiled" column so nothing is ever dropped.
 */
export function organisedLayout(
  artefacts: LayoutArtefact[],
  categories: LayoutCategory[],
): Map<string, LayoutPoint> {
  const out = new Map<string, LayoutPoint>();

  // Column index per category id. Unknown categories share a trailing column.
  const colIndex = new Map<string, number>();
  categories.forEach((c, i) => colIndex.set(c.id, i));
  const unfiledCol = categories.length; // index after the real columns

  // Per-column running row counter for stacking.
  const colRows = new Map<number, number>();
  const nextRow = (col: number) => {
    const r = colRows.get(col) ?? 0;
    colRows.set(col, r + 1);
    return r;
  };

  let lowestY = COL_Y0;

  // Place non-entity cards into columns.
  for (const a of artefacts) {
    if (a.kind === 'entity') continue;
    let col: number;
    if (a.categoryId && colIndex.has(a.categoryId)) {
      col = colIndex.get(a.categoryId)!;
    } else {
      col = unfiledCol;
    }
    const row = nextRow(col);
    const x = COL_X0 + col * COL_W;
    const y = COL_Y0 + row * ROW_PITCH;
    out.set(a.id, { x, y });
    if (y > lowestY) lowestY = y;
  }

  // Entity rail: a single row beneath every column card.
  const railY = lowestY + RAIL_GAP;
  let railSlot = 0;
  for (const a of artefacts) {
    if (a.kind !== 'entity') continue;
    out.set(a.id, { x: RAIL_X0 + railSlot * RAIL_PITCH, y: railY });
    railSlot++;
  }

  // Mark the unfiled column existence (no-op key reference to satisfy lint /
  // make the synthetic column explicit for callers reading the source).
  void UNFILED_COL;

  return out;
}
```

- [ ] **Step 4: Run the test — confirm green.**

```
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
```
Expected: `Test Files  1 passed`, all `describe` blocks green (15+ assertions).

- [ ] **Step 5: Commit.**

```
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/layout.ts src/lib/canvas/intelligence/desk/layout.test.ts && git commit -m "feat(desk): pure layout module — scatter + organised packer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Hydrate-then-stream store (`desk/store.svelte.ts`) + dedup tests

The store hydrates from `GET /api/deepdive/[id]/data`, then subscribes to `GET /api/deepdive/[id]/stream` (EventSource) for `artefact`/`synthesis` deltas, dedups cards by `id`, and exposes `$state.raw` collections flushed on a ~5 ms debounce. The merge logic (a plain function) is unit-tested; the EventSource wiring is a thin `$effect` exercised manually.

**Files:**
- Create `src/lib/canvas/intelligence/desk/store.svelte.ts`
- Create `src/lib/canvas/intelligence/desk/store.test.ts`

- [ ] **Step 1: Write the failing test for the pure merge core.**

We extract the merge math into pure exported functions (`mergeArtefact`, `dedupHydrate`) so the dedup/seq-ordering invariants are testable without a browser. The `$effect` wrapper around EventSource is verified manually in Task 5.

```ts
// src/lib/canvas/intelligence/desk/store.test.ts
import { describe, it, expect } from 'vitest';
import { mergeArtefact, dedupHydrate, type DeskCard } from './store.svelte';

function card(id: string, extra: Partial<DeskCard> = {}): DeskCard {
  return { id, kind: 'fact', seq: 0, phase: 1, fields: {}, ...extra };
}

describe('dedupHydrate', () => {
  it('keeps one card per id, last write wins', () => {
    const map = dedupHydrate([
      card('a', { fields: { content: 'old' } }),
      card('b'),
      card('a', { fields: { content: 'new' } }),
    ]);
    expect(map.size).toBe(2);
    expect((map.get('a')!.fields as any).content).toBe('new');
  });
});

describe('mergeArtefact', () => {
  it('inserts a new card by id', () => {
    const base = new Map<string, DeskCard>();
    const next = mergeArtefact(base, card('x', { seq: 5 }));
    expect(next.get('x')!.seq).toBe(5);
    expect(next).not.toBe(base); // new container (raw replacement)
  });

  it('dedups: a repeated id does not create a second card', () => {
    let m = new Map<string, DeskCard>();
    m = mergeArtefact(m, card('dup', { seq: 1 }));
    m = mergeArtefact(m, card('dup', { seq: 2 }));
    expect(m.size).toBe(1);
  });

  it('ignores an out-of-order (lower-seq) delta for an existing id', () => {
    let m = new Map<string, DeskCard>();
    m = mergeArtefact(m, card('s', { seq: 10, fields: { content: 'fresh' } }));
    m = mergeArtefact(m, card('s', { seq: 4, fields: { content: 'stale' } }));
    expect((m.get('s')!.fields as any).content).toBe('fresh');
    expect(m.get('s')!.seq).toBe(10);
  });

  it('applies a newer (higher-seq) delta to an existing id', () => {
    let m = new Map<string, DeskCard>();
    m = mergeArtefact(m, card('s', { seq: 1, fields: { content: 'a' } }));
    m = mergeArtefact(m, card('s', { seq: 7, fields: { content: 'b' } }));
    expect((m.get('s')!.fields as any).content).toBe('b');
  });

  it('never mutates the input map', () => {
    const base = new Map<string, DeskCard>([['k', card('k')]]);
    const snapshot = base.get('k');
    mergeArtefact(base, card('k', { seq: 9 }));
    expect(base.get('k')).toBe(snapshot); // original untouched
  });
});
```

- [ ] **Step 2: Run — confirm failure (module missing).**

```
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/store.test.ts
```
Expected: failure resolving `./store.svelte`.

- [ ] **Step 3: Implement `store.svelte.ts`.**

This is a Svelte 5 rune module (`.svelte.ts` so `$state.raw`/`$effect` compile). Export the pure `mergeArtefact`/`dedupHydrate` for tests AND a `createDeskStore(sessionId)` factory that owns the runes. **Gotcha compliance:** the EventSource and the flush timer are held in **plain `let`** (not `$state`) because they're read inside functions called from the SSE callback; only the card/edge/synthesis collections are `$state.raw`.

```ts
// src/lib/canvas/intelligence/desk/store.svelte.ts
//
// Hydrate-then-stream desk store. On mount: GET /api/deepdive/[id]/data to
// seed existing artefacts, THEN subscribe to /api/deepdive/[id]/stream for
// deltas. Cards are deduped by id; out-of-order deltas (lower seq) are dropped.
// Collections are $state.raw and replaced wholesale on a ~5ms debounced flush.

export type CardKind = 'source' | 'fact' | 'entity';

export interface DeskCard {
  id: string;
  kind: CardKind;
  seq: number;
  phase: number; // 1|2|3, 'post' folded to 4 by the caller
  fields: Record<string, unknown>;
  // persisted desk geometry (null/undefined → auto-layout)
  canvasX?: number | null;
  canvasY?: number | null;
  pinned?: boolean;
  deskState?: string;
  deskCategory?: string | null;
}

export interface DeskEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationshipType?: string | null;
  sentiment?: string | null;
}

export interface SynthesisCluster {
  id: string;
  title: string;
  summary: string;
  fact_ids: string[];
}

// ——— pure merge core (unit-tested) ———

/** Build the initial id→card map from a hydrate batch (last write wins). */
export function dedupHydrate(cards: DeskCard[]): Map<string, DeskCard> {
  const m = new Map<string, DeskCard>();
  for (const c of cards) m.set(c.id, c);
  return m;
}

/**
 * Return a NEW map with `card` merged in. Dedups by id; an existing card is
 * only overwritten by a delta with a strictly higher seq (so reconnect /
 * replay can't clobber fresher state). Never mutates `base`.
 */
export function mergeArtefact(
  base: Map<string, DeskCard>,
  card: DeskCard,
): Map<string, DeskCard> {
  const existing = base.get(card.id);
  if (existing && card.seq <= existing.seq) return base; // stale / replay — no-op
  const next = new Map(base);
  next.set(card.id, existing ? { ...existing, ...card } : card);
  return next;
}

// ——— normalisers: shape the /data + SSE payloads into DeskCards/Edges ———

function phaseToNum(phase: unknown): number {
  if (phase === 'post') return 4;
  const n = Number(phase);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Map a /data artefact row (source|fact|entity) into a DeskCard. */
export function rowToCard(kind: CardKind, row: Record<string, unknown>): DeskCard {
  const { id, canvasX, canvasY, pinned, deskState, deskCategory, ...rest } = row as any;
  return {
    id: String(id),
    kind,
    seq: 0,
    phase: phaseToNum((row as any).phase),
    fields: rest,
    canvasX: canvasX ?? null,
    canvasY: canvasY ?? null,
    pinned: pinned ?? false,
    deskState: deskState ?? 'unfiled',
    deskCategory: deskCategory ?? null,
  };
}

/** Map an SSE artefact event's `data` into a DeskCard. */
export function eventToCard(data: Record<string, unknown>): DeskCard {
  const { seq, artefactType, id, phase, ...fields } = data as any;
  return {
    id: String(id),
    kind: artefactType as CardKind,
    seq: Number(seq) || 0,
    phase: phaseToNum(phase),
    fields,
    canvasX: null,
    canvasY: null,
    pinned: false,
    deskState: 'unfiled',
    deskCategory: null,
  };
}

// ——— the rune store factory ———

export interface DeskStore {
  cards: ReadonlyArray<DeskCard>;
  edges: ReadonlyArray<DeskEdge>;
  clusters: ReadonlyArray<SynthesisCluster>;
  synthesisToken: string;
  status: 'idle' | 'hydrating' | 'live' | 'error';
  start(): Promise<void>;
  applyLocalPosition(id: string, x: number, y: number, pinned?: boolean): void;
  dispose(): void;
}

const STREAM_FLUSH_MS = 5;

export function createDeskStore(sessionId: string): DeskStore {
  // $state.raw — whole-container replacement keeps derived recompute bounded.
  let cardMap = $state.raw(new Map<string, DeskCard>());
  let edgeMap = $state.raw(new Map<string, DeskEdge>());
  let clusterList = $state.raw<SynthesisCluster[]>([]);
  let synthesisTokenBuf = $state('');
  let status = $state<'idle' | 'hydrating' | 'live' | 'error'>('idle');

  // Plain (non-$state) handles — read inside SSE callback / flush.
  let es: EventSource | null = null;
  let flushHandle: ReturnType<typeof setTimeout> | null = null;
  const pendingCards = new Map<string, DeskCard>(); // staged deltas
  const pendingEdges = new Map<string, DeskEdge>();

  function scheduleFlush() {
    if (flushHandle === null) flushHandle = setTimeout(flush, STREAM_FLUSH_MS);
  }

  function flush() {
    flushHandle = null;
    if (pendingCards.size > 0) {
      let next = cardMap;
      for (const c of pendingCards.values()) next = mergeArtefact(next, c);
      pendingCards.clear();
      cardMap = next;
    }
    if (pendingEdges.size > 0) {
      const next = new Map(edgeMap);
      for (const e of pendingEdges.values()) next.set(e.id, e);
      pendingEdges.clear();
      edgeMap = next;
    }
  }

  async function hydrate() {
    status = 'hydrating';
    const res = await fetch(`/api/deepdive/${sessionId}/data`);
    if (!res.ok) {
      status = 'error';
      return;
    }
    const body = await res.json();
    const seeded = new Map<string, DeskCard>();
    for (const s of body.sources ?? []) seeded.set(String(s.id), rowToCard('source', s));
    for (const f of body.facts ?? []) seeded.set(String(f.id), rowToCard('fact', f));
    for (const e of body.entities ?? []) seeded.set(String(e.id), rowToCard('entity', e));
    cardMap = seeded;
    const edges = new Map<string, DeskEdge>();
    for (const r of body.relationships ?? []) {
      edges.set(String(r.id), {
        id: String(r.id),
        fromEntityId: String(r.fromEntityId),
        toEntityId: String(r.toEntityId),
        relationshipType: r.relationshipType ?? null,
        sentiment: r.sentiment ?? null,
      });
    }
    edgeMap = edges;
  }

  function subscribe() {
    es = new EventSource(`/api/deepdive/${sessionId}/stream`);
    es.onmessage = (msg) => {
      let evt: any;
      try {
        evt = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (evt.type === 'artefact' && evt.data) {
        if (evt.data.artefactType === 'relationship') {
          const d = evt.data;
          pendingEdges.set(String(d.id), {
            id: String(d.id),
            fromEntityId: String(d.fromEntityId),
            toEntityId: String(d.toEntityId),
            relationshipType: d.relationshipType ?? null,
            sentiment: d.sentiment ?? null,
          });
        } else {
          const c = eventToCard(evt.data);
          // Stage with dedup-by-id; a later delta for the same id overwrites the staged one.
          pendingCards.set(c.id, c);
        }
        scheduleFlush();
      } else if (evt.type === 'synthesis' && evt.data) {
        const d = evt.data;
        if (d.stage === 'progress' && typeof d.token === 'string') {
          synthesisTokenBuf = synthesisTokenBuf + d.token;
        } else if (d.stage === 'cluster' && d.cluster) {
          clusterList = [...clusterList, d.cluster as SynthesisCluster];
        } else if (d.stage === 'done') {
          if (Array.isArray(d.clusters)) clusterList = d.clusters as SynthesisCluster[];
        } else if (d.stage === 'started') {
          synthesisTokenBuf = '';
        }
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; on reconnect the next hydrate-on-mount or
      // replayed deltas re-dedup by id. Leave status 'live'.
    };
  }

  return {
    get cards() {
      return Array.from(cardMap.values());
    },
    get edges() {
      return Array.from(edgeMap.values());
    },
    get clusters() {
      return clusterList;
    },
    get synthesisToken() {
      return synthesisTokenBuf;
    },
    get status() {
      return status;
    },
    async start() {
      await hydrate();
      subscribe();
      status = 'live';
    },
    applyLocalPosition(id, x, y, pinned) {
      const existing = cardMap.get(id);
      if (!existing) return;
      const next = new Map(cardMap);
      next.set(id, { ...existing, canvasX: x, canvasY: y, pinned: pinned ?? existing.pinned });
      cardMap = next;
    },
    dispose() {
      es?.close();
      es = null;
      if (flushHandle !== null) {
        clearTimeout(flushHandle);
        flushHandle = null;
      }
    },
  };
}
```

- [ ] **Step 4: Run the test — confirm green.**

```
cd /home/john/strange_rambling_svelte && npx vitest run src/lib/canvas/intelligence/desk/store.test.ts
```
Expected: `Test Files  1 passed`, all 6 assertions in `mergeArtefact`/`dedupHydrate` green.

- [ ] **Step 5: Commit.**

```
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/store.svelte.ts src/lib/canvas/intelligence/desk/store.test.ts && git commit -m "feat(desk): hydrate-then-stream store with id-dedup + seq ordering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `ArtefactCard.svelte` — source/fact/entity/challenge variants + UNFILED treatment

A presentational Svelte 5 component (no unit test — verified manually in Task 5). It renders one of four visual variants off a single `DeskCard`. The `challenge` variant is a `fact` whose `fields.isCounterfactual` is truthy.

**Component interface:**

```ts
// Props
let { card, selected = false, onselect } = $props<{
  card: DeskCard;          // from desk/store.svelte
  selected?: boolean;
  onselect: (id: string) => void;  // fired on click (not on drag — shell guards)
}>();
```
- **Emits:** `onselect(card.id)` on click.
- **Variants** (chosen from `card.kind` + `card.fields.isCounterfactual`): `source` (paper card: domain + credibility label), `fact` (paper card: content + accent confidence bar), `challenge` (red-tabbed counter-fact card), `entity` (black chip, Archivo Black name).
- **UNFILED treatment:** when `card.deskState === 'unfiled'` and not pinned → `1.5px dashed var(--accent)`, **no** box-shadow, plus a `● UNFILED` mono tag. When filed → solid hairline `1px solid rgba(26,16,8,.18)` + brutalist shadow `3px 4px 0 rgba(26,16,8,.1)`.

**Files:**
- Create `src/lib/canvas/intelligence/desk/ArtefactCard.svelte`

- [ ] **Step 1: Write the component.**

```svelte
<!-- src/lib/canvas/intelligence/desk/ArtefactCard.svelte -->
<script lang="ts">
  import type { DeskCard } from './store.svelte';

  let { card, selected = false, onselect } = $props<{
    card: DeskCard;
    selected?: boolean;
    onselect: (id: string) => void;
  }>();

  const f = $derived(card.fields as Record<string, any>);
  const isChallenge = $derived(card.kind === 'fact' && !!f.isCounterfactual);
  const isEntity = $derived(card.kind === 'entity');
  const unfiled = $derived(card.deskState === 'unfiled' && !card.pinned);

  const variant = $derived(
    isEntity ? 'entity' : isChallenge ? 'challenge' : card.kind, // 'source' | 'fact'
  );

  // confidence 0..1 → percentage for the accent bar
  const confidencePct = $derived(
    typeof f.confidence === 'number' ? Math.round(Math.max(0, Math.min(1, f.confidence)) * 100) : null,
  );

  const credLabel = $derived(
    f.credibilityType ? String(f.credibilityType) : f.credibilityScore != null ? `cred ${f.credibilityScore}` : '',
  );
</script>

<button
  type="button"
  class="ac"
  class:unfiled
  class:selected
  data-variant={variant}
  onclick={(e) => {
    e.stopPropagation();
    onselect(card.id);
  }}
>
  {#if variant === 'entity'}
    <span class="ac-entity-type">{f.type ?? 'entity'}</span>
    <span class="ac-entity-name">{f.name ?? '—'}</span>
    {#if f.description}<span class="ac-entity-desc">{f.description}</span>{/if}
  {:else if variant === 'source'}
    <span class="ac-label">SOURCE</span>
    <span class="ac-title">{f.title ?? f.url ?? '—'}</span>
    <span class="ac-meta">
      <span class="ac-domain">{f.domain ?? ''}</span>
      {#if credLabel}<span class="ac-cred">{credLabel}</span>{/if}
    </span>
  {:else if variant === 'challenge'}
    <span class="ac-tab">CHALLENGE</span>
    <span class="ac-content">{f.content ?? '—'}</span>
    {#if confidencePct !== null}
      <span class="ac-conf"><i style:width="{confidencePct}%"></i></span>
    {/if}
  {:else}
    <!-- fact -->
    <span class="ac-label">FACT</span>
    <span class="ac-content">{f.content ?? '—'}</span>
    {#if confidencePct !== null}
      <span class="ac-conf"><i style:width="{confidencePct}%"></i></span>
    {/if}
  {/if}

  {#if unfiled}
    <span class="ac-unfiled-tag">● UNFILED</span>
  {/if}
</button>

<style>
  .ac {
    --card-surface: #faf6ee;
    --hairline: rgba(26, 16, 8, 0.18);
    --brutal: 3px 4px 0 rgba(26, 16, 8, 0.1);

    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 240px;
    box-sizing: border-box;
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    font-family: var(--font-body);
    color: var(--text-primary);
    background: var(--card-surface);
    border: 1px solid var(--hairline);
    box-shadow: var(--brutal);
    transition:
      box-shadow 0.18s ease,
      border-color 0.18s ease,
      transform 0.18s ease;
  }
  .ac:hover { transform: translate(-1px, -1px); }
  .ac.selected { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* UNFILED: dashed burnt-orange border, NO shadow. */
  .ac.unfiled {
    border: 1.5px dashed var(--accent);
    box-shadow: none;
  }

  /* labels */
  .ac-label,
  .ac-entity-type {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ac-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .ac-content {
    font-size: 12px;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
  }
  .ac-meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
  .ac-domain { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-cred { color: var(--accent); flex-shrink: 0; }

  /* confidence bar */
  .ac-conf {
    height: 3px;
    width: 100%;
    background: rgba(26, 16, 8, 0.1);
    display: block;
  }
  .ac-conf i { display: block; height: 100%; background: var(--accent); }

  /* challenge variant — red tab + tint */
  .ac[data-variant='challenge'] {
    border-color: #b3261e;
  }
  .ac.unfiled[data-variant='challenge'] {
    border: 1.5px dashed #b3261e;
  }
  .ac-tab {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    padding: 1px 6px;
    background: #b3261e;
    color: #faf6ee;
  }

  /* entity variant — black chip, Archivo Black name */
  .ac[data-variant='entity'] {
    width: auto;
    min-width: 120px;
    max-width: 220px;
    background: var(--text-primary);
    color: var(--bg);
    box-shadow: var(--brutal);
  }
  .ac[data-variant='entity'] .ac-entity-type { color: rgba(237, 228, 212, 0.6); }
  .ac-entity-name {
    font-family: var(--font-display);
    font-size: 15px;
    line-height: 1.1;
    text-transform: uppercase;
  }
  .ac-entity-desc {
    font-size: 11px;
    color: rgba(237, 228, 212, 0.7);
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .ac.unfiled[data-variant='entity'] {
    border: 1.5px dashed var(--accent);
    box-shadow: none;
  }

  .ac-unfiled-tag {
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.12em;
    color: var(--accent);
  }
  .ac[data-variant='entity'] .ac-unfiled-tag { color: var(--accent); }
</style>
```

- [ ] **Step 2: Type-check the new component (no unit test for UI — manual verify in Task 5).**

```
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error --tsconfig ./tsconfig.json src/lib/canvas/intelligence/desk/ArtefactCard.svelte 2>&1 | tail -5
```
Expected: `0 errors` for `ArtefactCard.svelte` (warnings tolerated). If `svelte-check` runs project-wide, confirm no new errors are attributed to this file.

- [ ] **Step 3: Commit.**

```
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/desk/ArtefactCard.svelte && git commit -m "feat(desk): ArtefactCard — source/fact/entity/challenge variants + UNFILED treatment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ResearchDesk.svelte` shell — pan/zoom/drag/grid-snap/orthPath/minimap/edges

The shell mounts the store, renders every card as an absolutely-positioned `ArtefactCard` inside a pan/zoom world layer, draws relationship edges between entity cards via `orthPath`, lifts the minimap, and persists drag positions to the §M4 PATCH endpoint. **Layout resolution per card:** if `canvasX/canvasY` non-null (or a live drag override exists) → use it; else GATHER → `scatterPosition(id, phase)`; else (organised mode active) → `organisedLayout(...)`.

**Component interface:**

```ts
// Props
let { sessionId, topic = '' } = $props<{ sessionId: string; topic?: string }>();
```
- No emitted events (self-contained desk host). Parent (`+page.svelte`) passes `sessionId`.
- Owns: `panX/panY/zoom`, drag state, the `createDeskStore` instance, the GATHER⇄SYNTHESIZE `mode` flag (a local `$state<'gather'|'synthesize'>`), `selectedId`.

**Files:**
- Create `src/lib/canvas/intelligence/desk/ResearchDesk.svelte` (note: the contract lists `ResearchDesk.svelte` directly under `intelligence/`; per spec §8 it is `intelligence/ResearchDesk.svelte`. Place it at `src/lib/canvas/intelligence/ResearchDesk.svelte` and import `desk/*` siblings — see import paths below.)

Actual create path: `src/lib/canvas/intelligence/ResearchDesk.svelte`.

- [ ] **Step 1: Write the shell.** Pan/zoom is lifted verbatim from `canvas/[slug]/+page.svelte:1868–1984`; node drag + grid-snap from `:1991–2069` (PATCH target swapped to the M4 position endpoint, `invalidateAll()` dropped — the store applies the local override); `orthPath` from `:1016–1053` (simplified to fixed card bounds since cards are uniform); minimap geometry/markup from `:1119–1164` / `:5579–5605`.

```svelte
<!-- src/lib/canvas/intelligence/ResearchDesk.svelte -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ArtefactCard from './desk/ArtefactCard.svelte';
  import { createDeskStore, type DeskCard, type DeskEdge } from './desk/store.svelte';
  import { scatterPosition, organisedLayout } from './desk/layout';

  let { sessionId, topic = '' } = $props<{ sessionId: string; topic?: string }>();

  // ——— store ———
  const store = createDeskStore(sessionId);
  onMount(() => {
    store.start();
    return () => store.dispose();
  });

  // GATHER ⇄ SYNTHESIZE
  let mode = $state<'gather' | 'synthesize'>('gather');

  // ——— card geometry (uniform; entity chips a touch smaller) ———
  const CARD_W = 240;
  const CARD_H = 132;
  function cardW(c: DeskCard) {
    return c.kind === 'entity' ? 200 : CARD_W;
  }
  function cardH(c: DeskCard) {
    return c.kind === 'entity' ? 72 : CARD_H;
  }

  // Live drag overrides (id → {x,y}); applied on top of persisted/auto layout.
  let dragOverrides = $state.raw<Record<string, { x: number; y: number }>>({});

  // Organised positions, recomputed when in synthesize mode.
  const organised = $derived.by(() => {
    if (mode !== 'synthesize') return null;
    const cats = store.clusters.map((c) => ({ id: c.id, title: c.title }));
    // Map fact → its cluster (deskCategory or cluster.fact_ids membership).
    const factCat = new Map<string, string>();
    for (const cl of store.clusters) for (const fid of cl.fact_ids ?? []) factCat.set(fid, cl.id);
    const arts = store.cards.map((c) => ({
      id: c.id,
      kind: c.kind,
      categoryId: c.deskCategory ?? factCat.get(c.id),
    }));
    return organisedLayout(arts, cats);
  });

  /** Resolve a card's on-desk position. Override > persisted > organised > scatter. */
  function posOf(c: DeskCard): { x: number; y: number } {
    const ov = dragOverrides[c.id];
    if (ov) return ov;
    if (c.canvasX != null && c.canvasY != null) return { x: c.canvasX, y: c.canvasY };
    if (mode === 'synthesize' && organised) {
      const p = organised.get(c.id);
      if (p) return p;
    }
    return scatterPosition(c.id, c.phase);
  }

  // Entity-id → resolved centre, for edge docking.
  const entityById = $derived.by(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const c of store.cards) {
      if (c.kind !== 'entity') continue;
      const p = posOf(c);
      m.set(c.id, { x: p.x, y: p.y, w: cardW(c), h: cardH(c) });
    }
    return m;
  });

  // ——— orthPath (lifted from canvas/[slug]/+page.svelte:1016-1053) ———
  type Box = { x: number; y: number; w: number; h: number };
  function orthPath(from: Box, to: Box): string {
    const sCx = from.x + from.w / 2;
    const sCy = from.y + from.h / 2;
    const tCx = to.x + to.w / 2;
    const tCy = to.y + to.h / 2;
    const dx = tCx - sCx;
    const dy = tCy - sCy;
    const overlapX = from.x < to.x + to.w && to.x < from.x + from.w;
    const overlapY = from.y < to.y + to.h && to.y < from.y + from.h;
    let horizontal: boolean;
    if (overlapX && !overlapY) horizontal = false;
    else if (overlapY && !overlapX) horizontal = true;
    else horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      const [x1, x2] = dx >= 0 ? [from.x + from.w, to.x] : [from.x, to.x + to.w];
      const y1 = sCy;
      const y2 = tCy;
      const midX = (x1 + x2) / 2;
      return `M${x1} ${y1} L${midX} ${y1} L${midX} ${y2} L${x2} ${y2}`;
    }
    const [y1, y2] = dy >= 0 ? [from.y + from.h, to.y] : [from.y, to.y + to.h];
    const x1 = sCx;
    const x2 = tCx;
    const midY = (y1 + y2) / 2;
    return `M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2}`;
  }

  const edgePaths = $derived.by(() => {
    const out: { id: string; d: string }[] = [];
    for (const e of store.edges) {
      const a = entityById.get(e.fromEntityId);
      const b = entityById.get(e.toEntityId);
      if (!a || !b) continue; // only draw when both entity cards exist
      out.push({ id: e.id, d: orthPath(a, b) });
    }
    return out;
  });

  // ——— pan/zoom (lifted from canvas/[slug]/+page.svelte:1868-1984) ———
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
  const zoomPct = $derived(Math.round(zoom * 100));
  let viewportEl: HTMLDivElement | undefined;
  let viewportW = $state(0);
  let viewportH = $state(0);
  let panStart = $state<{ x: number; y: number; panX: number; panY: number; pointerId: number } | null>(null);

  function clampZoom(z: number) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }
  function zoomAt(cx: number, cy: number, factor: number) {
    const newZoom = clampZoom(zoom * factor);
    if (newZoom === zoom) return;
    const worldX = (cx - panX) / zoom;
    const worldY = (cy - panY) / zoom;
    zoom = newZoom;
    panX = cx - worldX * newZoom;
    panY = cy - worldY * newZoom;
  }
  function zoomCentered(factor: number) {
    const vp = viewportEl?.getBoundingClientRect();
    if (!vp) return;
    zoomAt(vp.width / 2, vp.height / 2, factor);
  }
  function fit() {
    const cards = store.cards;
    if (!viewportEl || cards.length === 0) return;
    const vp = viewportEl.getBoundingClientRect();
    const pad = 48;
    const xs = cards.map((c) => posOf(c));
    const minX = Math.min(...xs.map((p) => p.x)) - pad;
    const minY = Math.min(...xs.map((p) => p.y)) - pad;
    const maxX = Math.max(...cards.map((c) => posOf(c).x + cardW(c))) + pad;
    const maxY = Math.max(...cards.map((c) => posOf(c).y + cardH(c))) + pad;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const availW = Math.max(200, vp.width - 24);
    const availH = Math.max(200, vp.height - 24);
    const fitZ = clampZoom(Math.min(availW / contentW, availH / contentH, 1));
    zoom = fitZ;
    panX = 12 + (availW - contentW * fitZ) / 2 - minX * fitZ;
    panY = 12 + (availH - contentH * fitZ) / 2 - minY * fitZ;
  }
  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
  }
  function isInteractiveTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return !!el.closest('.ac, .desk-minimap, .desk-cmd, button, a, input, textarea, select');
  }
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    selectedId = null;
    panStart = { x: e.clientX, y: e.clientY, panX, panY, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!panStart || panStart.pointerId !== e.pointerId) return;
    panX = panStart.panX + (e.clientX - panStart.x);
    panY = panStart.panY + (e.clientY - panStart.y);
  }
  function onPointerUp(e: PointerEvent) {
    if (!panStart || panStart.pointerId !== e.pointerId) return;
    panStart = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* no-op */ }
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const vp = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - vp.left;
    const cy = e.clientY - vp.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(cx, cy, factor);
  }

  // ——— node drag + grid-snap (lifted from :1991-2069, PATCH target swapped) ———
  const DRAG_THRESHOLD = 3;
  const GRID = 20;
  let selectedId = $state<string | null>(null);
  let nodeDrag = $state<{
    cardId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  function onCardPointerDown(e: PointerEvent, c: DeskCard) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = posOf(c);
    nodeDrag = {
      cardId: c.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: p.x,
      startY: p.y,
      moved: false,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onCardPointerMove(e: PointerEvent) {
    if (!nodeDrag || nodeDrag.pointerId !== e.pointerId) return;
    const dxClient = e.clientX - nodeDrag.startClientX;
    const dyClient = e.clientY - nodeDrag.startClientY;
    if (!nodeDrag.moved && Math.hypot(dxClient, dyClient) < DRAG_THRESHOLD) return;
    nodeDrag.moved = true;
    const dx = dxClient / zoom;
    const dy = dyClient / zoom;
    const nx = Math.round((nodeDrag.startX + dx) / GRID) * GRID;
    const ny = Math.round((nodeDrag.startY + dy) / GRID) * GRID;
    dragOverrides = { ...dragOverrides, [nodeDrag.cardId]: { x: nx, y: ny } };
  }
  async function onCardPointerUp(e: PointerEvent, c: DeskCard) {
    if (!nodeDrag || nodeDrag.pointerId !== e.pointerId) return;
    const wasMoved = nodeDrag.moved;
    const cardId = nodeDrag.cardId;
    const finalPos = dragOverrides[cardId];
    nodeDrag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* no-op */ }
    if (wasMoved && finalPos) {
      // Mirror the canvas drag-persist; target the M4 position endpoint.
      const artefactType = c.kind; // 'source' | 'fact' | 'entity'
      let ok = false;
      try {
        const res = await fetch(`/api/deepdive/${sessionId}/artefacts/${cardId}/position`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artefactType, position: finalPos, pinned: true }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (ok) {
        // Fold the persisted position into the store, then drop the transient override.
        store.applyLocalPosition(cardId, finalPos.x, finalPos.y, true);
        const next = { ...dragOverrides };
        delete next[cardId];
        dragOverrides = next;
      }
      // On failure: keep the override so the card doesn't snap back on a blip.
    } else {
      selectedId = c.id;
    }
  }

  // ——— minimap (lifted from :1119-1164) ———
  const MINIMAP_BODY_W = 146;
  const MINIMAP_BODY_H = 60;
  const MINIMAP_PAD = 4;
  const minimap = $derived.by(() => {
    const cards = store.cards;
    if (cards.length === 0 || viewportW === 0 || viewportH === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cards) {
      const p = posOf(c);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      const r = p.x + cardW(c);
      const b = p.y + cardH(c);
      if (r > maxX) maxX = r;
      if (b > maxY) maxY = b;
    }
    const viewLeft = -panX / zoom;
    const viewTop = -panY / zoom;
    const viewRight = (viewportW - panX) / zoom;
    const viewBottom = (viewportH - panY) / zoom;
    if (viewLeft < minX) minX = viewLeft;
    if (viewTop < minY) minY = viewTop;
    if (viewRight > maxX) maxX = viewRight;
    if (viewBottom > maxY) maxY = viewBottom;
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxY - minY);
    const innerW = MINIMAP_BODY_W - MINIMAP_PAD * 2;
    const innerH = MINIMAP_BODY_H - MINIMAP_PAD * 2;
    const scale = Math.min(innerW / worldW, innerH / worldH);
    const offsetX = MINIMAP_PAD + (innerW - worldW * scale) / 2;
    const offsetY = MINIMAP_PAD + (innerH - worldH * scale) / 2;
    return {
      scale, offsetX, offsetY, minX, minY,
      frame: {
        x: offsetX + (viewLeft - minX) * scale,
        y: offsetY + (viewTop - minY) * scale,
        w: Math.max(2, (viewRight - viewLeft) * scale),
        h: Math.max(2, (viewBottom - viewTop) * scale),
      },
    };
  });

  const counts = $derived.by(() => {
    let sources = 0, facts = 0, entities = 0;
    for (const c of store.cards) {
      if (c.kind === 'source') sources++;
      else if (c.kind === 'entity') entities++;
      else facts++;
    }
    return { sources, facts, entities, links: store.edges.length };
  });
</script>

<div class="desk-root">
  <!-- command bar (minimal — full CommandBar is a later milestone) -->
  <header class="desk-cmd">
    <span class="desk-mono">sr.</span>
    <span class="desk-topic">{topic || sessionId.slice(0, 8)}</span>
    <div class="desk-toggle" role="group" aria-label="Desk mode">
      <button type="button" class:active={mode === 'gather'} onclick={() => (mode = 'gather')}>GATHER</button>
      <button type="button" class:active={mode === 'synthesize'} onclick={() => (mode = 'synthesize')}>SYNTHESIZE</button>
    </div>
    <span class="desk-counts">
      {counts.sources} src · {counts.facts} fact · {counts.entities} ent · {counts.links} link
    </span>
    <span class="desk-status" data-status={store.status}>● {store.status}</span>
  </header>

  <!-- viewport -->
  <div
    class="desk-viewport"
    class:panning={panStart !== null}
    bind:this={viewportEl}
    bind:clientWidth={viewportW}
    bind:clientHeight={viewportH}
    role="application"
    aria-label="Research desk"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
  >
    <!-- world layer -->
    <div class="desk-world" style:transform="translate({panX}px, {panY}px) scale({zoom})" style:transform-origin="0 0">
      <!-- edges (relationships between entity cards) -->
      <svg class="desk-edges" aria-hidden="true" overflow="visible">
        {#each edgePaths as e (e.id)}
          <path d={e.d} fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.45" vector-effect="non-scaling-stroke" />
        {/each}
      </svg>

      <!-- cards -->
      {#each store.cards as c (c.id)}
        {@const p = posOf(c)}
        <div
          class="desk-card-host"
          style:transform="translate({p.x}px, {p.y}px)"
          onpointerdown={(e) => onCardPointerDown(e, c)}
          onpointermove={onCardPointerMove}
          onpointerup={(e) => onCardPointerUp(e, c)}
          onpointercancel={(e) => onCardPointerUp(e, c)}
        >
          <ArtefactCard {card} card={c} selected={selectedId === c.id} onselect={(id) => (selectedId = id)} />
        </div>
      {/each}
    </div>

    <!-- minimap -->
    <div class="desk-minimap">
      <div class="desk-minimap-head"><span>MINIMAP</span><span>{zoomPct}%</span></div>
      <div class="desk-minimap-body">
        {#if minimap}
          {#each store.cards as c (c.id + '-m')}
            {@const p = posOf(c)}
            <div
              class="desk-minimap-node"
              class:ent={c.kind === 'entity'}
              style:left="{minimap.offsetX + (p.x - minimap.minX) * minimap.scale}px"
              style:top="{minimap.offsetY + (p.y - minimap.minY) * minimap.scale}px"
              style:width="{Math.max(2, cardW(c) * minimap.scale)}px"
              style:height="{Math.max(2, cardH(c) * minimap.scale)}px"
            ></div>
          {/each}
          <div
            class="desk-minimap-frame"
            style:left="{minimap.frame.x}px"
            style:top="{minimap.frame.y}px"
            style:width="{minimap.frame.w}px"
            style:height="{minimap.frame.h}px"
          ></div>
        {/if}
      </div>
    </div>

    <!-- zoom controls -->
    <div class="desk-zoom">
      <button type="button" onclick={() => zoomCentered(1.2)} aria-label="Zoom in">+</button>
      <button type="button" onclick={() => zoomCentered(1 / 1.2)} aria-label="Zoom out">−</button>
      <button type="button" onclick={fit} aria-label="Fit">⤢</button>
      <button type="button" onclick={reset} aria-label="Reset">⌂</button>
    </div>
  </div>
</div>

<style>
  .desk-root {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text-primary);
  }
  .desk-cmd {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    border-bottom: 1px solid rgba(26, 16, 8, 0.18);
    background: var(--surface-elevated);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .desk-mono { font-family: var(--font-brand); font-weight: 500; color: var(--accent); }
  .desk-topic { font-family: var(--font-body); font-weight: 600; font-size: 13px; }
  .desk-toggle { display: flex; border: 1px solid rgba(26, 16, 8, 0.18); margin-left: auto; }
  .desk-toggle button {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    padding: 5px 12px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    cursor: pointer;
  }
  .desk-toggle button.active { background: var(--accent); color: #faf6ee; }
  .desk-counts { color: var(--text-muted); }
  .desk-status { color: var(--success); letter-spacing: 0.08em; }
  .desk-status[data-status='error'] { color: #b3261e; }

  .desk-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    background:
      radial-gradient(circle, rgba(26, 16, 8, 0.06) 1px, transparent 1px) 0 0 / 32px 32px;
  }
  .desk-viewport.panning { cursor: grabbing; }
  .desk-world { position: absolute; top: 0; left: 0; }
  .desk-edges { position: absolute; top: 0; left: 0; width: 1px; height: 1px; pointer-events: none; }
  .desk-card-host { position: absolute; top: 0; left: 0; touch-action: none; }

  .desk-minimap {
    position: absolute;
    bottom: 12px;
    right: 12px;
    width: 146px;
    background: var(--surface-elevated);
    border: 1px solid rgba(26, 16, 8, 0.18);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    user-select: none;
  }
  .desk-minimap-head {
    display: flex;
    justify-content: space-between;
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    border-bottom: 1px solid rgba(26, 16, 8, 0.12);
  }
  .desk-minimap-body { position: relative; width: 146px; height: 60px; }
  .desk-minimap-node { position: absolute; background: var(--accent); opacity: 0.55; }
  .desk-minimap-node.ent { background: var(--text-primary); opacity: 0.8; }
  .desk-minimap-frame { position: absolute; border: 1px solid var(--accent); background: rgba(196, 87, 10, 0.08); }

  .desk-zoom {
    position: absolute;
    bottom: 12px;
    left: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .desk-zoom button {
    width: 28px;
    height: 28px;
    font-family: var(--font-mono);
    font-size: 14px;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid rgba(26, 16, 8, 0.18);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    cursor: pointer;
  }
  .desk-zoom button:hover { border-color: var(--accent); color: var(--accent); }
</style>
```

> Note: the `<ArtefactCard {card} card={c} .../>` line has a duplicated `{card}` shorthand — **remove the bare `{card}`** so only the explicit `card={c}` remains. Correct it to:
> `<ArtefactCard card={c} selected={selectedId === c.id} onselect={(id) => (selectedId = id)} />`

- [ ] **Step 2: Fix the duplicated prop noted above** (the bare `{card}` shorthand is a leftover and would reference an undefined `card` variable). Ensure the line reads exactly:

```svelte
          <ArtefactCard card={c} selected={selectedId === c.id} onselect={(id) => (selectedId = id)} />
```

- [ ] **Step 3: Type-check the shell.**

```
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error --tsconfig ./tsconfig.json src/lib/canvas/intelligence/ResearchDesk.svelte 2>&1 | tail -8
```
Expected: `0 errors` attributable to `ResearchDesk.svelte`. (The `untrack` import is reserved for the props-sync gotcha; if `svelte-check` flags it as unused, remove the import.)

- [ ] **Step 4: Commit.**

```
cd /home/john/strange_rambling_svelte && git add src/lib/canvas/intelligence/ResearchDesk.svelte && git commit -m "feat(desk): ResearchDesk shell — pan/zoom/drag/grid-snap/orthPath/minimap + edges

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Mount the desk at `/deepdive/[id]` + manual verification on homeserv

Wire a thin page that loads the session (auth/topic) and mounts `ResearchDesk.svelte`, then verify live in the browser. The route guard is automatic — the desk stays private because nothing is added to `PUBLIC_PATHS`.

**Files:**
- Create `src/routes/deepdive/[id]/+page.server.ts`
- Create `src/routes/deepdive/[id]/+page.svelte`

(If `src/routes/deepdive/[id]/+page.svelte` already exists from a prior page, this milestone REPLACES it with the desk host; the old `/progress` and `/dashboard` redirect shims are a later milestone — do not touch them here.)

- [ ] **Step 1: Write the page loader** — fetches the session's topic for the command bar, 404s on a missing session. Mirrors the existing deepdive load pattern (`researchSessions` by id).

```ts
// src/routes/deepdive/[id]/+page.server.ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic, status: researchSessions.status })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw error(404, 'Research session not found');

  return { sessionId: session.id, topic: session.topic ?? '', status: session.status };
};
```

> Confirm the column name `topic` exists on `researchSessions` before running (grep `src/lib/db/schema.ts` around line 370). If the field is named differently (e.g. `query` or `prompt`), use that real column name instead.

- [ ] **Step 2: Write the page host.**

```svelte
<!-- src/routes/deepdive/[id]/+page.svelte -->
<script lang="ts">
  import ResearchDesk from '$lib/canvas/intelligence/ResearchDesk.svelte';
  let { data } = $props<{ data: { sessionId: string; topic: string; status: string } }>();
</script>

<svelte:head>
  <title>{data.topic || 'Research desk'} · sr.</title>
</svelte:head>

<ResearchDesk sessionId={data.sessionId} topic={data.topic} />
```

- [ ] **Step 3: Confirm the `topic` column.**

```
cd /home/john/strange_rambling_svelte && grep -nE "topic|query|prompt" src/lib/db/schema.ts | sed -n '1,8p'
```
Expected: a line like `topic: text('topic')` inside the `researchSessions` table (line ~371–387). If absent, fix `+page.server.ts` to select the real column.

- [ ] **Step 4: Project type-check (errors only).**

```
cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error --tsconfig ./tsconfig.json 2>&1 | tail -12
```
Expected: no new errors referencing `src/routes/deepdive/[id]/` or `src/lib/canvas/intelligence/`. Pre-existing errors elsewhere are out of scope; confirm the count did not increase versus a clean checkout if unsure.

- [ ] **Step 5: Manual verification on homeserv:5173** (per CLAUDE.md verify discipline — John is on the same LAN, use `http://homeserv:<port>`).

```
cd /home/john/strange_rambling_svelte && (npm run dev -- --host 0.0.0.0 --port 5173 >/tmp/desk-dev.log 2>&1 &) ; sleep 8 ; grep -m1 -E "Local:|ready in|5173" /tmp/desk-dev.log
```
Expected: a Vite "ready"/"Local: http://localhost:5173/" line. Then:
1. Pick a real completed deep session id: `cd /home/john/strange_rambling_svelte && grep -rl "" /dev/null; psql "$DATABASE_URL" -c "select id, topic, status from research_session order by created_at desc limit 5;"` (or open `http://homeserv:8085/pgweb/` and read `research_session`).
2. In a browser, open `http://homeserv:5173/deepdive/<that-id>` (you'll be bounced through Google OAuth — sign in as John; the desk is private).
3. **Confirm visually:**
   - The desk renders full-bleed on the cream (`#ede4d4`) surface with the dotted grid.
   - Cards appear at scattered positions; **unfiled** cards show the **dashed burnt-orange border** + `● UNFILED` tag; entity cards are **black chips with Archivo Black names**.
   - Relationship **edges** draw between entity chips (orthogonal burnt-orange paths).
   - **Pan** by dragging empty desk; **wheel-zoom** centres on the cursor; the **minimap frame** (bottom-right) tracks pan/zoom; **+ / − / ⤢ / ⌂** zoom controls work.
   - **Drag a card** — it grid-snaps (20px) and, on release, PATCHes its position (check the network tab: `PATCH /api/deepdive/<id>/artefacts/<artefactId>/position` → if M4 isn't merged yet it 404s and the override sticks visually; that's the documented graceful-degrade).
   - Flip **GATHER → SYNTHESIZE**: if `synthesis_runs` clusters exist for the session, cards re-pack into category columns with entities in the bottom rail; otherwise they fall back to scatter (no crash).
   - Open the devtools console — **no `effect_update_depth_exceeded`** and no proxy-churn warnings (validates the `$state.raw`/plain-handle gotcha compliance).
4. Stop the dev server: `pkill -f "vite.*5173" || pkill -f "npm run dev"`.

- [ ] **Step 6: Commit.**

```
cd /home/john/strange_rambling_svelte && git add src/routes/deepdive/\[id\]/+page.server.ts src/routes/deepdive/\[id\]/+page.svelte && git commit -m "feat(desk): mount ResearchDesk at /deepdive/[id] (private)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**Milestone 6 done-when:** `layout.test.ts` + `store.test.ts` green; `ArtefactCard.svelte` renders all four variants with the correct UNFILED/filed treatments; `ResearchDesk.svelte` pans/zooms/drags with grid-snap, draws relationship edges via `orthPath`, and shows a live minimap; the desk mounts at `/deepdive/[id]` behind the existing private auth and visibly renders a real session's artefacts on homeserv:5173 with no Svelte effect-depth/proxy-churn errors. Synthesis triggering, the position PATCH endpoint, `desk-events.ts` emits, and the launcher rebuild are separate milestones; this one consumes their contracts and degrades gracefully where they are not yet merged.

**Files delivered (absolute paths):**
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/layout.ts` (+ `layout.test.ts`)
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/store.svelte.ts` (+ `store.test.ts`)
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/ArtefactCard.svelte`
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte`
- `/home/john/strange_rambling_svelte/src/routes/deepdive/[id]/+page.server.ts` and `+page.svelte`


I have enough context. I understand the design tokens, the canvas idioms (pan/zoom/drag/orthPath), the LLM gateway signatures, the synthesis event contract, and the store/desk patterns. Now I'll draft Milestone 7. This milestone depends on prior milestones having built: the schema, `desk-events.ts`, `worker.ts` `ensureEmitter`, `synthesis.ts`, the synthesize route, the position route, `ResearchDesk.svelte` shell, `ArtefactCard.svelte`, `layout.ts` with `scatterPosition`/`organisedLayout`, and the hydrate-then-stream store.

This milestone's job is: ModeToggle component, the morph/sticky/pinned animation in the desk shell, CategoryHeader, EntityRail, the toggle→synthesize POST wiring, and consuming `synthesis.*` events to assign categories + draw connectors. I'll write it to be self-contained, defining the exact interfaces it consumes from prior milestones per the shared contract.

## Milestone 7: Mode toggle, morph, synthesize wiring, categories/entity rail

This milestone makes the desk *flip*. Prior milestones have shipped: the additive schema (`canvasX/canvasY/pinned/deskState/deskCategory/synthesisRunId` + `synthesisRuns` table), `src/lib/deepdive/desk-events.ts` (`nextSeq`/`emitArtefact`/`flushArtefacts`), `worker.ts` `ensureEmitter`, `src/lib/deepdive/synthesis.ts` (`runSynthesis` + per-run abort registry), `POST /api/deepdive/[id]/synthesize`, `PATCH /api/deepdive/[id]/artefacts/[artefactId]/position`, the desk shell `src/lib/canvas/intelligence/ResearchDesk.svelte` (pan/zoom/drag/minimap + the hydrate-then-stream `$state.raw` store), `desk/ArtefactCard.svelte`, and `desk/layout.ts` (`hashId`, `scatterPosition`). Milestone 7 adds the SYNTHESIZE half: the `organisedLayout` packer, `ModeToggle.svelte`, `CategoryHeader.svelte`, `EntityRail.svelte`, the morph/sticky/pinned position logic in the shell, the toggle→`POST /synthesize` call, and the `synthesis.*` event consumer that assigns categories and draws connectors.

**Contract this milestone consumes from prior milestones (do not redefine — these already exist):**

- The store in `ResearchDesk.svelte` holds `cards` as a `$state.raw` array of `DeskCard`:
  ```ts
  // src/lib/canvas/intelligence/desk/types.ts  (created in an earlier milestone)
  export interface DeskCard {
    id: string;
    kind: 'source' | 'fact' | 'entity';   // relationships are edges, never cards
    seq: number;
    phase: 1 | 2 | 3 | 99;                 // 99 = 'post' / synthesis-era arrivals
    // server-persisted position (null until user-dragged or pinned)
    canvasX: number | null;
    canvasY: number | null;
    pinned: boolean;
    deskState: 'unfiled' | 'filed' | 'synthesized' | 'archived';
    deskCategory: string | null;
    synthesisRunId: string | null;
    // type-specific payload (source/fact/entity fields per the SHARED CONTRACT)
    fields: Record<string, unknown>;
  }
  export interface DeskEdge {
    id: string;
    fromEntityId: string;
    toEntityId: string;
    relationshipType: string;
    sentiment: string | null;
    strength: number | null;
    sourceId: string | null;
  }
  ```
- `desk/layout.ts` already exports `hashId(id:string):number` and `scatterPosition(id:string, phase:number):{x:number,y:number}`. This milestone ADDS `organisedLayout(...)` to the same file.
- The store exposes (already wired): `sessionId:string`, reactive `cards:DeskCard[]`, reactive `edges:DeskEdge[]`, and a mutator `patchCard(id:string, patch:Partial<DeskCard>):void` that does the `$state.raw` wholesale-replace + ~5ms debounced flush. Milestone 7 calls `patchCard` from the synthesis consumer.

---

### Task 1: `organisedLayout` packer + sticky/accumulation helpers in `desk/layout.ts` (TDD)

The pure positioning logic for SYNTHESIZE mode and the sticky-accumulation rule. Tested first because it is pure.

**Files:**
- Modify: `src/lib/canvas/intelligence/desk/layout.ts` (append exports; do not touch existing `hashId`/`scatterPosition`)
- Create: `src/lib/canvas/intelligence/desk/layout.test.ts`

- [ ] **Step 1: Read the current `layout.ts` to confirm the existing exports and constants.**
  ```
  npx -y -- true   # no-op; just open the file
  ```
  Read `src/lib/canvas/intelligence/desk/layout.ts` and confirm it exports `hashId(id)` and `scatterPosition(id, phase)`, and note the card dimensions constant if present (we add ours if absent). Re-grep if line refs drifted:
  ```
  grep -n "export function\|export const" src/lib/canvas/intelligence/desk/layout.ts
  ```
  Expected: lines for `hashId` and `scatterPosition` at minimum.

- [ ] **Step 2: Write the failing test `layout.test.ts`.**
  ```ts
  // src/lib/canvas/intelligence/desk/layout.test.ts
  import { describe, it, expect } from 'vitest';
  import {
    CARD_W,
    CARD_H,
    CARD_GAP,
    COL_W,
    organisedLayout,
    organisedCorePxBounds,
    accumulationScatter,
    type LayoutArtefact,
    type LayoutCategory,
  } from './layout';
  import { scatterPosition } from './layout';

  const cats: LayoutCategory[] = [
    { id: 'cat-a', title: 'Alpha' },
    { id: 'cat-b', title: 'Beta' },
  ];

  function art(id: string, kind: string, categoryId?: string): LayoutArtefact {
    return { id, kind, categoryId };
  }

  describe('organisedLayout', () => {
    it('places facts in their category column, stacked vertically under the header', () => {
      const arts = [
        art('f1', 'fact', 'cat-a'),
        art('f2', 'fact', 'cat-a'),
        art('s1', 'source', 'cat-b'),
      ];
      const m = organisedLayout(arts, cats);
      const p1 = m.get('f1')!;
      const p2 = m.get('f2')!;
      const ps1 = m.get('s1')!;
      // same column → same x
      expect(p1.x).toBe(p2.x);
      // stacked → f2 below f1 by exactly one CARD_H + CARD_GAP
      expect(p2.y - p1.y).toBe(CARD_H + CARD_GAP);
      // cat-b is column 1 → x is one COL_W to the right of cat-a (column 0)
      expect(ps1.x - p1.x).toBe(COL_W);
      // facts start below the header band (y > 0)
      expect(p1.y).toBeGreaterThan(0);
    });

    it('collects all entities into the bottom rail row regardless of category', () => {
      const arts = [
        art('f1', 'fact', 'cat-a'),
        art('e1', 'entity', 'cat-a'),
        art('e2', 'entity', 'cat-b'),
        art('e3', 'entity'),
      ];
      const m = organisedLayout(arts, cats);
      const ye = [m.get('e1')!.y, m.get('e2')!.y, m.get('e3')!.y];
      // all entities share one rail row (same y)
      expect(new Set(ye).size).toBe(1);
      // entities laid out left-to-right by CARD_W + CARD_GAP spacing, in id order
      const xs = ['e1', 'e2', 'e3'].map((id) => m.get(id)!.x).sort((a, b) => a - b);
      expect(xs[1] - xs[0]).toBe(CARD_W + CARD_GAP);
      expect(xs[2] - xs[1]).toBe(CARD_W + CARD_GAP);
    });

    it('puts uncategorised non-entity artefacts in a trailing "Unfiled" column', () => {
      const arts = [art('f1', 'fact', 'cat-a'), art('f9', 'fact')];
      const m = organisedLayout(arts, cats);
      // uncategorised fact goes to column index === cats.length (i.e. 2 → x = 2*COL_W)
      expect(m.get('f9')!.x).toBe(2 * COL_W);
    });

    it('is deterministic — same input yields identical positions', () => {
      const arts = [art('f1', 'fact', 'cat-a'), art('f2', 'fact', 'cat-a')];
      const a = organisedLayout(arts, cats);
      const b = organisedLayout(arts, cats);
      expect(a.get('f1')).toEqual(b.get('f1'));
      expect(a.get('f2')).toEqual(b.get('f2'));
    });

    it('never overlaps two cards in the same column', () => {
      const arts = Array.from({ length: 10 }, (_, i) => art(`f${i}`, 'fact', 'cat-a'));
      const m = organisedLayout(arts, cats);
      const ys = arts.map((a) => m.get(a.id)!.y).sort((x, y) => x - y);
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(CARD_H);
      }
    });
  });

  describe('organisedCorePxBounds', () => {
    it('returns the bounding box of all positioned cards', () => {
      const m = new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: COL_W, y: 200 }],
      ]);
      const b = organisedCorePxBounds(m);
      expect(b.minX).toBe(0);
      expect(b.minY).toBe(0);
      expect(b.maxX).toBe(COL_W + CARD_W);
      expect(b.maxY).toBe(200 + CARD_H);
    });

    it('returns a zero box for an empty map', () => {
      const b = organisedCorePxBounds(new Map());
      expect(b).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });
  });

  describe('accumulationScatter', () => {
    it('places new (phase 99) arrivals to the RIGHT of the organised core, deterministically', () => {
      const bounds = { minX: 0, minY: 0, maxX: 600, maxY: 800 };
      const p = accumulationScatter('newcard-1', bounds);
      expect(p.x).toBeGreaterThanOrEqual(bounds.maxX);
      // deterministic
      expect(accumulationScatter('newcard-1', bounds)).toEqual(p);
      // different id → (almost certainly) different y
      expect(accumulationScatter('newcard-2', bounds)).not.toEqual(p);
    });

    it('falls back to plain scatterPosition when the core is empty', () => {
      const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      expect(accumulationScatter('x', bounds)).toEqual(scatterPosition('x', 99));
    });
  });
  ```

- [ ] **Step 3: Run the test and watch it fail (modules/exports missing).**
  ```
  npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
  ```
  Expected: failures like `No "organisedLayout" export is defined` / `CARD_W` undefined.

- [ ] **Step 4: Append the implementation to `desk/layout.ts`.** (Add after the existing `scatterPosition` export. If `layout.ts` already defines any of `CARD_W/CARD_H/CARD_GAP`, reuse those and drop the duplicate `const` lines.)
  ```ts
  // ——— SYNTHESIZE-mode organised layout (added in Milestone 7) ———

  /** Card box used by the packer. Kept in sync with ArtefactCard.svelte min sizing. */
  export const CARD_W = 220;
  export const CARD_H = 120;
  export const CARD_GAP = 20;        // matches the desk GRID
  /** Width of a category column (card + horizontal breathing room). */
  export const COL_W = CARD_W + 80;
  /** Height reserved at the top of each column for the CategoryHeader. */
  export const HEADER_BAND_H = 64;
  /** Vertical gap between the deepest column and the entity rail. */
  export const RAIL_GAP = 80;

  export interface LayoutArtefact {
    id: string;
    kind: string;            // 'source' | 'fact' | 'entity'
    categoryId?: string;     // deskCategory; undefined → trailing "Unfiled" column
  }
  export interface LayoutCategory {
    id: string;
    title: string;
  }

  /**
   * Compute organised SYNTHESIZE positions.
   *  - Each category is a left-to-right column (header band reserved at top).
   *  - Non-entity artefacts stack vertically inside their category column,
   *    in id order, one CARD_H + CARD_GAP apart.
   *  - Uncategorised non-entity artefacts go to a trailing column at index === categories.length.
   *  - ALL entities (any/no category) collect into one bottom rail row,
   *    laid out left-to-right in id order.
   * Pure & deterministic: same args → identical Map.
   */
  export function organisedLayout(
    artefacts: LayoutArtefact[],
    categories: LayoutCategory[],
  ): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();

    // Stable column index per category id; trailing column for uncategorised.
    const colOf = new Map<string, number>();
    categories.forEach((c, i) => colOf.set(c.id, i));
    const UNFILED_COL = categories.length;

    // Partition: entities vs the rest, with a stable id sort for determinism.
    const byId = (a: LayoutArtefact, b: LayoutArtefact) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const sorted = [...artefacts].sort(byId);
    const entities = sorted.filter((a) => a.kind === 'entity');
    const stackables = sorted.filter((a) => a.kind !== 'entity');

    // Per-column running y, starting under the header band.
    const colCount = new Map<number, number>();
    let deepestY = HEADER_BAND_H;
    for (const a of stackables) {
      const col = a.categoryId != null && colOf.has(a.categoryId)
        ? colOf.get(a.categoryId)!
        : UNFILED_COL;
      const n = colCount.get(col) ?? 0;
      const x = col * COL_W;
      const y = HEADER_BAND_H + n * (CARD_H + CARD_GAP);
      out.set(a.id, { x, y });
      colCount.set(col, n + 1);
      if (y + CARD_H > deepestY) deepestY = y + CARD_H;
    }

    // Entity rail: one row beneath the deepest column.
    const railY = deepestY + RAIL_GAP;
    entities.forEach((e, i) => {
      out.set(e.id, { x: i * (CARD_W + CARD_GAP), y: railY });
    });

    return out;
  }

  /** Pixel bounding box of a positions map (each entry is a CARD_W×CARD_H card). */
  export function organisedCorePxBounds(
    positions: Map<string, { x: number; y: number }>,
  ): { minX: number; minY: number; maxX: number; maxY: number } {
    if (positions.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions.values()) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + CARD_W > maxX) maxX = p.x + CARD_W;
      if (p.y + CARD_H > maxY) maxY = p.y + CARD_H;
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Deterministic scatter for a NEW arrival that lands AROUND the organised core
   * (to the right of it) rather than over it. Falls back to plain scatterPosition
   * when the core is empty.
   */
  export function accumulationScatter(
    id: string,
    coreBounds: { minX: number; minY: number; maxX: number; maxY: number },
  ): { x: number; y: number } {
    const empty = coreBounds.maxX === 0 && coreBounds.maxY === 0
      && coreBounds.minX === 0 && coreBounds.minY === 0;
    if (empty) return scatterPosition(id, 99);
    const h = hashId(id);
    const laneW = COL_W;             // a column-wide gutter to the right of the core
    const x = coreBounds.maxX + RAIL_GAP + (h % 3) * laneW;
    const span = Math.max(CARD_H * 4, coreBounds.maxY - coreBounds.minY);
    const y = coreBounds.minY + ((h >> 3) % span);
    return { x, y };
  }
  ```

- [ ] **Step 5: Run the test green.**
  ```
  npx vitest run src/lib/canvas/intelligence/desk/layout.test.ts
  ```
  Expected: all tests pass (e.g. `Test Files  1 passed`, `Tests  11 passed`).

- [ ] **Step 6: Commit.**
  ```
  git add src/lib/canvas/intelligence/desk/layout.ts src/lib/canvas/intelligence/desk/layout.test.ts
  git commit -m "$(cat <<'EOF'
  desk: organisedLayout packer + sticky-accumulation helpers

  organisedLayout packs facts/sources into per-category columns and
  collects entities into a bottom rail; organisedCorePxBounds +
  accumulationScatter place SYNTHESIZE-era arrivals around the organised
  core. Pure, deterministic, unit-tested.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Synthesis-event reducer (`desk/synthesis-reducer.ts`) — category assignment + connector edges (TDD)

The `synthesis.*` event consumer is pure-reducible logic: given the current cards + a synthesis event, produce the card patches (deskCategory, deskState, synthesisRunId) and the synthesized cluster→fact connector edges. Extracting it makes it testable; the component just applies the result.

**Files:**
- Create: `src/lib/canvas/intelligence/desk/synthesis-reducer.ts`
- Create: `src/lib/canvas/intelligence/desk/synthesis-reducer.test.ts`

- [ ] **Step 1: Write the failing test.**
  ```ts
  // src/lib/canvas/intelligence/desk/synthesis-reducer.test.ts
  import { describe, it, expect } from 'vitest';
  import {
    initSynthesisState,
    applySynthesisEvent,
    type SynthesisEvent,
    type SynthesisState,
  } from './synthesis-reducer';

  function ev(stage: string, extra: Record<string, unknown> = {}): SynthesisEvent {
    return { seq: 1, runId: 'run-1', stage: stage as any, ...extra };
  }

  describe('applySynthesisEvent', () => {
    it('started clears prior tokens and marks running', () => {
      let s = initSynthesisState();
      s = applySynthesisEvent(s, ev('started', { factCount: 12, scope: { pinnedOnly: false } }));
      expect(s.runId).toBe('run-1');
      expect(s.status).toBe('running');
      expect(s.streamedText).toBe('');
      expect(s.factCount).toBe(12);
      expect(s.cardPatches).toEqual([]);
      expect(s.newEdges).toEqual([]);
    });

    it('progress tokens accumulate into streamedText', () => {
      let s = initSynthesisState();
      s = applySynthesisEvent(s, ev('started'));
      s = applySynthesisEvent(s, ev('progress', { token: 'Hel' }));
      s = applySynthesisEvent(s, ev('progress', { token: 'lo' }));
      expect(s.streamedText).toBe('Hello');
    });

    it('cluster events register the category and emit card patches for member facts', () => {
      let s = initSynthesisState();
      s = applySynthesisEvent(s, ev('started'));
      s = applySynthesisEvent(s, ev('cluster', {
        cluster: { id: 'c1', title: 'Funding', summary: 'about money', fact_ids: ['f1', 'f2'] },
      }));
      expect(s.categories).toEqual([{ id: 'c1', title: 'Funding' }]);
      // each member fact gets filed into the category + synthesized state + runId
      expect(s.cardPatches).toEqual([
        { id: 'f1', patch: { deskCategory: 'c1', deskState: 'synthesized', synthesisRunId: 'run-1' } },
        { id: 'f2', patch: { deskCategory: 'c1', deskState: 'synthesized', synthesisRunId: 'run-1' } },
      ]);
    });

    it('cluster events emit a header→fact connector edge per member fact', () => {
      let s = initSynthesisState();
      s = applySynthesisEvent(s, ev('started'));
      s = applySynthesisEvent(s, ev('cluster', {
        cluster: { id: 'c1', title: 'Funding', summary: '', fact_ids: ['f1'] },
      }));
      expect(s.newEdges).toEqual([
        { id: 'syn:c1:f1', fromId: 'cat:c1', toId: 'f1', kind: 'cluster' },
      ]);
    });

    it('dedups repeated cluster membership (idempotent on re-emit)', () => {
      let s = initSynthesisState();
      s = applySynthesisEvent(s, ev('started'));
      const c = { cluster: { id: 'c1', title: 'T', summary: '', fact_ids: ['f1'] } };
      s = applySynthesisEvent(s, ev('cluster', c));
      s = applySynthesisEvent(s, ev('cluster', c));
      expect(s.cardPatches.filter((p) => p.id === 'f1')).toHaveLength(1);
      expect(s.newEdges).toHaveLength(1);
      expect(s.categories).toHaveLength(1);
    });

    it('done sets status complete, summary and tokensUsed', () => {
      let s = initSynthesisState();
      s = applySynthesisEvent(s, ev('started'));
      s = applySynthesisEvent(s, ev('done', { summary: 'wrap up', tokensUsed: 4321, clusters: [] }));
      expect(s.status).toBe('complete');
      expect(s.summary).toBe('wrap up');
      expect(s.tokensUsed).toBe(4321);
    });

    it('ignores events from a stale runId once a newer run has started', () => {
      let s = initSynthesisState();
      s = applySynthesisEvent(s, ev('started')); // run-1
      s = applySynthesisEvent(s, { seq: 9, runId: 'run-2', stage: 'started' });
      // a late progress token from run-1 must not append
      s = applySynthesisEvent(s, { seq: 10, runId: 'run-1', stage: 'progress', token: 'X' });
      expect(s.runId).toBe('run-2');
      expect(s.streamedText).toBe('');
    });
  });
  ```

- [ ] **Step 2: Run it red.**
  ```
  npx vitest run src/lib/canvas/intelligence/desk/synthesis-reducer.test.ts
  ```
  Expected: module-not-found / export-missing failures.

- [ ] **Step 3: Implement `synthesis-reducer.ts`.**
  ```ts
  // src/lib/canvas/intelligence/desk/synthesis-reducer.ts
  // Pure reducer for synthesis.* SSE events → desk-side category + edge state.
  // Mirrors the SHARED CONTRACT synthesis event shape exactly.

  export interface SynthesisEvent {
    seq: number;
    runId: string;
    stage: 'started' | 'progress' | 'cluster' | 'done';
    token?: string;
    cluster?: { id: string; title: string; summary: string; fact_ids: string[] };
    summary?: string;
    clusters?: unknown[];
    scope?: unknown;
    factCount?: number;
    tokensUsed?: number;
  }

  export interface SynthCategory {
    id: string;
    title: string;
  }
  export interface SynthEdge {
    id: string;        // 'syn:<clusterId>:<factId>'
    fromId: string;    // 'cat:<clusterId>'
    toId: string;      // factId
    kind: 'cluster';
  }
  export interface CardPatch {
    id: string;
    patch: {
      deskCategory: string;
      deskState: 'synthesized';
      synthesisRunId: string;
    };
  }

  export interface SynthesisState {
    runId: string | null;
    status: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
    streamedText: string;
    factCount: number;
    summary: string | null;
    tokensUsed: number | null;
    categories: SynthCategory[];
    /** Card mutations to apply to the store (filed + categorised). */
    cardPatches: CardPatch[];
    /** Synthesized connector edges (header → fact). */
    newEdges: SynthEdge[];
    /** Internal: fact ids already filed, to keep the reducer idempotent. */
    _filed: Set<string>;
  }

  export function initSynthesisState(): SynthesisState {
    return {
      runId: null,
      status: 'idle',
      streamedText: '',
      factCount: 0,
      summary: null,
      tokensUsed: null,
      categories: [],
      cardPatches: [],
      newEdges: [],
      _filed: new Set<string>(),
    };
  }

  export function applySynthesisEvent(state: SynthesisState, ev: SynthesisEvent): SynthesisState {
    // A new run supersedes the old one: reset accumulation, adopt the new runId.
    if (ev.stage === 'started') {
      return {
        ...initSynthesisState(),
        runId: ev.runId,
        status: 'running',
        factCount: ev.factCount ?? 0,
      };
    }

    // Drop late events from a superseded run.
    if (state.runId !== null && ev.runId !== state.runId) return state;

    if (ev.stage === 'progress') {
      return { ...state, streamedText: state.streamedText + (ev.token ?? '') };
    }

    if (ev.stage === 'cluster' && ev.cluster) {
      const { id: cid, title, fact_ids } = ev.cluster;
      const categories = state.categories.some((c) => c.id === cid)
        ? state.categories
        : [...state.categories, { id: cid, title }];

      const filed = new Set(state._filed);
      const newPatches: CardPatch[] = [];
      const newEdges: SynthEdge[] = [];
      for (const fid of fact_ids ?? []) {
        if (filed.has(fid)) continue;
        filed.add(fid);
        newPatches.push({
          id: fid,
          patch: { deskCategory: cid, deskState: 'synthesized', synthesisRunId: state.runId! },
        });
        newEdges.push({ id: `syn:${cid}:${fid}`, fromId: `cat:${cid}`, toId: fid, kind: 'cluster' });
      }

      return {
        ...state,
        categories,
        cardPatches: [...state.cardPatches, ...newPatches],
        newEdges: [...state.newEdges, ...newEdges],
        _filed: filed,
      };
    }

    if (ev.stage === 'done') {
      return {
        ...state,
        status: 'complete',
        summary: ev.summary ?? state.summary,
        tokensUsed: ev.tokensUsed ?? state.tokensUsed,
      };
    }

    return state;
  }
  ```

- [ ] **Step 4: Run it green.**
  ```
  npx vitest run src/lib/canvas/intelligence/desk/synthesis-reducer.test.ts
  ```
  Expected: `Tests  7 passed`.

- [ ] **Step 5: Commit.**
  ```
  git add src/lib/canvas/intelligence/desk/synthesis-reducer.ts src/lib/canvas/intelligence/desk/synthesis-reducer.test.ts
  git commit -m "$(cat <<'EOF'
  desk: pure reducer for synthesis.* events → categories + connector edges

  applySynthesisEvent folds started/progress/cluster/done into category
  list, card patches (file + categorise + runId) and header→fact connector
  edges; idempotent on re-emit, drops late events from superseded runs.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Effective-position resolver (`desk/positioning.ts`) — morph/sticky/pinned rule (TDD)

This is the heart of the motion contract: given a card, the current mode, the organised positions, and the organised-core bounds, decide where the card *should* render. Pinned/dragged (non-null `canvasX/Y`) always win; filed cards stay filed (sticky); new arrivals scatter around the core. Pure → tested first; the component reads it inside a `$derived`.

**Files:**
- Create: `src/lib/canvas/intelligence/desk/positioning.ts`
- Create: `src/lib/canvas/intelligence/desk/positioning.test.ts`

- [ ] **Step 1: Write the failing test.**
  ```ts
  // src/lib/canvas/intelligence/desk/positioning.test.ts
  import { describe, it, expect } from 'vitest';
  import { effectivePosition, type PosCard } from './positioning';
  import { scatterPosition, organisedLayout, organisedCorePxBounds, accumulationScatter } from './layout';

  function card(p: Partial<PosCard> & { id: string }): PosCard {
    return {
      id: p.id,
      kind: p.kind ?? 'fact',
      phase: p.phase ?? 1,
      canvasX: p.canvasX ?? null,
      canvasY: p.canvasY ?? null,
      pinned: p.pinned ?? false,
      deskState: p.deskState ?? 'unfiled',
      deskCategory: p.deskCategory ?? null,
    };
  }

  describe('effectivePosition', () => {
    const organised = organisedLayout(
      [{ id: 'f1', kind: 'fact', categoryId: 'c1' }],
      [{ id: 'c1', title: 'C1' }],
    );
    const bounds = organisedCorePxBounds(organised);

    it('pinned/dragged cards keep canvasX/Y in BOTH modes', () => {
      const c = card({ id: 'f1', canvasX: 999, canvasY: 111, pinned: true, deskState: 'synthesized', deskCategory: 'c1' });
      expect(effectivePosition(c, 'gather', organised, bounds)).toEqual({ x: 999, y: 111 });
      expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual({ x: 999, y: 111 });
    });

    it('a non-pinned card with explicit canvasX/Y still honours it (user-dragged)', () => {
      const c = card({ id: 'f1', canvasX: 40, canvasY: 60, deskCategory: 'c1', deskState: 'synthesized' });
      expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual({ x: 40, y: 60 });
    });

    it('SYNTHESIZE: a filed card with no manual position takes its organised slot', () => {
      const c = card({ id: 'f1', deskCategory: 'c1', deskState: 'synthesized' });
      expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual(organised.get('f1'));
    });

    it('GATHER (sticky): a card already synthesized STAYS at its organised slot, does not eject', () => {
      const c = card({ id: 'f1', deskCategory: 'c1', deskState: 'synthesized' });
      expect(effectivePosition(c, 'gather', organised, bounds)).toEqual(organised.get('f1'));
    });

    it('GATHER: an unfiled phase-1 card uses deterministic scatterPosition', () => {
      const c = card({ id: 'u1', deskState: 'unfiled', phase: 1 });
      expect(effectivePosition(c, 'gather', organised, bounds)).toEqual(scatterPosition('u1', 1));
    });

    it('GATHER: a NEW arrival (phase 99) after synthesis scatters AROUND the core', () => {
      const c = card({ id: 'late1', deskState: 'unfiled', phase: 99 });
      expect(effectivePosition(c, 'gather', organised, bounds)).toEqual(accumulationScatter('late1', bounds));
    });

    it('SYNTHESIZE: an unfiled card (not yet folded in) parks around the core, not over it', () => {
      const c = card({ id: 'late2', deskState: 'unfiled', phase: 99 });
      expect(effectivePosition(c, 'synthesize', organised, bounds)).toEqual(accumulationScatter('late2', bounds));
    });
  });
  ```

- [ ] **Step 2: Run it red.**
  ```
  npx vitest run src/lib/canvas/intelligence/desk/positioning.test.ts
  ```
  Expected: `No "effectivePosition" export` failure.

- [ ] **Step 3: Implement `positioning.ts`.**
  ```ts
  // src/lib/canvas/intelligence/desk/positioning.ts
  // The morph/sticky/pinned motion contract, as a pure function.
  // The component renders card transforms from effectivePosition() inside a
  // CSS-transition'd translate, so changes animate (ease-in-out) automatically.

  import { scatterPosition, accumulationScatter } from './layout';

  export type DeskMode = 'gather' | 'synthesize';

  export interface PosCard {
    id: string;
    kind: string;
    phase: number;            // 1|2|3|99
    canvasX: number | null;
    canvasY: number | null;
    pinned: boolean;
    deskState: 'unfiled' | 'filed' | 'synthesized' | 'archived';
    deskCategory: string | null;
  }

  type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

  /**
   * Where a card should render right now.
   * Priority:
   *   1. Manual position (pinned OR user-dragged → non-null canvasX/Y) — wins in both modes.
   *   2. Already filed/synthesized — STAYS at its organised slot (sticky), even in GATHER.
   *   3. Unfiled new arrival (phase 99, i.e. post-synthesis) — scatters AROUND the core.
   *   4. Unfiled original arrival — deterministic phase-banded scatter.
   * If a filed card lacks an organised slot (e.g. mid-stream), fall back to scatter
   * so it never collapses to (0,0).
   */
  export function effectivePosition(
    card: PosCard,
    mode: DeskMode,
    organised: Map<string, { x: number; y: number }>,
    coreBounds: Bounds,
  ): { x: number; y: number } {
    // 1. Manual position always wins.
    if (card.canvasX != null && card.canvasY != null) {
      return { x: card.canvasX, y: card.canvasY };
    }

    const isFiled = card.deskState === 'synthesized' || card.deskState === 'filed';

    // 2. Sticky: a filed card keeps its organised slot in BOTH modes.
    if (isFiled) {
      const slot = organised.get(card.id);
      if (slot) return slot;
      // No slot yet → park around the core rather than (0,0).
      return accumulationScatter(card.id, coreBounds);
    }

    // 3 & 4. Unfiled cards.
    // Post-synthesis arrivals (phase 99) accumulate around the organised core.
    if (card.phase === 99) {
      return accumulationScatter(card.id, coreBounds);
    }
    // Original intake → deterministic phase-banded scatter.
    return scatterPosition(card.id, card.phase);
  }
  ```

- [ ] **Step 4: Run it green.**
  ```
  npx vitest run src/lib/canvas/intelligence/desk/positioning.test.ts
  ```
  Expected: `Tests  7 passed`.

- [ ] **Step 5: Commit.**
  ```
  git add src/lib/canvas/intelligence/desk/positioning.ts src/lib/canvas/intelligence/desk/positioning.test.ts
  git commit -m "$(cat <<'EOF'
  desk: effectivePosition — pure morph/sticky/pinned motion contract

  Manual position wins in both modes; filed cards stay sticky at their
  organised slot even in GATHER; unfiled post-synthesis arrivals scatter
  around the core; original intake uses deterministic phase scatter.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: `desk/ModeToggle.svelte` — the hero GATHER ⇄ SYNTHESIZE control

A two-state pill toggle. It is dumb: it reflects the current mode and `synthStatus`, and raises callbacks. The shell decides what to do (flip local mode; fire the synthesize POST).

**Component interface (props via `$props()`):**
```ts
let {
  mode,          // 'gather' | 'synthesize'  — current desk mode (bindable not needed; shell owns it)
  synthStatus,   // 'idle' | 'running' | 'complete' | 'failed' | 'cancelled'
  onGather,      // () => void  — user clicked GATHER
  onSynthesize,  // () => void  — user clicked SYNTHESIZE (shell decides: flip + maybe POST)
}: {
  mode: 'gather' | 'synthesize';
  synthStatus: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
  onGather: () => void;
  onSynthesize: () => void;
} = $props();
```

**Files:**
- Create: `src/lib/canvas/intelligence/desk/ModeToggle.svelte`

- [ ] **Step 1: Create the component.**
  ```svelte
  <!-- src/lib/canvas/intelligence/desk/ModeToggle.svelte -->
  <script lang="ts">
    let {
      mode,
      synthStatus,
      onGather,
      onSynthesize,
    }: {
      mode: 'gather' | 'synthesize';
      synthStatus: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
      onGather: () => void;
      onSynthesize: () => void;
    } = $props();

    const busy = $derived(synthStatus === 'running');
  </script>

  <div class="mode-toggle" role="group" aria-label="Desk mode">
    <button
      type="button"
      class="seg"
      class:active={mode === 'gather'}
      aria-pressed={mode === 'gather'}
      onclick={onGather}
    >
      <span class="dot gather" class:pulse={mode === 'gather'}></span>
      GATHER
    </button>
    <button
      type="button"
      class="seg"
      class:active={mode === 'synthesize'}
      class:busy
      aria-pressed={mode === 'synthesize'}
      onclick={onSynthesize}
    >
      <span class="dot synth" class:pulse={busy}></span>
      {busy ? 'SYNTHESISING…' : 'SYNTHESIZE'}
    </button>
  </div>

  <style>
    .mode-toggle {
      display: inline-flex;
      align-items: stretch;
      gap: 0;
      border: 1px solid rgba(26, 16, 8, 0.18);
      border-radius: 999px;
      background: var(--surface-elevated, #e8dece);
      padding: 3px;
      box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    }
    .seg {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted, rgba(26, 16, 8, 0.65));
      background: transparent;
      border: 0;
      border-radius: 999px;
      padding: 8px 16px;
      cursor: pointer;
      transition: background 160ms ease, color 160ms ease;
      white-space: nowrap;
    }
    .seg:hover { color: var(--text-primary, #1a1008); }
    .seg.active {
      color: var(--text-primary, #1a1008);
      background: var(--card, #faf6ee);
      box-shadow: inset 0 0 0 1px rgba(26, 16, 8, 0.18);
    }
    .seg.busy { color: var(--accent, #c4570a); }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: 0 0 auto;
      background: rgba(26, 16, 8, 0.3);
    }
    .dot.gather { background: var(--success, #2d7a3a); }
    .dot.synth { background: var(--accent, #c4570a); }
    .seg:not(.active) .dot { opacity: 0.45; }
    .pulse { animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.5); opacity: 0.5; }
    }
    @media (prefers-reduced-motion: reduce) {
      .pulse { animation: none; }
    }
  </style>
  ```

- [ ] **Step 2: Type-check the component compiles (svelte-check is the cheapest UI gate).**
  ```
  NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -i "ModeToggle" || echo "ModeToggle: no errors"
  ```
  Expected: `ModeToggle: no errors`.

- [ ] **Step 3: Manual verification (wired in Task 7; here just confirm render in isolation).** After Task 7 mounts it, load the desk and confirm: the pill shows two segments; the active one has the inset hairline + paper fill; clicking SYNTHESIZE shows `SYNTHESISING…` with an accent pulsing dot while `synthStatus==='running'`. Record the result inline; no automated UI test for this Svelte component.

- [ ] **Step 4: Commit.**
  ```
  git add src/lib/canvas/intelligence/desk/ModeToggle.svelte
  git commit -m "$(cat <<'EOF'
  desk: ModeToggle — hero GATHER⇄SYNTHESIZE pill

  Two-segment pill reflecting current mode + synth status (accent pulse
  while synthesising); dumb, raises onGather/onSynthesize callbacks.
  Warm-brutalist tokens, reduced-motion aware.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: `desk/CategoryHeader.svelte` — synthesized category group header

A header card that appears in SYNTHESIZE at the top of each category column. It is a positioned world-layer element (the shell renders it at `{x: col*COL_W, y:0}` so it sits in the `HEADER_BAND_H` reserved band). It is the `cat:<id>` connector anchor.

**Component interface:**
```ts
let {
  id,        // cluster id (without the 'cat:' prefix)
  title,     // cluster title
  summary,   // cluster summary (optional, truncated)
  count,     // number of member cards in this category
}: { id: string; title: string; summary?: string; count: number } = $props();
```

**Files:**
- Create: `src/lib/canvas/intelligence/desk/CategoryHeader.svelte`

- [ ] **Step 1: Create the component.**
  ```svelte
  <!-- src/lib/canvas/intelligence/desk/CategoryHeader.svelte -->
  <script lang="ts">
    let {
      id,
      title,
      summary = '',
      count,
    }: { id: string; title: string; summary?: string; count: number } = $props();
  </script>

  <div class="cat-header" data-cat-id={id} title={summary}>
    <div class="bar"></div>
    <div class="row">
      <span class="title">{title}</span>
      <span class="count">{count}</span>
    </div>
    {#if summary}
      <p class="summary">{summary}</p>
    {/if}
  </div>

  <style>
    .cat-header {
      width: 220px;
      box-sizing: border-box;
      background: var(--card, #faf6ee);
      border: 1px solid rgba(26, 16, 8, 0.18);
      border-radius: 4px;
      box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
      padding: 8px 10px 10px;
      overflow: hidden;
    }
    .bar {
      height: 3px;
      width: 28px;
      background: var(--accent, #c4570a);
      border-radius: 2px;
      margin-bottom: 7px;
    }
    .row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
    .title {
      font-family: var(--font-display, 'Archivo Black', sans-serif);
      font-size: 13px;
      line-height: 1.15;
      color: var(--text-primary, #1a1008);
    }
    .count {
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 11px;
      color: var(--accent, #c4570a);
      flex: 0 0 auto;
    }
    .summary {
      margin: 6px 0 0;
      font-family: var(--font-body, 'DM Sans', sans-serif);
      font-size: 11px;
      line-height: 1.35;
      color: var(--text-muted, rgba(26, 16, 8, 0.65));
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  </style>
  ```

- [ ] **Step 2: Type-check.**
  ```
  NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -i "CategoryHeader" || echo "CategoryHeader: no errors"
  ```
  Expected: `CategoryHeader: no errors`.

- [ ] **Step 3: Manual verification (after Task 7 wiring).** In SYNTHESIZE, each column shows a paper header with an accent bar, Archivo Black title, a mono member count, and a 2-line summary clamp. Confirm titles match the cluster titles streamed from synthesis. Record inline.

- [ ] **Step 4: Commit.**
  ```
  git add src/lib/canvas/intelligence/desk/CategoryHeader.svelte
  git commit -m "$(cat <<'EOF'
  desk: CategoryHeader — synthesized category group header card

  Per-column header anchor (cat:<id>) with accent bar, Archivo Black
  title, member count and clamped summary. Warm-brutalist tokens.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: `desk/EntityRail.svelte` — bottom rail of entity chips

A horizontal rail of black entity chips. It is a presentational strip the shell renders as a world-layer element at the rail row (computed in `organisedLayout`). Clicking a chip raises `onSelect(entityId)`. Each chip is also a connector anchor by its entity id (relationships are edges between entity ids).

**Component interface:**
```ts
let {
  entities,    // { id; name; type }[]  — sorted/ordered by the shell to match organisedLayout
  selectedId,  // string | null
  onSelect,    // (id: string) => void
}: {
  entities: { id: string; name: string; type: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
} = $props();
```

**Files:**
- Create: `src/lib/canvas/intelligence/desk/EntityRail.svelte`

- [ ] **Step 1: Create the component.**
  ```svelte
  <!-- src/lib/canvas/intelligence/desk/EntityRail.svelte -->
  <script lang="ts">
    let {
      entities,
      selectedId,
      onSelect,
    }: {
      entities: { id: string; name: string; type: string }[];
      selectedId: string | null;
      onSelect: (id: string) => void;
    } = $props();
  </script>

  <div class="entity-rail" role="list" aria-label="Entities">
    {#each entities as e (e.id)}
      <button
        type="button"
        class="chip"
        class:selected={selectedId === e.id}
        data-entity-id={e.id}
        role="listitem"
        title={e.type}
        onclick={() => onSelect(e.id)}
      >
        <span class="name">{e.name}</span>
        <span class="kind">{e.type}</span>
      </button>
    {/each}
  </div>

  <style>
    .entity-rail {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      align-items: flex-start;
    }
    .chip {
      display: inline-flex;
      flex-direction: column;
      gap: 2px;
      width: 220px;
      box-sizing: border-box;
      text-align: left;
      background: var(--text-primary, #1a1008);
      color: var(--card, #faf6ee);
      border: 1px solid rgba(26, 16, 8, 0.5);
      border-radius: 4px;
      box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
      padding: 9px 12px;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    .chip:hover { transform: translateY(-1px); }
    .chip.selected { outline: 2px solid var(--accent, #c4570a); outline-offset: 2px; }
    .name {
      font-family: var(--font-display, 'Archivo Black', sans-serif);
      font-size: 13px;
      line-height: 1.1;
    }
    .kind {
      font-family: var(--font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      opacity: 0.7;
    }
  </style>
  ```

- [ ] **Step 2: Type-check.**
  ```
  NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -i "EntityRail" || echo "EntityRail: no errors"
  ```
  Expected: `EntityRail: no errors`.

- [ ] **Step 3: Manual verification (after Task 7).** In SYNTHESIZE, the bottom rail shows black chips (Archivo Black names + mono type), clicking one highlights it (accent outline) and opens the inspector. Record inline.

- [ ] **Step 4: Commit.**
  ```
  git add src/lib/canvas/intelligence/desk/EntityRail.svelte
  git commit -m "$(cat <<'EOF'
  desk: EntityRail — bottom rail of black entity chips

  Presentational strip of Archivo-Black/mono entity chips; each chip is a
  relationship-edge anchor (data-entity-id) and raises onSelect.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Wire mode + morph + synthesize POST + synthesis consumer into `ResearchDesk.svelte`

The shell change: own `mode`, render the toggle, compute every card's transform from `effectivePosition` (CSS-transitioned so it morphs), render category headers + the entity rail in SYNTHESIZE, fire `POST /api/deepdive/[id]/synthesize` on the first synthesize per pile, and feed `synthesis.*` events through the reducer to file cards + draw connectors.

**Files:**
- Modify: `src/lib/canvas/intelligence/ResearchDesk.svelte` (the shell built in an earlier milestone). Re-read it first; the line refs below are approximate and WILL have drifted.

- [ ] **Step 1: Re-read the shell and locate the integration points.**
  ```
  grep -n "panX\|panY\|zoom\|cards\b\|edges\b\|patchCard\|EventSource\|onmessage\|world\|translate(\|orthPath\|minimap\|<ArtefactCard\|sessionId\|\$state.raw\|portal" src/lib/canvas/intelligence/ResearchDesk.svelte
  ```
  Identify and note exact symbol names for: the cards store accessor, the edges store accessor, the `patchCard` mutator, the SSE `onmessage`/event-dispatch site, the world-transform wrapper element, where `<ArtefactCard>` is rendered in the `{#each}`, and the `<svg>` connector layer. If `patchCard` is named differently (e.g. `applyPatch`), use the real name throughout this task.

- [ ] **Step 2: Add imports + mode/synthesis state to the `<script>`.** Insert near the other imports and state:
  ```ts
  import ModeToggle from './desk/ModeToggle.svelte';
  import CategoryHeader from './desk/CategoryHeader.svelte';
  import EntityRail from './desk/EntityRail.svelte';
  import { organisedLayout, organisedCorePxBounds, COL_W, type LayoutArtefact, type LayoutCategory } from './desk/layout';
  import { effectivePosition, type DeskMode } from './desk/positioning';
  import {
    initSynthesisState,
    applySynthesisEvent,
    type SynthesisEvent,
    type SynthesisState,
  } from './desk/synthesis-reducer';

  // ——— Desk mode + synthesis (Milestone 7) ———
  let mode = $state<DeskMode>('gather');
  let synth = $state<SynthesisState>(initSynthesisState());
  let synthesizing = $state(false);          // request in flight (debounce double-clicks)
  let everSynthesized = $state(false);       // have we ever folded this pile?
  ```

- [ ] **Step 3: Derive categories, the organised layout, the core bounds, and the entity-rail order.** Add after the cards/edges accessors. (Replace `cards`/`edges` with the real store accessor names found in Step 1.)
  ```ts
  // Categories come from the synthesis reducer (live during a run) merged with
  // any deskCategory already persisted on cards (so reloads show prior structure).
  const categories = $derived.by<LayoutCategory[]>(() => {
    const map = new Map<string, LayoutCategory>();
    for (const c of synth.categories) map.set(c.id, c);
    for (const card of cards) {
      if (card.deskCategory && !map.has(card.deskCategory)) {
        map.set(card.deskCategory, { id: card.deskCategory, title: card.deskCategory });
      }
    }
    return [...map.values()];
  });

  const layoutArtefacts = $derived.by<LayoutArtefact[]>(() =>
    cards.map((c) => ({ id: c.id, kind: c.kind, categoryId: c.deskCategory ?? undefined })),
  );

  const organised = $derived(organisedLayout(layoutArtefacts, categories));
  const coreBounds = $derived(organisedCorePxBounds(organised));

  // Per-category member counts (for the header badge).
  const categoryCounts = $derived.by<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const c of cards) if (c.deskCategory) out[c.deskCategory] = (out[c.deskCategory] ?? 0) + 1;
    return out;
  });

  // Entity rail order MUST match organisedLayout's id-sorted entity order.
  const railEntities = $derived.by(() =>
    cards
      .filter((c) => c.kind === 'entity')
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((c) => ({
        id: c.id,
        name: String(c.fields.name ?? ''),
        type: String(c.fields.type ?? ''),
      })),
  );

  // Effective position per card id — the morph source of truth.
  function posOf(card: (typeof cards)[number]) {
    return effectivePosition(card, mode, organised, coreBounds);
  }
  ```

- [ ] **Step 4: Add the toggle handlers (the synthesize POST wiring).** Per the SHARED CONTRACT route: `POST /api/deepdive/[id]/synthesize` body `{ scope }` → `201 { runId }`.
  ```ts
  function goGather() {
    mode = 'gather';
  }

  async function goSynthesize() {
    mode = 'synthesize';
    // Re-synthesize folds NEW loose cards into the existing structure.
    // Skip the POST if a run is already streaming.
    if (synthesizing || synth.status === 'running') return;
    synthesizing = true;
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // pinnedOnly:false → consider the whole loose pile; the server resolves the fact set.
        body: JSON.stringify({ scope: { pinnedOnly: false } }),
      });
      if (res.ok) {
        everSynthesized = true;
        // synthesis.started will arrive on the stream and reset `synth` via the reducer.
      } else {
        console.error('[desk] synthesize POST failed', res.status);
      }
    } catch (err) {
      console.error('[desk] synthesize POST error', err);
    } finally {
      synthesizing = false;
    }
  }
  ```

- [ ] **Step 5: Consume `synthesis` events in the existing SSE handler.** Find the SSE `onmessage`/dispatch switch from Step 1. The stream multiplexes the generic envelope `{ type, message?, data? }`; artefact handling already exists from an earlier milestone. Add a `synthesis` branch that runs the reducer and applies its `cardPatches` + `newEdges`. Insert alongside the existing `case 'artefact':` (use the real `patchCard`/edges-store names):
  ```ts
  // Inside the SSE event dispatch, add:
  if (parsed.type === 'synthesis') {
    const ev = parsed.data as unknown as SynthesisEvent;
    const prevPatchCount = synth.cardPatches.length;
    const prevEdgeCount = synth.newEdges.length;
    synth = applySynthesisEvent(synth, ev);
    // Apply only the newly-produced patches/edges (reducer accumulates).
    for (let i = prevPatchCount; i < synth.cardPatches.length; i++) {
      const cp = synth.cardPatches[i];
      patchCard(cp.id, cp.patch);   // files + categorises the card → it morphs to its slot
    }
    for (let i = prevEdgeCount; i < synth.newEdges.length; i++) {
      addSynthEdge(synth.newEdges[i]);
    }
    if (ev.stage === 'started') everSynthesized = true;
    return; // handled
  }
  ```
  If the shell's dispatch is a `switch (parsed.type)`, add it as `case 'synthesis': { …; break; }` instead.

- [ ] **Step 6: Add the synth-edge store + merged edge derivation.** The reducer's `SynthEdge` connects a `cat:<id>` header anchor to a fact card. Add a small reactive store and merge it with the relationship edges for rendering. Place near the edges accessor:
  ```ts
  // Synthesized connector edges (header → fact), keyed by edge id for dedup.
  let synthEdges = $state.raw<Record<string, { id: string; fromId: string; toId: string; kind: 'cluster' }>>({});
  function addSynthEdge(e: { id: string; fromId: string; toId: string; kind: 'cluster' }) {
    if (synthEdges[e.id]) return;
    synthEdges = { ...synthEdges, [e.id]: e };
  }

  // Resolve an anchor id to a world rect for orthPath. Category anchors ('cat:<id>')
  // resolve to the header position (column top); card anchors resolve via posOf.
  function anchorRect(anchorId: string): { x: number; y: number; w: number; h: number } | null {
    if (anchorId.startsWith('cat:')) {
      const catId = anchorId.slice(4);
      const idx = categories.findIndex((c) => c.id === catId);
      if (idx < 0) return null;
      return { x: idx * COL_W, y: 0, w: 220, h: 64 };
    }
    const card = cards.find((c) => c.id === anchorId);
    if (!card) return null;
    const p = posOf(card);
    return { x: p.x, y: p.y, w: 220, h: 120 };
  }
  ```
  Reuse the existing `orthPath` lifted into the shell from the canvas page (it takes `{x,y}` boxes with `nodeW/nodeH`). If the shell's `orthPath` reads `from.x/from.y` + `nodeW(from)`, adapt by passing `{ x, y }` plus making `nodeW`/`nodeH` return `220`/`120` for synth anchors, OR add a local `orthPathRect(a, b)` that inlines the lifted algorithm against `{x,y,w,h}`.

- [ ] **Step 7: Render the toggle in the command bar slot.** Where the shell renders `CommandBar` / the top bar, mount the toggle (or pass it through if `CommandBar` exposes a center slot). Minimal direct mount:
  ```svelte
  <ModeToggle
    {mode}
    synthStatus={synth.status}
    onGather={goGather}
    onSynthesize={goSynthesize}
  />
  ```

- [ ] **Step 8: Render category headers + entity rail in SYNTHESIZE, inside the world-transform layer.** Add alongside the existing `{#each cards}` `<ArtefactCard>` block (so they share the `translate(panX,panY) scale(zoom)` transform):
  ```svelte
  {#if mode === 'synthesize'}
    {#each categories as cat, i (cat.id)}
      <div class="world-item" style="transform: translate({i * COL_W}px, 0px);">
        <CategoryHeader
          id={cat.id}
          title={cat.title}
          summary={synth.categories.find((c) => c.id === cat.id) ? '' : ''}
          count={categoryCounts[cat.id] ?? 0}
        />
      </div>
    {/each}

    {#if railEntities.length}
      {@const railY = organised.get(railEntities[0].id)?.y ?? 0}
      <div class="world-item rail" style="transform: translate(0px, {railY}px);">
        <EntityRail entities={railEntities} {selectedId} onSelect={selectCard} />
      </div>
    {/if}
  {/if}
  ```
  (`selectedId`/`selectCard` are the shell's existing selection state + handler from Step 1; reuse the real names.)

- [ ] **Step 9: Make each card use `posOf` + a morph transition + UNFILED border resolution.** Update the `<ArtefactCard>` wrapper in the `{#each cards}` loop so its transform comes from `posOf(card)` and CSS-transitions, and pass an `unfiled` flag that resolves when filed. (Adapt to the shell's actual wrapper element.)
  ```svelte
  {#each cards as card (card.id)}
    {@const p = posOf(card)}
    <div
      class="world-item card-wrap"
      class:morphing={!card.pinned && card.canvasX == null}
      style="transform: translate({p.x}px, {p.y}px);"
    >
      <ArtefactCard
        {card}
        unfiled={card.deskState === 'unfiled'}
        selected={selectedId === card.id}
        onpointerdown={(e) => onCardPointerDown(e, card)}
        onselect={() => selectCard(card.id)}
      />
    </div>
  {/each}
  ```
  Add the morph transition CSS (cards that are NOT manually positioned animate between scatter and organised slots; pinned/dragged cards have `card.canvasX != null` so they skip the transition and never lag):
  ```svelte
  <style>
    .world-item { position: absolute; top: 0; left: 0; will-change: transform; }
    .card-wrap.morphing {
      transition: transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1);
    }
    @media (prefers-reduced-motion: reduce) {
      .card-wrap.morphing { transition: none; }
    }
  </style>
  ```
  Confirm `ArtefactCard.svelte` (earlier milestone) already renders the `1.5px dashed var(--accent)` no-shadow treatment when `unfiled` is true and resolves to the solid hairline + `3px 4px 0` shadow when false. If it does not accept an `unfiled` prop, add that prop + the conditional border there (one-line `class:unfiled` toggle) as part of this step.

- [ ] **Step 10: Render the synth connector edges in the SVG layer.** In the shell's `<svg class="edges">` (the connector layer rendered inside the world transform), add the synthesized edges next to the relationship edges:
  ```svelte
  {#if mode === 'synthesize'}
    {#each Object.values(synthEdges) as e (e.id)}
      {@const a = anchorRect(e.fromId)}
      {@const b = anchorRect(e.toId)}
      {#if a && b}
        <path
          d={orthPathRect(a, b)}
          fill="none"
          stroke="var(--accent)"
          stroke-width="1.25"
          stroke-opacity="0.45"
          vector-effect="non-scaling-stroke"
          class="syn-edge"
        />
      {/if}
    {/each}
  {/if}
  ```
  Add the draw-in CSS so connectors fade in on synthesize:
  ```svelte
  <style>
    .syn-edge { animation: fade-in 600ms ease both; }
    @keyframes fade-in { from { stroke-opacity: 0; } to { stroke-opacity: 0.45; } }
    @media (prefers-reduced-motion: reduce) { .syn-edge { animation: none; } }
  </style>
  ```
  Define `orthPathRect(a, b)` from the lifted `orthPath` algorithm if the shell's `orthPath` is node-shaped:
  ```ts
  function orthPathRect(
    from: { x: number; y: number; w: number; h: number },
    to: { x: number; y: number; w: number; h: number },
  ): string {
    const sCx = from.x + from.w / 2, sCy = from.y + from.h / 2;
    const tCx = to.x + to.w / 2, tCy = to.y + to.h / 2;
    const dx = tCx - sCx, dy = tCy - sCy;
    const overlapX = from.x < to.x + to.w && to.x < from.x + from.w;
    const overlapY = from.y < to.y + to.h && to.y < from.y + from.h;
    let horizontal: boolean;
    if (overlapX && !overlapY) horizontal = false;
    else if (overlapY && !overlapX) horizontal = true;
    else horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      const [x1, x2] = dx >= 0 ? [from.x + from.w, to.x] : [from.x, to.x + to.w];
      const midX = (x1 + x2) / 2;
      return `M${x1} ${sCy} L${midX} ${sCy} L${midX} ${tCy} L${x2} ${tCy}`;
    }
    const [y1, y2] = dy >= 0 ? [from.y + from.h, to.y] : [from.y, to.y + to.h];
    const midY = (y1 + y2) / 2;
    return `M${sCx} ${y1} L${sCx} ${midY} L${tCx} ${midY} L${tCx} ${y2}`;
  }
  ```

- [ ] **Step 11: Type-check the whole shell wiring.**
  ```
  NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -iE "ResearchDesk|desk/" || echo "Desk wiring: no errors"
  ```
  Expected: `Desk wiring: no errors`. Fix any real type mismatches (e.g. store accessor names) before proceeding.

- [ ] **Step 12: Run the full desk unit suite to confirm nothing regressed.**
  ```
  npx vitest run src/lib/canvas/intelligence/desk/
  ```
  Expected: all `layout.test.ts`, `synthesis-reducer.test.ts`, `positioning.test.ts` pass (`Test Files  3 passed`).

- [ ] **Step 13: Commit.**
  ```
  git add src/lib/canvas/intelligence/ResearchDesk.svelte src/lib/canvas/intelligence/desk/ArtefactCard.svelte
  git commit -m "$(cat <<'EOF'
  desk: wire mode toggle, morph, synthesize POST + synthesis consumer

  ResearchDesk owns gather/synthesize mode, renders ModeToggle, computes
  every card transform from effectivePosition (CSS-transitioned morph),
  renders CategoryHeader columns + EntityRail in synthesize, POSTs
  /synthesize on flip, and folds synthesis.* events through the reducer to
  file/categorise cards and draw fade-in connector edges. Pinned/dragged
  cards skip the transition and never move.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Manual E2E verification + deploy (per CLAUDE.md verify-live discipline)

The morph and synthesis wiring is realtime and visual — it must be exercised against a real run.

**Files:** none (verification only)

- [ ] **Step 1: Build locally with the sandbox disabled** (adapter-node fails under the sandbox).
  ```
  cd /home/john/strange_rambling_svelte && NODE_OPTIONS=--max-old-space-size=8192 npm run build
  ```
  Expected: build completes, `.svelte-kit/output` produced, no errors. If it fails, suspect stale `.svelte-kit/output` and `rm -rf .svelte-kit/output` then rebuild.
  (Run this Bash step with `dangerouslyDisableSandbox: true`.)

- [ ] **Step 2: Start dev and open a fresh deep run.** Start `npm run dev`, navigate to the launcher, submit a deep research prompt, and land on `/deepdive/[id]`.
  ```
  cd /home/john/strange_rambling_svelte && npm run dev
  ```
  Then open `http://homeserv:5173/jkai/research` (John is on the same LAN). Verify in GATHER: cards drop in at scattered positions with the dashed `UNFILED` border + `● UNFILED` tag; counters tick.

- [ ] **Step 2 checklist (record PASS/FAIL inline):**
  - [ ] GATHER: new artefacts arrive scattered with dashed accent border, no shadow.
  - [ ] Flip to SYNTHESIZE: the POST fires (Network tab shows `201 { runId }`); the toggle shows `SYNTHESISING…` with the accent pulse.
  - [ ] Cards **smoothly morph** (≈520ms) into category columns; `UNFILED` borders resolve to the solid hairline + shadow; CategoryHeaders appear at column tops; the EntityRail appears at the bottom; accent connector lines fade in from headers to their facts.
  - [ ] Drag a card, then **pin** it; flip GATHER↔SYNTHESIZE — the pinned card never moves in either mode.
  - [ ] Flip back to GATHER: filed cards **stay put** (sticky); let more artefacts arrive — they appear scattered **around** the organised core (to its right), not over it.
  - [ ] Hit SYNTHESIZE again (re-synthesize): the new loose cards fold into the existing structure; pinned/dragged cards keep their positions; previously-filed cards do not jump.

- [ ] **Step 3: Deploy to production.**
  ```
  /home/john/strange_rambling_svelte/scripts/deploy.sh
  ```
  (Run with `dangerouslyDisableSandbox: true`.) Expected: build + `drizzle-kit push --force` + restart succeed.

- [ ] **Step 4: Verify live on strangeramblings.com.** Open a deep run on production, repeat the Step-2 flip checklist (at least: artefacts arrive → SYNTHESIZE morphs + connectors → re-synthesize folds in, pinned stays). Confirm the served desk bundle contains the new toggle:
  ```
  curl -s https://strangeramblings.com/deepdive/ -o /dev/null -w "%{http_code}\n"
  ```
  Expected: a redirect/200 (auth-gated → may be a login redirect; that is fine, the desk is private). The substantive check is the in-browser flip on a logged-in session — record PASS/FAIL inline.

- [ ] **Step 5: Commit any verification-driven fixes** (only if Steps 2/4 surfaced a real defect; otherwise no commit). Use the same footer:
  ```
  git add -A && git commit -m "$(cat <<'EOF'
  desk: fixes from morph/synthesis live verification

  <one line per fix>

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

**Milestone 7 done when:** the three desk unit suites pass; `svelte-check` is clean for the new components and the shell; and the live flip checklist (Task 8 Steps 2 & 4) passes on production — artefacts gather, SYNTHESIZE morphs cards into categories + entity rail with fade-in connectors, pinned/dragged cards never move, GATHER is sticky, and re-synthesize folds new arrivals into the existing structure.

**Key files (absolute):**
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/layout.ts` (+ `layout.test.ts`)
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/synthesis-reducer.ts` (+ `.test.ts`)
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/positioning.ts` (+ `.test.ts`)
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/ModeToggle.svelte`
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/CategoryHeader.svelte`
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/desk/EntityRail.svelte`
- `/home/john/strange_rambling_svelte/src/lib/canvas/intelligence/ResearchDesk.svelte` (modified)


I now have a complete picture of the repo idioms, tokens, endpoints, and contracts. I'll write the milestone. Since this milestone's components consume a `deskStore` (built in earlier milestones), I'll define the exact prop contract each component expects against the SHARED CONTRACT and consume only documented store fields, with manual verification steps for the Svelte UI.

## Milestone 8: Cockpit chrome (command bar, left feed, ticker, inspector)

This milestone builds the four cockpit-chrome components that wrap the desk: `CommandBar.svelte` (top), `LeftFeed.svelte` (collapsible side), `ActivityTicker.svelte` (bottom dark strip), and `InspectorDrawer.svelte` (right portal drawer). It also adds `ModeToggle.svelte` (the hero GATHER⇄SYNTHESIZE control consumed by `CommandBar`). These components are **presentational** — they receive state via props and emit user intent via callbacks. `ResearchDesk.svelte` (built in an earlier milestone) owns the store and wires these together. Controls are wired to the **existing** endpoints: `PATCH /api/deepdive/[id]` (`{action:'stop'}` / `{action:'skip'}`), `POST /api/deepdive/[id]/share`, the `GET /api/deepdive/[id]/export/*` download endpoints, and `POST /api/deepdive/[id]/explore` (from `InspectorDrawer`).

**Assumed-available from earlier milestones (consume verbatim, do NOT redefine):**
- A reactive store instance with these read fields used here: `topic:string`, `sessionId:string`, `status:string` (one of `'draft'|'phase1'|'phase2'|'phase3'|'post_processing'|'complete'|'failed'`), `mode:'gather'|'synthesize'`, `counts:{sources:number;facts:number;entities:number;links:number;counterfactuals:number}`, `logs:{message:string;timestamp:number}[]`, `sources:DeskSource[]`, `cards:Map<string,DeskCard>`, `synthesisRuns:{runId:string;status:string;summary?:string;createdAt?:string}[]`, `typeFilters:{source:boolean;fact:boolean;entity:boolean;counterfactual:boolean}`, `synthesising:boolean`.
- Card/source/fact/entity shapes mirror the SHARED CONTRACT artefact fields plus `id`.

Because the store binding belongs to the shell, every component below takes its inputs as **plain props** and surfaces intent via **callback props** (Svelte 5 idiom). The shell passes store slices in and handles the callbacks. This keeps each component independently verifiable.

---

### Task 1: ModeToggle.svelte — the hero GATHER ⇄ SYNTHESIZE control

**Files:**
- Create `src/lib/canvas/intelligence/desk/ModeToggle.svelte`

Component interface:
```ts
let {
  mode,            // 'gather' | 'synthesize'
  synthesising,    // boolean — true while a synthesis run is streaming
  disabled = false,
  onmode,          // (next: 'gather' | 'synthesize') => void
}: {
  mode: 'gather' | 'synthesize';
  synthesising?: boolean;
  disabled?: boolean;
  onmode: (next: 'gather' | 'synthesize') => void;
} = $props();
```

- [ ] **Step 1: Create the component.**
```svelte
<!-- src/lib/canvas/intelligence/desk/ModeToggle.svelte -->
<script lang="ts">
  let {
    mode,
    synthesising = false,
    disabled = false,
    onmode,
  }: {
    mode: 'gather' | 'synthesize';
    synthesising?: boolean;
    disabled?: boolean;
    onmode: (next: 'gather' | 'synthesize') => void;
  } = $props();

  function pick(next: 'gather' | 'synthesize') {
    if (disabled) return;
    if (next === mode) return;
    onmode(next);
  }
</script>

<div class="mode-toggle" role="radiogroup" aria-label="Desk mode" class:disabled>
  <button
    type="button"
    role="radio"
    aria-checked={mode === 'gather'}
    class="seg"
    class:active={mode === 'gather'}
    onclick={() => pick('gather')}
    {disabled}
  >
    GATHER
  </button>
  <span class="arrows" aria-hidden="true">⇄</span>
  <button
    type="button"
    role="radio"
    aria-checked={mode === 'synthesize'}
    class="seg"
    class:active={mode === 'synthesize'}
    class:pulsing={synthesising}
    onclick={() => pick('synthesize')}
    {disabled}
  >
    SYNTHESIZE
    {#if synthesising}<span class="dot" aria-hidden="true"></span>{/if}
  </button>
</div>

<style>
  .mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-pill);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
  }
  .mode-toggle.disabled { opacity: 0.55; }
  .seg {
    position: relative;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    padding: 7px 16px;
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.18s ease, color 0.18s ease;
  }
  .seg:hover:not(:disabled) { color: var(--text-primary); }
  .seg:disabled { cursor: default; }
  .seg.active {
    background: var(--accent);
    color: #faf6ee;
    border-color: var(--accent);
  }
  .arrows {
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text-ghost);
  }
  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 6px;
    border-radius: 50%;
    background: #faf6ee;
    vertical-align: middle;
    animation: pulse 1s ease-in-out infinite;
  }
  .seg.pulsing { box-shadow: 0 0 0 0 rgba(196, 87, 10, 0.5); animation: ring 1.4s ease-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  @keyframes ring {
    0% { box-shadow: 0 0 0 0 rgba(196, 87, 10, 0.45); }
    100% { box-shadow: 0 0 0 8px rgba(196, 87, 10, 0); }
  }
</style>
```

- [ ] **Step 2: Manual verification.** Create a throwaway harness route to render the toggle in isolation, then delete it after checking.
```bash
cd /home/john/strange_rambling_svelte
mkdir -p "src/routes/_deskscratch"
cat > "src/routes/_deskscratch/+page.svelte" <<'EOF'
<script lang="ts">
  import ModeToggle from '$lib/canvas/intelligence/desk/ModeToggle.svelte';
  let mode = $state<'gather' | 'synthesize'>('gather');
  let synth = $state(false);
</script>
<div style="padding:40px;background:var(--bg);min-height:100vh">
  <ModeToggle {mode} synthesising={synth} onmode={(m) => (mode = m)} />
  <p style="font-family:var(--font-mono)">mode = {mode}</p>
  <button onclick={() => (synth = !synth)}>toggle synth pulse</button>
</div>
EOF
npm run dev >/tmp/desk-dev.log 2>&1 &
sleep 6 && grep -m1 "Local:" /tmp/desk-dev.log || tail -5 /tmp/desk-dev.log</parameter>
```
Open `http://homeserv:5173/_deskscratch`. Expected: a pill with `GATHER` filled burnt-orange (active), `⇄` between, `SYNTHESIZE` muted. Click `SYNTHESIZE` → it becomes filled, `mode = synthesize` updates, clicking the active segment again is a no-op. Click "toggle synth pulse" while on SYNTHESIZE → a small dot pulses and an accent ring animates. Kill dev when done: `pkill -f "vite.*5173" || pkill -f "npm run dev"`. Leave `_deskscratch` in place for Task 2/3/4 verification (deleted in Task 5).

- [ ] **Step 3: Commit.**
```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/ModeToggle.svelte
git commit -m "$(cat <<'EOF'
Add desk ModeToggle (GATHER⇄SYNTHESIZE hero control)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: deskControls.ts — pure status-pill + control-eligibility helpers (TDD)

These are the testable logic units the chrome shares: mapping `status` → a pill label/hue, and deciding which controls are enabled. Extracting them keeps `CommandBar` declarative and unit-testable.

**Files:**
- Create `src/lib/canvas/intelligence/desk/deskControls.ts`
- Create `src/lib/canvas/intelligence/desk/deskControls.test.ts`

- [ ] **Step 1: Write the test first.**
```ts
// src/lib/canvas/intelligence/desk/deskControls.test.ts
import { describe, it, expect } from 'vitest';
import { statusPill, controlState, type DeskStatus } from './deskControls';

describe('statusPill', () => {
  it('labels active phases as gathering with success hue', () => {
    for (const s of ['phase1', 'phase2', 'phase3', 'post_processing'] as DeskStatus[]) {
      const p = statusPill(s, false);
      expect(p.label.toLowerCase()).toContain('gathering');
      expect(p.hue).toBe('success');
    }
  });

  it('shows the phase number in the label', () => {
    expect(statusPill('phase1', false).label).toContain('1');
    expect(statusPill('phase3', false).label).toContain('3');
  });

  it('shows synthesising with accent hue when a synthesis run is live, overriding status', () => {
    const p = statusPill('phase2', true);
    expect(p.label.toLowerCase()).toContain('synthesising');
    expect(p.hue).toBe('accent');
  });

  it('labels complete and failed terminal states', () => {
    expect(statusPill('complete', false).label.toLowerCase()).toContain('complete');
    expect(statusPill('complete', false).hue).toBe('neutral');
    expect(statusPill('failed', false).label.toLowerCase()).toContain('failed');
    expect(statusPill('failed', false).hue).toBe('error');
  });

  it('synthesising on a complete session still reads synthesising', () => {
    const p = statusPill('complete', true);
    expect(p.label.toLowerCase()).toContain('synthesising');
    expect(p.hue).toBe('accent');
  });
});

describe('controlState', () => {
  it('allows pause/stop while the engine is running, not deepen', () => {
    const c = controlState('phase2', false);
    expect(c.canPause).toBe(true);
    expect(c.canStop).toBe(true);
    expect(c.canDeepen).toBe(false);
  });

  it('allows deepen/share once complete, not pause/stop', () => {
    const c = controlState('complete', false);
    expect(c.canPause).toBe(false);
    expect(c.canStop).toBe(false);
    expect(c.canDeepen).toBe(true);
    expect(c.canShare).toBe(true);
  });

  it('never enables pause while synthesising even mid-run', () => {
    expect(controlState('phase2', true).canPause).toBe(false);
  });

  it('share/export always available except in draft', () => {
    expect(controlState('draft', false).canShare).toBe(false);
    expect(controlState('phase1', false).canShare).toBe(true);
    expect(controlState('complete', false).canShare).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — expect failure (module missing).**
```bash
cd /home/john/strange_rambling_svelte
npx vitest run src/lib/canvas/intelligence/desk/deskControls.test.ts
```
Expected: fails to resolve `./deskControls` (`Failed to load url ./deskControls` / `Cannot find module`).

- [ ] **Step 3: Implement to pass.**
```ts
// src/lib/canvas/intelligence/desk/deskControls.ts
export type DeskStatus =
  | 'draft'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'post_processing'
  | 'complete'
  | 'failed';

export type PillHue = 'success' | 'accent' | 'neutral' | 'error';

export interface StatusPill {
  label: string;
  hue: PillHue;
}

const RUNNING: DeskStatus[] = ['phase1', 'phase2', 'phase3', 'post_processing'];

export function isRunning(status: DeskStatus): boolean {
  return RUNNING.includes(status);
}

/**
 * Maps the session status (+ live-synthesis flag) to the cockpit status pill.
 * A live synthesis run always overrides whatever the engine is doing.
 */
export function statusPill(status: DeskStatus, synthesising: boolean): StatusPill {
  if (synthesising) {
    return { label: '● synthesising', hue: 'accent' };
  }
  switch (status) {
    case 'phase1':
      return { label: '● gathering · phase 1', hue: 'success' };
    case 'phase2':
      return { label: '● gathering · phase 2', hue: 'success' };
    case 'phase3':
      return { label: '● gathering · phase 3', hue: 'success' };
    case 'post_processing':
      return { label: '● gathering · finalising', hue: 'success' };
    case 'complete':
      return { label: '● complete', hue: 'neutral' };
    case 'failed':
      return { label: '● failed', hue: 'error' };
    case 'draft':
    default:
      return { label: '● idle', hue: 'neutral' };
  }
}

export interface ControlState {
  canPause: boolean;
  canStop: boolean;
  canDeepen: boolean;
  canShare: boolean;
}

/** Which cockpit controls are actionable for the current status. */
export function controlState(status: DeskStatus, synthesising: boolean): ControlState {
  const running = isRunning(status);
  return {
    canPause: running && !synthesising,
    canStop: running,
    canDeepen: status === 'complete',
    canShare: status !== 'draft',
  };
}
```

- [ ] **Step 4: Run the test — expect pass.**
```bash
cd /home/john/strange_rambling_svelte
npx vitest run src/lib/canvas/intelligence/desk/deskControls.test.ts
```
Expected: `Test Files  1 passed`, all `controlState` + `statusPill` cases green (`13 passed` assertions across the suites).

- [ ] **Step 5: Commit.**
```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/deskControls.ts src/lib/canvas/intelligence/desk/deskControls.test.ts
git commit -m "$(cat <<'EOF'
Add desk control/status-pill helpers with unit tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: CommandBar.svelte — top cockpit bar (monogram, topic, mode toggle, counters, controls, status pill)

Renders the full top strip. The "pause" control maps to the engine's **skip** action (the engine has no true pause — `action:'skip'` advances the phase; the spec's ⏸ is the closest existing affordance). The bar consumes `deskControls.ts` for pill/enablement and embeds `ModeToggle`. All network side-effects are performed by the shell via callbacks; the bar only computes display + dispatches intent.

**Files:**
- Create `src/lib/canvas/intelligence/desk/CommandBar.svelte`

Component interface:
```ts
let {
  topic, sessionId, status, mode, synthesising,
  counts,            // { sources, facts, entities, links, counterfactuals }
  onmode,            // (next:'gather'|'synthesize') => void   -> shell flips desk mode (and POSTs /synthesize when entering synth)
  onskip,            // () => void  -> shell PATCHes { action:'skip' }
  onstop,            // () => void  -> shell PATCHes { action:'stop' }
  ondeepen,          // () => void  -> shell opens deepen affordance
  onshare,           // () => void  -> shell POSTs /share then surfaces token
  onexport,          // (kind:'docx'|'narrative-docx'|'narrative-md') => void -> shell triggers download
}: { ... } = $props();
```

- [ ] **Step 1: Create the component.**
```svelte
<!-- src/lib/canvas/intelligence/desk/CommandBar.svelte -->
<script lang="ts">
  import ModeToggle from './ModeToggle.svelte';
  import { statusPill, controlState, type DeskStatus } from './deskControls';

  let {
    topic,
    sessionId,
    status,
    mode,
    synthesising = false,
    counts,
    onmode,
    onskip,
    onstop,
    ondeepen,
    onshare,
    onexport,
  }: {
    topic: string;
    sessionId: string;
    status: DeskStatus;
    mode: 'gather' | 'synthesize';
    synthesising?: boolean;
    counts: {
      sources: number;
      facts: number;
      entities: number;
      links: number;
      counterfactuals: number;
    };
    onmode: (next: 'gather' | 'synthesize') => void;
    onskip: () => void;
    onstop: () => void;
    ondeepen: () => void;
    onshare: () => void;
    onexport: (kind: 'docx' | 'narrative-docx' | 'narrative-md') => void;
  } = $props();

  let pill = $derived(statusPill(status, synthesising));
  let ctl = $derived(controlState(status, synthesising));

  let exportOpen = $state(false);
  function chooseExport(kind: 'docx' | 'narrative-docx' | 'narrative-md') {
    exportOpen = false;
    onexport(kind);
  }
</script>

<header class="cmdbar">
  <div class="left">
    <a class="mono-mark" href="/jkai/research" title="Back to research launcher">sr.</a>
    <h1 class="topic" title={topic}>{topic}</h1>
  </div>

  <div class="center">
    <ModeToggle {mode} {synthesising} onmode={onmode} />
  </div>

  <div class="right">
    <div class="counters" aria-label="Artefact counts">
      <span class="counter"><b>{counts.sources}</b> src</span>
      <span class="counter"><b>{counts.facts}</b> facts</span>
      <span class="counter"><b>{counts.entities}</b> ent</span>
      <span class="counter"><b>{counts.links}</b> links</span>
      {#if counts.counterfactuals > 0}
        <span class="counter challenge"><b>{counts.counterfactuals}</b> chal</span>
      {/if}
    </div>

    <div class="controls">
      <button
        type="button"
        class="ctl"
        title="Skip current phase"
        disabled={!ctl.canPause}
        onclick={onskip}
      >⏭</button>
      <button
        type="button"
        class="ctl danger"
        title="Stop & finalise"
        disabled={!ctl.canStop}
        onclick={onstop}
      >◼</button>
      <button
        type="button"
        class="ctl"
        title="Deepen (explore further)"
        disabled={!ctl.canDeepen}
        onclick={ondeepen}
      >⤓</button>
      <div class="export-wrap">
        <button
          type="button"
          class="ctl"
          title="Share / export"
          disabled={!ctl.canShare}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          onclick={() => (exportOpen = !exportOpen)}
        >⤴</button>
        {#if exportOpen}
          <div class="export-menu" role="menu">
            <button role="menuitem" onclick={() => { exportOpen = false; onshare(); }}>Copy share link</button>
            <button role="menuitem" onclick={() => chooseExport('docx')}>Export report (.docx)</button>
            <button role="menuitem" onclick={() => chooseExport('narrative-docx')}>Export narrative (.docx)</button>
            <button role="menuitem" onclick={() => chooseExport('narrative-md')}>Export narrative (.md)</button>
          </div>
        {/if}
      </div>
    </div>

    <span class="pill pill-{pill.hue}">{pill.label}</span>
  </div>
</header>

<svelte:window onclick={(e) => {
  if (exportOpen && !(e.target as HTMLElement).closest('.export-wrap')) exportOpen = false;
}} />

<style>
  .cmdbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
    height: 56px;
    padding: 0 16px;
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--card-border);
    box-shadow: 0 2px 0 rgba(26, 16, 8, 0.06);
    z-index: 30;
  }
  .left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .mono-mark {
    font-family: var(--font-brand);
    font-size: 18px;
    font-weight: 500;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .mono-mark:hover { color: var(--accent-hover); }
  .topic {
    font-family: var(--font-body);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .center { display: flex; justify-content: center; }
  .right { display: flex; align-items: center; justify-content: flex-end; gap: 14px; }

  .counters { display: flex; align-items: center; gap: 10px; }
  .counter {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }
  .counter b { color: var(--text-primary); font-weight: 600; }
  .counter.challenge b { color: var(--error); }

  .controls { display: flex; align-items: center; gap: 4px; }
  .ctl {
    font-size: 13px;
    line-height: 1;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .ctl:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .ctl.danger:hover:not(:disabled) { border-color: var(--error); color: var(--error); }
  .ctl:disabled { opacity: 0.35; cursor: default; }

  .export-wrap { position: relative; }
  .export-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 200px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    z-index: 40;
  }
  .export-menu button {
    display: block;
    width: 100%;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    background: transparent;
    border: none;
    padding: 8px 10px;
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .export-menu button:hover { background: var(--accent-tint-08); color: var(--accent); }

  .pill {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    padding: 5px 10px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .pill-success { color: var(--success); background: var(--success-bg); border: 1px solid var(--success-border); }
  .pill-accent  { color: var(--accent);  background: var(--accent-tint-08); border: 1px solid var(--accent-tint-35); }
  .pill-neutral { color: var(--text-muted); background: var(--card-bg); border: 1px solid var(--card-border); }
  .pill-error   { color: var(--error); background: var(--error-bg); border: 1px solid var(--error-border); }
</style>
```

- [ ] **Step 2: Manual verification.** Point the scratch route at the bar with a fake-running and a fake-complete session.
```bash
cd /home/john/strange_rambling_svelte
cat > "src/routes/_deskscratch/+page.svelte" <<'EOF'
<script lang="ts">
  import CommandBar from '$lib/canvas/intelligence/desk/CommandBar.svelte';
  import type { DeskStatus } from '$lib/canvas/intelligence/desk/deskControls';
  let status = $state<DeskStatus>('phase2');
  let mode = $state<'gather' | 'synthesize'>('gather');
  let synth = $state(false);
  const counts = { sources: 14, facts: 88, entities: 21, links: 9, counterfactuals: 3 };
  const log = (m: string) => console.log('[cmdbar]', m);
</script>
<div style="background:var(--bg);min-height:100vh">
  <CommandBar
    topic="Why did the Roman Republic collapse into empire?"
    sessionId="demo"
    {status} {mode} synthesising={synth} {counts}
    onmode={(m) => { mode = m; synth = m === 'synthesize'; log('mode ' + m); }}
    onskip={() => log('skip')}
    onstop={() => log('stop')}
    ondeepen={() => log('deepen')}
    onshare={() => log('share')}
    onexport={(k) => log('export ' + k)}
  />
  <div style="padding:20px;font-family:var(--font-mono)">
    <button onclick={() => (status = status === 'phase2' ? 'complete' : 'phase2')}>toggle status (now: {status})</button>
  </div>
</div>
EOF
npm run dev >/tmp/desk-dev.log 2>&1 &
sleep 6 && grep -m1 "Local:" /tmp/desk-dev.log || tail -5 /tmp/desk-dev.log
```
Open `http://homeserv:5173/_deskscratch` with the devtools console visible. Expected while `phase2`: `sr.` mark + topic (ellipsised) on the left, the centred toggle, counters (`14 src 88 facts 21 ent 9 links` + red `3 chal`), controls with ⏭ + ◼ enabled, ⤓ disabled (greyed), ⤴ enabled, and a green `● gathering · phase 2` pill. Click ⤴ → menu opens with Copy share link + 3 export rows; clicking each logs the right intent and closes; clicking outside closes it. Click toggle SYNTHESIZE → pill flips to accent `● synthesising`, ⏭ greys out. Click "toggle status" → now `complete`: pill neutral `● complete`, ⏭/◼ greyed, ⤓ enabled. Kill dev: `pkill -f "vite.*5173"`.

- [ ] **Step 3: Commit.**
```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/CommandBar.svelte
git commit -m "$(cat <<'EOF'
Add desk CommandBar (monogram, topic, mode toggle, counters, controls, status pill)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: ActivityTicker.svelte — dark bottom strip narrating the current engine action (TDD on the narration helper)

The ticker shows the most recent meaningful log line in a dark strip. The narration extraction (strip the leading emoji/icon that `emitLog` prepends as `"${icon}  ${message}"`, collapse whitespace, pick the latest) is pure and tested; the component is thin.

**Files:**
- Create `src/lib/canvas/intelligence/desk/tickerText.ts`
- Create `src/lib/canvas/intelligence/desk/tickerText.test.ts`
- Create `src/lib/canvas/intelligence/desk/ActivityTicker.svelte`

- [ ] **Step 1: Write the helper test first.**
```ts
// src/lib/canvas/intelligence/desk/tickerText.test.ts
import { describe, it, expect } from 'vitest';
import { tickerLine } from './tickerText';

describe('tickerLine', () => {
  it('returns an idle placeholder for an empty log', () => {
    expect(tickerLine([])).toMatch(/idle|waiting|stand/i);
  });

  it('strips the leading emoji + double-space that emitLog prepends', () => {
    // emitLog formats as `${icon}  ${message}`
    const out = tickerLine([{ message: '🔍  Searching: roman republic fall causes', timestamp: 1 }]);
    expect(out).toBe('Searching: roman republic fall causes');
  });

  it('uses the most recent log entry', () => {
    const out = tickerLine([
      { message: 'ℹ️  Starting Phase 1', timestamp: 1 },
      { message: '🔍  Extracting facts from source 4', timestamp: 2 },
    ]);
    expect(out).toBe('Extracting facts from source 4');
  });

  it('collapses internal whitespace and trims', () => {
    const out = tickerLine([{ message: '⚠️   Phase 2   error:   timeout  ', timestamp: 1 }]);
    expect(out).toBe('Phase 2 error: timeout');
  });

  it('leaves messages without a leading icon untouched (just trimmed)', () => {
    expect(tickerLine([{ message: 'Research complete!', timestamp: 1 }])).toBe('Research complete!');
  });
});
```

- [ ] **Step 2: Run the test — expect failure.**
```bash
cd /home/john/strange_rambling_svelte
npx vitest run src/lib/canvas/intelligence/desk/tickerText.test.ts
```
Expected: fails to resolve `./tickerText`.

- [ ] **Step 3: Implement the helper.**
```ts
// src/lib/canvas/intelligence/desk/tickerText.ts
export interface TickerLog {
  message: string;
  timestamp: number;
}

// Leading emoji/pictograph(s) optionally followed by a VS16, then whitespace.
// emitLog() prepends `${icon}  ${message}` with two spaces.
const LEADING_ICON =
  /^[\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}\u2139\u26A0\u2705]+\s*/u;

/** Latest log line, with the emitLog icon prefix stripped and whitespace collapsed. */
export function tickerLine(logs: TickerLog[]): string {
  if (!logs || logs.length === 0) return 'idle · standing by';
  const last = logs[logs.length - 1]?.message ?? '';
  return last.replace(LEADING_ICON, '').replace(/\s+/g, ' ').trim() || 'idle · standing by';
}
```

- [ ] **Step 4: Run the test — expect pass.**
```bash
cd /home/john/strange_rambling_svelte
npx vitest run src/lib/canvas/intelligence/desk/tickerText.test.ts
```
Expected: `Test Files  1 passed`, `5 passed`. If the emoji-class regex flags a case, adjust `LEADING_ICON` until all five pass — do not change the test expectations.

- [ ] **Step 5: Create the component.**
```svelte
<!-- src/lib/canvas/intelligence/desk/ActivityTicker.svelte -->
<script lang="ts">
  import { tickerLine, type TickerLog } from './tickerText';

  let {
    logs,
    live = false,   // true while the engine or a synthesis run is active
  }: {
    logs: TickerLog[];
    live?: boolean;
  } = $props();

  let line = $derived(tickerLine(logs));
</script>

<div class="ticker" class:live aria-live="polite">
  <span class="tag">{live ? 'LIVE' : 'IDLE'}</span>
  <span class="beam" aria-hidden="true"></span>
  <span class="text">{line}</span>
</div>

<style>
  .ticker {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 30px;
    padding: 0 14px;
    background: #1a1008;
    border-top: 1px solid rgba(250, 246, 238, 0.12);
    color: #ede4d4;
    font-family: var(--font-mono);
    font-size: 11.5px;
    letter-spacing: 0.02em;
    overflow: hidden;
    z-index: 30;
  }
  .tag {
    font-size: 9.5px;
    letter-spacing: 0.12em;
    padding: 2px 6px;
    border-radius: var(--radius-sharp);
    color: var(--text-ghost);
    border: 1px solid rgba(250, 246, 238, 0.18);
    flex-shrink: 0;
  }
  .ticker.live .tag { color: #ede4d4; border-color: var(--accent); }
  .beam {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(250, 246, 238, 0.25);
    flex-shrink: 0;
  }
  .ticker.live .beam { background: var(--accent); animation: blink 1.1s ease-in-out infinite; }
  .text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: rgba(237, 228, 212, 0.92);
  }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
</style>
```

- [ ] **Step 6: Manual verification.** Render the ticker from the scratch route with a small fake log stream.
```bash
cd /home/john/strange_rambling_svelte
cat > "src/routes/_deskscratch/+page.svelte" <<'EOF'
<script lang="ts">
  import ActivityTicker from '$lib/canvas/intelligence/desk/ActivityTicker.svelte';
  let logs = $state<{ message: string; timestamp: number }[]>([]);
  let live = $state(true);
  let i = 0;
  const samples = ['🔍  Searching: roman senate reforms', 'ℹ️  Phase 2: extracting facts', '⚠️  Source 7 timed out, skipping'];
  setInterval(() => {
    logs = [...logs.slice(-50), { message: samples[i++ % samples.length], timestamp: Date.now() }];
  }, 1500);
</script>
<div style="background:var(--bg);min-height:100vh;display:flex;flex-direction:column">
  <div style="flex:1"></div>
  <ActivityTicker {logs} {live} />
  <div style="padding:8px"><button onclick={() => (live = !live)}>toggle live</button></div>
</div>
EOF
npm run dev >/tmp/desk-dev.log 2>&1 &
sleep 6 && grep -m1 "Local:" /tmp/desk-dev.log || tail -5 /tmp/desk-dev.log
```
Open `http://homeserv:5173/_deskscratch`. Expected: a dark strip at the bottom with an accent `LIVE` tag, a blinking accent dot, and the narration cycling every 1.5s with the leading emoji stripped (e.g. `Searching: roman senate reforms`). Click "toggle live" → tag dims to `IDLE`, dot stops blinking. Kill dev: `pkill -f "vite.*5173"`.

- [ ] **Step 7: Commit.**
```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/tickerText.ts src/lib/canvas/intelligence/desk/tickerText.test.ts src/lib/canvas/intelligence/desk/ActivityTicker.svelte
git commit -m "$(cat <<'EOF'
Add desk ActivityTicker + tested narration helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: LeftFeed.svelte — collapsible side panel (activity log, source list, legend, type filters, synthesis history)

A panel that collapses to a thin spine. Sections: live activity log (newest first), source list (links open in new tab), a legend for card treatments, artefact-type filter toggles (controlled — values come in via `filters`, changes go out via `onfilter`), and synthesis-run history (clicking a run calls `onselectrun`).

**Files:**
- Create `src/lib/canvas/intelligence/desk/LeftFeed.svelte`

Component interface:
```ts
let {
  logs,            // { message, timestamp }[]
  sources,         // { id, url, title, domain, credibilityType?, credibilityScore? }[]
  filters,         // { source, fact, entity, counterfactual } booleans
  synthesisRuns,   // { runId, status, summary?, createdAt? }[]
  collapsed = $bindable(false),
  onfilter,        // (key:'source'|'fact'|'entity'|'counterfactual', value:boolean) => void
  onselectrun,     // (runId:string) => void
}: { ... } = $props();
```

- [ ] **Step 1: Create the component.**
```svelte
<!-- src/lib/canvas/intelligence/desk/LeftFeed.svelte -->
<script lang="ts">
  import { tickerLine, type TickerLog } from './tickerText';

  interface FeedSource {
    id: string;
    url: string;
    title: string | null;
    domain: string;
    credibilityType?: string | null;
    credibilityScore?: number | null;
  }
  interface SynthRun {
    runId: string;
    status: string;
    summary?: string | null;
    createdAt?: string | null;
  }

  let {
    logs,
    sources,
    filters,
    synthesisRuns,
    collapsed = $bindable(false),
    onfilter,
    onselectrun,
  }: {
    logs: TickerLog[];
    sources: FeedSource[];
    filters: { source: boolean; fact: boolean; entity: boolean; counterfactual: boolean };
    synthesisRuns: SynthRun[];
    collapsed?: boolean;
    onfilter: (key: 'source' | 'fact' | 'entity' | 'counterfactual', value: boolean) => void;
    onselectrun: (runId: string) => void;
  } = $props();

  // Newest-first log view, lightly cleaned via the shared narration helper.
  let logView = $derived(
    [...logs].slice(-60).reverse().map((l) => ({
      text: tickerLine([l]),
      timestamp: l.timestamp,
    })),
  );

  const filterDefs: { key: 'source' | 'fact' | 'entity' | 'counterfactual'; label: string; swatch: string }[] = [
    { key: 'source', label: 'Sources', swatch: 'src' },
    { key: 'fact', label: 'Facts', swatch: 'fact' },
    { key: 'entity', label: 'Entities', swatch: 'ent' },
    { key: 'counterfactual', label: 'Challenges', swatch: 'chal' },
  ];

  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
</script>

<aside class="left-feed" class:collapsed>
  <button
    type="button"
    class="spine-toggle"
    title={collapsed ? 'Expand feed' : 'Collapse feed'}
    aria-expanded={!collapsed}
    onclick={() => (collapsed = !collapsed)}
  >
    {collapsed ? '›' : '‹'}
  </button>

  {#if collapsed}
    <div class="spine">
      <span class="spine-label">FEED</span>
    </div>
  {:else}
    <div class="feed-body">
      <!-- Type filters -->
      <section class="feed-sec">
        <h3>FILTERS</h3>
        <div class="filters">
          {#each filterDefs as f (f.key)}
            <label class="filter-row">
              <input
                type="checkbox"
                checked={filters[f.key]}
                onchange={(e) => onfilter(f.key, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span class="swatch swatch-{f.swatch}"></span>
              {f.label}
            </label>
          {/each}
        </div>
      </section>

      <!-- Legend -->
      <section class="feed-sec">
        <h3>LEGEND</h3>
        <ul class="legend">
          <li><span class="lg-card"></span> paper card = source / fact</li>
          <li><span class="lg-chip"></span> black chip = entity</li>
          <li><span class="lg-unfiled"></span> dashed = unfiled</li>
          <li><span class="lg-edge"></span> line = relationship</li>
        </ul>
      </section>

      <!-- Synthesis history -->
      {#if synthesisRuns.length > 0}
        <section class="feed-sec">
          <h3>SYNTHESIS RUNS</h3>
          <ul class="runs">
            {#each synthesisRuns as r (r.runId)}
              <li>
                <button type="button" class="run" onclick={() => onselectrun(r.runId)}>
                  <span class="run-status run-{r.status}">{r.status}</span>
                  <span class="run-summary">{r.summary ?? r.runId.slice(0, 8)}</span>
                  {#if r.createdAt}<span class="run-time">{fmtTime(new Date(r.createdAt).getTime())}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Source list -->
      <section class="feed-sec">
        <h3>SOURCES <span class="count">{sources.length}</span></h3>
        <ul class="sources">
          {#each sources as s (s.id)}
            <li>
              <a href={s.url} target="_blank" rel="noopener noreferrer" class="source" title={s.url}>
                <span class="src-domain">{s.domain}</span>
                <span class="src-title">{s.title ?? s.url}</span>
                {#if s.credibilityType}<span class="src-cred">{s.credibilityType}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      </section>

      <!-- Activity log -->
      <section class="feed-sec">
        <h3>ACTIVITY</h3>
        <ul class="log">
          {#each logView as l (l.timestamp)}
            <li><span class="log-time">{fmtTime(l.timestamp)}</span> {l.text}</li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</aside>

<style>
  .left-feed {
    position: relative;
    width: 300px;
    flex-shrink: 0;
    background: var(--surface-elevated);
    border-right: 1px solid var(--card-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.18s ease;
    z-index: 25;
  }
  .left-feed.collapsed { width: 32px; }

  .spine-toggle {
    position: absolute;
    top: 8px;
    right: 6px;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    z-index: 2;
  }
  .spine-toggle:hover { color: var(--accent); border-color: var(--accent); }

  .spine {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
  }
  .spine-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--text-ghost);
  }

  .feed-body { overflow-y: auto; padding: 12px 12px 24px; }
  .feed-sec { margin-bottom: 18px; }
  .feed-sec h3 {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    margin: 0 0 8px;
    text-transform: uppercase;
  }
  .feed-sec h3 .count { color: var(--text-muted); }

  .filters { display: flex; flex-direction: column; gap: 6px; }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  .swatch-src { background: #faf6ee; border: 1px solid var(--card-border); }
  .swatch-fact { background: var(--accent-tint-25); border: 1px solid var(--accent); }
  .swatch-ent { background: #1a1008; }
  .swatch-chal { background: var(--error-bg); border: 1px solid var(--error); }

  .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .legend li {
    display: flex; align-items: center; gap: 8px;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);
  }
  .lg-card { width: 14px; height: 10px; background: #faf6ee; border: 1px solid var(--card-border); box-shadow: 1px 1px 0 rgba(26,16,8,.1); }
  .lg-chip { width: 14px; height: 10px; background: #1a1008; }
  .lg-unfiled { width: 14px; height: 10px; border: 1.5px dashed var(--accent); }
  .lg-edge { width: 14px; height: 0; border-top: 1.5px solid var(--text-muted); }

  .runs, .sources, .log { list-style: none; margin: 0; padding: 0; }
  .run {
    display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp);
    padding: 6px 8px; margin-bottom: 6px; cursor: pointer;
  }
  .run:hover { border-color: var(--accent); }
  .run-status {
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
    align-self: flex-start; padding: 1px 5px; border-radius: var(--radius-sharp);
  }
  .run-running { color: var(--accent); background: var(--accent-tint-08); }
  .run-complete { color: var(--success); background: var(--success-bg); }
  .run-failed, .run-cancelled { color: var(--error); background: var(--error-bg); }
  .run-summary { font-family: var(--font-body); font-size: 12px; color: var(--text-primary); }
  .run-time { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }

  .source { display: flex; flex-direction: column; gap: 1px; padding: 5px 0; text-decoration: none; border-bottom: 1px solid var(--bg-section); }
  .src-domain { font-family: var(--font-mono); font-size: 10px; color: var(--accent); }
  .src-title { font-family: var(--font-body); font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src-cred { font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }
  .source:hover .src-title { color: var(--accent); }

  .log li { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); padding: 3px 0; line-height: 1.4; }
  .log-time { color: var(--text-ghost); margin-right: 6px; }
</style>
```

- [ ] **Step 2: Manual verification.** Render with fake data and toggle collapse/filters.
```bash
cd /home/john/strange_rambling_svelte
cat > "src/routes/_deskscratch/+page.svelte" <<'EOF'
<script lang="ts">
  import LeftFeed from '$lib/canvas/intelligence/desk/LeftFeed.svelte';
  let collapsed = $state(false);
  let filters = $state({ source: true, fact: true, entity: true, counterfactual: true });
  const logs = [
    { message: '🔍  Searching: roman senate reforms', timestamp: Date.now() - 5000 },
    { message: 'ℹ️  Extracted 12 facts from source 3', timestamp: Date.now() - 2000 },
  ];
  const sources = [
    { id: 's1', url: 'https://en.wikipedia.org/wiki/Roman_Republic', title: 'Roman Republic', domain: 'wikipedia.org', credibilityType: 'encyclopedia', credibilityScore: 0.7 },
    { id: 's2', url: 'https://www.jstor.org/x', title: 'Fall of the Republic (JSTOR)', domain: 'jstor.org', credibilityType: 'academic', credibilityScore: 0.95 },
  ];
  const synthesisRuns = [
    { runId: 'run-abc12345', status: 'complete', summary: 'Three drivers: militarisation, debt, factionalism', createdAt: new Date().toISOString() },
    { runId: 'run-def67890', status: 'running', createdAt: new Date().toISOString() },
  ];
</script>
<div style="background:var(--bg);height:100vh;display:flex">
  <LeftFeed {logs} {sources} {filters} {synthesisRuns} bind:collapsed
    onfilter={(k, v) => { filters = { ...filters, [k]: v }; console.log('filter', k, v); }}
    onselectrun={(r) => console.log('run', r)} />
  <div style="flex:1;padding:20px;font-family:var(--font-mono)">filters: {JSON.stringify(filters)}</div>
</div>
EOF
npm run dev >/tmp/desk-dev.log 2>&1 &
sleep 6 && grep -m1 "Local:" /tmp/desk-dev.log || tail -5 /tmp/desk-dev.log
```
Open `http://homeserv:5173/_deskscratch`. Expected: a 300px panel with FILTERS (4 checked rows w/ colour swatches), LEGEND, SYNTHESIS RUNS (one green "complete" w/ summary, one accent "running"), SOURCES (2, domain in accent, opens new tab on click), ACTIVITY (newest-first, emoji stripped, timestamps). Untick "Facts" → console logs `filter fact false` and the JSON updates. Click the complete run → logs `run run-abc12345`. Click the `‹` toggle → panel collapses to a 32px spine showing vertical `FEED`; click `›` to expand. Kill dev: `pkill -f "vite.*5173"`.

- [ ] **Step 3: Commit.**
```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/LeftFeed.svelte
git commit -m "$(cat <<'EOF'
Add desk LeftFeed (filters, legend, synthesis history, sources, activity log)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: InspectorDrawer.svelte — portal drawer on card click (detail + related + explore-further)

A right-hand drawer, portaled to `<body>` (via `$lib/canvas/portal`) so it escapes the desk's `transform`ed world layer. Shows full detail for the clicked artefact, lists related artefacts (passed in by the shell from `GET /api/deepdive/[id]/related` / the in-memory edge map), and an "explore further" action that POSTs to the **existing** `/api/deepdive/[id]/explore` and navigates to the new child desk. The drawer is presentational + owns only the explore network call (it has the exact contract); detail/related data come in as props.

**Files:**
- Create `src/lib/canvas/intelligence/desk/InspectorDrawer.svelte`

Component interface:
```ts
type ArtefactKind = 'source' | 'fact' | 'entity';
let {
  open = $bindable(false),
  sessionId,
  artefact,        // null when nothing selected; else { kind, id, ...fields-from-SHARED-CONTRACT }
  related,         // { id, kind, label }[]  related artefact summaries
  onclose,         // () => void
  onselect,        // (id:string) => void   -> shell focuses/selects another card
}: { ... } = $props();
```
The `artefact` shape per kind (from the SHARED CONTRACT + `/data`): source `{kind:'source', id, url, title, domain, category, credibilityScore, credibilityType}`; fact `{kind:'fact', id, content, confidence, isCounterfactual, refutesFactId, tags, eventDate, sourceId}`; entity `{kind:'entity', id, name, type, description}`.

- [ ] **Step 1: Create the component.**
```svelte
<!-- src/lib/canvas/intelligence/desk/InspectorDrawer.svelte -->
<script lang="ts">
  import { portal } from '$lib/canvas/portal';
  import { goto } from '$app/navigation';

  type ArtefactKind = 'source' | 'fact' | 'entity';
  interface RelatedRef { id: string; kind: ArtefactKind; label: string; }
  // Loose shape — fields depend on kind (see SHARED CONTRACT).
  type Artefact = { kind: ArtefactKind; id: string } & Record<string, unknown>;

  let {
    open = $bindable(false),
    sessionId,
    artefact,
    related = [],
    onclose,
    onselect,
  }: {
    open?: boolean;
    sessionId: string;
    artefact: Artefact | null;
    related?: RelatedRef[];
    onclose: () => void;
    onselect: (id: string) => void;
  } = $props();

  let exploring = $state(false);
  let exploreErr = $state<string | null>(null);

  // explore type for the /explore endpoint: only fact|entity are addressable by itemId here
  let exploreType = $derived(
    artefact?.kind === 'entity' ? 'entity' : artefact?.kind === 'fact' ? 'fact' : null,
  );

  async function exploreFurther() {
    if (!artefact || !exploreType) return;
    exploring = true;
    exploreErr = null;
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/explore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: exploreType, itemId: artefact.id }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `Explore failed (${res.status})`);
      }
      const child = await res.json();
      goto(`/deepdive/${child.id}`);
    } catch (err: any) {
      exploreErr = err.message ?? 'Explore failed';
    } finally {
      exploring = false;
    }
  }

  function kindLabel(k: ArtefactKind): string {
    return k === 'source' ? 'SOURCE' : k === 'entity' ? 'ENTITY' : 'FACT';
  }
  function fmtPct(n: unknown): string {
    const v = typeof n === 'number' ? n : 0;
    return `${Math.round((v <= 1 ? v * 100 : v))}%`;
  }
</script>

{#if open && artefact}
  <div class="scrim" use:portal={'body'} onclick={onclose} role="presentation"></div>
  <aside class="drawer" use:portal={'body'} role="dialog" aria-label="Artefact inspector">
    <header class="d-head">
      <span class="d-kind d-kind-{artefact.kind}"
            class:challenge={artefact.kind === 'fact' && (artefact.isCounterfactual as boolean)}>
        {(artefact.kind === 'fact' && (artefact.isCounterfactual as boolean)) ? 'CHALLENGE' : kindLabel(artefact.kind)}
      </span>
      <button type="button" class="d-close" onclick={onclose} aria-label="Close inspector">✕</button>
    </header>

    <div class="d-body">
      {#if artefact.kind === 'source'}
        <h2 class="d-title">{(artefact.title as string) ?? (artefact.url as string)}</h2>
        <a class="d-link" href={artefact.url as string} target="_blank" rel="noopener noreferrer">{artefact.domain as string}</a>
        <dl class="d-meta">
          <div><dt>Category</dt><dd>{(artefact.category as string) ?? '—'}</dd></div>
          <div><dt>Credibility</dt><dd>{(artefact.credibilityType as string) ?? '—'} · {fmtPct(artefact.credibilityScore)}</dd></div>
        </dl>

      {:else if artefact.kind === 'fact'}
        <p class="d-fact">{artefact.content as string}</p>
        <div class="d-confbar" aria-label="Confidence">
          <span class="d-conffill" style:width={fmtPct(artefact.confidence)}></span>
        </div>
        <span class="d-confnum">confidence {fmtPct(artefact.confidence)}</span>
        {#if (artefact.tags as string[])?.length}
          <div class="d-tags">{#each artefact.tags as string[] as t}<span class="d-tag">{t}</span>{/each}</div>
        {/if}
        {#if artefact.eventDate}<p class="d-date">dated {String(artefact.eventDate).slice(0, 10)}</p>{/if}

      {:else}
        <h2 class="d-entity">{artefact.name as string}</h2>
        <span class="d-etype">{(artefact.type as string) ?? 'entity'}</span>
        {#if artefact.description}<p class="d-desc">{artefact.description as string}</p>{/if}
      {/if}

      {#if related.length}
        <section class="d-sec">
          <h3>RELATED</h3>
          <ul class="d-related">
            {#each related as r (r.id)}
              <li>
                <button type="button" class="d-rel" onclick={() => onselect(r.id)}>
                  <span class="d-rel-kind d-kind-{r.kind}">{kindLabel(r.kind)}</span>
                  <span class="d-rel-label">{r.label}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <footer class="d-foot">
      {#if exploreErr}<p class="d-err">{exploreErr}</p>{/if}
      <button
        type="button"
        class="d-explore"
        disabled={!exploreType || exploring}
        title={exploreType ? 'Spin up a child research run seeded by this artefact' : 'Explore not available for this artefact'}
        onclick={exploreFurther}
      >
        {exploring ? 'Spinning up…' : '⤓ Explore further'}
      </button>
    </footer>
  </aside>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0;
    background: rgba(26, 16, 8, 0.18);
    z-index: 90;
  }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: 380px; max-width: 92vw;
    background: var(--surface-elevated);
    border-left: 1px solid var(--card-border);
    box-shadow: -8px 0 24px rgba(26, 16, 8, 0.18);
    display: flex; flex-direction: column;
    z-index: 91;
    animation: slidein 0.18s ease-out;
  }
  @keyframes slidein { from { transform: translateX(100%); } to { transform: translateX(0); } }

  .d-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--card-border); }
  .d-kind {
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em;
    padding: 3px 8px; border-radius: var(--radius-sharp); color: var(--text-muted); border: 1px solid var(--card-border);
  }
  .d-kind-entity { background: #1a1008; color: #ede4d4; border-color: #1a1008; }
  .d-kind-source { color: var(--accent); border-color: var(--accent-tint-35); }
  .d-kind.challenge { color: var(--error); border-color: var(--error); background: var(--error-bg); }
  .d-close { background: none; border: none; color: var(--text-muted); font-size: 15px; cursor: pointer; }
  .d-close:hover { color: var(--accent); }

  .d-body { flex: 1; overflow-y: auto; padding: 16px 14px; }
  .d-title { font-family: var(--font-body); font-size: 17px; font-weight: 700; color: var(--text-primary); margin: 0 0 6px; }
  .d-link { font-family: var(--font-mono); font-size: 12px; color: var(--accent); text-decoration: none; }
  .d-link:hover { text-decoration: underline; }
  .d-meta { margin: 16px 0 0; display: flex; flex-direction: column; gap: 10px; }
  .d-meta div { display: flex; justify-content: space-between; gap: 12px; }
  .d-meta dt { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; color: var(--text-ghost); text-transform: uppercase; margin: 0; }
  .d-meta dd { font-family: var(--font-body); font-size: 13px; color: var(--text-primary); margin: 0; text-align: right; }

  .d-fact { font-family: var(--font-body); font-size: 15px; line-height: 1.5; color: var(--text-primary); margin: 0 0 14px; }
  .d-confbar { height: 6px; background: var(--card-bg); border-radius: var(--radius-pill); overflow: hidden; }
  .d-conffill { display: block; height: 100%; background: var(--accent); }
  .d-confnum { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .d-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .d-tag { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); background: var(--card-bg); border: 1px solid var(--card-border); padding: 2px 7px; border-radius: var(--radius-pill); }
  .d-date { font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost); margin-top: 10px; }

  .d-entity { font-family: var(--font-display); font-size: 22px; color: var(--text-primary); margin: 0 0 4px; }
  .d-etype { font-family: var(--font-mono); font-size: 11px; color: var(--accent); }
  .d-desc { font-family: var(--font-body); font-size: 14px; line-height: 1.55; color: var(--text-secondary); margin-top: 12px; }

  .d-sec { margin-top: 22px; }
  .d-sec h3 { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; color: var(--text-ghost); margin: 0 0 8px; }
  .d-related { list-style: none; margin: 0; padding: 0; }
  .d-rel { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp); padding: 6px 8px; margin-bottom: 6px; cursor: pointer; }
  .d-rel:hover { border-color: var(--accent); }
  .d-rel-kind { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; padding: 1px 5px; border-radius: var(--radius-sharp); border: 1px solid var(--card-border); color: var(--text-muted); }
  .d-rel-label { font-family: var(--font-body); font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .d-foot { padding: 12px 14px; border-top: 1px solid var(--card-border); }
  .d-err { font-family: var(--font-mono); font-size: 11px; color: var(--error); margin: 0 0 8px; }
  .d-explore {
    width: 100%; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.04em;
    padding: 10px; border: 1px solid var(--accent); border-radius: var(--radius-sharp);
    background: var(--accent); color: #faf6ee; cursor: pointer;
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
  }
  .d-explore:hover:not(:disabled) { background: var(--accent-hover); }
  .d-explore:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
</style>
```

- [ ] **Step 2: Manual verification.** Render the drawer with one of each artefact kind; confirm the portal escapes a transformed ancestor.
```bash
cd /home/john/strange_rambling_svelte
cat > "src/routes/_deskscratch/+page.svelte" <<'EOF'
<script lang="ts">
  import InspectorDrawer from '$lib/canvas/intelligence/desk/InspectorDrawer.svelte';
  let open = $state(false);
  let artefact = $state<any>(null);
  const related = [
    { id: 'f9', kind: 'fact', label: 'Marius reformed the legions in 107 BC' },
    { id: 'e2', kind: 'entity', label: 'Julius Caesar' },
  ];
  const samples = {
    source: { kind: 'source', id: 's1', url: 'https://jstor.org/x', title: 'Fall of the Republic', domain: 'jstor.org', category: 'academic', credibilityScore: 0.92, credibilityType: 'academic' },
    fact: { kind: 'fact', id: 'f1', content: 'The Republic\u2019s reliance on private armies eroded civilian control.', confidence: 0.78, isCounterfactual: false, tags: ['military', 'governance'], eventDate: '0049-01-10T00:00:00Z', sourceId: 's1' },
    challenge: { kind: 'fact', id: 'f2', content: 'Some historians argue economic factors mattered more than militarisation.', confidence: 0.55, isCounterfactual: true, refutesFactId: 'f1', tags: ['debate'] },
    entity: { kind: 'entity', id: 'e1', name: 'Gaius Marius', type: 'person', description: 'Roman general and statesman, seven-time consul.' },
  };
  function show(k: keyof typeof samples) { artefact = samples[k]; open = true; }
</script>
<!-- transformed ancestor proves the portal escapes it -->
<div style="transform:scale(1);background:var(--bg);min-height:100vh;padding:40px">
  <div style="display:flex;gap:8px;font-family:var(--font-mono)">
    <button onclick={() => show('source')}>source</button>
    <button onclick={() => show('fact')}>fact</button>
    <button onclick={() => show('challenge')}>challenge</button>
    <button onclick={() => show('entity')}>entity</button>
  </div>
  <InspectorDrawer bind:open {related} sessionId="demo-session" {artefact}
    onclose={() => (open = false)} onselect={(id) => console.log('select', id)} />
</div>
EOF
npm run dev >/tmp/desk-dev.log 2>&1 &
sleep 6 && grep -m1 "Local:" /tmp/desk-dev.log || tail -5 /tmp/desk-dev.log
```
Open `http://homeserv:5173/_deskscratch`. Expected: clicking "source" slides a 380px drawer in from the right (pinned to the true viewport edge despite the `transform` ancestor — confirms portal) with title, accent domain link, credibility meta, and a RELATED list. "fact" shows the content + an accent confidence bar at 78% + tags. "challenge" shows a red `CHALLENGE` tab. "entity" shows the Archivo Black name + type + description. Clicking the scrim or ✕ closes it. Click a RELATED row → logs `select <id>`. The "⤓ Explore further" button is enabled for fact/entity, disabled (greyed) for source; clicking it on the fact will POST to `/api/deepdive/demo-session/explore` and show the error text (`Parent session not found`) since `demo-session` isn't real — that confirms the wiring hits the real endpoint. Kill dev: `pkill -f "vite.*5173"`.

- [ ] **Step 3: Remove the scratch route.**
```bash
cd /home/john/strange_rambling_svelte
rm -rf "src/routes/_deskscratch"
ls "src/routes/_deskscratch" 2>&1 | head -1   # expect: No such file or directory
```

- [ ] **Step 4: Type-check the new desk chrome (memory-bumped to avoid OOM).**
```bash
cd /home/john/strange_rambling_svelte
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -20
```
Expected: `svelte-check found 0 errors` (warnings are acceptable). If errors reference only these new files, fix them; pre-existing errors elsewhere are out of scope for this milestone.

- [ ] **Step 5: Commit.**
```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/desk/InspectorDrawer.svelte
git commit -m "$(cat <<'EOF'
Add desk InspectorDrawer (portal drawer: detail, related, explore-further)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire the chrome into ResearchDesk.svelte (controls → existing endpoints)

`ResearchDesk.svelte` exists from an earlier milestone with the store, pan/zoom, cards and minimap. This task slots the four chrome components into its layout and connects their callbacks to the real endpoints. Re-Read the current `ResearchDesk.svelte` before editing — the markup/line numbers below are illustrative and **will have drifted**; locate the equivalent regions by the anchor comments/structure described, not by line number.

**Files:**
- Modify `src/lib/canvas/intelligence/ResearchDesk.svelte` (add imports + chrome markup + handlers; integrate with the existing store)

- [ ] **Step 1: Re-Read the shell to find the integration points.**
```bash
cd /home/john/strange_rambling_svelte
grep -n "deskStore\|store\.\|<script\|class=\"desk\|EventSource\|panX\|minimap\|export let\|\$props\|onMount" src/lib/canvas/intelligence/ResearchDesk.svelte | head -60
```
Confirm: (a) the store variable name and its `mode`/`status`/`counts`/`logs`/`sources`/`synthesisRuns`/`typeFilters` accessors; (b) the existing root layout element where the desk world is mounted; (c) the existing card-click handler / selected-artefact state. Note the exact names — the steps below reference placeholders `store`, `selected`, and `setSelected()` that you must rename to match the real shell.

- [ ] **Step 2: Add chrome imports** at the top of the `<script>` block (after the existing imports):
```ts
  import CommandBar from './desk/CommandBar.svelte';
  import LeftFeed from './desk/LeftFeed.svelte';
  import ActivityTicker from './desk/ActivityTicker.svelte';
  import InspectorDrawer from './desk/InspectorDrawer.svelte';
  import { isRunning } from './desk/deskControls';
```

- [ ] **Step 3: Add the control handlers** in the `<script>` block. Replace `store` with the real store accessor confirmed in Step 1; `sessionId` with the real session id ref.
```ts
  let feedCollapsed = $state(false);
  let inspectorOpen = $state(false);
  let inspectorArtefact = $state<any>(null);
  let inspectorRelated = $state<{ id: string; kind: 'source' | 'fact' | 'entity'; label: string }[]>([]);

  // ⏸ → engine "skip" (advance phase). Engine has no true pause.
  async function handleSkip() {
    await fetch(`/api/deepdive/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    });
  }

  async function handleStop() {
    await fetch(`/api/deepdive/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
  }

  // ⤓ deepen → open the inspector's explore path generically (deepen the whole topic
  // is surfaced per-artefact; the bar-level deepen focuses the most central entity).
  function handleDeepen() {
    // Open inspector on the highest-centrality entity if present; else no-op gracefully.
    const ent = [...store.cards.values()].find((c: any) => c.kind === 'entity');
    if (ent) openInspector(ent.id);
  }

  async function handleShare() {
    const res = await fetch(`/api/deepdive/${sessionId}/share`, { method: 'POST' });
    if (!res.ok) return;
    const { token } = await res.json();
    const url = `${location.origin}/deepdive/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard may be blocked; URL is still created server-side */
    }
  }

  function handleExport(kind: 'docx' | 'narrative-docx' | 'narrative-md') {
    const path =
      kind === 'docx'
        ? `/api/deepdive/${sessionId}/export/docx`
        : kind === 'narrative-docx'
          ? `/api/deepdive/${sessionId}/export/narrative-docx`
          : `/api/deepdive/${sessionId}/export/narrative-md`;
    // Trigger a browser download.
    const a = document.createElement('a');
    a.href = path;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function handleFilter(key: 'source' | 'fact' | 'entity' | 'counterfactual', value: boolean) {
    // store.typeFilters is the controlled source of truth; mutate via the store's setter.
    store.typeFilters = { ...store.typeFilters, [key]: value };
  }

  function handleSelectRun(runId: string) {
    // Flip to synthesize mode and let the shell highlight that run's clusters.
    store.mode = 'synthesize';
    store.activeRunId = runId; // shell already reads activeRunId to scope highlighting
  }

  // Build the inspector artefact payload from the store card by id.
  function openInspector(id: string) {
    const card: any = store.cards.get(id);
    if (!card) return;
    inspectorArtefact = card; // card already carries SHARED-CONTRACT fields + kind + id
    inspectorRelated = relatedFor(id);
    inspectorOpen = true;
  }

  // Related artefacts via the in-memory edge map already held by the shell.
  function relatedFor(id: string): { id: string; kind: 'source' | 'fact' | 'entity'; label: string }[] {
    const out: { id: string; kind: 'source' | 'fact' | 'entity'; label: string }[] = [];
    for (const c of store.cards.values() as IterableIterator<any>) {
      if (c.id === id) continue;
      const linked =
        c.refutesFactId === id ||
        c.sourceId === id ||
        c.fromEntityId === id ||
        c.toEntityId === id;
      if (linked) {
        out.push({
          id: c.id,
          kind: (c.kind === 'counterfactual' ? 'fact' : c.kind),
          label: c.content ?? c.name ?? c.title ?? c.id,
        });
      }
    }
    return out.slice(0, 12);
  }
```

- [ ] **Step 4: Slot the chrome into the markup.** Wrap the existing desk world in this layout. Keep the existing world/minimap element exactly as-is in the `<!-- existing desk world -->` slot; only the chrome around it is added. `onmode` should call the existing mode handler from the prior milestone (`store.mode = m` for `gather`; the existing synthesize-trigger fn — confirm its name in Step 1 — for `synthesize`).
```svelte
<div class="desk-shell">
  <CommandBar
    topic={store.topic}
    {sessionId}
    status={store.status}
    mode={store.mode}
    synthesising={store.synthesising}
    counts={store.counts}
    onmode={(m) => (m === 'synthesize' ? triggerSynthesize() : (store.mode = 'gather'))}
    onskip={handleSkip}
    onstop={handleStop}
    ondeepen={handleDeepen}
    onshare={handleShare}
    onexport={handleExport}
  />

  <div class="desk-mid">
    <LeftFeed
      logs={store.logs}
      sources={store.sources}
      filters={store.typeFilters}
      synthesisRuns={store.synthesisRuns}
      bind:collapsed={feedCollapsed}
      onfilter={handleFilter}
      onselectrun={handleSelectRun}
    />

    <!-- existing desk world (pan/zoom/cards/minimap) — UNCHANGED -->
    <div class="desk-world-wrap">
      <!-- KEEP the prior milestone's world markup here verbatim.
           Ensure each card's click handler calls openInspector(card.id). -->
    </div>
  </div>

  <ActivityTicker logs={store.logs} live={isRunning(store.status) || store.synthesising} />

  <InspectorDrawer
    bind:open={inspectorOpen}
    {sessionId}
    artefact={inspectorArtefact}
    related={inspectorRelated}
    onclose={() => (inspectorOpen = false)}
    onselect={(id) => openInspector(id)}
  />
</div>
```

- [ ] **Step 5: Add/merge the shell layout CSS** (append to the shell's `<style>`; rename if `.desk-shell` already exists):
```css
  .desk-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--bg);
  }
  .desk-mid {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .desk-world-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
```

- [ ] **Step 6: Ensure each card invokes the inspector.** In the world markup, confirm the card click handler calls `openInspector(card.id)` (rename to the real card-id field). If the prior milestone used a different selected-state mechanism, route it through `openInspector` so the drawer opens.
```bash
cd /home/john/strange_rambling_svelte
grep -n "openInspector\|onclick.*card\|ArtefactCard\|onselect" src/lib/canvas/intelligence/ResearchDesk.svelte | head
```
Expected: at least one `openInspector(` call wired to the card click. If `ArtefactCard.svelte` exposes an `onclick`/`onopen` callback prop, pass `onopen={() => openInspector(card.id)}`.

- [ ] **Step 7: Type-check.**
```bash
cd /home/john/strange_rambling_svelte
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -20
```
Expected: `svelte-check found 0 errors`. Resolve any type mismatches between the placeholder `store.*` names and the real store accessors (this is the expected work — the placeholders above must be renamed to match Step 1's findings).

- [ ] **Step 8: Manual verification against a real session.** Start dev, open an existing deep-dive session id on the desk route, and confirm the chrome is wired.
```bash
cd /home/john/strange_rambling_svelte
# find a real session id to open
NODE_OPTIONS=--max-old-space-size=8192 npm run dev >/tmp/desk-dev.log 2>&1 &
sleep 6 && grep -m1 "Local:" /tmp/desk-dev.log || tail -5 /tmp/desk-dev.log
echo "Pick a session id from /deepdive (recent runs) and open /deepdive/<id>"
```
Open `http://homeserv:5173/deepdive/<id>`. Expected: the top CommandBar shows the topic, centred toggle, live counters and a status pill; the LeftFeed shows real sources/activity/filters/synthesis history and collapses to a spine; the bottom ticker narrates the latest log; clicking a card opens the InspectorDrawer from the right with that artefact's detail + related list; the ⏭/◼ controls hit `PATCH /api/deepdive/<id>` (watch `/tmp/desk-dev.log` for the request) and ⤴ → "Copy share link" creates a token. Kill dev: `pkill -f "vite"`.

- [ ] **Step 9: Commit.**
```bash
cd /home/john/strange_rambling_svelte
git add src/lib/canvas/intelligence/ResearchDesk.svelte
git commit -m "$(cat <<'EOF'
Wire desk chrome (CommandBar/LeftFeed/Ticker/Inspector) into ResearchDesk shell

Controls hit existing PATCH /api/deepdive/[id] (skip/stop), share + export
download endpoints, and the InspectorDrawer's explore-further uses the
existing /explore endpoint.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**Milestone-8 done-when:** all five new desk components exist under `src/lib/canvas/intelligence/desk/`; `deskControls.test.ts` and `tickerText.test.ts` pass (`npx vitest run src/lib/canvas/intelligence/desk/`); `svelte-check` reports 0 errors for the new files; and on a live session the CommandBar/LeftFeed/ActivityTicker/InspectorDrawer render and their controls drive the existing PATCH/share/export/explore endpoints. (Deploy + verify-live happens in the milestone that ships the `/deepdive/[id]` page route per CLAUDE.md discipline; the scratch route used for isolated verification is removed.)

---

Key load-bearing facts I confirmed against the real code (not the brief):
- `PATCH /api/deepdive/[id]/+server.ts` accepts only `{action:'stop'|'skip'}` (no `pause`), and `worker.ts` has no pause primitive — so the ⏸ control maps to `skip`. File: `/home/john/strange_rambling_svelte/src/routes/api/deepdive/[id]/+server.ts:50-64`.
- `emitLog` formats messages as `` `${icon}  ${message}` `` (two spaces) — `tickerText.ts` strips exactly that. File: `/home/john/strange_rambling_svelte/src/lib/deepdive/worker.ts:35-41`.
- `POST /api/deepdive/[id]/share` returns `{token}` and the share page lives at `/deepdive/share/[token]`. Files: `.../share/+server.ts`, `src/routes/deepdive/share/[token]/`.
- `POST /api/deepdive/[id]/explore` takes `{type:'fact'|'entity'|'cluster'|'gap'|'hypothesis', itemId, additionalContext?}` and returns the child session (201) — InspectorDrawer uses `type:'fact'|'entity'` + `itemId`. File: `.../explore/+server.ts:11-176`.
- Export endpoints are GET downloads: `/export/docx`, `/export/narrative-docx`, `/export/narrative-md`.
- Design tokens used all exist in `src/app.css` (`--surface-elevated #e8dece`, `--accent #c4570a`, `--card-border rgba(26,16,8,.18)`, `--radius-sharp/pill/round`, `--shadow-lg`, `--success/--error/--warn` + `-bg/-border`, `--font-brand/mono/display/body`).
- `portal` action is `$lib/canvas/portal` (default target `'body'`) — used by InspectorDrawer to escape the desk's transformed world layer.
- The `desk/` dir does not yet exist; no `desk-events.ts`/`synthesis.ts`/`ResearchDesk.svelte` present yet — Task 7 assumes `ResearchDesk.svelte` and the store land in earlier milestones, and instructs a re-Read + placeholder-rename rather than guessing the store's exact accessor names.


I now have full context. Key findings for this milestone:

- No `/deepdive/[id]/+page.svelte` index exists yet — this milestone creates it.
- `ResearchDesk.svelte`, the `desk/` components, schema changes, synthesis, desk-events, and the synthesize/position endpoints are built in earlier milestones (1-8). Milestone 9 mounts them, wires routing, the quick desk, the launcher, retires old UI, and deploys.
- Helpers to extract live in `dashboard/+page.svelte` (`confidenceColor` :95, `confidenceLabel` :101, `credibilityBadge` :569, `severityColor` :582, `typeColors` :200, `sentimentColors` :210) AND `share/[token]/+page.svelte` (`confidenceColor` :62). Both dashboard and share use Cytoscape (both get retired/converted). The narrative builder logic also lives in dashboard.
- `share/[token]` reuses the same data shape — the brief says "Cytoscape (both usages)". Both `dashboard` and `share` use Cytoscape; I'll convert share to the desk too (readonly) so Cytoscape is fully removed, OR strip its graph. The brief's retire list is `DeepResearchViewer.svelte` + Cytoscape (both usages) + the old pages. I'll handle share by pointing it at the readonly desk.
- `ResearchResultNode.svelte` imports `DeepResearchViewer` — must be rewired before deletion. Per brief Milestone 9 retires DeepResearchViewer; `ResearchResultNode` is referenced in `IntelligenceNode`. I'll have the task swap `ResearchResultNode`'s embed to the new `ResearchDesk` (readonly/embedded) before deleting `DeepResearchViewer`.
- The data endpoint and `+page.server.ts` merge query exist; the launcher keeps the merge query but updates the deep `href` to `/deepdive/[id]`.

Now I'll write the milestone.

## Milestone 9: Routing, quick desk, launcher rebuild, retire old UI, deploy

> **Preconditions (built in Milestones 1–8, must already be on `master`):**
> - `src/lib/db/schema.ts` has the additive `canvasX/canvasY/pinned/deskState/deskCategory/synthesisRunId` columns on `sources`/`facts`/`entities` and the new `synthesisRuns` `pgTable` (export name `synthesisRuns`).
> - `src/lib/canvas/intelligence/ResearchDesk.svelte` exists and accepts props `{ sessionId: string; mode?: 'deep' | 'quick'; readonly?: boolean; initialTopic?: string }`. It hydrates via `GET /api/deepdive/[id]/data`, subscribes to `GET /api/deepdive/[id]/stream`, and renders the full desk (CommandBar, ModeToggle, ArtefactCards, EntityRail, ActivityTicker, LeftFeed, InspectorDrawer, minimap, pan/zoom/drag). For quick desks it points its hydrate/stream at the `quickAnswers` data instead — exposed via the same `sessionId` because the quick desk wraps the quick-answer row (see Task 3 for the quick wiring contract).
> - `src/lib/canvas/intelligence/desk/layout.ts`, `desk-events.ts`, `synthesis.ts`, and the `POST /api/deepdive/[id]/synthesize` + `PATCH /api/deepdive/[id]/artefacts/[artefactId]/position` endpoints exist.
>
> If any precondition is missing, STOP — earlier milestones are incomplete and this milestone cannot land. Verify with:
> ```
> test -f src/lib/canvas/intelligence/ResearchDesk.svelte && grep -q "export const synthesisRuns" src/lib/db/schema.ts && echo PRECONDITIONS-OK || echo PRECONDITIONS-MISSING
> ```
> Expected: `PRECONDITIONS-OK`.

---

### Task 1: Extract shared display helpers into `$lib/deepdive/display.ts` (TDD)

The old `dashboard/+page.svelte` and `share/[token]/+page.svelte` carry duplicate, inline `confidenceColor`, `confidenceLabel`, `credibilityBadge`, `severityColor`, `typeColors`, `sentimentColors`. We salvage them into a pure, unit-tested module **before** deleting the pages, so the desk components and the rebuilt launcher can reuse them with identical behaviour.

**Files:**
- Create: `src/lib/deepdive/display.ts`
- Create: `src/lib/deepdive/display.test.ts`

- [ ] **Step 1: Write the test first (`src/lib/deepdive/display.test.ts`).** Pin the exact thresholds copied verbatim from `dashboard/+page.svelte:95-105,569-586,200-216`.
```ts
import { describe, it, expect } from 'vitest';
import {
  confidenceColor,
  confidenceLabel,
  credibilityBadge,
  severityColor,
  ENTITY_TYPE_COLORS,
  SENTIMENT_COLORS,
} from './display';

describe('confidenceColor', () => {
  it('returns green at/above 0.8', () => {
    expect(confidenceColor(0.8)).toBe('#2d7d46');
    expect(confidenceColor(0.95)).toBe('#2d7d46');
  });
  it('returns accent in [0.5, 0.8)', () => {
    expect(confidenceColor(0.5)).toBe('var(--accent)');
    expect(confidenceColor(0.79)).toBe('var(--accent)');
  });
  it('returns red below 0.5', () => {
    expect(confidenceColor(0.49)).toBe('#8b3a1a');
    expect(confidenceColor(0)).toBe('#8b3a1a');
  });
});

describe('confidenceLabel', () => {
  it('labels HIGH/MED/LOW at the same thresholds', () => {
    expect(confidenceLabel(0.8)).toBe('HIGH');
    expect(confidenceLabel(0.5)).toBe('MED');
    expect(confidenceLabel(0.49)).toBe('LOW');
  });
});

describe('credibilityBadge', () => {
  it('maps known credibility types', () => {
    expect(credibilityBadge('academic')).toEqual({ label: 'ACADEMIC', color: '#2d7d46' });
    expect(credibilityBadge('government')).toEqual({ label: 'GOV', color: '#2d7d46' });
    expect(credibilityBadge('major_news')).toEqual({ label: 'MAJOR NEWS', color: '#3a6b8b' });
    expect(credibilityBadge('news')).toEqual({ label: 'NEWS', color: '#3a6b8b' });
    expect(credibilityBadge('wiki')).toEqual({ label: 'WIKI', color: '#8b7a3a' });
    expect(credibilityBadge('blog')).toEqual({ label: 'BLOG', color: 'var(--accent)' });
    expect(credibilityBadge('social')).toEqual({ label: 'SOCIAL', color: '#8b3a1a' });
  });
  it('falls back to OTHER for unknown/null/undefined', () => {
    expect(credibilityBadge('whatever')).toEqual({ label: 'OTHER', color: 'var(--text-muted)' });
    expect(credibilityBadge(null)).toEqual({ label: 'OTHER', color: 'var(--text-muted)' });
    expect(credibilityBadge(undefined)).toEqual({ label: 'OTHER', color: 'var(--text-muted)' });
  });
});

describe('severityColor', () => {
  it('maps high/medium/other', () => {
    expect(severityColor('high')).toBe('#8b3a1a');
    expect(severityColor('medium')).toBe('var(--accent)');
    expect(severityColor('low')).toBe('var(--text-muted)');
    expect(severityColor('')).toBe('var(--text-muted)');
  });
});

describe('colour maps', () => {
  it('entity type colours match the canon, with an other fallback key', () => {
    expect(ENTITY_TYPE_COLORS.person).toBe('#c4570a');
    expect(ENTITY_TYPE_COLORS.organisation).toBe('#2d7d46');
    expect(ENTITY_TYPE_COLORS.location).toBe('#3a6b8b');
    expect(ENTITY_TYPE_COLORS.event).toBe('#7b3a8b');
    expect(ENTITY_TYPE_COLORS.concept).toBe('#8b7a3a');
    expect(ENTITY_TYPE_COLORS.product).toBe('#3a8b7b');
    expect(ENTITY_TYPE_COLORS.other).toBe('#666666');
  });
  it('sentiment colours match the canon', () => {
    expect(SENTIMENT_COLORS.positive).toBe('#2d7d46');
    expect(SENTIMENT_COLORS.negative).toBe('#8b3a1a');
    expect(SENTIMENT_COLORS.neutral).toBe('#999999');
    expect(SENTIMENT_COLORS.contested).toBe('#c4570a');
  });
});
```

- [ ] **Step 2: Run the test, expect failure (module does not exist yet).**
```
npx vitest run src/lib/deepdive/display.test.ts
```
Expected: fails with `Failed to resolve import "./display"` / `Cannot find module`.

- [ ] **Step 3: Implement `src/lib/deepdive/display.ts`** with the salvaged logic verbatim.
```ts
/**
 * Shared display helpers for the research desk + launcher.
 * Salvaged from the retired dashboard/share Svelte pages so the
 * thresholds + colour canon live in one tested place.
 */

export function confidenceColor(c: number): string {
  if (c >= 0.8) return '#2d7d46';
  if (c >= 0.5) return 'var(--accent)';
  return '#8b3a1a';
}

export function confidenceLabel(c: number): string {
  if (c >= 0.8) return 'HIGH';
  if (c >= 0.5) return 'MED';
  return 'LOW';
}

export function credibilityBadge(
  type: string | null | undefined,
): { label: string; color: string } {
  switch (type) {
    case 'academic':
      return { label: 'ACADEMIC', color: '#2d7d46' };
    case 'government':
      return { label: 'GOV', color: '#2d7d46' };
    case 'major_news':
      return { label: 'MAJOR NEWS', color: '#3a6b8b' };
    case 'news':
      return { label: 'NEWS', color: '#3a6b8b' };
    case 'wiki':
      return { label: 'WIKI', color: '#8b7a3a' };
    case 'blog':
      return { label: 'BLOG', color: 'var(--accent)' };
    case 'social':
      return { label: 'SOCIAL', color: '#8b3a1a' };
    default:
      return { label: 'OTHER', color: 'var(--text-muted)' };
  }
}

export function severityColor(severity: string): string {
  if (severity === 'high') return '#8b3a1a';
  if (severity === 'medium') return 'var(--accent)';
  return 'var(--text-muted)';
}

export const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: '#c4570a',
  organisation: '#2d7d46',
  location: '#3a6b8b',
  event: '#7b3a8b',
  concept: '#8b7a3a',
  product: '#3a8b7b',
  other: '#666666',
};

export const SENTIMENT_COLORS: Record<string, string> = {
  positive: '#2d7d46',
  negative: '#8b3a1a',
  neutral: '#999999',
  contested: '#c4570a',
};
```

- [ ] **Step 4: Run the test, expect pass.**
```
npx vitest run src/lib/deepdive/display.test.ts
```
Expected: `Test Files  1 passed (1)` and all assertions green.

- [ ] **Step 5: Commit.**
```
git add src/lib/deepdive/display.ts src/lib/deepdive/display.test.ts
git commit -m "$(cat <<'EOF'
research-desk(m9): extract shared display helpers into $lib/deepdive/display

Salvage confidence/credibility/severity helpers + entity/sentiment colour
canon from the soon-to-be-retired dashboard & share pages into a pure,
unit-tested module the desk + launcher can reuse.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create the desk host route at `/deepdive/[id]` (TDD on the server load, manual verify on the page)

The desk index page does not exist yet. It mounts `ResearchDesk.svelte` for a deep run. `+page.server.ts` validates the session exists (404→redirect to `/deepdive`) and passes minimal session metadata; the desk does its own hydrate-then-stream so the server load stays light.

**Files:**
- Create: `src/routes/deepdive/[id]/+page.server.ts`
- Create: `src/routes/deepdive/[id]/+page.svelte`
- Create: `src/routes/deepdive/[id]/deskload.ts` (pure helper for the load's return shape, so it is unit-testable)
- Create: `src/routes/deepdive/[id]/deskload.test.ts`

- [ ] **Step 1: Write the test first (`deskload.test.ts`).** The only testable logic in the load is the metadata projection; isolate it in a pure fn.
```ts
import { describe, it, expect } from 'vitest';
import { buildDeskLoad } from './deskload';

const row = {
  id: 'abc',
  topic: 'UK civil-service AI hiring',
  status: 'phase2',
  goals: ['focus on Whitehall'],
  shareToken: null,
  createdAt: new Date('2026-06-14T10:00:00.000Z'),
  completedAt: null,
};

describe('buildDeskLoad', () => {
  it('projects the session into the desk metadata shape', () => {
    expect(buildDeskLoad(row)).toEqual({
      session: {
        id: 'abc',
        topic: 'UK civil-service AI hiring',
        status: 'phase2',
        goals: ['focus on Whitehall'],
        shareToken: null,
        createdAt: '2026-06-14T10:00:00.000Z',
        completedAt: null,
      },
      mode: 'deep',
    });
  });
  it('serialises completedAt when present', () => {
    const done = { ...row, status: 'complete', completedAt: new Date('2026-06-14T11:00:00.000Z') };
    expect(buildDeskLoad(done).session.completedAt).toBe('2026-06-14T11:00:00.000Z');
  });
  it('coerces null goals to an empty array', () => {
    expect(buildDeskLoad({ ...row, goals: null }).session.goals).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, expect failure (module missing).**
```
npx vitest run src/routes/deepdive/\[id\]/deskload.test.ts
```
Expected: fails to resolve `./deskload`.

- [ ] **Step 3: Implement `deskload.ts`.**
```ts
export type DeskSessionRow = {
  id: string;
  topic: string;
  status: string;
  goals: unknown;
  shareToken: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type DeskLoad = {
  session: {
    id: string;
    topic: string;
    status: string;
    goals: string[];
    shareToken: string | null;
    createdAt: string;
    completedAt: string | null;
  };
  mode: 'deep';
};

export function buildDeskLoad(row: DeskSessionRow): DeskLoad {
  return {
    session: {
      id: row.id,
      topic: row.topic,
      status: row.status,
      goals: Array.isArray(row.goals) ? (row.goals as string[]) : [],
      shareToken: row.shareToken ?? null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    },
    mode: 'deep',
  };
}
```

- [ ] **Step 4: Run the test, expect pass.**
```
npx vitest run src/routes/deepdive/\[id\]/deskload.test.ts
```
Expected: `1 passed`.

- [ ] **Step 5: Implement `+page.server.ts`** (thin, delegates to the tested helper).
```ts
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { buildDeskLoad } from './deskload';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      goals: researchSessions.goals,
      shareToken: researchSessions.shareToken,
      createdAt: researchSessions.createdAt,
      completedAt: researchSessions.completedAt,
    })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw redirect(302, '/deepdive');

  return buildDeskLoad(session);
};
```

- [ ] **Step 6: Implement `+page.svelte`** — full-bleed host for the desk.
```svelte
<svelte:head><title>{data.session.topic} — The Desk</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import ResearchDesk from '$lib/canvas/intelligence/ResearchDesk.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="desk-host">
  <ResearchDesk
    sessionId={data.session.id}
    mode="deep"
    initialTopic={data.session.topic}
  />
</div>

<style>
  .desk-host {
    position: fixed;
    inset: 0;
    background: var(--bg);
    overflow: hidden;
    z-index: 0;
  }
</style>
```

- [ ] **Step 7: Manual verification (dev server).** Start dev and load an existing deep session id.
```
npm run dev -- --host
```
Then in a browser on the LAN open `http://homeserv:5173/deepdive/<existing-deep-session-id>`. Confirm: the full-bleed desk renders, artefact cards hydrate from `/api/deepdive/[id]/data`, the GATHER⇄SYNTHESIZE toggle is present, pan/zoom/drag work, and the page does NOT show the old tabbed dashboard. For a bad id (e.g. `/deepdive/does-not-exist`) confirm a redirect to `/deepdive`. Stop dev (`Ctrl-C`) when done.

- [ ] **Step 8: Commit.**
```
git add src/routes/deepdive/\[id\]/+page.server.ts src/routes/deepdive/\[id\]/+page.svelte src/routes/deepdive/\[id\]/deskload.ts src/routes/deepdive/\[id\]/deskload.test.ts
git commit -m "$(cat <<'EOF'
research-desk(m9): mount ResearchDesk at /deepdive/[id]

New full-bleed desk host route + tested load projection. Replaces the
linear progress/dashboard UX with the live spatial desk.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Mount the small desk at `/quickanswer/[id]` (manual verify)

Quick answers reuse the same `ResearchDesk` shell in `mode="quick"` / small-desk treatment. The existing `quickanswer/[id]/+page.server.ts` already loads the `quickAnswers` row; we keep that load and replace the linear `+page.svelte` with the desk host. The desk in quick mode hydrates from the quick-answer data the server passes through (no `/api/deepdive/[id]/data` for quick — the row's `sources`/`answer` are handed in as `initial`), and still subscribes to `/quickanswer/[id]/stream` for the live token/source/status deltas.

**Files:**
- Modify: `src/routes/quickanswer/[id]/+page.server.ts` (lines 14-22 — add `topic`/`goals` passthrough already present; keep as-is but ensure `sources`/`answer`/`status` are returned, which they are via `...row`)
- Replace: `src/routes/quickanswer/[id]/+page.svelte` (entire file, 1-272)

- [ ] **Step 1: Confirm the server load already exposes everything the quick desk needs.** Re-read `src/routes/quickanswer/[id]/+page.server.ts`; it returns `{ answer: { ...row, createdAt, completedAt } }` where `row` includes `topic`, `status`, `answer`, `sources`, `errorMessage`, `durationMs`. No change required to the load — verify by inspection.

- [ ] **Step 2: Replace `+page.svelte` with the small-desk host.** The quick desk passes the loaded row as `initial` so `ResearchDesk` can render the handful of sources/facts immediately, then live-stream from the quick-answer SSE endpoint.
```svelte
<svelte:head><title>Quick Answer — {data.answer.topic}</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import ResearchDesk from '$lib/canvas/intelligence/ResearchDesk.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="desk-host">
  <ResearchDesk
    sessionId={data.answer.id}
    mode="quick"
    initialTopic={data.answer.topic}
    quickInitial={{
      status: data.answer.status,
      answer: data.answer.answer ?? '',
      sources: data.answer.sources ?? [],
      errorMessage: data.answer.errorMessage ?? '',
      durationMs: data.answer.durationMs ?? 0,
      createdAt: data.answer.createdAt,
    }}
  />
</div>

<style>
  .desk-host {
    position: fixed;
    inset: 0;
    background: var(--bg);
    overflow: hidden;
    z-index: 0;
  }
</style>
```

> **Contract note for `ResearchDesk.svelte` (from Milestone 1–8):** it must accept an optional `quickInitial` prop of shape `{ status:string; answer:string; sources:any[]; errorMessage:string; durationMs:number; createdAt:string }`. In `mode="quick"` it subscribes to `/quickanswer/[id]/stream` (token/sources/status/complete/error events) instead of `/api/deepdive/[id]/stream`, and skips the `/api/deepdive/[id]/data` hydrate. If `ResearchDesk` does not yet accept `quickInitial`/quick-mode streaming, that is a gap to close in the earlier milestone before this task — do NOT re-introduce the linear quick page. Confirm with:
> ```
> grep -q "quickInitial" src/lib/canvas/intelligence/ResearchDesk.svelte && echo QUICK-OK || echo QUICK-MODE-MISSING
> ```
> Expected: `QUICK-OK`. If `QUICK-MODE-MISSING`, stop and patch `ResearchDesk` first.

- [ ] **Step 3: Manual verification (dev server).** Start dev, open an existing quick-answer id at `http://homeserv:5173/quickanswer/<existing-quick-id>`. Confirm: a small desk renders the answer's sources as cards, the synthesize toggle groups the few facts, no phase machinery is shown, and (for a still-live quick run) tokens stream in. Stop dev when done.

- [ ] **Step 4: Commit.**
```
git add src/routes/quickanswer/\[id\]/+page.svelte src/routes/quickanswer/\[id\]/+page.server.ts
git commit -m "$(cat <<'EOF'
research-desk(m9): mount small desk at /quickanswer/[id]

Quick answers now render the shared ResearchDesk in quick mode (small desk,
no phases) hydrated from the loaded row and live-streamed from the existing
quick-answer SSE endpoint. Retires the linear quick-answer page.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Redirect the old `/deepdive/[id]/progress` and `/deepdive/[id]/dashboard` to the desk

Both old routes become server-side redirect shims to `/deepdive/[id]`. We replace each `+page.server.ts` with a pure 302 redirect (preserving the bad-id → `/deepdive` behaviour) and delete each `+page.svelte` so the (Cytoscape-laden) dashboard component and the linear progress component stop building.

**Files:**
- Replace: `src/routes/deepdive/[id]/progress/+page.server.ts` (entire file, 1-30)
- Delete: `src/routes/deepdive/[id]/progress/+page.svelte`
- Replace: `src/routes/deepdive/[id]/dashboard/+page.server.ts` (entire file, 1-131)
- Delete: `src/routes/deepdive/[id]/dashboard/+page.svelte`

- [ ] **Step 1: Replace `progress/+page.server.ts` with a redirect shim.**
```ts
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/** Retired linear progress page — the live desk replaces it. */
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(308, `/deepdive/${params.id}`);
};
```

- [ ] **Step 2: Replace `dashboard/+page.server.ts` with a redirect shim.**
```ts
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

/** Retired tabbed dashboard — the live desk replaces it. */
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(308, `/deepdive/${params.id}`);
};
```

- [ ] **Step 3: Delete the two old page components.**
```
git rm src/routes/deepdive/\[id\]/progress/+page.svelte src/routes/deepdive/\[id\]/dashboard/+page.svelte
```
Expected output: `rm 'src/routes/deepdive/[id]/progress/+page.svelte'` and `rm 'src/routes/deepdive/[id]/dashboard/+page.svelte'`.

- [ ] **Step 4: Sanity-check nothing else references the deleted components or routes by file path.**
```
grep -rn "deepdive/\[id\]/dashboard/+page.svelte\|deepdive/\[id\]/progress/+page.svelte" src/ || echo "no stale file refs"
```
Expected: `no stale file refs`. (In-app links to `/deepdive/[id]/dashboard` and `/deepdive/[id]/progress` are fine — they 308 to the desk. Those `goto(...)` calls inside the now-deleted dashboard/progress components are gone with the files; remaining ones get cleaned in Task 5/6.)

- [ ] **Step 5: Manual verification (dev server).** Open `http://homeserv:5173/deepdive/<id>/progress` and `http://homeserv:5173/deepdive/<id>/dashboard`; both must land on `/deepdive/<id>` (the desk). Stop dev when done.

- [ ] **Step 6: Commit.**
```
git add src/routes/deepdive/\[id\]/progress/+page.server.ts src/routes/deepdive/\[id\]/dashboard/+page.server.ts
git commit -m "$(cat <<'EOF'
research-desk(m9): redirect old progress/dashboard routes to the desk

Both legacy linear pages now 308 to /deepdive/[id]. Deletes the tabbed
dashboard (+Cytoscape) and the conveyor-belt progress page.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Point the share route at the readonly desk and remove its Cytoscape usage

The share page (`/deepdive/share/[token]`) is the second Cytoscape consumer. We keep public share working but swap its body for the readonly desk so Cytoscape's second usage is removed. The share `+page.server.ts` already resolves the session by token and returns the full data shape — we keep it but only need to pass `session.id` and `readonly`.

**Files:**
- Modify: `src/routes/deepdive/share/[token]/+page.server.ts` (lines 65-98 — trim the return to what the readonly desk needs; keep token lookup)
- Replace: `src/routes/deepdive/share/[token]/+page.svelte` (entire file)

- [ ] **Step 1: Trim the share server load return.** Replace the `return { ... }` block (lines 65-98) so it returns only the readonly desk inputs. Keep lines 1-64 (token lookup + parallel queries) intact — drizzle queries are cheap and the file is shared; we just narrow the output.

Edit `src/routes/deepdive/share/[token]/+page.server.ts`, replacing the existing `return { readonly: true, ... };` object with:
```ts
  return {
    readonly: true as const,
    session: {
      id: session.id,
      topic: session.topic,
      status: session.status,
      shareToken: session.shareToken,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    },
  };
```
(The now-unused `allFacts`/`allEntities`/`allSources`/`allRelationships`/`allMentions`/`report`/`entityCentrality`/`elapsedMs`/`serializedFacts` bindings become dead — delete lines 22-63 too, leaving only the token lookup at lines 14-20 plus the trimmed return. The readonly desk hydrates itself from `/api/deepdive/[session.id]/data`.)

After editing, the file should be exactly:
```ts
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.shareToken, params.token));

  if (!session) throw error(404, 'Not found');

  return {
    readonly: true as const,
    session: {
      id: session.id,
      topic: session.topic,
      status: session.status,
      shareToken: session.shareToken,
      createdAt: session.createdAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    },
  };
};
```

- [ ] **Step 2: Replace the share `+page.svelte` with the readonly desk host (drops the `<script src="…cytoscape…">` tag).**
```svelte
<svelte:head><title>{data.session.topic} — The Desk (Shared)</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import ResearchDesk from '$lib/canvas/intelligence/ResearchDesk.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="desk-host">
  <ResearchDesk
    sessionId={data.session.id}
    mode="deep"
    readonly
    initialTopic={data.session.topic}
  />
</div>

<style>
  .desk-host {
    position: fixed;
    inset: 0;
    background: var(--bg);
    overflow: hidden;
    z-index: 0;
  }
</style>
```

> **Auth note:** the share token route already lives under `PUBLIC_PATHS` (it must — public shares). The readonly desk's hydrate `GET /api/deepdive/[id]/data` must therefore also be reachable for the shared session. Confirm the data endpoint is already public for shares (it is reached by share today via the page load, not the API). If `GET /api/deepdive/[id]/data` is NOT in `PUBLIC_PATHS`, a shared desk will 401 on hydrate — verify:
> ```
> grep -n "deepdive" src/lib/auth.ts
> ```
> If `/api/deepdive/[id]/data` is not allowlisted for the readonly/share case, leave a follow-up note; do not broaden auth in this milestone unless the manual share check (Step 3) actually 401s.

- [ ] **Step 3: Confirm Cytoscape is now fully gone from the codebase.**
```
grep -rn "cytoscape" src/ || echo "CYTOSCAPE-REMOVED"
```
Expected: `CYTOSCAPE-REMOVED`.

- [ ] **Step 4: Manual verification (dev server).** If a shared session exists, open its `/deepdive/share/<token>` URL and confirm the readonly desk renders (no toggle-driven mutation actions persist for readonly; cards/edges visible, no Cytoscape console errors). If no share token exists, create one via the desk's share control first. Stop dev when done.

- [ ] **Step 5: Commit.**
```
git add src/routes/deepdive/share/\[token\]/+page.server.ts src/routes/deepdive/share/\[token\]/+page.svelte
git commit -m "$(cat <<'EOF'
research-desk(m9): render shared deep dives on the readonly desk

Swaps the share page body for the readonly ResearchDesk and removes the
second (and last) Cytoscape usage. Share server load trimmed to the desk's
hydrate inputs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rebuild `/jkai/research` as the launcher and retire `DeepResearchViewer.svelte`

Rebuild `/jkai/research/+page.svelte` into the launcher (prominent prompt bar + Quick/Deep + recent-runs grid). Keep `+page.server.ts`'s merged query but point the deep `href` at the new desk. Then rewire `ResearchResultNode.svelte` (the only component importing `DeepResearchViewer`) to embed the readonly `ResearchDesk` instead, and delete `DeepResearchViewer.svelte`.

**Files:**
- Modify: `src/routes/jkai/research/+page.server.ts` (lines 58-62 — deep `href` now `/deepdive/${r.id}`)
- Replace: `src/routes/jkai/research/+page.svelte` (entire file, 1-468)
- Modify: `src/lib/canvas/intelligence/ResearchResultNode.svelte` (line 2 import; line ~230 usage — swap `DeepResearchViewer` → `ResearchDesk` readonly)
- Delete: `src/lib/canvas/intelligence/DeepResearchViewer.svelte`

- [ ] **Step 1: Update the merge query's deep href.** In `src/routes/jkai/research/+page.server.ts`, replace the deep `href` ternary (currently lines 58-62) so a deep run always points at the desk:
```ts
      href: `/deepdive/${r.id}`,
```
(Remove the `r.status === 'complete' ? dashboard : progress` branch entirely; the desk is the single destination for any deep run state.)

- [ ] **Step 2: Replace `/jkai/research/+page.svelte` with the launcher.** Keep the SR design language (`--font-display`, `--font-mono`, `--accent`, hairline borders), keep the recent-runs grid driven by `data.runs`, but lead with a prominent prompt bar and a compact Quick/Deep segmented toggle. Submitting routes to the desk: deep → `/deepdive/[id]`, quick → `/quickanswer/[id]`.
```svelte
<svelte:head><title>Research — JKAI</title></svelte:head>
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Mode = 'quick' | 'deep';
  let mode = $state<Mode>('deep');
  let topic = $state('');
  let starting = $state(false);
  let error = $state<string | null>(null);

  async function start() {
    const t = topic.trim();
    if (!t) { error = 'Enter a topic first.'; return; }
    error = null;
    starting = true;
    try {
      if (mode === 'quick') {
        const fd = new FormData();
        fd.append('topic', t);
        fd.append('goals', '');
        const res = await fetch('/quickanswer', { method: 'POST', body: fd });
        if (res.redirected) { await goto(res.url); return; }
        if (!res.ok) { error = `Quick answer failed (${res.status})`; return; }
        await goto('/quickanswer');
      } else {
        const res = await fetch('/api/deepdive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: t, goals: [] }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          error = body.error ?? `Deep dive failed (${res.status})`;
          return;
        }
        const session = await res.json();
        await goto(`/deepdive/${session.id}`);
      }
    } catch (e: any) {
      error = e?.message ?? 'Network error';
    } finally {
      starting = false;
    }
  }

  function statusColor(status: string): string {
    if (status === 'complete') return '#2d7d46';
    if (status === 'failed') return '#8b3a1a';
    if (status === 'draft') return 'var(--text-ghost)';
    return 'var(--accent)';
  }
  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatDuration(ms: number | null): string {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Research</div>
      <h1>The Desk</h1>
      <p class="sub">
        Ask a question. Watch the desk fill with sources, facts and entities in realtime,
        then flip <strong>GATHER ⇄ SYNTHESIZE</strong> to fold the pile into clusters.
      </p>
    </div>
    <a class="back-link" href="/jkai">← JKAI</a>
  </header>

  <section class="launch">
    <div class="prompt-row">
      <input
        type="text"
        bind:value={topic}
        class="prompt-input"
        placeholder="Research anything…"
        onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !starting) { e.preventDefault(); start(); } }}
      />
      <div class="seg" role="group" aria-label="Research depth">
        <button type="button" class="seg-btn" class:on={mode === 'quick'} aria-pressed={mode === 'quick'} onclick={() => (mode = 'quick')}>Quick</button>
        <button type="button" class="seg-btn" class:on={mode === 'deep'} aria-pressed={mode === 'deep'} onclick={() => (mode = 'deep')}>Deep</button>
      </div>
      <button type="button" class="go-btn" disabled={starting || !topic.trim()} onclick={start}>
        {starting ? 'Starting…' : 'Open desk →'}
      </button>
    </div>
    <p class="mode-hint">
      {#if mode === 'quick'}
        <strong>Quick</strong> — a single pass with citations, a small desk in under two minutes.
      {:else}
        <strong>Deep</strong> — the multi-phase agent: sources, facts, entities, red-team — the full desk.
        <a class="row-link" href="/deepdive">Advanced options →</a>
      {/if}
    </p>
    {#if error}<div class="err-line">{error}</div>{/if}
  </section>

  <section class="recent">
    <div class="recent-hd">
      <span class="sr-label-tight">Recent runs</span>
      <span class="recent-meta">{data.runs.length} {data.runs.length === 1 ? 'run' : 'runs'}</span>
    </div>

    {#if data.runs.length === 0}
      <div class="empty">No research runs yet. Ask something above.</div>
    {:else}
      <div class="run-grid">
        {#each data.runs as r (r.mode + ':' + r.id)}
          <a class="run-card" href={r.href}>
            <span class="run-mode {r.mode}">{r.mode}</span>
            <div class="run-topic">{r.topic}</div>
            <div class="run-meta">
              <span style:color={statusColor(r.status)}>{r.status}</span>
              {#if r.durationMs}<span class="dot">·</span><span>{formatDuration(r.durationMs)}</span>{/if}
              <span class="dot">·</span><span>{formatDate(r.createdAt)}</span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 900; line-height: 1.05; }
  .sub { margin: 0.6rem 0 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); max-width: 64ch; }
  .sub strong { color: var(--text-primary); font-weight: 700; }
  .back-link { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; flex-shrink: 0; }
  .back-link:hover { text-decoration: underline; }

  .launch { margin-bottom: 2.25rem; }
  .prompt-row { display: flex; gap: 0.5rem; align-items: stretch; flex-wrap: wrap; }
  .prompt-input {
    flex: 1 1 320px; min-width: 0;
    font-family: var(--font-body); font-size: 1.05rem;
    padding: 0.85rem 1rem;
    background: var(--surface-elevated, #e8dece);
    border: 1.5px solid rgba(26, 16, 8, 0.18);
    color: var(--text-primary);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    outline: none;
  }
  .prompt-input:focus { border-color: var(--accent); }
  .seg { display: inline-flex; border: 1.5px solid rgba(26, 16, 8, 0.18); box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1); }
  .seg-btn {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
    padding: 0 1rem; background: var(--card, #faf6ee); color: var(--text-muted); border: none; cursor: pointer;
  }
  .seg-btn + .seg-btn { border-left: 1.5px solid rgba(26, 16, 8, 0.18); }
  .seg-btn.on { background: var(--accent); color: #fff; }
  .go-btn {
    font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em;
    padding: 0 1.25rem; background: var(--text-primary); color: var(--bg); border: 1.5px solid var(--text-primary);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1); cursor: pointer; white-space: nowrap;
  }
  .go-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mode-hint { margin: 0.7rem 0 0; font-size: 0.85rem; color: var(--text-secondary); }
  .mode-hint strong { color: var(--text-primary); }
  .err-line { font-family: var(--font-mono); font-size: 11px; color: #c44; padding: 6px 8px; background: rgba(196, 68, 68, 0.08); border-left: 2px solid #c44; margin-top: 0.6rem; }

  .recent-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .recent-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost); font-style: italic; border: 1px dashed rgba(26, 16, 8, 0.18); }
  .run-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.6rem; }
  .run-card {
    display: block; padding: 0.8rem 0.95rem;
    background: var(--card, #faf6ee); border: 1px solid rgba(26, 16, 8, 0.18);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    color: var(--text-primary); text-decoration: none; transition: transform 80ms ease;
  }
  .run-card:hover { transform: translate(-1px, -1px); }
  .run-mode { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em; padding: 2px 6px; border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-muted); }
  .run-mode.quick { color: var(--accent); border-color: var(--accent); }
  .run-mode.deep { color: var(--bg); background: var(--text-primary); border-color: var(--text-primary); }
  .run-topic { font-size: 13px; font-weight: 500; margin: 0.55rem 0 0.35rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .run-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .run-meta .dot { color: var(--text-ghost); }
  .row-link { color: var(--accent); text-decoration: none; font-family: var(--font-mono); font-size: 11px; }
  .row-link:hover { text-decoration: underline; }
</style>
```

- [ ] **Step 3: Rewire `ResearchResultNode.svelte` off `DeepResearchViewer`.** Read the current usage first to get the exact embedded prop block.
```
sed -n '220,245p' src/lib/canvas/intelligence/ResearchResultNode.svelte
```
Then change the import on line 2 from:
```svelte
  import DeepResearchViewer from './DeepResearchViewer.svelte';
```
to:
```svelte
  import ResearchDesk from './ResearchDesk.svelte';
```
And replace the `<DeepResearchViewer ... />` usage (around line 230) with an embedded readonly desk. The embed must use the session id the node already holds (the existing component passes a `data`/`sessionId`-bearing prop; preserve whichever id field is already in scope — read the node to confirm the variable name):
```svelte
    <ResearchDesk
      sessionId={sessionId}
      mode="deep"
      readonly
      embedded
    />
```
> **Contract note:** `ResearchDesk.svelte` must accept an optional `embedded` boolean that constrains it to fill its parent box (not `position:fixed; inset:0`) for the canvas-node embed. If `embedded` is not supported yet, add it in the earlier desk milestone before this task. Confirm:
> ```
> grep -q "embedded" src/lib/canvas/intelligence/ResearchDesk.svelte && echo EMBED-OK || echo EMBED-MISSING
> ```
> Expected: `EMBED-OK`. Also confirm the comment on `ResearchResultNode.svelte:49` referencing "drv-tabs bar height in DeepResearchViewer" is updated/removed since the embedded desk has no `.drv-tabs` bar — re-measure the embed header height against the desk's CommandBar and adjust the constant, or remove the now-wrong comment.

- [ ] **Step 4: Delete `DeepResearchViewer.svelte` and confirm no references remain.**
```
git rm src/lib/canvas/intelligence/DeepResearchViewer.svelte
grep -rn "DeepResearchViewer" src/ || echo "DEEPRESEARCHVIEWER-REMOVED"
```
Expected: the `git rm` line, then `DEEPRESEARCHVIEWER-REMOVED` (the comment on `data/+server.ts:17` mentioning it is just prose — update it to say "the embedded ResearchDesk canvas node" in the same step if you want it accurate; not load-bearing).

- [ ] **Step 5: Update the stale data-endpoint comment** (optional but tidy). In `src/routes/api/deepdive/[id]/data/+server.ts:17`, change `Used by the embedded DeepResearchViewer canvas node.` to `Used by the ResearchDesk hydrate-then-stream contract (desk + embedded canvas node).`

- [ ] **Step 6: Manual verification (dev server).** Open `http://homeserv:5173/jkai/research`: confirm the prompt bar + Quick/Deep segment + recent-runs grid render in SR design language, deep cards link to `/deepdive/[id]` (not `/dashboard` or `/progress`), and starting a deep run navigates to the desk. Open a workflow canvas containing an `IntelligenceNode` / `ResearchResultNode` and confirm the embedded readonly desk renders in place of the old viewer. Stop dev when done.

- [ ] **Step 7: Commit.**
```
git add src/routes/jkai/research/+page.svelte src/routes/jkai/research/+page.server.ts src/lib/canvas/intelligence/ResearchResultNode.svelte src/routes/api/deepdive/\[id\]/data/+server.ts
git commit -m "$(cat <<'EOF'
research-desk(m9): rebuild /jkai/research launcher + retire DeepResearchViewer

Launcher = prompt bar + Quick/Deep segment + recent-runs grid (merge query
kept, deep href now points at the desk). Rewire ResearchResultNode to embed
a readonly ResearchDesk and delete DeepResearchViewer.svelte.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Fix the stale `$lib/vertex` line in `~/strange_rambling_svelte/CLAUDE.md`

The repo CLAUDE.md (line 9) still says `**LLM:** All AI calls via $lib/vertex (never direct API calls)`. The real gateway is `$lib/jkai/llm-client` (which `$lib/deepdive/ai.ts` wraps). Fix it.

**Files:**
- Modify: `~/strange_rambling_svelte/CLAUDE.md` (the `**LLM:**` bullet near line 9)

- [ ] **Step 1: Confirm the exact current line.**
```
grep -n "vertex" /home/john/strange_rambling_svelte/CLAUDE.md
```
Expected: one hit on the `**LLM:** All AI calls via `$lib/vertex`...` line.

- [ ] **Step 2: Replace the line.** Change:
```
- **LLM:** All AI calls via `$lib/vertex` (never direct API calls)
```
to:
```
- **LLM:** All AI calls via the gateway in `$lib/jkai/llm-client` (and its wrappers, e.g. `$lib/deepdive/ai.ts`) — never direct provider SDK calls
```

- [ ] **Step 3: Verify no `vertex` reference remains.**
```
grep -n "vertex" /home/john/strange_rambling_svelte/CLAUDE.md || echo "VERTEX-REFERENCE-GONE"
```
Expected: `VERTEX-REFERENCE-GONE`.

- [ ] **Step 4: Commit.**
```
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
research-desk(m9): fix stale $lib/vertex LLM gateway line in CLAUDE.md

The real gateway is $lib/jkai/llm-client (wrapped by $lib/deepdive/ai.ts);
$lib/vertex does not exist.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full unit suite + type-check (gate before deploy)

Run the whole desk-related unit suite and the project type-check to catch any cross-file breakage from the retirements.

**Files:** none (verification task).

- [ ] **Step 1: Run all new/affected unit tests.**
```
npx vitest run src/lib/deepdive/ src/lib/canvas/intelligence/desk/ src/routes/deepdive/\[id\]/deskload.test.ts
```
Expected: all test files pass, `0 failed`. (Includes `display.test.ts`, `deskload.test.ts`, plus `layout.test.ts` / `desk-events.test.ts` / `synthesis*.test.ts` from earlier milestones.)

- [ ] **Step 2: Type-check (needs the bumped heap — it OOMs otherwise).**
```
NODE_OPTIONS=--max-old-space-size=8192 npm run check
```
Expected: `svelte-check` finishes with `0 errors`. Warnings are acceptable; **zero errors** is the gate. If errors appear, they will most likely be: a dangling import of a deleted component, a `goto('/deepdive/.../dashboard')` left in a surviving file, or a missing `ResearchDesk` prop (`quickInitial`/`embedded`/`readonly`/`initialTopic`) — fix at the source, re-run, do not proceed until clean.

- [ ] **Step 3: Confirm no surviving in-app navigation targets the retired routes by mistake** (links are fine — they 308 — but `goto` to them is wasteful).
```
grep -rn "deepdive/\${[^}]*}/dashboard\|deepdive/\${[^}]*}/progress\|/dashboard\`\|/progress\`" src/routes/ src/lib/ || echo "NO-STALE-NAV"
```
Review hits: any remaining `goto(\`/deepdive/${id}/progress\`)` (e.g. in `/api/deepdive/[id]/explore` callers or rerun flows that were inside the deleted dashboard — those are gone, but double-check `api/deepdive/[id]/rerun` redirect responses and any other component) should be pointed at `/deepdive/${id}`. Fix any found, then re-run Step 2.

- [ ] **Step 4: Commit any fixes from Steps 2-3** (only if changes were made).
```
git add -A
git commit -m "$(cat <<'EOF'
research-desk(m9): fix type errors + stale nav after retiring old research UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Migrate schema, build, deploy, and verify live on strangeramblings.com

Per CLAUDE.md deploy discipline: push schema, build with the bumped heap (sandbox disabled), run `scripts/deploy.sh` (which itself runs `drizzle-kit push --force` on the VPS before restart), then verify the change is actually live.

**Files:** none (deploy task). All `Bash` calls in this task must run with the **sandbox disabled** (build + deploy fail under the sandbox at the adapter-node step and over SSH).

- [ ] **Step 1: Apply the additive schema locally.** (All Milestone 1–8 columns + `synthesis_runs` are additive/nullable/defaulted → safe push, no prompt.)
```
npx drizzle-kit push --config=drizzle.config.ts
```
Expected: `[✓] Changes applied` (CREATE TABLE `synthesis_runs`; ALTER TABLE `sources`/`facts`/`entities` ADD COLUMN ...). If it prompts about a destructive change, STOP — the schema has an unintended narrowing; do not force-push blindly.

- [ ] **Step 2: Verify the new columns/table exist locally.**
```
npx drizzle-kit push --config=drizzle.config.ts
```
Run twice — the second run should report `No changes detected` (idempotent), proving the first applied.

- [ ] **Step 3: Clean build with the bumped heap (suspect stale `.svelte-kit/output` first per CLAUDE.md).**
```
rm -rf .svelte-kit/output && NODE_OPTIONS=--max-old-space-size=8192 npm run build
```
Expected: `✓ built` / adapter-node output, no errors. If it fails citing a deleted module, grep for the dangling import and fix before retrying.

- [ ] **Step 4: Deploy (script builds again, pushes schema on VPS with `--force`, restarts).**
```
NODE_OPTIONS=--max-old-space-size=8192 scripts/deploy.sh
```
Expected tail: `==> Applying DB schema (drizzle-kit push)...` then `==> Deployed successfully to https://strangeramblings.com`. If it ends with `ERROR: Service is failed`, read the journal output it prints and fix before declaring done.

- [ ] **Step 5: Verify the deploy provenance matches HEAD.**
```
git rev-parse --short HEAD
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "cat /opt/strange-rambling-svelte/build/.deploy-sha"
```
Expected: the `short=` line in the VPS file equals local `git rev-parse --short HEAD`.

- [ ] **Step 6: Verify the live desk route responds and the old routes redirect.** Pick a real deep session id from the launcher's recent runs (or query the VPS DB), then:
```
# Desk index responds (200, private — authenticated curl needed if it 302s to login that's expected for the redirect-to-auth, so probe the redirect shims instead):
curl -sS -o /dev/null -w "progress -> %{http_code} %{redirect_url}\n" "https://strangeramblings.com/deepdive/SOME_DEEP_ID/progress"
curl -sS -o /dev/null -w "dashboard -> %{http_code} %{redirect_url}\n" "https://strangeramblings.com/deepdive/SOME_DEEP_ID/dashboard"
```
Expected: each prints `308` (or the auth `302` to login if unauthenticated — but the redirect target, once authed, must be `/deepdive/SOME_DEEP_ID`). The key assertion: the old paths no longer render the tabbed dashboard / linear progress HTML.

- [ ] **Step 7: Verify Cytoscape is gone from the live bundle.**
```
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "grep -rl cytoscape /opt/strange-rambling-svelte/build/ || echo NO-CYTOSCAPE-IN-BUILD"
```
Expected: `NO-CYTOSCAPE-IN-BUILD`.

- [ ] **Step 8: Manual live confirmation.** In a logged-in browser on `https://strangeramblings.com`:
  1. Open `/jkai/research` — the launcher (prompt bar + Quick/Deep + recent grid) renders in SR design language.
  2. Start a Deep run — it navigates to `/deepdive/[id]` and the desk fills with artefacts in GATHER mode in realtime.
  3. Flip to SYNTHESIZE — cards morph into categories/clusters, connectors draw.
  4. Drag + pin a card; reload — the pinned position persists.
  5. Start a Quick run — it lands on `/quickanswer/[id]` as a small desk with the answer's sources.
  6. Confirm no console errors mentioning `cytoscape` or `DeepResearchViewer`.

- [ ] **Step 9: Final commit (only if Step 6/8 surfaced any live-only fix; otherwise nothing to commit — deploy itself created no tracked changes beyond the provenance stamp which is gitignored under `build/`).** If a fix was needed:
```
git add -A
git commit -m "$(cat <<'EOF'
research-desk(m9): live-verify fixes after desk rollout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
NODE_OPTIONS=--max-old-space-size=8192 scripts/deploy.sh
```
Then re-run Steps 5-8 until the desk is observed working on `strangeramblings.com`. Do not declare the milestone done until Step 8 is confirmed live.

---

**Milestone 9 done when:** the desk is the single research surface (`/deepdive/[id]` deep, `/quickanswer/[id]` small, `/deepdive/share/[token]` readonly), the old `progress`/`dashboard` routes 308 to it, `/jkai/research` is the launcher, `DeepResearchViewer.svelte` + both Cytoscape usages are deleted, the shared display helpers are tested in `$lib/deepdive/display.ts`, the CLAUDE.md `$lib/vertex` line is fixed, `npm run check` is error-free, the additive schema is pushed locally and on the VPS, and the live desk is observed working on strangeramblings.com.

---

**Notes for the executing engineer (paths verified against the real repo on 2026-06-14):**
- `/deepdive/[id]/+page.svelte` does **not** exist yet — Task 2 creates it (no overwrite collision).
- `ResearchDesk.svelte`, the `desk/` dir, `synthesisRuns` schema, `desk-events.ts`, `synthesis.ts`, and the synthesize/position endpoints are **preconditions from Milestones 1–8**; this milestone errors out early (precondition check) if they are absent.
- Both `dashboard/+page.svelte` (`:3`) and `share/[token]/+page.svelte` (`:3`) load Cytoscape via a `<script src=…cdnjs…cytoscape…>` tag in `<svelte:head>`; deleting/replacing those two files (Tasks 4 + 5) removes Cytoscape entirely (`grep -rn cytoscape src/` must be empty).
- `DeepResearchViewer.svelte` is imported only by `ResearchResultNode.svelte:2` (rewired in Task 6); the only other textual hit is a prose comment in `api/deepdive/[id]/data/+server.ts:17`.
- The launcher's `+page.server.ts` merge query (quick + deep, `limit(15)` each, sliced to 20) is **kept**; only the deep `href` changes from the dashboard/progress branch to `/deepdive/[id]` (Task 6, Step 1).
- Deploy: `scripts/deploy.sh` already builds with `NODE_OPTIONS=--max-old-space-size=8192` and runs `drizzle-kit push --force` on the VPS before restarting only `strange-rambling-svelte`; build + all SSH steps must run with the Bash sandbox disabled.

---

## Final self-review checklist

**Spec coverage** (spec section → milestone):
| Spec § | Covered by |
|---|---|
| §3.1 launcher / §14 rollout | M9 |
| §3.2 desk (pan/zoom/drag) | M6 |
| §3.3 artefact taxonomy | M6 (cards) + M2 (events) |
| §3.4 GATHER mode | M2 + M6 |
| §3.5 SYNTHESIZE mode | M3 + M7 |
| §3.6 the flip / morph / stickiness | M7 |
| §3.7 cockpit (bar/feed/ticker/inspector) | M8 |
| §3.8 quick vs deep | M9 |
| §5.2 SSE event vocabulary | M2 |
| §5.3 hydrate-then-stream | M6 (store) |
| §5.4 synthesis endpoint | M3 |
| §5.5 position persistence | M4 |
| §5.6 LLM gateway | M3 |
| §5.7 auto-layout | M5 |
| §5.8 emitter lifecycle / per-run abort | M2 (ensureEmitter) + M3 (abort) |
| §6 schema changes | M1 |
| §7 routing/auth/migration/deploy | M1 + M3 + M9 |

**Build-time confirmations (flagged in the spec):**
1. Re-grep the phase insert-site line refs before editing — `phase1/2/3.ts` line numbers may have drifted; emit AFTER the `.returning()` insert.
2. Confirm `ResearchResultNode.svelte`'s exact prop contract before extracting its token-stream/`--scroll-h` idiom.
3. Run `npx vitest run` for the testable units (M2 desk-events, M5 layout, M3 scope/abort) and `npx svelte-check` (with the 8GB node heap) before each commit; deploy with the Bash sandbox disabled.
