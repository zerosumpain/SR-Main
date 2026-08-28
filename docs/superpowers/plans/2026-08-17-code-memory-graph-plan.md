# Codegraph — implementation plan (phase 1, ship today)

**Date:** 2026-08-17
**Worktree:** `/home/john/strange_rambling_svelte/.worktrees/codegraph` (clean checkout of `origin/master`, HEAD `2bf78765`, has `.env` + `node_modules`)
**Design:** B — LOOM, rebuilt as *Codegraph*, with A's fingerprint lane + outcome tiers and C's lesson layer + liveness grafted on.
**Ends at:** merged PR → CI deploy → `deploy-builder.sh` → live-verified query on production → measurement baseline frozen.

Everything below is ordered. A stage may not start until its `Depends on` stages are green. Each stage has a verification command whose output is the evidence — **run it, read it, do not assume it**.

---

## 0. Facts measured today (do not re-derive; do not contradict)

Run on the production DB (`ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling -tA < file.sql'`) at 2026-08-17:

| Fact | Value | How it was obtained |
|---|---|---|
| DB size | 3216 MB | `pg_size_pretty(pg_database_size('strange_rambling'))` |
| git-target builds | 66 | `count(*) FROM jkai_builds WHERE git_target_config IS NOT NULL` |
| iterations | 280 | `count(*) FROM jkai_iterations` |
| iterations/build, all 66 | **4.24 mean** | 280 / 66 |
| iterations/build, builds with ≥1 iteration (48) | **5.83 mean, 4 median** | `avg(c)`, `percentile_cont(0.5)` over the grouped join |
| action histogram, all 280 iterations | read 2219, bash 1888, edit 461, write 268, grep 253, find 100, ls 25 (**5,214 total, zero bridged calls**) | `SELECT a->>'lang', count(*) FROM jkai_iterations, jsonb_array_elements(actions) a GROUP BY 1` |
| discovery actions/iteration | (2219+253+100+25)/280 = **9.28** measured today; survey figure 10.5 uses the completed-iteration subset — record both | derived |
| claude_sessions | 150 | `count(*)` |
| pg extensions | `vector`, `pg_trgm`, `plpgsql` | `SELECT extname FROM pg_extension` |
| hnsw / trgm indexes in prod | **0** | `SELECT count(*) FROM pg_indexes WHERE indexdef ILIKE '%hnsw%' OR ILIKE '%trgm%'` |
| `CLAUDE_CHANGELOG_SECRET` in prod `.env` | **ABSENT** | `grep -o '^[A-Z_]*' /opt/.../.env` → JKAI_API_URL, JKAI_BRIDGE_SECRET, HERMES_BRIDGE_SECRET, MAINTENANCE_SECRET, RELEASE_LOG_SECRET, WHATSAPP_HERMES_BRIDGE_URL — no changelog secret |
| prod `.env` attrs | `----i---------e-------` (immutable) | `lsattr /opt/strange-rambling-svelte/.env` |

Local corpus (homeserv):

| Fact | Value |
|---|---|
| top-level session transcripts | 107 `*.jsonl` |
| nested subagent/workflow transcripts | 911 `*.jsonl` |
| `~/.claude/projects/-home-john/memory/*.md` | **272 files, 1.7 MB** |
| memory notes citing a `src/` path | **122** |

Verified source anchors (all in this worktree, line numbers confirmed by reading):

- `src/lib/db/schema.ts:21` — `const vector = customType<...>` (module-private, **not exported** → new tables must live in this file)
- `src/lib/db/schema.ts:3137` — `export type NewClaudeSessionStage` (insert point; file is 3318 lines)
- `src/lib/db/schema.ts:2319` — `intelCategories` (the precedent block)
- `src/lib/jkai/executor.ts:245` — `const codebaseDigest = await buildCodebaseDigest(build.id, devFiles).catch(() => '');`
- `src/lib/jkai/executor.ts:312` — `const userPrompt = [deliveriesBlock, contextMessages.map((m) => m.content).join('\n\n')]`
- `src/lib/jkai/prompt.ts:163` — REPO_SYSTEM_PROMPT step 2 (`2. Read those files, plus two precedents…`)
- `src/lib/jkai/prompt.ts:423-426` — `studioResearchScript()`
- `src/lib/jkai/prompt.ts:444-450` — `if (mode === 'repo')` branch of `buildSystemPrompt`
- `src/lib/jkai/prompt.ts:495` — the false `Trust the digest for "what exists and where"` sentence
- `src/hooks.server.ts:424-431` — the exact-pathname bridge bypass block (`manifest`, `invoke`, `studio/image`, `studio/research`)
- `src/hooks.server.ts:449` — `pathname.startsWith('/api/claude-changelog/') && method === 'POST'` bypass
- `src/routes/api/claude-changelog/ingest/+server.ts:19-23` — `function authorized()` with `if (!secret) return true;` ← **fails open, and the secret is unset in prod**
- `src/routes/api/releases/ingest/+server.ts:30-34` — the fail-closed pattern to copy
- `scripts/ci-release.sh:56-80` — the rsync **allow-list** (last line `rsync -a scripts/studio-research.mjs "$VPS_DIR/scripts/"`)
- `scripts/ci-release.sh:110-125` — `drizzle-kit push --config=drizzle.config.ts --force` behind `timeout`, `exit 1` on 124
- `scripts/check-public-routes.mjs:70-95` — the mirrored allow-list (CI gate)
- `src/lib/workflows/site-tools/registry.ts:37` — `import './tools/intel-graph';`
- `src/lib/workflows/site-tools/registry.ts:125` — the `'intel-graph': '…'` toolsetDescriptions entry
- `src/lib/workflows/site-tools/keyword-classifier.ts:50` — the `intel-graph` TOOLSET_PATTERNS row
- `src/lib/components/jkai/HubHeader.svelte:78-83` — `surfaces` array (Intel at :81)
- `src/lib/components/jkai/JkaiLauncher.svelte:51` — the `INT` launcher row
- `scripts/claude-changelog/parse-transcript.mjs:19` — `export const SCHEMA_VERSION = 3;`

### The gate command (verified from `package.json`)

```
npm run gate
  = gate:public-routes   → node scripts/check-public-routes.mjs
  → gate:font-sizes      → node scripts/check-font-sizes.mjs
  → gate:check           → svelte-kit sync && NODE_OPTIONS=--max-old-space-size=4096 svelte-check --tsconfig ./tsconfig.json --threshold error
  → gate:test            → NODE_OPTIONS=--max-old-space-size=4096 vitest run --exclude '**/node_modules/**' --exclude '**/*.integration.test.ts'
  → gate:build           → NODE_OPTIONS=--max-old-space-size=6144 vite build
```

Faster equivalent used by CI: `./scripts/gate-concurrent.sh` (runs `svelte-check` and `vitest` concurrently, ORs the exit statuses, and asserts both printed a plausible summary line so a checker that dies silently cannot pass). CI itself runs `npm run gate:public-routes && npm run gate:font-sizes`, then `./scripts/gate-concurrent.sh`, then `npm run gate:build` (`.github/workflows/ci.yml:189-222`), with `drizzle-kit push --force` against a throwaway DB at `:184`.

**Use `npm run gate` for the final pre-PR proof.** Use `npx vitest run <file>` per-stage — the full gate is minutes, a single test file is seconds.

---

## MUST NOT DO (repo traps — each one has already caused an incident)

1. **Never run `scripts/deploy.sh` by hand. Never hand-roll an rsync of the repo over `/opt/strange-rambling-svelte`.** Deploy is: merge to `master`, CI runs. A hand rsync replaced production `.env` with homeserv's and caused a 33-hour outage plus a public `/admin` exposure via `AUTH_BYPASS=1`.
2. **Never write to the production `.env` except via the deliberate `sudo chattr -i` → edit → `sudo chattr +i` dance.** It is currently immutable (`lsattr` shows `i`). Only Stage 1 touches it, and only to *add* one line.
3. **No `.unique()` / `uniqueIndex()` on any table that will hold rows before the next `drizzle-kit push`.** `scripts/ci-release.sh:110-125` runs push non-interactively with `--force` behind a timeout that `exit 1`s the release. Retrofitting a unique index onto a populated table makes push prompt → timeout → failed release. Every index on `codegraph_nodes/_edges/_episodes/_lessons/_queries` is a plain `index()`. The only composite PKs allowed are on `codegraph_node_lessons` (ships empty).
4. **No column renames in `schema.ts`.** A rename triggers drizzle-kit's interactive "is this a rename?" TTY prompt, which hangs CI. Add columns, never rename.
5. **A new file under `scripts/` that the VPS reads at runtime needs its own `rsync` line in `scripts/ci-release.sh`.** Lines 56-80 are an explicit allow-list, not a directory sync. This has silently shipped a broken feature twice (`smoke-static-app.mjs`, `studio-gate.mjs`) — the feature reports "skipped" forever while CI stays green.
6. **`pi --tools` is an allow-list applied to extension-registered tools too.** Do not deliver retrieval as a bridged registry tool for builds: 5,214 production actions across all 280 iterations are exactly `read/bash/edit/write/grep/find/ls` — **zero bridged calls, including the 41 iterations since all four bridge fixes landed on 2026-08-12**. Bash + a repo script is the only transport with a production track record. The registry tool in Stage 9 exists for **jkai chat only**.
7. **Never add the exact pathname to `hooks.server.ts` by prefix.** Name each path exactly (`pathname === '/api/jkai/codegraph/query'`). `/api/jkai/tools/promote` deliberately falls through to the owner gate; a prefix bypass would open it.
8. **`scripts/check-public-routes.mjs` is a CI gate and mirrors the hooks allow-list.** Change one, change both, in the same commit, or CI fails.
9. **Never return `[]` on infrastructure failure.** An empty result converts an outage into the false statement "this is not covered" — `src/routes/api/jkai/studio/research/+server.ts:63-69` records exactly this. Zero-match is a typed `outcome:'empty'`; infra failure is a 502.
10. **Never write a magic string into a supersession/tombstone column.** `forget_memory` wrote the literal `'forgotten'` into 23 `jkai_memories` rows. `supersededById` / `mergedIntoId` are always real row ids or NULL.
11. **`static/` bypasses the auth gate entirely.** Nothing about codegraph goes in `static/`.
12. **Do not touch `/home/john/strange_rambling_svelte` (the main checkout).** It has uncommitted work on another branch. Reading is fine; no `git` command that mutates it, no `reset --hard`.
13. **Do not point `drizzle-kit push` at production from homeserv.** Local `DATABASE_URL` is `postgresql://app:***@localhost:5433/strange_rambling`. Prod push happens only via CI (`scripts/ci-release.sh`).
14. **Do not fork `src/lib/components/intel/graph-visual.ts`.** Import it. That file exists to end hand-synced copies of the encodings.
15. **d3 handles (simulation, zoom, selections, timers) are plain `let`, never `$state`.** A simulation tick that reads and writes reactive state is the documented route to `effect_update_depth_exceeded`.
16. **No eager analytics imports in the tool module.** Use `const loadX = () => import(...)` and prefix every loader name with `load` — a bare `const paths = …` loader landed in its own temporal dead zone and threw. Eager imports pulled `$lib/db` into the registry and took registry import from instant to 20s+.
17. **Do not add the tool to `ESSENTIAL_TOOL_NAMES`.** That changes `tools/list`, and Hermes freezes the MCP manifest at connect (no `notifications/tools/list_changed`) → requires a Hermes restart. `jkai_extended` reads `getTools()` live per call, so a plain registry tool needs only a SvelteKit deploy.
18. **Do not fork `memory-review.ts` or touch `jkai_memories` / `~/.hermes-jkai/memories/MEMORY.md` in this PR.** Phase 2, own PR.
19. **Do not bump `parse-transcript.mjs` SCHEMA_VERSION to 4 in this PR.** The cron execs the MAIN checkout, which is on another branch — "merged" ≠ "ingesting". Phase 1 backfill is a standalone re-runnable script from this worktree.
20. **Do not add `.mjs` migration files and consider them shipped.** `scripts/migrations/2026-07-26-intel-ann-indexes.sql` was written and **never run** — prod has zero hnsw indexes today. Stage 14 runs the new one manually and verifies with `pg_indexes`.

---

## Stage 1 — Security precondition (fail-closed changelog ingest)

**Depends on:** nothing. Do this first; it is a live-open public endpoint.

Today: `hooks.server.ts:449` bypasses Auth.js for every `POST /api/claude-changelog/*`, and `ingest/+server.ts:21` returns `true` when `CLAUDE_CHANGELOG_SECRET` is unset — and it **is** unset in prod. Anyone can POST arbitrary rows into `claude_sessions`.

**Files**

| File | Change |
|---|---|
| `src/routes/api/claude-changelog/ingest/+server.ts` (lines 19-23) | Replace `authorized()` with the fail-closed shape copied from `src/routes/api/releases/ingest/+server.ts:30-34`: `async function authorized(event: RequestEvent): Promise<boolean> { const secret = env.CLAUDE_CHANGELOG_SECRET; if (secret && (event.request.headers.get('authorization') ?? '') === \`Bearer ${secret}\`) return true; return isOwnerRequest(event); }`. Import `isOwnerRequest` from `$lib/server/owner`. Update the header comment: unset secret no longer means open. |
| `src/routes/api/claude-changelog/ingest/ingest.auth.test.ts` (new) | Vitest: secret set + wrong bearer → 401; secret set + right bearer → passes auth; secret **unset** + no owner session → **401** (this is the regression that must never come back). |

**VPS side (Stage 14 does the deploy; do the env now so the deploy lands into a configured host):**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38
sudo chattr -i /opt/strange-rambling-svelte/.env
# append exactly one line: CLAUDE_CHANGELOG_SECRET=<same value as ~/.claude-changelog.env CLAUDE_CHANGELOG_TOKEN>
sudo chattr +i /opt/strange-rambling-svelte/.env
```

Read the value from `/home/john/.claude-changelog.env` (`CLAUDE_CHANGELOG_TOKEN`) — the homeserv cron already sends it as a Bearer, so setting the server side makes the existing pipeline authenticate rather than break. **Restart the app after the deploy**, not before (env is read at process start).

**Verify**

```bash
npx vitest run src/routes/api/claude-changelog/ingest/ingest.auth.test.ts
# After Stage 14 deploy, from homeserv:
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://strangeramblings.com/api/claude-changelog/ingest -d '{}'    # expect 401
tail -3 /home/john/.claude/changelog-ingest.log                                                                      # expect failed=0 on the next tick
```

---

## Stage 2 — Schema + local push

**Depends on:** Stage 1 (same PR, but independent code).

**File:** `src/lib/db/schema.ts` — insert the seven tables **immediately after line 3137** (`export type NewClaudeSessionStage`). They must live in this file because `vector` at `:21` is `const`, not exported.

Tables, exactly as specced (full DDL is in the design brief and must be transcribed verbatim):

1. `codegraph_nodes` — `codegraph_nodes` (`type`, `name`, `canonical_name`, `repo`, `file_kind`, `summary`, `properties` jsonb, `embedding` vector, `edit_count`/`read_count`/`fail_count`, `last_touched_at`, `exists_on_head`, `head_checked_at`, `watched`, `merged_into_id` (no FK — tombstone), `retired_at`, `retired_reason`, timestamps). Indexes: `type`, `canonical_name`, `(repo,type)`, `merged_into_id`, `retired_at` — **all plain `index()`**.
2. `codegraph_edges` — `source_id`/`target_id` → nodes `ON DELETE CASCADE`, `type`, `weight` double NOT NULL 0.5 (**the real measure; no bucketed display column**), `observation_count`, `evidence` jsonb, `manual`, `suppressed` + `suppressed_reason`, `last_seen_at`. Indexes: source, target, type.
3. `codegraph_episodes` — `node_id` FK cascade, `session_id` **deliberately no FK** (54 prod sessions have no jsonl; stages are delete/reinserted per cron tick), `transcript_path` (903 nested files share 107 sessionIds — transcript key ≠ session key), `intent`, `change_summary` NOT NULL (the only embedded text), `diff_excerpt`, `fail_excerpt`, `gate_sig`, `fingerprint`, `verdict` enum `verified|landed|unverified|abandoned|repaired` default `unverified`, `pr_number`, `model`, `skill`, `is_sidechain`, `resolution` `full|stage`, `embedding`, `observed_at` (**session clock, never ingest clock**), `retired_at`, `created_at`. Indexes: `(node_id, observed_at)`, `fingerprint` (the hot lane), `gate_sig`, `verdict`, `session_id`, `pr_number`.
4. `codegraph_lessons` — `claim` NOT NULL, `consequence`, `scope` (`repo|glob|gate`), `scope_pattern`, `source` (`memory_note|prompt|correction|manual`), `source_ref`, `status` (`active|superseded|retired`), `superseded_by_id` (**real id only**), `half_life_days` default **180** (not intel's 42 — that is a Gmail-window number), `embedding`, `observed_at`, `retired_at`, `retired_reason`, timestamps. Indexes: status, source.
5. `codegraph_node_lessons` — **composite PK `(lesson_id, node_id)`** + `relevance`, `method`. Ships empty → PK is safe and mandatory (`intel_note_entities` shipped without one and every re-extraction silently duplicated rows). Extra index on `node_id`.
6. `codegraph_node_merges` — `survivor_id`, `merged_id`, `snapshot` jsonb (`{movedEdges:[{id,role}], movedEpisodeIds, movedLessonIds}` — unmerge replays this), `score`, `method`, `reason`, `undone_at`, `created_at`. Index on survivor.
7. `codegraph_queries` — `serial` PK, `build_id`, `iteration`, `caller` (`pi-push|pi-pull|jkai|ui`), `query` (verbatim CGQL, replayable), `served_nodes` jsonb, `node_count`, `episode_count`, `lesson_count`, `served_chars`, `ms`, `outcome` (`ok|empty|error`), `error_text`, `iteration_passed` (phase-2 backfill), `created_at`. Indexes: `(build_id, iteration)`, `(caller, created_at)`.

Also export the `$inferSelect` / `$inferInsert` types for each, mirroring the intel block.

**Footprint check to state in the PR:** ~4,250 episodes + ~450 lessons + ~2,450 nodes × `vector(1536)` ≈ 7,150 × 9.75 KB ≈ 70 MB heap + HNSW ≈ **~115 MB total = +3.6% on a 3,216 MB DB, 0.24% of 48 GB free**.

**Verify**

```bash
cd /home/john/strange_rambling_svelte/.worktrees/codegraph
grep -n "\.unique()\|uniqueIndex(" src/lib/db/schema.ts | sed -n '/codegraph/p'   # must print NOTHING
npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -5
set -a; . ./.env; set +a; npx drizzle-kit push --config=drizzle.config.ts --force   # LOCAL :5433 ONLY
psql "$DATABASE_URL" -tAc "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'codegraph%' ORDER BY 1"
# expect exactly 7 rows
```

---

## Stage 3 — Pure core (no DB): CGQL parser + failure classifier

**Depends on:** Stage 2 (types only).

Both files are 100% pure and DB-free — the `resolve/match.ts` pattern. They are testable in seconds and everything else depends on them.

### 3a. `src/lib/codegraph/query.ts` (new)

The CGQL compiler: `string → { stages, sql fragments, params }`. Grammar (EBNF, ~150 LOC parser):

```
query    := stage ( '|' stage )*
stage    := seed | walk | pick | budget
seed     := 'file:' PATH[',' PATH]*        (glob '*' allowed, trgm-matched)
          | 'gate:' SIG[',' SIG]*
          | 'fingerprint:' FP[',' FP]*     (the hot lane, pure btree)
          | 'topic:' '"' TEXT '"'          (the ONLY vector entry)
walk     := 'hops' INT edgeset?             (INT ∈ {1,2} HARD CAP; default co_change,needs_context)
pick     := ('episodes'|'lessons'|'failures'|'nodes') kv*
kv       := KEY '=' VALUE                   (KEY ∈ {verdict, gate, since, limit(<=10), min_conf})
budget   := 'budget' INT                    (chars, HARD CAP 8000)
```

Bare-seed default expansion: `| hops 1 | lessons | episodes verdict=verified,landed limit=3 | budget 5000`.

Exports: `parseCgql(src): CgqlAst | CgqlParseError` (error carries **byte position** + the grammar echoed), `compileCgql(ast): { cte: SQL, params }` producing one parameterised CTE chain, `DEFAULT_PIPELINE`, `MAX_HOPS = 2`, `MAX_LIMIT = 10`, `MAX_BUDGET = 8000`, and `packBudget(items, budget)` (greedy whole-item pack, priority **lessons > failures > episodes > neighbour list**).

Ranking is exported here as a pure function so it is testable: `score = tierWeight × recency × match`, with `TIER_WEIGHT = { verified: 1.0, landed: 0.8, unverified: 0.5, repaired: 0.25, abandoned: 0.1 }`, recency = half-life 180d on `observedAt` **floored at 0.3**, and every score returned **decomposed** (`{score, tier, recency, match}` — the intel rule: never an unexplained number).

**Test:** `src/lib/codegraph/query.test.ts` — the four worked examples parse to the expected AST; `hops 3` rejects; `limit=50` clamps to 10; `budget 99999` clamps to 8000; unterminated `topic:"` returns a parse error with the right byte offset; `packBudget` never emits a partial item and respects priority order; injection strings (`file:'; DROP TABLE`) either fail to parse or end up as bound parameters, never inlined SQL.

### 3b. `src/lib/codegraph/classify.ts` (new)

`classifyGateFailure(stdout, stderr, exitCode) → { failed: boolean, gateSig: string|null, fingerprint: string|null }`.

- `gateSig` normalisation: `svelte-check | tsc | vitest | playwright | npm run gate | build | eslint | unknown` (~15 signatures).
- `fingerprint` extraction: `tsc:TS2345`, `svelte:a11y_click_events_have_key_events`, `vitest:<first failing test file>`, etc.
- **stderr is empty 96% of the time** (`2>&1` pipes) — read stdout first.

**Test:** `src/lib/codegraph/classify.test.ts` — the **false-positive corpus**, which must assert REJECTION of:
`svelte-check found 0 errors`, `Test Files 0 failed`, `0 tests failed`, `found 0 errors and 0 warnings`, and exit codes **130 / 137 / 143 / 144** (interrupt/OOM/term — not gate failures). Unfixed, these inflate the failure count by ~46%. Also assert positive extraction on real samples of each of the ~15 gate signatures.

**Verify**

```bash
npx vitest run src/lib/codegraph/query.test.ts src/lib/codegraph/classify.test.ts
```

---

## Stage 4 — Retrieval core + the one-loader forgetting filter

**Depends on:** Stages 2, 3.

**Files**

| File | Contents |
|---|---|
| `src/lib/codegraph/load.ts` (new) | The **only** module that knows SQL exists for retrieval. `runCgql(src, ctx): Promise<CgqlResult>`. Own module-level `cached` Map + `inflight` Map + monotonic `generation` counter + `TTL_MS = 60_000` + exported **`invalidateCodegraphAnalysis()`** — do **not** share intel's cache. **This is the one place where `retired_at IS NULL`, `suppressed IS NOT TRUE` and `merged_into_id IS NULL` are applied.** Every other consumer goes through this function. Edge endpoints remapped through `COALESCE(sm.id, e.source_id)` so a merge never loses an edge. |
| `src/lib/codegraph/format.ts` (new) | Pure formatter: `formatRetrievalBlock(result): string` — returns `''` for empty, wraps in an XML-ish tag (the `formatNotesForPrompt` precedent at `src/lib/jkai/build-notes.ts:45`). Verdict chips, decomposed scores, no raw diffs beyond `diffExcerpt`. |
| `src/lib/codegraph/seeds.ts` (new) | **Regex, zero LLM.** `compileSeeds({ task, lastEvaluation, prevActions }) → string` (a CGQL string). Order: (1) fingerprints regexed out of `prevIteration.evaluation` — `orchestrator.ts:1447` already appends gate diagnostics, so **iteration N's failure mechanically becomes iteration N+1's query**; (2) path-like tokens in `build.prompt` + files edited last iteration (from the `actions` jsonb) → `file:` seeds with `hops 1`; (3) iteration 1 with no paths → one `topic:` embedding, **cached by prompt hash**. |
| `src/lib/codegraph/retrieval-context.ts` → place at `src/lib/jkai/retrieval-context.ts` | `buildRetrievalBlock({buildId, task, lastEvaluation, prevActions, iteration})` — calls `compileSeeds` → `runCgql` → `formatRetrievalBlock`, writes the `codegraph_queries` row, enforces **800 ms timeout** and **5,000-char cap**. Lives under `src/lib/jkai/` because the executor imports it and the builder bundle ships from there. |

**Forgetting filter test — mandatory, this is the "silent guard death" guard:**
`src/lib/codegraph/load.forgetting.test.ts` — insert a **retired lesson**, a **suppressed edge**, and a **tombstoned node** (`merged_into_id` set), run the retrieval block, and assert **all three are excluded**. Also assert a suppressed edge is still readable via the separate `loadSuppressedPairs()` path (a suppressed edge that is merely absent gets re-proposed on the next re-ingest, so "not related" would mean nothing).

`topic:` degradation: if the `text-embedding-3-small` call exceeds **3 s**, degrade to seed-only and log the degradation explicitly (OpenRouter outage mode). Never silently return fewer results.

**Verify**

```bash
npx vitest run src/lib/codegraph/            # all codegraph unit tests
npx vitest run src/lib/codegraph/load.forgetting.test.ts   # read the output — 3 exclusions asserted
```

---

## Stage 5 — Ingest endpoint + extractor + local backfill

**Depends on:** Stages 2, 3, 4.

**Files**

| File | Contents |
|---|---|
| `src/routes/api/jkai/codegraph/ingest/+server.ts` (new) | `POST` only. Auth **fail-closed from birth**: copy `releases/ingest/+server.ts:30-34` (Bearer `CLAUDE_CHANGELOG_SECRET` **or** `isOwnerRequest`). Idempotent: **delete-by-`session_id` then reinsert, in ONE `db.transaction`** (the cron and the SessionEnd hook genuinely race — `claude-changelog/ingest/+server.ts:122-131` documents it). Batched payloads. Calls `invalidateCodegraphAnalysis()` after commit. |
| `src/hooks.server.ts` (edit, in the block at 424-431) | Add `pathname === '/api/jkai/codegraph/ingest' ||` — **exact pathname**. |
| `scripts/check-public-routes.mjs` (edit, allow-list at 70-95) | Add `'/api/jkai/codegraph/ingest', // POST only, CLAUDE_CHANGELOG_SECRET or owner`. Same commit as the hooks edit. |
| `scripts/codegraph-backfill.mjs` (new) | Standalone, re-runnable, run from **this worktree on homeserv**. Walks all **1,018** jsonl files (107 top-level + 911 nested) with the dual-path `toolUseResult` fallback that recovers the ~25,020 subagent results. Normalises the 6-way worktree path aliasing to a repo-relative `canonicalName`; partitions by `repo` (~38% of activity is archetype / scs-earnings / sr-docs). Classifies failures with `src/lib/codegraph/classify.ts` (import the compiled logic or duplicate the regexes with a shared fixture — do **not** let the two drift). Builds episodes at the **(transcript × edited file)** grain, edges (`co_change` same-session co-edit ≥2, `needs_context` read-before-edit directed, `broke_at` file→gate), verdicts from deduped `pr-link` events + `gh` PR state + the 78 fail→pass triples (span ≤80 records, ≤8 edits, cross-transcript session joins). Stage-lifts the 1,037 pre-2026-07-12 `claude_session_stages` rows as `resolution='stage'` via `touched_paths`. Stamps `exists_on_head` against `git ls-files` **behind a sentinel self-test: `src/lib/db/schema.ts` must be found alive or the run aborts loudly**. POSTs batches to the ingest endpoint. Flags: `--dry`, `--limit N`, `--repo <name>`, `--api <url>`. |

Reuse from `scripts/claude-changelog/parse-transcript.mjs`: `sanitize()` (:136 — **mandatory**, Postgres text rejects NUL), `isProjectFile()` (:128), `topDir()` (:121), `clip()`, the `PROJECT_MAP` (:48-64). **Do not** bump `SCHEMA_VERSION` (trap 19).

**Verify**

```bash
# 1. dry run against 20 transcripts, no network
node scripts/codegraph-backfill.mjs --dry --limit 20
# expect a printed summary: nodes / episodes / edges / fingerprints / verdict histogram, and NO abort

# 2. full dry run — check the sentinel and the totals
node scripts/codegraph-backfill.mjs --dry 2>&1 | tail -20
# expect ~1,250 SR file nodes + ~1,200 other-repo, ~3,221 full episodes + ~1,037 stage episodes,
# ~6,000 co_change, ~4,000 needs_context, ~600 broke_at

# 3. real run against the LOCAL DB (endpoint served by `npm run dev`)
npm run dev &   # homeserv :5173
node scripts/codegraph-backfill.mjs --api http://127.0.0.1:5173
psql "$DATABASE_URL" -tAc "SELECT type, count(*) FROM codegraph_nodes GROUP BY 1"
psql "$DATABASE_URL" -tAc "SELECT verdict, count(*) FROM codegraph_episodes GROUP BY 1 ORDER BY 2 DESC"
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM codegraph_episodes WHERE fingerprint IS NOT NULL"

# 4. idempotence — run it twice, counts must not change
node scripts/codegraph-backfill.mjs --api http://127.0.0.1:5173
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM codegraph_episodes"   # same number as step 3
```

---

## Stage 6 — Lesson seed + embedding backfill

**Depends on:** Stage 5 (nodes must exist for `cited_path` attachment).

**Files**

| File | Contents |
|---|---|
| `scripts/codegraph-seed-lessons.mjs` (new) | Imports the **272** `~/.claude/projects/-home-john/memory/*.md` files **verbatim** as `codegraph_lessons` rows (`source='memory_note'`, `sourceRef=<abs path>`, `scope='repo'` or `'glob'` where the note names a directory). **No LLM distiller** — they are already claim+consequence shape. Auto-attaches via `codegraph_node_lessons` (`method='cited_path'`) for the **122** notes that cite a concrete `src/` path. **The .md files stay on disk untouched** — Claude Code's own MEMORY.md loop must not change. Re-runnable: keyed on `sourceRef`, update-in-place. |
| `scripts/codegraph-embed.mjs` (new) | Template-generated `changeSummary` (`In <file>: <intent/skill>; <N> edits; <gate> <verdict>; PR #<n> <state>`) + lesson bodies + node names → embeddings via `generateEmbeddings` from `src/lib/jkai/intel/embed.ts` (graph-agnostic wrapper, `openai/text-embedding-3-small`, 32,000-char truncation). **Batch 96; one failed batch must NOT abandon the sweep; log a final remaining-count query.** (342 of 492 intel entities were permanently unembedded because embedding was only ever a side effect of a summary pass — do not repeat.) |

**Verify**

```bash
node scripts/codegraph-seed-lessons.mjs --api http://127.0.0.1:5173
psql "$DATABASE_URL" -tAc "SELECT source, count(*) FROM codegraph_lessons GROUP BY 1"        # memory_note ≈ 272
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM codegraph_node_lessons"                      # ≥ 122 rows
node scripts/codegraph-seed-lessons.mjs --api http://127.0.0.1:5173                          # re-run: count unchanged
node scripts/codegraph-embed.mjs
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM codegraph_episodes WHERE embedding IS NULL"  # expect 0
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM codegraph_lessons WHERE embedding IS NULL"   # expect 0
```

---

## Stage 7 — Query API + pull channel

**Depends on:** Stages 3, 4, 5.

**Files**

| File | Contents |
|---|---|
| `src/routes/api/jkai/codegraph/query/+server.ts` (new) | `POST { query: string, caller, buildId?, iteration? }`. Auth: `verifyBridgeToken` (builds) **OR** `isOwnerRequest` (the console). Parse error → **400 with byte position + the grammar echoed**. Zero-match seed → `200 { outcome:'empty', suggestions:[…3 trgm…], text: 'NO PRECEDENT for <x> — you are the first; proceed from first principles and record the lesson in ## Evaluation' }`. Infrastructure failure → **502, never `[]`**. **Every query, including failed parses, writes a `codegraph_queries` row.** Must answer in **< 2 s** — no first-call index building (the 300 s command cap plus "never re-run the same command" makes a slow first call a permanently unused feature). |
| `src/hooks.server.ts` (edit, block 424-431) | Add `pathname === '/api/jkai/codegraph/query' ||` — exact pathname, beside `studio/research`. |
| `scripts/check-public-routes.mjs` (edit) | Mirror it in the allow-list. |
| `scripts/codegraph-query.mjs` (new) | Byte-for-byte structural clone of `scripts/studio-research.mjs`: reads `JKAI_API_URL` + `JKAI_BRIDGE_TOKEN`, **`process.exit(2)` with a useful message when either is missing**, POSTs, prints formatted cards to stdout. Name is deliberately **greppable** — Stage 15 measures adoption with `LIKE '%codegraph-query%'` over `jkai_iterations.actions`. |
| `scripts/ci-release.sh` (edit, after line 80) | `rsync -a scripts/codegraph-query.mjs "$VPS_DIR/scripts/"` with a comment naming the allow-list trap. **Only this one script** — the backfill/seed/embed scripts run from homeserv and must NOT be rsynced. |
| `src/routes/api/jkai/codegraph/query/query.api.test.ts` (new) | 400-with-position on a bad parse; typed `empty` on a zero-match seed; no-token → 401; a `codegraph_queries` row is written on **all three**. |

**Verify**

```bash
npx vitest run src/routes/api/jkai/codegraph/
node scripts/check-public-routes.mjs                 # must exit 0
# local end to end
JKAI_API_URL=http://127.0.0.1:5173 JKAI_BRIDGE_TOKEN=<sign one> \
  node scripts/codegraph-query.mjs 'file:src/lib/jkai/executor.ts | hops 1 | episodes verdict=verified,landed limit=3 | lessons | budget 5000'
# expect formatted cards, not JSON, and:
psql "$DATABASE_URL" -tAc "SELECT caller, outcome, node_count, ms FROM codegraph_queries ORDER BY id DESC LIMIT 3"
# fingerprint hot lane latency:
psql "$DATABASE_URL" -c "EXPLAIN ANALYZE SELECT * FROM codegraph_episodes WHERE fingerprint = 'tsc:TS2345' LIMIT 5"
# expect an Index Scan on codegraph_episodes_fingerprint_idx, sub-10ms
grep -n "codegraph-query" scripts/ci-release.sh      # must print the rsync line
```

---

## Stage 8 — Push channel (executor + prompt)

**Depends on:** Stages 4, 7. **This is the load-bearing change.**

| File | Line | Change |
|---|---|---|
| `src/lib/jkai/executor.ts` | after **245** | After `const codebaseDigest = await buildCodebaseDigest(build.id, devFiles).catch(() => '');` add: `const retrievalBlock = promptMode === 'repo' && process.env.CODEGRAPH_PUSH !== '0' ? await (await import('./retrieval-context')).buildRetrievalBlock({ buildId: build.id, task: build.prompt, lastEvaluation: prevIteration?.evaluation ?? null, prevActions: prevIteration?.actions ?? null, iteration: iterationNumber }).catch(() => '') : '';` — dynamic import + `.catch(() => '')` mirrors the digest above it. **`CODEGRAPH_PUSH` is read per-iteration, not at process start** (the `JKAI_API_URL`-read-once trap). |
| `src/lib/jkai/executor.ts` | **312** | `const userPrompt = [deliveriesBlock, contextMessages.map((m) => m.content).join('\n\n'), retrievalBlock]` — the existing `.filter((s) => s.length > 0)` on :313 drops it when empty. **After** `contextMessages`, so retrieval reads as the correction to the digest, not a preamble the digest then overrides. **No signature change to `buildIterationContext`** (10 positional args, called positionally by `executor.studio-brief.test.ts`). |
| `src/lib/jkai/executor.ts` | near **219** (preflight) | `emitLog` the outcome, three distinct states, **never silent**: `codegraph push: 3 episodes (2 verified) + 2 lessons for tsc:TS2345, 1,840 chars` / `codegraph push: EMPTY — no history for <paths> (graph holds N nodes for this repo)` / `codegraph push: FAILED <err>` at level `error`. **Zero nodes for the target repo at preflight = `emitLog('error')`** — that means ingest is broken, not that history is empty. |
| `src/lib/jkai/prompt.ts` | **163** | Rewrite REPO_SYSTEM_PROMPT step 2 to name the pull command via a `__CODEGRAPH_CMD__` placeholder, mirroring how STUDIO_SYSTEM_PROMPT:224-231 names studio-research. |
| `src/lib/jkai/prompt.ts` | after **426** | Add `export function codegraphQueryScript(cwd = process.cwd()) { return \`${cwd}/scripts/codegraph-query.mjs\`; }` beside `studioResearchScript`. Builder `process.cwd()` on the VPS is `/opt/strange-rambling-svelte` (`packages/jkai-builder/jkai-builder.service` WorkingDirectory), which is exactly what `ci-release.sh` writes to. |
| `src/lib/jkai/prompt.ts` | **444-450** | In the `if (mode === 'repo')` branch, `.replace('__CODEGRAPH_CMD__', codegraphQueryScript())`. **Never via an env var** — prompt.ts:407-413 documents why a var that fails to propagate leaves the prompt naming a command that does not exist. |
| `src/lib/jkai/prompt.ts` | **495** | Gate the `Trust the digest for "what exists and where"` sentence on `mode !== 'repo'`. In repo mode it is false (60 files sampled from a `head -500` truncation of 3,359 tracked files, mtimes all clone-time) and it actively suppresses the discovery the agent needs. Replace with a pointer to the retrieval block + the pull command. |

**Tests:** `src/lib/jkai/retrieval-context.test.ts` (new) — empty result returns `''`; a >5,000-char result is capped; an 800 ms-exceeding call returns `''` and logs; seeds compile from a `prevIteration.evaluation` containing a real `svelte-check` failure. `src/lib/jkai/prompt.test.ts` (extend) — repo mode substitutes an absolute `/scripts/codegraph-query.mjs` path and contains **no** `__CODEGRAPH_CMD__`; repo mode does **not** contain "Trust the digest".

**Verify**

```bash
npx vitest run src/lib/jkai/prompt.test.ts src/lib/jkai/retrieval-context.test.ts src/lib/jkai/executor.studio-brief.test.ts
node -e "const {buildSystemPrompt}=await import('./src/lib/jkai/prompt.ts')" 2>/dev/null || \
  npx vitest run src/lib/jkai/ 2>&1 | tail -5
grep -n "__CODEGRAPH_CMD__" src/lib/jkai/prompt.ts    # placeholder defined AND substituted
```

---

## Stage 9 — jkai chat tool (chat only, not builds)

**Depends on:** Stages 4, 7.

| File | Change |
|---|---|
| `src/lib/workflows/site-tools/tools/codegraph.ts` (new) | `register()` from `../registry-internal`. One tool `codegraph_query` (plus optionally `codegraph_node` for a file dossier), `toolset: 'codegraph'`, `category: 'Knowledge'`, **no `destructive` flag**. **Lazy header only:** `const loadRun = () => import('$lib/codegraph/load');` etc. — every loader name prefixed `load`. `resolveNode()` reports ambiguity as `{ candidates: [...] }` rather than guessing. |
| `src/lib/workflows/site-tools/registry.ts:37` | Add `import './tools/codegraph';` beside `import './tools/intel-graph';`. This single side-effecting import IS the registration. |
| `src/lib/workflows/site-tools/registry.ts:125` | Add a `codegraph:` entry to `toolsetDescriptions`, after the `intel-graph` line. Say explicitly what it answers that intel-graph does not: *build/edit/gate history of FILES in this repo — what changed a file before, what fixed this exact gate error, and the lessons bound to it* (intel-graph is people and organisations). Without an entry the manifest shows a bare slug. |
| `src/lib/workflows/site-tools/keyword-classifier.ts:50` | Add `{ toolset: 'codegraph', pattern: /code\s*graph|who\s+(?:last\s+)?(?:touched|changed|edited)|edit\s+history|what\s+broke|previous\s+(?:fix|diff)|precedent\s+for|co-?change|last\s+time\s+.*(?:failed|broke)/i }`. Without a row the toolset is unreachable unless the model thinks to call `activate_toolset` on its own. |
| `src/lib/workflows/site-tools/keyword-classifier.test.ts` | Add cases (the file asserts every listed toolset is inferrable). |

**Verify**

```bash
npx vitest run src/lib/workflows/site-tools/keyword-classifier.test.ts
node -e "
import('./src/lib/workflows/site-tools/registry.ts')" 2>/dev/null || \
npx vitest run src/lib/workflows/site-tools/ 2>&1 | tail -5
# registry import must stay fast — an eager \$lib/db import takes it to 20s+
time npx vitest run src/lib/workflows/site-tools/registry.test.ts 2>&1 | tail -3
```

---

## Stage 10 — UI surface 1: the ER map at `/jkai/codegraph`

**Depends on:** Stages 4, 5. **Read the `svelte5-pitfalls` skill before writing the first `.svelte` line.**

| File | Contents |
|---|---|
| `src/lib/components/codegraph/workbench.ts` (new) | `CodegraphCounts` interface + `SURFACES` array with the same six fields as `src/lib/components/intel/workbench.ts:23-34` (`href, label, stage, question, ratherThan, count, warnAbove`), ordered by loop stage. |
| `src/routes/jkai/codegraph/+layout.server.ts` (new) | **COUNT queries ONLY** — `Promise.all` of `db.select({n: count()})`. It runs on every page in the section; never `getCodegraphAnalysis()` here. |
| `src/routes/jkai/codegraph/+layout.svelte` (new) | Build a `PageMenu` from `SURFACES`, `setPageMenu(menu)` in an `$effect`, **`clearPageMenu()` in `onDestroy`** (omitting the clear leaves the nav showing on `/jkai`). Import from `$lib/jkai/hub-bus.svelte`. `label: 'codegraph'`, `back: { label: 'chat', href: '/jkai' }`. |
| `src/lib/codegraph/analytics/model.ts` (new) | Structural clone of `src/lib/jkai/intel/analytics/model.ts` (GraphNode/GraphEdge/GraphSnapshot/AdjacencyIndex/pairKey/buildIndex/hopNeighbourhood/components) with code fields (`canonicalName`, `repo`, `fileKind`, `editCount`, `failCount`, `lastTouchedAt`). |
| `src/lib/codegraph/analytics/load.ts` (new) | Own `cached` Map, `inflight` Map, `generation` counter, `TTL_MS = 60_000`, own `invalidateCodegraphAnalysis()`. **Import `centrality.ts`, `community.ts`, `paths.ts`, `filter.ts` UNCHANGED** from `$lib/jkai/intel/analytics/` — they take only an `AdjacencyIndex`. Copy `centrality.ts`'s yield-on-a-timer usage: betweenness at 5,338 nodes was 40.3 s of blocked event loop and restarted the service via the watchdog. |
| `src/routes/api/jkai/codegraph/network/+server.ts` (new) | Clone of `src/routes/api/jkai/intel/network/+server.ts`. Keep **`MAX_NODES = 600`** with pagerank-ranked trimming and keep the **`selected` vs `keep`** distinction (conflating them made the panel report 600 when the real number was 2,816). One `now` for the whole response. |
| `src/lib/components/codegraph/NetworkGraph.svelte` (new) | Copy `src/lib/components/intel/NetworkGraph.svelte` wholesale; change **only** `radius` / `structuralRadius` / `earnsLabel` and the node type import. **Import every encoding from `src/lib/components/intel/graph-visual.ts`** — `CLUSTER_COLOURS`, `clusterSlotOf`, `clusterSeedOf`, `washOut`, `edgeWidth`, `edgeEmphasis`, `edgeDistanceScale`, `edgeForceStrength`, `PAGE_BG`. Colour by the **durable cluster key**, never the Louvain index (70.6% overnight churn measured). d3 handles as plain `let`. |
| `src/routes/jkai/codegraph/+page.svelte` / `+page.server.ts` (new) | The map + an inline node panel on click: episodes with verdict chips, attached lessons, top `co_change` neighbours (with weights), gate history. |
| `src/lib/components/jkai/HubHeader.svelte:81` | Add `{ label: 'Code', href: '/jkai/codegraph', meta: 'BUILD GRAPH' }` after the Intel row. |
| `src/lib/components/jkai/JkaiLauncher.svelte:51` | Add `{ code: 'CG', label: 'Code graph', href: '/jkai/codegraph', desc: 'File history, precedents & gate failures', keywords: 'code build files graph precedent fingerprint' }` next to the `INT` row. |

**Verify**

```bash
npm run dev
# browse http://homeserv:5173/jkai/codegraph — graph renders, no console errors,
# node click opens the panel, PageMenu appears in the hub header and DISAPPEARS on /jkai
npm run gate:font-sizes      # 12px floor, inputs 16px
npx svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -5
```

---

## Stage 11 — UI surface 2: `/jkai/codegraph/review` (quality + forgetting + measurement)

**Depends on:** Stages 4, 10.

One page, three panels — John's own feedback file says no over-engineered UI, so the split-out `/node/[id]`, `/quality` and `/impact` pages are phase 2.

| File | Contents |
|---|---|
| `src/routes/jkai/codegraph/review/+page.server.ts` + `+page.svelte` (new) | **(a) Triage queue** — `unverified` and `repaired` episodes plus unattached lessons, **ordered by retrieval frequency** (join `codegraph_queries.served_nodes` — review what actually gets served), LIMIT 250. **(b) Retrieval audit table** — every CGQL query by caller with `outcome`, `node_count`, `served_chars`, `ms`, and the **verbatim replayable query string**. **(c) Stats strip** — frozen baseline vs live iterations-per-build, retired / suppressed / superseded counts (so the forgetting filter is *observable*, not assumed), and a **RED state when any repo build since ship has zero `codegraph_queries` rows**. |
| `src/routes/api/jkai/codegraph/triage/+server.ts` (new) | POST actions: `retire`, `supersede` (writes a **real** `supersededById`), `suppress-edge` (+ reason; kept, never deleted), `forget-with-reason`. **Rows marked in place, never `invalidateAll`**, so the cursor survives. Calls `invalidateCodegraphAnalysis()` after each write. |
| `src/lib/codegraph/forget.ts` (new) | `deleteNodeCascade(nodeId)` for secrets/PII only — one transaction, **edges BEFORE the node**, merge tombstones walked to a fixpoint, FK-less refs hand-deleted (the `src/lib/jkai/intel/ingest.ts:156` ordering). **Awaited, not queued**. `mergeNodes(survivorId, mergedId)` writes the `codegraph_node_merges` ledger row **in the same transaction as the tombstone** and flattens chains (`UPDATE … SET merged_into_id = survivor WHERE merged_into_id = merged`) — the loader resolves one hop only. `unmergeNode()` replays the ledger snapshot. |
| `src/lib/codegraph/forget.test.ts` (new) | Cascade ordering; chain flattening; unmerge restores exactly what merge moved; `supersededById` is never a string literal. |

**Verify**

```bash
npx vitest run src/lib/codegraph/forget.test.ts
npm run dev
# /jkai/codegraph/review — retire a lesson, confirm the retired count increments,
# then re-run the Stage 7 CGQL query and confirm that lesson is NOT served.
```

---

## Stage 12 — Full gate green, locally

**Depends on:** Stages 1-11.

```bash
cd /home/john/strange_rambling_svelte/.worktrees/codegraph
npm run gate            # the full 5-step gate, verified from package.json
# or, faster and what CI actually runs:
npm run gate:public-routes && npm run gate:font-sizes && ./scripts/gate-concurrent.sh && npm run gate:build
```

**Local gate ≠ CI.** A green local gate is necessary, not sufficient — CI runs `drizzle-kit push --force` against a throwaway DB at `.github/workflows/ci.yml:184` and that step will exercise the new tables for the first time. If the build fails, suspect a stale `.svelte-kit/output` first and do a clean rebuild.

---

## Stage 13 — PR, CI, merge

**Depends on:** Stage 12.

```bash
git checkout -b codegraph-phase1
git add -A && git commit    # message ends with the Co-Authored-By line
git push -u origin codegraph-phase1
gh pr create --title "codegraph: file-keyed build memory (phase 1)" --body-file <PR body>
```

**The PR body must contain the FROZEN BASELINE** (Stage 15's re-runnable SQL and today's numbers) and the phase-1/phase-2 split.

- **Never `gh pr merge --auto`** — it merges immediately, it does not wait.
- Watch CI: `gh run watch` / `gh pr checks`. The `gate` job must be green before the `release` job runs (`needs: [gate, prebuild]` at `ci.yml:292`).
- Merge to `master` → **CI auto-deploys**. Do not run `scripts/deploy.sh`.

**Verify the deploy actually happened** (merged ≠ deployed — a pending deploy can be cancelled):

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'cat /opt/strange-rambling-svelte/build/.deploy-sha'
git rev-parse HEAD    # must match
```

---

## Stage 14 — Production: ANN indexes, backfill, builder deploy

**Depends on:** Stage 13 (CI must have run `drizzle-kit push`, creating the 7 tables in prod).

**Order matters. Three separate deploy paths, and they can be out of step:** the web app ships via CI merge; `scripts/codegraph-query.mjs` ships via the `ci-release.sh` allow-list; the executor's `retrieval-context.ts` ships with the **builder bundle**, which `ci-deploy`/`ci-release` do **not** run.

**14a. Confirm the tables exist in prod**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  'docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -tAc "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '"'"'codegraph%'"'"' ORDER BY 1"'
# expect 7
```

**14b. ANN migration — write it, RUN it, VERIFY it**

File: `scripts/migrations/2026-08-17-codegraph-ann-indexes.sql` (new) — `CREATE INDEX CONCURRENTLY … USING hnsw (embedding vector_cosine_ops)` on `codegraph_episodes`, `codegraph_lessons`, `codegraph_nodes`; `USING gin (lower(canonical_name) gin_trgm_ops)` on `codegraph_nodes`. Both extensions are already installed in prod.

```bash
scp -i ~/.ssh/id_ed25519 scripts/migrations/2026-08-17-codegraph-ann-indexes.sql johnk@157.180.19.38:/tmp/
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  'docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < /tmp/2026-08-17-codegraph-ann-indexes.sql'
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -tAc \"SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%hnsw%' OR indexdef ILIKE '%trgm%'\""
# MUST print 4 rows. The intel equivalent has printed ZERO since 2026-07-26.
```

**14c. Set the changelog secret on the VPS and restart** (Stage 1's env half)

```bash
ssh: sudo chattr -i .env → append CLAUDE_CHANGELOG_SECRET=… → sudo chattr +i .env
sudo systemctl restart strange-rambling   # env is read at process start
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://strangeramblings.com/api/claude-changelog/ingest -d '{}'   # expect 401
```

**14d. Backfill production from homeserv**

```bash
cd /home/john/strange_rambling_svelte/.worktrees/codegraph
node scripts/codegraph-backfill.mjs --api https://strangeramblings.com --dry | tail -20   # sanity first
node scripts/codegraph-backfill.mjs --api https://strangeramblings.com
node scripts/codegraph-seed-lessons.mjs --api https://strangeramblings.com
node scripts/codegraph-embed.mjs --api https://strangeramblings.com
```

Prod `BODY_SIZE_LIMIT` is 20 MB; batch payloads well under that (the changelog corpus's largest single payload is 1,047 KB). Watch DB growth: expect **~115 MB** on a 3,216 MB DB. Abort if it exceeds ~300 MB and investigate before continuing.

```bash
# counts + size
ssh … psql -tAc "SELECT 'nodes',count(*) FROM codegraph_nodes UNION ALL SELECT 'episodes',count(*) FROM codegraph_episodes UNION ALL SELECT 'edges',count(*) FROM codegraph_edges UNION ALL SELECT 'lessons',count(*) FROM codegraph_lessons"
ssh … psql -tAc "SELECT pg_size_pretty(pg_database_size('strange_rambling'))"
ssh … "df -h /"     # 48 GB free before; must not drop meaningfully
```

**14e. Deploy the builder — AFTER CI, in this order**

```bash
# only after CI's release job (and its drizzle push) has completed
./scripts/deploy-builder.sh
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'systemctl status jkai-builder --no-pager | head -5'
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 'ls -l /opt/strange-rambling-svelte/scripts/codegraph-query.mjs'
# ↑ if this file is MISSING, the ci-release.sh rsync line was not added (trap 5)
```

---

## Stage 15 — Live verification + measurement baseline freeze

**Depends on:** Stage 14. **Done means live.**

**15a. Live query through the real pull path**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  'cd /opt/strange-rambling-svelte && set -a; . ./.env; set +a; \
   JKAI_BRIDGE_TOKEN=$(node -e "…signBridgeToken…") \
   node scripts/codegraph-query.mjs "file:src/lib/jkai/executor.ts | hops 1 co_change,needs_context | episodes verdict=verified,landed limit=3 | lessons | budget 5000"'
# expect formatted precedent cards, NOT an error, NOT an empty array
ssh … psql -tAc "SELECT caller,outcome,node_count,episode_count,lesson_count,served_chars,ms FROM codegraph_queries ORDER BY id DESC LIMIT 3"
# expect outcome='ok', ms < 2000
```

**15b. Fingerprint hot lane on prod**

```bash
ssh … psql -c "EXPLAIN ANALYZE SELECT * FROM codegraph_episodes WHERE fingerprint LIKE 'svelte:%' LIMIT 5"
# expect Index Scan on codegraph_episodes_fingerprint_idx
```

**15c. Both pages render live**

`https://strangeramblings.com/jkai/codegraph` and `/jkai/codegraph/review` — graph draws, node panel opens, review stats strip shows the counts. Owner session required (deny-by-default `/jkai` prefix gate).

**15d. Push channel proven on a real build.** Kick one small repo-mode build and read `jkai_logs`:

```bash
ssh … psql -tAc "SELECT message FROM jkai_logs WHERE message LIKE 'codegraph push:%' ORDER BY id DESC LIMIT 10"
# expect a 'served N episodes' or an explicit 'EMPTY —' line. A build with NO such line
# means the executor did not ship — re-check deploy-builder.sh.
```

**15e. FREEZE THE BASELINE.** Put this in the PR description (and in the `/review` stats strip) as re-runnable SQL with today's answers:

```sql
-- PRIMARY: iterations to terminal per repo build
SELECT b.id, count(i.*) AS iters
FROM jkai_builds b JOIN jkai_iterations i ON i.build_id = b.id
WHERE b.git_target_config IS NOT NULL
GROUP BY 1;
-- 2026-08-17 baseline: 66 git-target builds, 280 iterations,
--   mean over all 66 = 4.24; mean over the 48 with >=1 iteration = 5.83; median = 4

-- split served vs unserved after ship:
--   EXISTS (SELECT 1 FROM codegraph_queries q
--           WHERE q.build_id = b.id AND q.outcome='ok' AND q.node_count > 0)

-- SECONDARY (a): discovery actions per iteration
SELECT a->>'lang' AS lang, count(*) FROM jkai_iterations, jsonb_array_elements(actions) a GROUP BY 1;
-- 2026-08-17 baseline: read 2219, bash 1888, edit 461, write 268, grep 253, find 100, ls 25
--   → 5,214 total; discovery (read+grep+find+ls) = 2,597 over 280 iterations = 9.28/iteration
--   → 2,219 reads over 340 distinct paths = 6.53 reads per path

-- SECONDARY (c): PULL adoption — trust SQL over actions, never logs
SELECT count(*) FROM jkai_iterations i, jsonb_array_elements(i.actions) a
WHERE a->>'lang' = 'bash' AND a->>'code' LIKE '%codegraph-query%';
-- 2026-08-17 baseline: 0

-- SECONDARY (d): relevance proxy — fraction of files edited in iteration N
--   that appeared in servedNodes for iteration N (canonical names make the join free)
```

**Success bar:** served-cohort median iterations ≤ 3 over the first 25 post-ship repo builds.
**Pre-registered kill criterion:** after **30** post-ship repo builds, if the served cohort's median iterations is not below the unserved cohort's, **the push block is removed rather than defended.**
**Honesty clause:** 5-8 repo builds/week means ~4 weeks to 25. The page shows medians and full distributions, never significance theatre, and names the task-mix confound.

**15f. Update memory.** Add a `project_codegraph.md` note under `~/.claude/projects/-home-john/memory/` and one bolded index line in `MEMORY.md` — specifically: the ANN migration is applied and verified, the backfill is re-runnable and idempotent, `CODEGRAPH_PUSH=0` is the kill switch, and three deploy paths must stay in step.

---

## Dependency graph (one line)

```
1 (security) ─┐
2 (schema) ───┼─→ 3 (pure: CGQL + classifier) ─→ 4 (retrieval core + forgetting filter)
              │                                    ├─→ 5 (ingest + extractor + backfill) ─→ 6 (lessons + embeddings)
              │                                    ├─→ 7 (query API + pull script + hooks + ci-release + check-public-routes)
              │                                    │      └─→ 8 (push: executor + prompt)
              │                                    │      └─→ 9 (chat tool)
              │                                    └─→ 10 (map UI) ─→ 11 (review UI + forget flows)
                                                                        └─→ 12 (gate) → 13 (PR + CI + merge)
                                                                              → 14 (ANN + prod backfill + deploy-builder)
                                                                              → 15 (live verify + baseline freeze)
```

Stages 5/6, 7/8/9 and 10/11 are the three parallelisable clusters once Stage 4 is green.

---

## Phase 2 (labelled, NOT in this PR)

Continuous ingest riding `parse-transcript.mjs` SCHEMA_VERSION 3→4 (plus pulling the main checkout to `master` — the cron does not run master today); nested transcripts in the cron path; the minting loop (orchestrator finalize mints `verified` episodes from a build's own fail→pass gate transitions); the nightly sweep at 04:45 (clear of 03:30 selfimprove and 04:15 intel); served→passed corroboration; LLM dossiers for the ~340 files with ≥3 episodes; `jkai_memories` absorption and the `memory-review.ts` fork (own PR); a `codegraph` branch in `knowledge_search`; `route`/`table`/`tool`/`skill` node types; `/node/[id]`, `/quality`, `/impact`; rename detection; the 54 prod-only pre-07-12 sessions scraped from `full_transcript`; regenerating `MEMORY.md` from the graph; symptom-family near-matching.
