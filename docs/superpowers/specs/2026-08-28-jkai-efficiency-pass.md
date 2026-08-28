# /jkai efficiency pass — ten measured improvements

**Date:** 2026-08-28 · **Branch:** `perf/jkai-efficiency` · Delivered autonomously.

A read of `/jkai` and the subsystems it drives (workflow engine, intel, builds,
chat) looking only for *waste* — work the box does that nothing reads. Every
item below was measured against **production** with `EXPLAIN (ANALYZE, BUFFERS)`
or a byte count, not inferred from the shape of the code.

The headline: four tables that the hub touches on every navigation carry **no
index but their primary key**, including a 2.5 GB one that the workflow engine
scans on its inner loop.

## The ten, in priority order

| # | What | Measured cost | Fix |
|---|---|---|---|
| 1 | `node_executions` — 356k rows / **2.5 GB**, PK only | **89 ms, 26,287 buffers (~205 MB I/O) to return 2 rows**; 20+ call sites incl. `run-worker.ts` | index `(run_id)`, `(node_id, started_at)` |
| 2 | `workflow_runs` — 44k rows, PK only | 20 ms / 1,095-buffer **seq scan on every `/jkai` navigation** (layout load) | index `(workflow_id, started_at)`, `(status, started_at)` **and split the `count(*) FILTER` into two WHERE-d counts** — see below |
| 3 | `intel_note_entities` — 7.4k rows, **zero indexes, no PK** | 4 ms / 847-buffer seq scan **three times per entity per note** at extraction | index `(note_id, entity_id)`, `(entity_id)` |
| 4 | `jkai_logs` — 21.5k rows / 13 MB, PK only | 8 ms / 1,034-buffer seq scan per build-log read, and the log view polls | index `(build_id, created_at)` |
| 5 | Chat history builds a **200-term `OR`** instead of `= ANY` | every chat turn | `inArray` |
| 6 | `/jkai` root load fetches the **whole** WhatsApp thread, unbounded, and runs three queries serially | every `/jkai` load | `LIMIT` + fold into the existing `Promise.all` |
| 7 | Conversation rail ships **full last-message bodies** — 102 kB for 483 rows — to render a 44-char preview | every `/jkai` load | truncate in SQL, cap the rail |
| 8 | `/api/jkai/hub-status` runs 4 independent blocks **serially**; polled every 20 s from every `/jkai` page | 4 round-trips × 3/min × every open tab | `Promise.all` |
| 9 | Builds list is `SELECT *` (incl. `research_brief`, `chapter_plan` jsonb) with **no `LIMIT`**, in both the page load and the API | every `/jkai/builds` load and poll | project the 15 columns the list renders |
| 10 | Orchestrator reclaim sweep selects every finished build and discards by date **in JS**; `serve-manager` selects the whole builds table | every sweep | push the predicate into SQL |

## Decision log

| Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| How to create indexes on a 2.5 GB table | (a) let `drizzle-kit push` do it during the release, (b) pre-create `CONCURRENTLY` on prod with the exact names, then declare in `schema.ts` so push sees no diff | **(b)** | A blocking `CREATE INDEX` stalls the engine's writes mid-deploy and the release step has a 180 s timeout. `CONCURRENTLY` cannot run inside drizzle's transaction, so it must be done out of band. Follows the pattern in `reference_drizzle_unique_push_gotcha`. | Yes — `DROP INDEX` |
| `intel_note_entities` duplicates (810 rows across 24 pairs inflate every evidence count; the code comment asks for a unique index) | (a) dedupe + unique index now, (b) plain indexes now, flag the dedupe | **(b)** | The seq scans are what cost, and a plain index fixes those whether or not duplicates exist. Deleting production rows is outside a "code efficiency" brief. SQL is in the report. | n/a — nothing deleted |
| Conversation rail: unbounded list | (a) paginate the rail, (b) keep every row, truncate the preview text | **(b)** | The rail has client-side search across all threads; a `LIMIT` silently breaks "find that old thread". Truncation keeps every row addressable and takes the payload with it. | Yes |
| Preview truncation length | 120 / 200 / 400 chars | **200** | `rowTitle` only ever reads the first line clipped to 44 chars, so 200 is generous for the title and still useful as a search haystack. | Yes — one constant |
| Where to work | main checkout / new worktree | **worktree off `origin/master`** | The main checkout is parked on `intel-source-filters` with unmerged WIP (`reference_shared_worktree_hazard`). | Yes |

## Verification

- `EXPLAIN (ANALYZE, BUFFERS)` on prod before/after for items 1–4 — seq scan → index scan, buffer counts.
- `\d <table>` on prod proves the index landed (a green deploy is not evidence — `reference_schema_ts_must_be_self_contained`).
- `npm run gate` green (check + test + build + lint gates).
- Live `/jkai`, `/jkai/builds`, `/jkai/intel` fetched after deploy.


## Measured on production, after

Indexes were created `CONCURRENTLY` on prod before the deploy, so `drizzle-kit
push` sees no diff and never takes a blocking lock on the 2.5 GB table.

| Query | Before | After |
|---|---|---|
| `node_executions` by `run_id` | 89.0 ms, 26,287 buffers (parallel seq scan) | **14.0 ms, ~3 buffers** (bitmap index scan) |
| hub layout run counts | 20.5 ms, 1,095 buffers (seq scan) | **0.22 ms, 6 buffers** (two index-only scans) |
| `jkai_logs` by `build_id` | 8.1 ms, 1,034 buffers (seq scan) | **1.0 ms, 85 buffers** (bitmap index scan) |
| `intel_note_entities` by `note_id` | 4.0 ms, 847 buffers (seq scan) | **0.06 ms, 4 buffers** (index-only scan) |

### The one the index alone did not fix

Item 2 needed a query change as well, and only the measurement showed it. A
`count(*) FILTER (WHERE status = ...)` with no `WHERE` clause of its own must
visit every row whatever indexes exist — adding one changed nothing. Split into
two counts that each carry their own predicate, both become index-only scans.
Equivalence was checked against production over 1-day, 30-day and 365-day
windows (0/0, 9/9, 5076/5076).

### The one the type checker did not catch

The first draft of the set-based corroboration `UPDATE` bound its id list as
`= ANY(${entityIds})`. `svelte-check` passed, the build passed, and Postgres
rejected it at runtime with `op ANY/ALL (array) requires array on right side` —
drizzle expands a bare array in an `sql` template into a comma-separated
parameter list, not a single array parameter. `sql.param(entityIds)` is the form
that binds one array. Caught by exercising the statement against a real database;
nothing static would have found it.

## Deliberately left undone

`intel_note_entities` holds **810 duplicate `(note_id, entity_id)` rows across 24
pairs**, from before the code checked for existence. They inflate every evidence
count derived from the table, and they are why the unique index the graph code
asks for cannot be declared. Deleting production rows is outside a code-efficiency
brief, so the plain indexes shipped and the dedupe did not:

```sql
DELETE FROM intel_note_entities a USING intel_note_entities b
 WHERE a.ctid > b.ctid AND a.note_id = b.note_id AND a.entity_id = b.entity_id;
CREATE UNIQUE INDEX CONCURRENTLY intel_note_entities_pair_key
  ON intel_note_entities (note_id, entity_id);
```

Also noted and not acted on: `node_executions` is 2.5 GB for 356k rows because it
retains `input_data`/`output_data` for every node of every run ever. That is a
retention question, not an efficiency one.
