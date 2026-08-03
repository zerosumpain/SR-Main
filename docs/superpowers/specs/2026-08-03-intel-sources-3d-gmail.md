# Intel: source control, 3D graph, working insight actions, better resolution, Gmail at scale

Date: 2026-08-03
Status: shipped — PR #96 (data/backend) and #97 (graph/UI)
Mode: autonomous (Full grade — no approval gates)

Five asks against `/jkai/intel`, from John:

1. A control for **which sources contribute** to the graph (files by category, emails, chats, research…).
2. The network rendered as a **3D spatial graph** like Obsidian, keeping node/edge weight encodings.
3. **Insight action buttons that work** — "Confirm the link" must record a relationship, not deep-link to
   jkai; and any button that asks jkai a question must start a **new session**.
4. **Better matching / duplicate handling**, to cut the review burden.
5. **Gmail into the graph** — rolling 12 weeks, all mail except bin and spam, bodies *and* attachments,
   with **staleness** reducing the relevance of older mail.

## What already exists (precedent, not invention)

| Thing | Where | Note |
|---|---|---|
| Gmail sweep into intel | `src/lib/jkai/intel/gmail-ingest.ts` (784 ln) | Marked threads only (`is:starred OR label:intel`), 100-thread cap, no attachments |
| Gmail OAuth + client | `src/lib/workflows/gmail/service` | Multi-account, encrypted refresh tokens. **One Gmail client in this repo** — reuse it |
| Graph snapshot + analytics | `src/lib/jkai/intel/analytics/{load,model,filter,centrality,community}.ts` | Cached 60 s, invalidated on write |
| 2D force graph | `src/lib/components/intel/NetworkGraph.svelte` (512 ln) | d3-force, PageRank sizing, community colour |
| Duplicate detection | `src/lib/jkai/intel/resolve/{match,merge}.ts` | Name/acronym/semantic signals, `AUTO_MERGE_THRESHOLD = 0.85` |
| Commissioning | `src/routes/api/jkai/intel/commission/+server.ts` | `ask` returns `/jkai?ask=…`; consumed by `ChatArea.svelte:573` |
| Category filter | `intel_notes.categories` → snapshot → `?categories=` | The source selector extends exactly this path |
| Nightly intel maintenance | `src/lib/jkai/intel/engine.ts` | 04:15 local, prod-gated, kill switch — the rolling sweep hangs off this |
| Attachment text | `src/lib/jkai/extract/` (`extractText`) | docx/pdf already handled |
| three.js | dependency `three@0.183.2`; raw-three precedent `src/lib/sim/federation/scene.ts` | |

Root causes found while reading, which change the design:

- **"Confirm the link" was never wired to write anything.** `missing_link` carries `action: 'ask'`, so it
  fell through the commission switch into the interactive branch and returned a `/jkai?ask=` deep link.
  It is not a broken button; it is a *missing commission kind*.
- **`?ask=` prefills the composer of whatever conversation is already open** (`ChatArea.svelte`), which is
  why asking from Intel lands in the current thread. New sessions need an explicit signal.
- **The snapshot has no notion of a note's source.** `load.ts` aggregates `categories` per entity but not
  `intel_notes.source`, so nothing downstream *can* filter by source yet.

## Design

### 1. Source selector

Extend the path categories already take. `load.ts` aggregates `ARRAY_AGG(DISTINCT n.source)` per entity and
per edge (edges via `source_note_id`); `GraphNode`/`GraphEdge` gain `sources: string[]`; `filter.ts` gains a
`sources` predicate; the network route accepts `?sources=csv`. UI: a Sources block in the filter rail listing
the seven source kinds with live counts, categories nested under Files. Deselecting a source removes its
nodes *and* the edges it asserted.

Decision: filter at **read** time, not ingest time. Reversible per view, no re-extraction, and matches how
categories already behave.

### 2. 3D graph

New `NetworkGraph3D.svelte` — three.js renderer + `d3-force-3d` layout (same API as the `d3-force` already
used in the 2D component, so the force setup is a straight port with a z axis). Encodings carried over
verbatim: radius from PageRank `importance`, colour from community, edge width/opacity from `weight`, accent
for cross-community edges, path overlay, dim-on-keyword-match. Instanced meshes for nodes, a single
`LineSegments` for edges, sprite labels for the top-N and on hover. Orbit/pan/zoom, raycast picking, click to
select, double-click to open.

`NetworkGraph.svelte` (2D) stays; a persisted 2D/3D toggle sits on the graph header. **3D is the default** —
that is what was asked for — with 2D one click away.

Decision: `d3-force-3d` (new dep, 3.0.6) over hand-rolling a force layout. It is the same author and API as
the incumbent d3-force; hand-rolling would be the invention here, not the reuse.

### 3. Insight actions

- New commission kind **`confirm_link`**: writes an `intel_relationships` row with `manual: true`,
  `confidence: 'high'`, `observationCount` and `weight` set through the existing `weightFor`, invalidates the
  analysis cache, and returns "Link recorded" rather than a URL. `missing_link` insights switch to it.
- Its companion **`reject_link`** sets `suppressed` + `suppressedReason` so the predictor stops re-proposing
  the pair. (The columns exist and nothing wrote them.)
- `ask`/`briefing` now return `/jkai?ask=…&new=1`; `ChatArea.svelte` starts a fresh conversation when `new=1`
  is present, before prefilling.

### 4. Matching and duplicates

Cut the burden at the two ends — fewer candidates needing eyes, faster disposal of the ones that do:

- **`same_email` signal at 0.98** (auto-mergeable). Gmail writes `properties.email` on every person it
  creates, so the highest-precision key in the whole graph currently goes unused by the matcher.
  `ResolvableEntity` gains `properties`.
- **Person-name signals**: initial-vs-expansion (`J Kelly` ≈ `John Kelly`) and given/family reordering
  (`Kelly, John`), gated to `person`-typed pairs so organisations do not collapse.
- **Auto-merge runs after every ingest** (`autoMergeDuplicates` at the existing threshold), so duplicates are
  resolved as they arrive instead of accumulating into a review queue.
- **Bulk review** on `/jkai/intel/quality`: select-all-above-a-confidence, merge selected in one call, and a
  swap-survivor control for when `pickSurvivor` chose the wrong side.

Threshold stays 0.85. Nothing here lowers the bar for an automatic merge; it adds a *higher*-precision signal
and makes manual disposal cheaper.

### 5. Gmail: rolling 12 weeks, bodies + attachments, staleness

- Query becomes `newer_than:84d -in:trash -in:spam` (constant `ROLLING_GMAIL_INTEL_QUERY`, 84d = 12 weeks).
  `DEFAULT_GMAIL_INTEL_QUERY` is kept for the manual marked-thread sweep.
- **Paged backfill** replacing the 100-thread cap: `pageToken` loop with a per-run thread budget and a
  persisted cursor, so a 12-week backfill completes across several runs instead of one enormous request.
- **Attachments**: parts with a filename are fetched and run through `$lib/jkai/extract`'s `extractText`,
  appended to the note text under a per-attachment heading, capped per thread. Unsupported types are named
  but not decoded.
- **Staleness**: `recencyWeight(ageDays, halfLifeDays = 42)` — exponential decay, floored at 0.15 so an old
  edge fades rather than vanishing. Applied to Gmail-derived edge weight at write time, and exposed as
  `recency` on nodes/edges in the network payload so both renderers can fade stale material.
- **Scheduled**: the rolling sweep joins `runIntelSweep()` in `engine.ts` (04:15, prod-gated, existing kill
  switch), with `INTEL_GMAIL_ROLLING=0` to disable independently.

Cost note, flagged rather than blocking: an unfiltered 12-week mailbox is far more threads than the marked
sweep, and each costs a model call for body extraction. Mitigations built in — the structural half (headers →
participants and correspondence edges) is free and runs for every thread; body extraction is budgeted per run
and skips threads whose content hash is unchanged. The header of `gmail-ingest.ts` argues against unfiltered
sweeps; John asked for all of it, so the argument is answered with a budget rather than a narrower query.

## Files to touch

**Backend / data (PR 1)**
- `src/lib/jkai/intel/gmail-ingest.ts` — rolling query, paged sweep, attachments, staleness at write
- `src/lib/jkai/intel/gmail-attachments.ts` *(new)* — part walking + `extractText`, pure-ish and testable
- `src/lib/jkai/intel/staleness.ts` *(new)* — `recencyWeight`, shared by ingest and the network route
- `src/lib/jkai/intel/engine.ts` — rolling sweep in the nightly pass
- `src/lib/jkai/intel/resolve/match.ts` — `same_email` + person-name signals, `properties` on the entity
- `src/lib/jkai/intel/resolve/merge.ts` — load `properties`; auto-merge entry point after ingest
- `src/routes/api/jkai/intel/gmail-ingest/+server.ts` — expose the rolling mode
- `src/routes/api/jkai/intel/duplicates/+server.ts` — bulk merge action
- tests alongside each

**Graph / UI (PR 2)**
- `src/lib/jkai/intel/analytics/load.ts` — `sources` + `lastSeenAt` on nodes and edges
- `src/lib/jkai/intel/analytics/model.ts` — types
- `src/lib/jkai/intel/analytics/filter.ts` — `sources` predicate
- `src/routes/api/jkai/intel/network/+server.ts` — `?sources=`, `recency` in the payload
- `src/lib/components/intel/NetworkGraph3D.svelte` *(new)*
- `src/lib/components/intel/SourcePicker.svelte` *(new)*
- `src/lib/components/intel/types.ts` — `sources`, `recency` on `NetNode`/`NetEdge`
- `src/routes/jkai/intel/+page.svelte` — source rail, 2D/3D toggle, confirm/reject wiring
- `src/routes/jkai/intel/quality/+page.svelte` — bulk review
- `src/routes/api/jkai/intel/commission/+server.ts` — `confirm_link`, `reject_link`, `&new=1`
- `src/lib/jkai/intel/analytics/insights.ts` — `missing_link` → `confirm_link`
- `src/lib/components/intel/InsightCard.svelte` — secondary reject action
- `src/lib/components/jkai/ChatArea.svelte` — honour `new=1`
- `package.json` — `d3-force-3d`

## Verification

- `npx vitest run tests/lib/jkai/intel` — unit tests for staleness, attachments, the new match signals, the
  paged sweep planner
- `npm run gate` — typecheck + lint + full suite (8 GB heap; never `source .env` first)
- `curl -s 'localhost:5173/api/jkai/intel/network?sources=email' | jq '.stats, (.nodes[0].sources)'` — sources
  filter narrows the graph and round-trips
- `curl -s -XPOST localhost:5173/api/jkai/intel/commission -d '{"kind":"confirm_link",…}'` then re-read the
  edge from the DB — the relationship exists, `manual = true`
- Gmail preview (`GET …/gmail-ingest?mode=rolling`) reports a 12-week thread count with no write
- Live: screenshot `/jkai/intel` on production showing the 3D graph and the source rail

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|---|
| 1 | Source filtering point | ingest-time exclusion vs read-time filter | read-time | matches categories; no re-extraction to undo a toggle | yes |
| 2 | 3D layout | hand-rolled force vs `d3-force-3d` | `d3-force-3d` | same API/author as incumbent d3-force; hand-rolling is the invention | yes (dep) |
| 3 | 3D default? | 2D default + opt-in vs 3D default | 3D default, toggle to 2D | it is what was asked for | yes (toggle persists) |
| 4 | "Confirm the link" | fix the deep link vs new commission kind | new `confirm_link` kind that writes an edge | the ask is that it *records* the relationship | yes (edge is manual, deletable) |
| 5 | Rejecting a predicted link | leave it vs `suppressed` | suppress with reason | otherwise the same pair returns every run | yes |
| 6 | Gmail breadth | keep marked-only vs rolling 12 weeks | rolling 12 weeks per the brief, with a per-run LLM budget | explicit ask; cost answered by budget + free structural pass | yes (query is a constant) |
| 7 | Auto-merge threshold | lower it to cut review burden vs add a precision signal | keep 0.85, add `same_email` | lowering the bar trades review burden for silent wrong merges | yes |
| 8 | Attachment scope | all types vs text-extractable only | extract what `$lib/jkai/extract` handles, name the rest | reuses the one extractor; no new parsing stack | yes |
| 9 | PR shape | one big PR vs sequential | two: data/backend then graph/UI | CI serialises gates+deploys; two keeps each reviewable | n/a |
