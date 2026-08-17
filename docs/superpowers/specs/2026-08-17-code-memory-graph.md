# Codegraph — a code-keyed memory graph for the builder

> A structural memory for autonomous builds: the graph's nodes are files and
> gates, because code entities are the only identity in this corpus that
> survives — sessions end and transcripts get deleted, but
> `src/lib/jkai/executor.ts` persists across all 157 sessions and will be
> edited again next week. Episodes (edits with diffs and verdicts) and lessons
> (claims with provenance) hang off those nodes. Retrieval is keyed on the
> file set a build is about to touch plus the fingerprint of the gate error it
> just hit — both extracted deterministically, zero LLM calls — and every
> serve is an auditable row, because this repo's own history proves the only
> trustworthy evidence of usage is SQL over actions.
>
> Date: 2026-08-17. Autonomous build — Decision Log in §12. All paths relative
> to `/home/john/strange_rambling_svelte/` (built in the `codegraph` worktree).

## 0. The problem

The builder starts every iteration amnesiac. It has a codebase digest (a
mtime-ranked sample of ~60 files out of 3,359) and whatever the previous
iteration's evaluation says, and nothing else: not the 134 prior edits to the
file it is about to open, not the fix that cleared this exact `svelte-check`
error three weeks ago, not the hand-written note saying `ci-deploy.sh` is an
allow-list. Meanwhile 272 curated memory notes (1.16 MB, the highest-quality
knowledge body in the house) sit in `~/.claude/projects/-home-john/memory/`
where jkai cannot read a byte of them.

The cost is measured, not felt: **10.5 read/grep/find/ls discovery actions per
build iteration**, 6.53 reads per distinct path — the agent re-derives the
same context over and over. And when it repairs something, the repair
evaporates: 17.1% of merged PRs were themselves fixes of earlier merged work.

Two constraints shape everything below:

1. **pi has no mid-run injection channel.** `runPi` builds one argv
   (`--no-context-files` explicit); nothing enters after `executor.ts:322`.
   Anything the agent gets mid-iteration, it must fetch itself — and the only
   transport that has never been stripped is bash (5,214 production actions
   are exactly `BASE_PI_TOOLS`; zero bridged tool calls, ever).
2. **The prompt is mostly throttle, not spec.** 29% of John's prompts are
   ≤25 characters ("go", "crack on", "ship it"). A retrieval system that
   embeds the prompt to find context has nothing to embed. The query has to
   come from somewhere mechanical.

## 1. Ground truth (measured, not assumed)

Survey of all 1,010 transcript files (107 main sessions, 555 MB; 903 nested
subagent/workflow files, 303 MB; 208,338 JSON records, zero parse failures),
joined to production Postgres and GitHub. Numbers below are from that survey,
2026-08-17.

### The corpus

| What | Measured |
|---|---|
| Sessions | 107 with jsonl + 50 recoverable only from prod `claude_sessions` = 157 |
| Tool calls | 57,862 `tool_use` blocks; Bash is 68% (39,604 calls) |
| Edits | 8,722 Edit/Write ops over 2,447 distinct files; **34% happen in nested subagent transcripts** |
| Repo coverage | 1,246 distinct repo-relative SR paths = 42% of the 2,935 tracked `.ts`/`.svelte` files |
| Reads | 7,544 Read ops; subagents read ~2× the main session while editing half as much |
| Real prompts | 532 of 1,621 candidates (33% signal); median 45 chars; only 222 (42%) exceed 60 chars |
| Gate runs | 4,278 recognised invocations; 281 strict failures; 166 fail→pass transitions |
| Verified fix triples | **78** (53 tight) — 0.7 per session, present in only 28 of 107 sessions |
| Strict text-classified failures | 940 (after fixing two false-positive regex bugs — see traps) |
| PR linkage | 268 distinct PRs, 258 merged / 10 closed-unmerged; 89.3% recall vs `gh pr list`; 100% precision |
| Fix-PR rate | 52 of 304 PR titles (17.1%) are fix/hotfix/revert/repair |
| Memory notes | 272 files, median 2,919 B, already claim+consequence shape; 117 cite concrete `src/` paths |

### The waste, and where it is not

The rare event is the fix triple: 78 corpus-wide. The common event is
discovery: **10.5 discovery actions per iteration** across 280 builder
iterations (66 git-target builds, mean 4.24 iterations per build, grouped
median 4; completed-only mean 5.65). A memory system for this corpus must pay
on every iteration's discovery, not just on the rare recurring error — that
decision is D1.

### Traps the design is built around

- **Exit status is not failure status.** `is_error=true` on only 593 main
  Bash results vs 940 text-detected failures, because gates are run as
  `... 2>&1 | grep error | head -20`, which exits 0. And 296 exit-code hits
  are 130/137/143/144 — the harness's timeout killing a long build, not a
  defect. An unfixed classifier over-reports failure by ~46%.
- **`svelte-check found \d+ error` matches "found 0 errors".** Must be
  `[1-9]\d*`; same for "Test Files 0 failed". Fixing both cut strict failures
  from 1,374 to 940 and phantom triples from 62 to 51.
- **Nested transcripts omit `toolUseResult`** (present on 8.6%). The fallback
  through `message.content[].tool_result.content` recovers 25,020 results and
  lifts nested Bash results from 1,357 to 18,663. Always dual-path.
- **Worktree path aliasing**: the same logical file appears under up to 6
  roots. Normalising to repo-relative collapsed 1,499 absolute SR paths to
  1,246 logical ones.
- **The corpus is multi-repo**: only ~62% of edits are this repo. archetype
  (944 ops), sr-docs (514), scs-earnings (382) and `~/.claude` (686) must
  partition out or an SR build retrieves Archetype card-balance lore.
- **`full_transcript` is a lossy rendering** — 0.4–4.7% of the raw jsonl
  (Bash sliced to 200 chars, results to 400, Edit/Write rendered as a bare
  path). It recovers the lost 2026-06-04..07-11 prompts and paths; it cannot
  recover fix triples for that window.
- **Session ≠ transcript file**: all 903 nested files carry the *parent's*
  sessionId (1,010 files → 107 distinct sessionIds). The transcript path is
  the file key; sessionId is the session key. This is also the gift that lets
  a subagent's fixing edit join back to the main session's gate failure.
- **Usage logs lie; actions do not.** The tool bridge reported healthy for
  280 iterations while never being called once — including 41 iterations
  after all four bridge fixes landed. Every usage claim in §11 is SQL over
  `jkai_iterations.actions`, never a log line.

### Precedent measured, not assumed

The intel graph (`src/lib/db/schema.ts:1859-2333`, `src/lib/jkai/intel/`) is
the in-house precedent for every layer: pure analytics + one DB-aware loader
with a generation-guarded 60 s cache, tombstone-not-delete resolution with a
replayable merge ledger, a shared visual-encoding module, and lazy-imported
read-only site tools. Its production numbers (10,619 entities / 99 MB) also
bound this build: codegraph lands an order of magnitude smaller.

One cautionary find: `scripts/migrations/2026-07-26-intel-ann-indexes.sql`
was **written and never applied** — `SELECT indexdef FROM pg_indexes WHERE
indexdef ILIKE '%hnsw%'` returns zero rows on prod today, so every intel
vector search is a seq scan. The codegraph ANN migration therefore ships with
a mandatory run-and-verify step (§4.2).

## 2. Design

Three candidate architectures were designed and scored (D1): **A — Casebook**
(episodic, fingerprint-first), **B — LOOM** (structural, file-set-first),
**C — Doctrine** (claims with decay). B won because it is the only design
keyed to the measured cost — file-set seeding is deterministic, works when
the prompt is "crack on", and pays on every iteration — and it is rebuilt
here as **Codegraph** with A's fingerprint lane and outcome tiers, and C's
lesson layer and liveness, grafted on.

The thesis in one paragraph: **code entities are the only durable identity in
this corpus.** 54 of 150 prod sessions already have no jsonl; the transcripts
are mortal. Files and gates are not. So the graph's nodes are files and
gates; history hangs off them; retrieval is keyed on what the build is about
to touch (`file:` seeds from the prompt and the last iteration's edits) plus
the fingerprint of the error it just hit (`fingerprint:` seeds regexed out of
the previous evaluation — which `orchestrator.ts:1447` already populates with
gate diagnostics). Ranking multiplies by an outcome tier, because "merged" is
demonstrably not "correct". The lesson layer ships pre-loaded with the 272
memory notes verbatim. And every serve is a `codegraph_queries` row joinable
to `jkai_iterations`, so "did it help" is a SQL question with a
pre-registered kill criterion.

What is deliberately novel here (each property earned from a measurement):

1. **Deterministic seeding** — the query is the file set + error fingerprint,
   extracted by regex; works on a 7-character prompt, costs zero LLM calls.
2. **The failure is the query** — iteration N's gate diagnostics mechanically
   compile into iteration N+1's retrieval. No model decides whether to
   retrieve; the loop retrieves exactly when there is a symptom.
3. **Outcome-tiered ranking** — verified > landed > unverified > repaired >
   abandoned, because 17.1% of merged work later needed repair.
4. **A two-speed index** — a pure-btree fingerprint hot lane for the
   recurring-error case; a structural co-change graph for the discovery case,
   where the measured waste actually is.
5. **Informative absence with a typed outage** — "no precedent, you are the
   first" is a first-class logged result, distinct from a 502.
6. **Self-measuring from row one** — every serve is a row; adoption and
   efficacy are SQL, not vibes.

## 3. Ontology

### Nodes (phase 1: two types only)

- **`file`** — `canonicalName` is the repo-relative path with the 6-way
  worktree aliasing collapsed; `repo` partitions out the 38% of activity in
  archetype/scs-earnings/sr-docs/etc.; carries `editCount`/`readCount`/
  `failCount`, `existsOnHead` stamped against `git ls-files`. ~1,250 SR +
  ~1,200 other-repo nodes at seed.
- **`gate`** — a normalised command signature (`svelte-check` | `tsc` |
  `vitest` | `playwright` | `npm run gate` | …). ~15 nodes.
- Reserved for phase 2: `route`, `table`, `tool`, `skill`.

### Payload rows (not nodes)

- **`episode`** — one per (transcript file × edited file); 3,221 measured,
  plus 1,037 pre-2026-07-12 stage-lifted rows at `resolution='stage'`.
  Carries: `intent` (nearest preceding >60-char human prompt, or the subagent
  Task spec), a template-generated `changeSummary` (the only embedded text —
  never the diff), `diffExcerpt` (from `toolUseResult.structuredPatch`,
  present on 5,883 results), `failExcerpt` (gate stdout — stderr is empty 96%
  of the time), `gateSig`, `fingerprint` (`tsc:TS2345` — the hot index),
  `verdict` tier, `prNumber`, `model`, `skill`, `isSidechain`.
- **`lesson`** — claim + consequence with `scope` (`repo`|`glob`|`gate`),
  `source`, `sourceRef`, real-id `supersededById`. ~450 active at seed (272
  memory notes + CLAUDE.md bullets).

### Edges (phase 1: three types)

| Edge | Direction | Derivation | Est. count |
|---|---|---|---|
| `co_change` | file↔file | same-session co-edit ≥2; weight boosted by merged PRs, cut by fix-PR chains | ~6,000 |
| `needs_context` | file→file | read-before-edit in one session — the cheapest "must be understood together" proxy | ~4,000 |
| `broke_at` | file→gate | from the 940 strict failures, corrected regexes | ~600 |
| `attached_to` | lesson→node | via cited path (117 notes name concrete `src/` paths) or manual pin — a composite-PK join table | — |

Phase 2 edges: `implements` / `touches_table` / `registers` / `governed_by`
from static scans of `src/routes`, `schema.ts` pgTable exports, and the tool
registry.

### Verdict tiers

| Verdict | Meaning | Rank weight |
|---|---|---|
| `verified` | same-gate pass observed after the edit, in-transcript | 1.0 |
| `landed` | the PR merged | 0.8 |
| `unverified` | no signal | 0.5 |
| `repaired` | a later fix-PR touched the same files | 0.25 |
| `abandoned` | the PR closed unmerged | 0.1 |

## 4. Schema

### 4.1 Seven `codegraph_*` tables

Inserted in `src/lib/db/schema.ts` immediately after line 3137
(`export type NewClaudeSessionStage`) — the same file as the module-private
`vector` customType at `schema.ts:21` (it is `const`, not exported; a new
table in the same file just uses it). Every index on tables that get
backfilled is plain `index()`: a retrofitted unique index on a populated
table prompts and exit-1s the release, because `drizzle-kit push` runs
non-interactively with `--force` in CI (`ci-release.sh:117`). The two
composite PKs are on tables that ship empty and only gain rows after push, so
they are safe — and mandatory: `intel_note_entities` shipped without one and
every re-extraction silently duplicated rows.

```ts
export const codegraphNodes = pgTable('codegraph_nodes', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  type: text('type').notNull(), // 'file' | 'gate'  (phase 2: route|table|tool|skill)
  name: text('name').notNull(),
  canonicalName: text('canonical_name').notNull(), // repo-relative, worktree aliases collapsed
  repo: text('repo').notNull().default('strange_rambling_svelte'),
  fileKind: text('file_kind'), // component|route-page|route-server|lib|schema|script|test|config
  summary: text('summary'), // phase 2: LLM dossier for files with >=3 episodes only
  properties: jsonb('properties').notNull().default(sql`'{}'::jsonb`),
  embedding: vector('embedding'),
  editCount: integer('edit_count').notNull().default(0),
  readCount: integer('read_count').notNull().default(0),
  failCount: integer('fail_count').notNull().default(0),
  lastTouchedAt: timestamp('last_touched_at', { withTimezone: true }), // observation clock, never ingest
  existsOnHead: boolean('exists_on_head').notNull().default(true), // stamped vs git ls-files
  headCheckedAt: timestamp('head_checked_at', { withTimezone: true }),
  watched: boolean('watched').notNull().default(false),
  mergedIntoId: text('merged_into_id'), // tombstone, no FK — intel schema.ts:1926 pattern
  retiredAt: timestamp('retired_at', { withTimezone: true }), // soft-forget, excluded from ALL retrieval
  retiredReason: text('retired_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('codegraph_nodes_type_idx').on(t.type),
  index('codegraph_nodes_canonical_idx').on(t.canonicalName),
  index('codegraph_nodes_repo_type_idx').on(t.repo, t.type),
  index('codegraph_nodes_merged_idx').on(t.mergedIntoId),
  index('codegraph_nodes_retired_idx').on(t.retiredAt),
]);

export const codegraphEdges = pgTable('codegraph_edges', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sourceId: text('source_id').notNull().references(() => codegraphNodes.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => codegraphNodes.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // co_change | needs_context | broke_at
  weight: doublePrecision('weight').notNull().default(0.5), // the real measure — no bucketed display column
  observationCount: integer('observation_count').notNull().default(1),
  evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`), // {sessionIds:[<=10], prNumbers:[<=10]}
  manual: boolean('manual').notNull().default(false),
  suppressed: boolean('suppressed').notNull().default(false), // kept + loaded separately, never deleted
  suppressedReason: text('suppressed_reason'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('codegraph_edges_source_idx').on(t.sourceId),
  index('codegraph_edges_target_idx').on(t.targetId),
  index('codegraph_edges_type_idx').on(t.type),
]);

export const codegraphEpisodes = pgTable('codegraph_episodes', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  nodeId: text('node_id').notNull().references(() => codegraphNodes.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'), // claude_sessions.id — deliberately NO FK: 54 prod sessions have
    // no jsonl and stages are delete/reinserted per cron tick
  transcriptPath: text('transcript_path'), // transcript key != session key: 903 nested files share 107 sessionIds
  intent: text('intent'), // nearest preceding >60-char human prompt, or the subagent Task spec
  changeSummary: text('change_summary').notNull(), // TEMPLATE-generated, the only embedded text — never the diff
  diffExcerpt: text('diff_excerpt'), // from toolUseResult.structuredPatch (5,883 results carry it)
  failExcerpt: text('fail_excerpt'), // gate stdout — stderr is empty 96% of the time (2>&1 pipes)
  gateSig: text('gate_sig'),
  fingerprint: text('fingerprint'), // 'tsc:TS2345' | 'svelte:a11y_click_events_have_key_events' — the HOT index
  verdict: text('verdict', { enum: ['verified', 'landed', 'unverified', 'abandoned', 'repaired'] })
    .notNull().default('unverified'),
  prNumber: integer('pr_number'),
  model: text('model'),
  skill: text('skill'), // attributionSkill carried forward from last non-null
  isSidechain: boolean('is_sidechain').notNull().default(false),
  resolution: text('resolution').notNull().default('full'), // 'full' | 'stage' (pre-07-12 lossy window, labelled)
  embedding: vector('embedding'),
  observedAt: timestamp('observed_at', { withTimezone: true }), // session clock, NOT ingest clock
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('codegraph_episodes_node_idx').on(t.nodeId, t.observedAt),
  index('codegraph_episodes_fingerprint_idx').on(t.fingerprint), // the deterministic hot path
  index('codegraph_episodes_gate_idx').on(t.gateSig),
  index('codegraph_episodes_verdict_idx').on(t.verdict),
  index('codegraph_episodes_session_idx').on(t.sessionId),
  index('codegraph_episodes_pr_idx').on(t.prNumber),
]);

export const codegraphLessons = pgTable('codegraph_lessons', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  claim: text('claim').notNull(), // "ci-release.sh:56-80 is an allow-list; a new scripts/ file needs its own rsync line"
  consequence: text('consequence'), // what it costs when forgotten — the bolded half of MEMORY.md
  scope: text('scope').notNull().default('repo'), // repo | glob | gate
  scopePattern: text('scope_pattern'), // e.g. src/lib/jkai/** when scope='glob'
  source: text('source').notNull(), // memory_note | prompt | correction | manual (phase 2: distilled)
  sourceRef: text('source_ref'), // originating file path / session id — provenance
  status: text('status').notNull().default('active'), // active | superseded | retired (phase 2: quarantined)
  supersededById: text('superseded_by_id'), // REAL id, never a magic string — forget_memory wrote the
    // literal 'forgotten' into 23 jkai_memories rows
  halfLifeDays: integer('half_life_days').notNull().default(180), // per-kind, observation clock;
    // intel's 42d is a Gmail number
  embedding: vector('embedding'),
  observedAt: timestamp('observed_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  retiredReason: text('retired_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('codegraph_lessons_status_idx').on(t.status),
  index('codegraph_lessons_source_idx').on(t.source),
]);

// Brand-new join table, ships empty -> composite PK is safe and mandatory.
export const codegraphNodeLessons = pgTable('codegraph_node_lessons', {
  lessonId: text('lesson_id').notNull().references(() => codegraphLessons.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull().references(() => codegraphNodes.id, { onDelete: 'cascade' }),
  relevance: doublePrecision('relevance').notNull().default(0.5),
  method: text('method').notNull().default('cited_path'), // cited_path | manual (phase 2: embedding)
}, (t) => [
  primaryKey({ columns: [t.lessonId, t.nodeId] }),
  index('codegraph_node_lessons_node_idx').on(t.nodeId),
]);

export const codegraphNodeMerges = pgTable('codegraph_node_merges', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  survivorId: text('survivor_id').notNull(),
  mergedId: text('merged_id').notNull(),
  snapshot: jsonb('snapshot').notNull().default(sql`'{}'::jsonb`), // {movedEdges:[{id,role}],
    // movedEpisodeIds, movedLessonIds} — unmerge replays this
  score: doublePrecision('score'),
  method: text('method'),
  reason: text('reason'),
  undoneAt: timestamp('undone_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('codegraph_node_merges_survivor_idx').on(t.survivorId)]);

// Retrieval audit — every serve, push/pull/chat/ui, is a row.
export const codegraphQueries = pgTable('codegraph_queries', {
  id: serial('id').primaryKey(),
  buildId: text('build_id'),
  iteration: integer('iteration'),
  caller: text('caller').notNull(), // 'pi-push' | 'pi-pull' | 'jkai' | 'ui'
  query: text('query').notNull(), // verbatim CGQL — replayable byte-for-byte on the console
  servedNodes: jsonb('served_nodes').notNull().default(sql`'[]'::jsonb`), // canonical names — joins to later edits
  nodeCount: integer('node_count').notNull().default(0),
  episodeCount: integer('episode_count').notNull().default(0),
  lessonCount: integer('lesson_count').notNull().default(0),
  servedChars: integer('served_chars').notNull().default(0),
  ms: integer('ms').notNull().default(0),
  outcome: text('outcome').notNull().default('ok'), // 'ok' | 'empty' | 'error' — empty is typed,
    // error is loud, never a silent []
  errorText: text('error_text'),
  iterationPassed: boolean('iteration_passed'), // phase-2 orchestrator backfill — closes the corroboration loop
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('codegraph_queries_build_idx').on(t.buildId, t.iteration),
  index('codegraph_queries_caller_idx').on(t.caller, t.createdAt),
]);
```

### 4.2 ANN migration — manual, and verified this time

HNSW and trgm indexes go in
`scripts/migrations/2026-08-17-codegraph-ann-indexes.sql` (hnsw
`vector_cosine_ops` on `codegraph_episodes.embedding`,
`codegraph_lessons.embedding`, `codegraph_nodes.embedding`; `gin_trgm` on
`lower(canonical_name)`). Run **manually on the VPS at ship time** and
**verified** with:

```sql
SELECT indexdef FROM pg_indexes WHERE indexdef ILIKE '%hnsw%';
```

The intel equivalent was written 2026-07-26 and never applied; prod has zero
hnsw indexes today. Writing the file is not the deliverable — the pg_indexes
row is.

### 4.3 Footprint arithmetic

~4,250 episodes + ~450 lessons + ~2,450 nodes with `vector(1536)` ≈ 7,150
rows × 9.75 KB heap + HNSW ≈ **115 MB total** — +3.6% on a 3.2 GB DB, 0.24%
of the 48 GB free. The rejected one-row-per-tool_use design (57,862 rows,
~930 MB) is the only variant that would have mattered, and it is the wrong
grain anyway (D2).

## 5. CGQL — the query language

One graph, one grammar, three callers. A five-verb, non-Turing set-pipeline
compiled to a single parameterised SQL CTE chain (~150 LOC parser). The
compiler is a pure module `src/lib/codegraph/query.ts` (string →
parameterised SQL fragments, own test file — the intel `match.ts` pattern of
keeping the pure half DB-free).

### 5.1 Grammar (EBNF)

```
query    := stage ( '|' stage )*
stage    := seed | walk | pick | budget
seed     := 'file:' PATH[',' PATH]*        (glob '*' allowed, trgm-matched)
          | 'gate:' SIG[',' SIG]*          ('svelte-check' | 'tsc' | 'vitest' | ...)
          | 'fingerprint:' FP[',' FP]*     ('tsc:TS2345' — the hot lane, pure btree)
          | 'topic:' '"' TEXT '"'          (the ONLY vector entry)
walk     := 'hops' INT edgeset?            (INT ∈ {1,2} hard cap; default co_change,needs_context)
pick     := ('episodes'|'lessons'|'failures'|'nodes') kv*
kv       := KEY '=' VALUE                  (KEY ∈ {verdict, gate, since, limit(<=10), min_conf})
budget   := 'budget' INT                   (chars, hard cap 8000; greedy whole-item pack,
                                            priority lessons > failures > episodes > neighbour list)
```

Bare-seed defaults:
`| hops 1 | lessons | episodes verdict=verified,landed limit=3 | budget 5000`.

### 5.2 Worked examples

```
fingerprint:svelte:a11y_click_events_have_key_events | episodes limit=2
```
This exact error class, the fix that worked, sub-10 ms — one btree hit, zero
LLM, zero embedding.

```
file:src/lib/jkai/executor.ts | hops 1 co_change,needs_context
  | episodes verdict=verified,landed limit=3 | lessons | budget 5000
```
The file's history, its co-change partners (`pi-runner.ts`,
`tool-bridge.ts`, with weights), and the lessons that bind it ("JKAI_API_URL
is read once at builder start").

```
gate:svelte-check | failures file=src/lib/components/jkai/* limit=5
```
Recent strict failures under a glob, with their fixing episodes where a
triple exists.

```
topic:"scoped css onto a child component silently deleted" | nodes limit=5 | episodes limit=3
```
The semantic escape hatch for greenfield work — the only stage that costs an
embedding call.

### 5.3 Why not raw SQL, and why not Cypher

Raw SQL: injection surface, ~2 KB of schema per prompt, and silent
plausible-wrong rows. CGQL validates loudly and its whole surface fits in six
prompt lines. Cypher: no graph engine is permitted here, and at 2.5k nodes /
10k edges the useful operations are exactly seed → bounded hop → typed pick →
budget pack, which CGQL states natively. Every query string is stored
verbatim in `codegraph_queries.query` and replayable on the console against
later graph states.

### 5.4 Ranking and the failure contract

Seeds resolve via btree on `canonicalName`/`fingerprint`/`gateSig` (trgm for
globs); hops walk `codegraph_edges` with `suppressed=false`; picks project
episodes/lessons ranked **tierWeight** (verified 1.0, landed 0.8, unverified
0.5, repaired 0.25, abandoned 0.1) × **recency** (half-life 180 d on
`observedAt`, floor 0.3) × **match** — every score returned decomposed (the
intel rule: never an unexplained number). `topic:` is the only vector entry —
one text-embedding-3-small call (~100 ms), degrading to seed-only with a
logged degradation if the call exceeds 3 s (OpenRouter outage mode).

Failure contract, in full:

- **Parse error** → 400 with the byte position and the grammar echoed back.
- **Zero-match seed** → typed `outcome='empty'` with three trgm suggestions
  and the text *"NO PRECEDENT for `<x>` — you are the first; proceed from
  first principles and record the lesson in ## Evaluation"*.
- **Infrastructure failure** → 502, **never** `[]`.
  `studio-research/+server.ts:63-69` is the named precedent: an empty result
  that impersonates an outage converts a graph failure into the false
  statement "this is not covered" — the exact conversion that let four
  bridge failures hide.
- Every query — including failed parses — writes a `codegraph_queries` row.

## 6. Retrieval — one endpoint, three callers

`POST /api/jkai/codegraph/query` — `verifyBridgeToken` for builds (exact
pathname added to the `hooks.server.ts:428` bypass block, named never by
prefix), owner gate for the console.

1. **pi PULL** — `node scripts/codegraph-query.mjs '<CGQL>'` via bash: a
   byte-for-byte clone of `scripts/studio-research.mjs` (reads `JKAI_API_URL`
   + `JKAI_BRIDGE_TOKEN`, exits 2 with a useful message when env is missing,
   prints formatted cards to stdout). Bash is the only transport never
   stripped.
2. **pi PUSH** — the executor block, §7.
3. **jkai chat** — a `codegraph_query` registry tool in
   `src/lib/workflows/site-tools/tools/codegraph.ts` (lazy
   `const loadX = () => import(...)` header — eager analytics imports once
   took registry import to 20 s), barrel import at `registry.ts:37`,
   `toolsetDescriptions` entry at `:124`, keyword-classifier row + test case;
   reachable through `jkai_extended` with **no Hermes restart**.

## 7. Just-in-time injection

Built around two measured facts: pi has no mid-run injection channel (one
argv, nothing enters after `executor.ts:322`), and bash has a production
track record where the bridge has none.

### 7.1 PUSH — load-bearing, every repo-mode iteration, zero LLM calls

At `executor.ts:245` — the line after
`const codebaseDigest = await buildCodebaseDigest(...)` — add:

```ts
const retrievalBlock = promptMode === 'repo'
  ? await (await import('./retrieval-context')).buildRetrievalBlock({
      buildId,
      task: build.prompt,
      lastEvaluation: prevIteration?.evaluation ?? null,
      prevActions: prevIteration?.actions ?? null,
    }).catch(() => '')
  : '';
```

Seed compilation is regex, not a model:

- Fingerprints regexed from `prevIteration.evaluation` —
  `orchestrator.ts:1447` already appends gate diagnostics, so **the previous
  iteration's failure mechanically becomes this iteration's query** →
  `fingerprint:` seeds.
- Path-like tokens in `build.prompt` + files edited last iteration (the
  `actions` jsonb) → `file:` seeds with `hops 1`.
- Iteration 1 with no paths falls back to one `topic:` embedding per build,
  cached by prompt hash.

Injected at `executor.ts:312` by appending `retrievalBlock` to the
`userPrompt` array **after** `contextMessages` — the `deliveriesBlock`
precedent; the existing `.filter(s => s.length > 0)` drops it when empty; no
signature change to the 10-arg `buildIterationContext`. It is positioned as
the correction to the digest, whose false "Trust the digest" sentence at
`prompt.ts:495` is **gated off in repo mode** — a 60-of-3,359 mtime-random
sample must not outrank real precedent.

Hard cap 5,000 chars; 800 ms timeout; **never silent**:

```
codegraph push: 3 episodes (2 verified) + 2 lessons for tsc:TS2345, 1,840 chars
codegraph push: EMPTY — no history for <paths> (graph holds N nodes for this repo)
codegraph push: FAILED <err>            (emitLog level 'error')
```

Zero nodes for the target repo at preflight = `emitLog('error')` — that means
ingest is broken, not that history is empty. Kill switch `CODEGRAPH_PUSH=0`
read **per-iteration**, not at process start (the JKAI_API_URL read-once
trap).

### 7.2 PULL — agent-initiated, mid-iteration

`scripts/codegraph-query.mjs`, named in `REPO_SYSTEM_PROMPT` step 2
(`prompt.ts:163`) through a `__CODEGRAPH_CMD__` placeholder substituted in
`buildSystemPrompt`'s repo branch beside `studioResearchScript`
(`prompt.ts:423-426`) — never an env var, which fails silently.

Wiring checklist — each line a named historical failure:

- Exact pathname in the `hooks.server.ts:428` bypass block.
- `rsync -a scripts/codegraph-query.mjs "$VPS_DIR/scripts/"` beside
  `ci-release.sh:80` — the deploy script is an allow-list.
- The endpoint answers <2 s with no first-call index building — the 300 s cap
  plus "never re-run the same command" makes a slow first call a permanently
  unused feature.

Three deploy paths acknowledged and sequenced: web app via CI merge, scripts
via the ci-release allow-list, executor via `deploy-builder.sh` **after** CI
— with the preflight logging the endpoint's schema version to catch skew.

## 8. Forgetting

Manual-first in phase 1, mechanical in phase 2, never a bare DELETE.

1. **Tombstones.** Retire on nodes/episodes/lessons sets
   `retiredAt`+`retiredReason`; `supersededById` is always a real row id (the
   `forget_memory` trap wrote the literal string `'forgotten'` into 23
   `jkai_memories` rows — named here so it is not repeated). Merge writes the
   `codegraph_node_merges` ledger row in the **same transaction** as the
   tombstone and flattens chains (intel `merge.ts:221-224` — the loader
   resolves one hop only). Tombstoning rather than deleting is load-bearing
   because the backfill is re-runnable: a deleted row would be resurrected on
   the next re-ingest.
2. **Suppressed edges** are kept and loaded separately (intel
   `load.ts:309-324` pattern), or re-ingest re-proposes them and "not
   related" means nothing beyond the click.
3. **Decay** is ranking-time only — half-life 180 days on `observedAt`
   (per-kind: trap/rule 180, fact 90; human-corroborated rules floored at
   0.3). Intel's 42 d half-life is a Gmail-window number, wrong for code.
   Decay demotes; it never removes.
4. **Repo reality.** `existsOnHead` stamped against `git ls-files` — one-shot
   in the phase-1 backfill with a **sentinel self-test**:
   `src/lib/db/schema.ts` must be found alive before anything is stamped
   dead, or the run aborts loudly (this prevents the mass-false-quarantine a
   wrong repo path would cause). Phase 2 makes it a nightly sweep.
5. **Manual forget UI.** `/jkai/codegraph/review` actions: retire /
   supersede / suppress-edge / forget-with-reason, POSTed and marked in place
   so the cursor survives. A hard `deleteNodeCascade` (edges before node,
   tombstones walked to fixpoint, FK-less refs hand-deleted — the intel
   `ingest.ts:156` ordering) exists for secrets/PII, awaited not queued.

**Guard against silent guard death** (the SCS pay lesson): retired /
suppressed / merged filtering lives in exactly **one loader**; a vitest
inserts a retired lesson + a suppressed edge + a tombstoned node and asserts
the retrieval block excludes all three; the review page displays retired /
suppressed / superseded counts so the filter is observable, not assumed. The
failure classifier ships with a false-positive test corpus asserting
**rejection** of "svelte-check found 0 errors", "Test Files 0 failed", and
exit codes 130/137/143/144 — unfixed, those inflate failures by ~46%.

## 9. What it absorbs from existing memory

Absorbs, non-destructively, the three stores that scored "absorb" in the
survey — and names what it must not touch.

1. **`~/.claude/projects/-home-john/memory/`** — 272 files, 1.16 MB, 251
   repo-relevant, the measured biggest gap (jkai can see zero bytes today).
   `scripts/codegraph-seed-lessons.mjs` imports them **verbatim** as lessons
   (`source='memory_note'`, `sourceRef=path`) — no distiller, no LLM; they
   are already claim+consequence shape. The 117 concrete `src/` citations
   auto-attach via `cited_path`. The md files **stay on disk**, so Claude
   Code's own MEMORY.md loop is untouched. Phase 2 adds an mtime-diff
   re-import and — once trust is earned — regenerating MEMORY.md *from* the
   graph.
2. **`claude_sessions` / `claude_session_stages`** become the substrate, not
   a rival: episodes carry `sessionId` deliberately FK-less (stages are
   delete/reinserted every cron tick; 54 prod sessions have no jsonl). The
   1,037 pre-2026-07-12 stage rows — especially the 367 already
   problem→fix-shaped `fixes` rows — are stage-lifted as
   `resolution='stage'` coarse episodes attached via `touched_paths`,
   honestly labelled lower-res (`full_transcript` is a 0.4–4.7% rendering;
   fix triples are unrecoverable there).
3. **`jkai_memories`**: phase 2 migrates the ~48 platform rows to lessons and
   forks `memory-review.ts` (platform facts → graph, personal facts →
   `jkai_memories` as today). **Not on ship day**: it is the platform's only
   autonomous memory writer and it ran this morning (D9).

**Explicitly not touched:** `~/.hermes-jkai/memories/MEMORY.md` + `USER.md`
(the only store in the live chat prompt path, 97.5% full, read by literal
file path from `config.yaml:312-316` — though the phase-2 platform-fact
migration is what finally relieves that cap); both prompt stacks;
`improvement_backlog`; the intel graph (different domain — own tables, own
analytics cache, own `invalidateCodegraphAnalysis()`, shared pure algorithms
only).

**Security precondition, shipped first:** `CLAUDE_CHANGELOG_SECRET` set on
the VPS and `/api/claude-changelog/ingest`'s `authorized()` made fail-closed
(copy `releases/ingest/+server.ts:31`) — verified live-open today. The new
`POST /api/jkai/codegraph/ingest` uses the same Bearer and fails closed from
birth.

## 10. UI surfaces

Phase 1: **two** surfaces under `/jkai/codegraph`, cloning the intel
workbench mechanics — `src/lib/components/codegraph/workbench.ts` SURFACES
array (href/label/stage/question/ratherThan/count/warnAbove); a
`+layout.svelte` publishing a PageMenu via `setPageMenu()` from
`$lib/jkai/hub-bus.svelte` with `clearPageMenu()` in onDestroy; a
`+layout.server.ts` of COUNT queries **only** (the intel rule: it runs on
every page in the section — never a Louvain run for a badge).
`HubHeader.svelte:81` gains `{ label:'Code', href:'/jkai/codegraph',
meta:'BUILD GRAPH' }`; `JkaiLauncher.svelte:51` gains a 'CG' row.

### `/jkai/codegraph` — the ER map

`NetworkGraph.svelte` copied with only `radius`/`structuralRadius`/
`earnsLabel` changed; **all** encodings imported from
`src/lib/components/intel/graph-visual.ts` (CLUSTER_COLOURS, clusterSlotOf,
washOut, edgeWidth — the one shared module that exists to end hand-synced
copies). The network endpoint clone keeps `MAX_NODES=600` pagerank-trimmed
with the selected-vs-keep distinction. Node colour keys on the durable
cluster key, never the Louvain index (70.6% overnight churn measured).
Analytics via a codegraph `model.ts` + `load.ts` clone (own cache Map,
inflight Map, generation counter, TTL 60 s, own invalidate) importing
centrality/community/paths/filter **unchanged**; d3 handles as plain `let`,
never `$state`. Clicking a file node opens an inline panel: episodes with
verdict chips, attached lessons, top `co_change` neighbours, gate history.

### `/jkai/codegraph/review` — quality + forgetting + measurement

One page: a triage queue (unverified and repaired episodes, unattached
lessons) ordered by **retrieval frequency** (`codegraph_queries` join —
review what actually gets served), with retire/supersede/suppress/
forget-with-reason actions marked in place; a retrieval-audit table (every
CGQL query by caller with outcome and served chars, replayable byte-for-byte);
and a stats strip showing the frozen baseline vs live iterations-per-build,
retired/suppressed counts, and a **red state when any repo build since ship
has zero `codegraph_queries` rows**.

Phase 2 splits out `/node/[id]` dossier, `/quality` (orphans, duplicate-path
candidates via a codegraph `scorePair` importing `normaliseName` from
`intel/resolve/match`, coverage gauge vs the 42% baseline), and `/impact`.

## 11. Measurement plan

Baseline **frozen 2026-08-17** in the ship PR description, all re-runnable
prod SQL: 66 git-target builds, 280 iterations (all on repo-mode builds),
mean 4.24 iterations/build (grouped median 4; completed-only mean 5.65);
10.5 read/grep/find/ls discovery actions per iteration; 2,219 reads over 340
distinct paths = 6.53 reads/path; post-bridge-fix window (since 2026-08-12):
41 iterations, 21.4 actions/iteration, zero bridged tool calls.

**Primary — iterations-to-terminal per repo build:**

```sql
SELECT b.id, count(i.*) FROM jkai_builds b
JOIN jkai_iterations i ON i.build_id = b.id
WHERE b.git_target_config IS NOT NULL AND b.created_at > $SHIP
GROUP BY 1;
```

split served vs unserved by

```sql
EXISTS (SELECT 1 FROM codegraph_queries q
        WHERE q.build_id = b.id AND q.outcome = 'ok' AND q.node_count > 0)
```

against the frozen baseline. Success bar: **served-cohort median ≤3 over the
first 25 post-ship repo builds.**

**Secondary:**

- (a) discovery actions/iteration and reads-per-distinct-path from the same
  actions-jsonb SQL, windowed pre/post — retrieved context should displace
  re-reading;
- (b) repeat-failure rate: the same fingerprint failing in consecutive
  iterations of one build (classify `jkai_iterations.evaluation`) — the
  number the fingerprint lane must drive toward zero;
- (c) PULL adoption without trusting logs:

```sql
SELECT count(*) FROM jkai_iterations i, jsonb_array_elements(i.actions) a
WHERE a->>'lang' = 'bash' AND a->>'code' LIKE '%codegraph-query%';
```

  — the exact SQL shape that exposed the bridge's four silent failures,
  which is why the script name is deliberately greppable;
- (d) relevance proxy: fraction of files edited in iteration N that appeared
  in `servedNodes` for iteration N (canonical names make the join free).

**Guards:** any repo build with zero `codegraph_queries` rows → red state on
`/review` (phase 1) and a dedupe-keyed insight (phase 2); executor emitLogs
carry a hit count per iteration so `jkai_logs` is independently greppable.

**Pre-registered decision rule:** after 30 post-ship repo builds, if
served-builds' median iterations is not below unserved-builds' median, **the
push block is removed rather than defended.**

Honesty clause: at 5–8 repo builds/week it takes ~4 weeks to reach 25; the
page shows medians and full distributions, never significance theatre, and
names the task-mix confound.

## 12. Decision Log

Autonomous build; every gate self-approved and recorded here.

### D1 — Which architecture carries the system

- **Options:** (a) Casebook — episodic, fingerprint-first (scored 52);
  (b) LOOM — structural, file-set-first (53); (c) Doctrine — claims with
  decay (51); (d) a synthesis.
- **Chosen:** (b) rebuilt as Codegraph, with (a)'s fingerprint lane + outcome
  tiers and (c)'s lesson layer + liveness grafted on.
- **Why:** (a) optimises the rare event — 78 triples, 0.7/session, present in
  28 of 107 sessions — while the measured waste is discovery (10.5 actions/
  iteration). (c) serves prose about code when the build wants the prior
  diff, and its confidence machinery idles until an outcome loop that takes
  months to close. (b) is the only design keyed to the measured cost:
  file-set seeding is deterministic, works when the prompt is "crack on",
  pays on every iteration, and the ER map falls out naturally.
- **Reversible:** the grafts are columns and code paths, not forks; any lane
  can be removed without a migration.

### D2 — The unit of knowledge

- **Options:** (a) one row per tool_use (57,862 rows, ~930 MB); (b) session
  grain (157 rows); (c) one episode per (transcript file × edited file).
- **Chosen:** (c) — 3,221 measured episodes, ~40/session.
- **Why:** (a) is individually meaningless and 8× the budget; (b) fuses a
  median of 19 unrelated files into one embedding. (c) is the only grain
  simultaneously abundant and retrievable, keys naturally on the path an
  agent is about to edit, carries its own outcome label, and absorbs the
  scarce triples as its `evidence` tier rather than competing with them. It
  also survives the corpus traps: transcript-file keying separates the 903
  subagent files (34% of edits) that share their parents' sessionIds.
- **Reversible:** yes — finer grains can be derived from the stored
  `diffExcerpt`s later; coarser is a GROUP BY.

### D3 — One query language, not three

- **Options:** (a) each candidate design's own language (three parsers);
  (b) raw SQL handed to the agent; (c) Cypher on a graph engine; (d) one
  CGQL.
- **Chosen:** (d).
- **Why:** one graph, one grammar — two parsers, two test suites and two docs
  sets for the same three callers is maintenance drag. Raw SQL is an
  injection surface plus ~2 KB of schema per prompt plus silent
  plausible-wrong rows. No graph engine is permitted, and at this scale the
  useful operations are exactly what CGQL states natively.
- **Reversible:** the endpoint contract (CGQL string in, cards out) hides the
  compiler; the language can grow verbs without touching callers.

### D4 — Bash script, not a bridged registry tool, for pi retrieval

- **Options:** (a) a bridged registry tool; (b) `scripts/codegraph-query.mjs`
  via bash; (c) both.
- **Chosen:** (b) for builds; the registry tool exists for jkai chat only.
- **Why:** 5,214 production actions contain **zero** bridged calls, including
  41 iterations after all four bridge fixes landed. Bash + a repo script is
  the only transport with a production track record
  (`studio-research.mjs` is the working precedent).
- **Reversible:** yes — the endpoint serves both; if bridged calls ever show
  up in `actions` jsonb, the script can be retired.

### D5 — Deterministic seeding, not model-decided retrieval

- **Options:** (a) embed the prompt and search; (b) let the model decide when
  to retrieve; (c) regex extraction of file paths and fingerprints, with
  `topic:` as a fallback.
- **Chosen:** (c).
- **Why:** 29% of prompts are ≤25 chars and embed to nothing; pi has no
  mid-run channel for a model to decide anything in. The previous iteration's
  gate diagnostics (`orchestrator.ts:1447`) are mechanically the sharpest
  possible query and already exist. Zero LLM calls per iteration by
  construction.
- **Reversible:** yes — the seed compiler is one pure function; a smarter
  planner can replace it behind the same interface.

### D6 — Verbatim lesson seeding, no LLM distiller

- **Options:** (a) distil the 272 memory notes into atomic claims;
  (b) import them verbatim as lessons.
- **Chosen:** (b), with the md files left on disk untouched.
- **Why:** they are already claim+consequence shape (median 2,919 B), the
  highest-quality knowledge body John owns, and jkai can currently read zero
  bytes of them. Verbatim import is day-one value at zero distillation cost
  and zero confident-wrongness risk. 117 cited `src/` paths auto-attach.
- **Reversible:** trivially — `source='memory_note'` + `sourceRef` make the
  import a deletable, re-runnable set.

### D7 — Standalone backfill today, not the cron

- **Options:** (a) ride SCHEMA_VERSION 4 and the existing
  `parse-transcript.mjs` cron; (b) a standalone idempotent
  `scripts/codegraph-backfill.mjs` run once from this worktree.
- **Chosen:** (b); (a) is phase 2.
- **Why:** the cron execs the **main checkout**, which is on branch
  `intel-source-filters` — "merged" ≠ "ingesting". The standalone script
  ships today, is re-runnable (delete-by-session + reinsert, same
  transaction), and POSTs to a fail-closed Bearer endpoint.
- **Reversible:** yes — phase 2 folds the same extraction into the cron's
  single walk once the checkout is fixed.

### D8 — Tier × recency ranking now; confidence machinery later

- **Options:** (a) C's computed confidence (base × decay × liveness ×
  contradiction penalty, nightly cached); (b) tierWeight × recency × match,
  decomposed in every response.
- **Chosen:** (b).
- **Why:** until the outcome loop closes over dozens of builds, computed
  confidence is seed provenance dressed up as a number. Tier × recency is
  honest about what is actually known. Likewise embedding-near contradiction
  auto-quarantine is rejected: its false pairs quarantine two good claims
  precisely where the graph is densest — contradiction stays human-asserted
  until precision is proven.
- **Reversible:** yes — phase 2 adds the machinery with the data to feed it.

### D9 — memory-review.ts and Hermes memory are not touched on ship day

- **Options:** (a) fork `memory-review.ts` and migrate `jkai_memories` now;
  (b) phase 2, own PR.
- **Chosen:** (b).
- **Why:** it is the platform's only autonomous memory writer and it ran at
  06:05 this morning; touching it in the same PR as seven new tables and an
  executor change is how outages happen. Hermes' `memories/MEMORY.md` is the
  only store in the live chat prompt path, 97.5% full, read by literal file
  path — and the `/jkai/prompts` workbench currently edits the wrong (0-byte)
  file, which must be fixed before any migration is even safe to attempt.
- **Reversible:** n/a — this is a deferral, not a change.

### D10 — Plain indexes everywhere; composite PKs only on ships-empty tables

- **Options:** (a) unique indexes for natural keys; (b) plain `index()` on
  every backfilled table, composite PKs only on `codegraph_node_lessons` and
  ship-empty tables.
- **Chosen:** (b).
- **Why:** `drizzle-kit push` runs non-interactively with `--force` in CI
  (`ci-release.sh:117`); a retrofitted unique index on a populated table
  prompts and exit-1s the release (the named Drizzle push gotcha). But the
  join table must have its composite PK from birth —
  `intel_note_entities` shipped without one and silently duplicated on every
  re-extraction.
- **Reversible:** unique constraints can be added later via the manual
  migration lane, with dedupe first.

### D11 — Fail-closed ingest, and fixing the open door first

- **Options:** (a) ship the new ingest endpoint and leave
  `/api/claude-changelog/ingest` as found; (b) first commit sets
  `CLAUDE_CHANGELOG_SECRET` on the VPS and makes `authorized()` fail closed.
- **Chosen:** (b) — verified from outside that an unauthenticated POST 401s.
- **Why:** the route is live-open on the public internet today; cloning its
  pattern would clone the hole. The codegraph ingest uses the same Bearer and
  fails closed from birth.
- **Reversible:** no, and it should not be.

### D12 — Two UI surfaces, not five

- **Options:** (a) map + review/audit/stats combined (two routes);
  (b) the full five-surface split (map, review, quality, impact, queries).
- **Chosen:** (a); the splits are phase 2.
- **Why:** the ship-today budget, and every brief mandate (ER navigation,
  quality review, forgetting, measurement) is covered by two pages. John's
  own feedback file says no over-engineered UI.
- **Reversible:** yes — the SURFACES array is built to grow.

## 13. Phase 2 — not built today

Labelled explicitly so nothing below is mistaken for shipped behaviour.

- **Continuous ingest**: graph accumulators as a second output of
  `parse-transcript.mjs`'s existing single walk (before the type gate at
  `:194`, returned at `:448`), SCHEMA_VERSION 3→4, same-transaction
  delete/reinsert at `+server.ts:131`; pull the main checkout to master
  first; batch the thundering-herd re-parse.
- **Nested transcripts in the cron path** (remove the `ingest.mjs:51`
  subagents skip for graph extraction) — 34% of edits live there; phase 1
  covers them via the standalone backfill only.
- **Minting loop**: orchestrator finalize mints `verified` episodes from a
  repo build's own fail→pass gate transitions, upgraded to `landed` on merge
  — pi's fixes become next month's precedent with zero curation.
- **Nightly sweep** (intel `engine.ts` clone, 04:45 — clear of 03:30
  selfimprove and 04:15 intel): liveness quarantine of lessons with all-dead
  anchors, `existsOnHead` refresh, fix-PR chain propagation (episode verdict
  → `repaired`), decay recompute, datastore run-log, and a dedupe-keyed
  insight when any repo build ran with zero `codegraph_queries` rows.
- **served→passed corroboration**: orchestrator backfills
  `codegraph_queries.iterationPassed`; serves become weak supporting/
  contradicting evidence; per-lesson efficacy leaderboard on `/impact`.
- **LLM dossiers** only for the ~340 files with ≥3 episodes; a distiller
  inbox with an admit/reject queue. (Distilling all ~2,500 nodes was killed:
  $40–80 for summaries nobody will review, drifting toward confident
  wrongness — the exact failure mode of the digest this system corrects.)
- **jkai_memories absorption** + the `memory-review.ts` fork (own PR — D9).
- **`knowledge_search` 'codegraph' branch**: KnowledgeSource union +
  timeout-wrapped branch at `search.ts:208` + Recall page row.
- **Node types** route/table/tool/skill with the four phase-2 edge types.
- **Remaining UI**: `/node/[id]` dossier, `/quality`, `/impact`, merge UI
  with ledger replay/unmerge.
- **Rename detection** (`git log --follow` sampling) so refactors don't
  silently fragment a file's history into orphan + fresh node.
- **The 54 prod-only sessions' nodes/edges** scraped from the intact
  "» Tool: arg" one-liners in `full_transcript` (paths survive the clip;
  Bash-derived edges do not).
- **Regenerate `~/.claude` MEMORY.md from the graph** once retrieval trust is
  earned; relieve the Hermes 97.5%-full cap by migrating its platform facts
  (after fixing the `hermes-store.ts:30` wrong-file allowlist).
- **Symptom-family near-matching** (embedding over fingerprint exemplars) if
  the exact-match hit rate measures under ~20% of gate failures.

## 14. Phase 1 ship list (build order)

1. **Security precondition** (first commit): `CLAUDE_CHANGELOG_SECRET` on the
   VPS `.env` (`sudo chattr -i`/`+i` dance), `authorized()` fail-closed,
   verified from outside with an unauthenticated POST → 401.
2. **Schema**: the seven `codegraph_*` tables after `schema.ts:3137`; lands
   via normal CI merge + `drizzle-kit push`.
3. **ANN migration**: written, run manually on the VPS, **verified via
   `pg_indexes`** (§4.2).
4. **Backfill**: `scripts/codegraph-backfill.mjs` run once from this worktree
   — all 1,010 jsonl files with the dual-path `toolUseResult` fallback,
   worktree normalisation, repo partitioning, corrected failure regexes,
   fingerprints, verdicts from deduped pr-link + `gh` PR state + the 78
   triples (span ≤80 records, ≤8 edits, cross-transcript session joins),
   stage-lifting the 1,037 pre-07-12 rows, `existsOnHead` behind the
   `schema.ts` sentinel; POSTs batched payloads to the fail-closed
   `POST /api/jkai/codegraph/ingest` (idempotent delete-by-session +
   reinsert, same transaction).
5. **Vitest false-positive corpus** for the failure classifier (§8).
6. **Lesson seed**: `scripts/codegraph-seed-lessons.mjs` — 272 notes
   verbatim + cited-path attachment; md files untouched.
7. **Embedding backfill**: template changeSummaries ("In `<file>`:
   `<intent/skill>`; `<N>` edits; `<gate>` `<verdict>`; PR #`<n>` `<state>`")
   + lesson bodies, via the intel `embed.ts` pattern (batch 96, one failed
   batch never abandons the sweep, final remaining-count check logged).
8. **CGQL**: pure parser/compiler + own tests;
   `POST /api/jkai/codegraph/query` with the full failure contract; every
   query logged.
9. **Pull channel**: the script, the hooks bypass line, the ci-release rsync
   line, the `__CODEGRAPH_CMD__` prompt substitution.
10. **Push channel**: `buildRetrievalBlock` at `executor.ts:245`, appended at
    `:312`; "Trust the digest" gated off in repo mode; `CODEGRAPH_PUSH` kill
    switch read per-iteration; ship via merge → CI → `deploy-builder.sh` in
    that order.
11. **Chat access**: the `codegraph_query` registry tool (lazy imports),
    barrel + toolset description + keyword-classifier row and test.
12. **UI**: the ER map and the review page (§10), workbench SURFACES,
    PageMenu layout, COUNT-only layout server, HubHeader + JkaiLauncher rows.
13. **One-loader forgetting filter + unit test** (§8).
14. **Measurement freeze + live verification**: baseline SQL and numbers in
    the ship PR description; after deploy, run one CGQL query against prod
    via `scripts/codegraph-query.mjs` and confirm the `codegraph_queries`
    row lands and the map renders. Done means live.

## 15. Known traps carried in

- Never a silent `[]` — empty is typed, outage is 502, both are logged.
- `ci-deploy`/`ci-release` are allow-lists — every new `scripts/` file needs
  its own rsync line.
- Drizzle `.unique()` on a populated table breaks non-interactive push; a
  column rename prompts on a TTY.
- Env vars read once at builder start stay stale — kill switches are read
  per-iteration.
- Liveness never comes from subtracting `updatedAt`.
- d3 handles are plain `let`, never `$state`; graph colour keys on the
  durable cluster key, never the Louvain index.
- "Merged" is not "correct" (17.1% fix-PR rate); "deployed" is not "in
  effect" (the tool bridge); "logged healthy" is not "used" (SQL over
  actions or it did not happen).
