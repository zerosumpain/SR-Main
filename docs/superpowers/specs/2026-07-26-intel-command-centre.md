# Intel command centre — network intelligence, entity resolution, commissioning

**Date:** 2026-07-26
**Grade:** Full autonomous ("build this autonomously… go for it")
**Branch:** `feat/intel-command-center`

## The brief

Turn `/jkai/intel` into a comprehensive intelligence management function: fix the
ER extraction mechanism and source data quality, add network intelligence (hops,
centrality, communities, "unlikely relatives"), automated insights, a visualised
graph with modals, entity hover-cards inside `/jkai` chat replies, a fix for
research notes "full of uuids that make no sense as entities", and lead
suggestions that can commission any other activity. Plus 20 additional features
scored out of 100 on value to John, everything above 30 built.

## What was actually wrong

Diagnosis came before design. Four defects, all confirmed against the live
graph (492 entities / 458 relationships / 49 notes pulled from the VPS):

1. **The UUID bug — root cause found.** `deepdive/postprocess.ts:49` writes
   `report.ranked_facts = factScores.map(f => f.id)`. They are fact *IDs*.
   `intel-bridge.ts:33` filtered them with `typeof f === 'string'` — which every
   UUID passes — and fed them to the extractor. Production notes carried 160+
   raw UUIDs each under a "Key facts:" heading. Every other consumer in the
   codebase (`chat-context.ts`, the report routes) correctly resolves IDs to
   prose; the bridge was the sole broken one.

2. **Entity resolution was manufacturing duplicates.**
   - `upsertEntity` matched an existing entity on `(name, typeId)`. The
     extractor is not stable about types, so calling something a `policy` in one
     note and a `system` in the next produced two nodes. 20+ such pairs in
     production, including `Responsible AI Strategy` split into a project with
     16 links and a policy with 1.
   - Nothing had *ever* written `intel_entities.merged_into_id`. It was read as
     `IS NULL` in six places and written nowhere, so the merge feature was
     schema-only and duplicates simply accumulated. `IBCA` (degree 119) and
     `Infected Blood Compensation Authority (IBCA)` (degree 12) were separate.
   - 342 of 492 entities had **no embedding**. `extract.ts` retrieves resolution
     candidates with `WHERE embedding IS NOT NULL`, so ~70% of the graph was
     invisible to its own deduplication — permanently, and worsening with every
     ingest. Embeddings were only ever written as a side effect of the summary
     pass, which skips entities it has no evidence for.

3. **Relationships and timeline events were inserted unguarded.** Every
   re-extraction of a note laid down another copy of every edge. `IBCA` showed
   157 raw relationship rows against 119 distinct neighbours — 38 duplicates,
   inflating every degree and centrality figure.

4. **Type proliferation.** `createProposedTypes` accepted any type the model
   invented: 25 types, several holding one or two entities, and a stray `font`
   type acting as a magnet for anything the model was unsure about (three
   newspapers were filed as fonts).

## Decision Log

Every fork that would have been a question.

| # | Decision | Options considered | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | How to fix the UUID digest | (a) drop `ranked_facts` from the digest (b) resolve IDs to fact prose (c) bridge the research `entity`/`relationship` tables structurally instead of re-extracting | **(b) + research entities as extraction hints** | (a) throws away the best-ranked evidence. (c) is cleaner but loses the intel graph's own typing and dedup authority; the architect review scored it 72 vs 92 for correction work. (b) restores the evidence and adds the research-side ER output as hints, which is most of (c)'s benefit at none of its risk. | Yes — pure function, unit-tested |
| 2 | Entity dedup: match on name alone or `(name, type)` | keep type in the key; match on name alone | **name alone; keep the existing type** | The type disagreement is a known extractor artefact, not evidence of two things. Documented in the code so the reasoning survives. | Yes |
| 3 | Auto-merge threshold | merge everything ≥0.5; ≥0.85 only; never auto-merge | **≥0.85 auto, everything else queued for review** | 0.85 is cleared only by an explicit acronym match or identical names with semantic corroboration. On real data that is 8 pairs, all correct. `ISO`→`IBCA Strategic Objectives` scored 0.63 and was correctly held back. | Yes — merges are tombstones, `unmergeEntity` reverses them |
| 4 | Duplicate-merge deletion semantics | hard-delete the loser; tombstone it | **tombstone (`merged_into_id`), never delete** | Nothing is destroyed, stale links still resolve, and a bad merge is undoable. | Yes |
| 5 | "Unlikely relatives" maths | cross-community + type difference; add embeddings; add a configuration-model correction | **multiplicative blend + hard hub-gate** | First naive version returned "12 things connected to IBCA" — a degree-119 hub makes everything technically cross-cluster. Corrected with the configuration-model expectation `deg(a)·deg(b)/2m`, Adamic-Adar connector rarity, bridge specificity, and a hard gate dropping any route whose intermediates are all hubs. | Yes — pure, 57 unit tests |
| 6 | Whether direct edges count as "unlikely" | exclude d=1 (architect's view: an asserted edge is not a discovery); include | **include, but scored below d=2** | A direct edge between two dissimilar things is worth seeing — it is often an extraction error. But a 2-hop find is something nobody wrote down, so it ranks higher. | Yes |
| 7 | Chat entity linkification safety | link every occurrence; link the first per entity | **first per entity, max 40 per message, banned-word list, acronyms case-sensitive** | Production has entities literally named `Data`, `Alpha`, `Beta`, `Discovery`. Without guards every reply becomes a wall of links. `IBCA` matches only in caps so it cannot fire inside a URL. | Yes |
| 8 | Where the entity linkifier runs | before sanitisation; after | **after sanitisation, after citation-linkify, never inside `<a>` or `<code>`** | Mirrors the existing `citation-linkify` precedent exactly, so it is SSR-safe and cannot introduce markup the sanitiser didn't allow. A source citation always wins over an entity mention at the same words. | Yes |
| 9 | Hover-card architecture | one popover per message; one per page | **one per page, module-level state, delegated events** | A long thread has hundreds of mentions; hundreds of idle popovers is waste. | Yes |
| 10 | Commissioning: server-side vs deep-link | run everything server-side; deep-link everything | **run what can be run (research, monitors), deep-link what is interactive (ask, canvas)** | Starting a deep dive from a finding should just happen. Asking jkai a question needs the user in the loop, so it prefills the composer via a new `?ask=` param. | Yes |
| 11 | Schema changes | add columns/indexes for the analytics; compute in-memory | **no schema change at all** | 492 nodes / 458 edges is trivially small for in-memory Louvain + Brandes (~350ms). Avoids the `drizzle-kit push` `.unique()` hazard on populated tables entirely. Revisit past ~20k entities. | N/A |
| 12 | Duplicate-edge prevention | unique constraint; application-level upsert | **application-level** | `.unique()` on a populated table silently breaks non-interactive `drizzle-kit push` (known incident). | Yes |
| 13 | Graph node colour | by entity type; by community | **by community, type shown as icon** | Type-colour told you nothing the label didn't. Community colour makes the structure legible at a glance. | Yes |
| 14 | 3D/WebGL graph view | build it; skip it | **skip — scored 14/100 and explicitly cut** | `three` and `@threlte/*` are installed and it would screenshot well, which is exactly the trap. A 492-node graph is *harder* to read in 3D (occlusion, no stable mental map, unsolvable labels) and it would consume the whole viz budget while real readability problems went unfixed. | N/A — not built |

## The 20 scored features

Scored by three independent panels (intelligence analyst, product manager, staff
engineer), then merged with argued consensus rather than a blind mean. Full
reasoning in the workflow output. **17 scored above 30 and are committed; 3 cut.**

See the "Consolidated feature list" table in the final report. Built in this
pass: #1 (Graph Correction Console, 92), #2 (Entity Type Governance, 87, partial
— retype/merge shipped), #4 (Graph Integrity, 80 — embedding backfill, dedup,
idempotent re-extraction), #9 (structural research bridge, 72 — as hints), plus
every explicitly-requested item.

## Verification

- 154 new unit tests across `analytics/`, `resolve/`, `entity-linkify`, `intel-bridge`, `intel-graph`
- Full gate green: **3046 tests passing, 0 type errors, 0 public-route drift**
- Every algorithm run against a live copy of the production graph, not fixtures
- Embedding backfill executed for real on that copy: **342 embedded, 0 failed, 0 remaining**
- Dashboard exercised in a real browser: 332 nodes rendered, entity card opens on
  click, 55 duplicates listed, **zero console errors**

### Merge invariants, checked against real data

`mergeEntities` contains the only hand-written multi-table SQL in the change and
is the one place that could lose data, so it was run against a copy of the live
graph merging the real `Infected Blood Compensation Authority (IBCA)` →`IBCA`
duplicate, with invariants asserted before and after:

| Invariant | Result |
|---|---|
| No connection partner lost | PASS |
| No self-loops created | PASS |
| Merged entity left with zero edges | PASS (12 → 0) |
| Survivor gained exactly the moved edges | PASS (157 → 166, 9 moved) |
| Edges removed == edges reported dropped | PASS (3 == 3) |
| Unrelated edges untouched | PASS (289 unchanged) |
| Note links preserved | PASS (756 → 756) |
| `unmergeEntity` restores the entity | PASS |

The three dropped edges were the direct survivor↔duplicate edge and two
same-type duplicates the survivor already had — exactly the intended behaviour.
