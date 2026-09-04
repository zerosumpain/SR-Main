# The Improvement Floor — P3, finding the themes in the queue

**Status:** built autonomously 2026-09-04, straight after P1+P2 (PR #681).
**Brief:** John — *"crack on with p3"*, where P3 was scoped in the P1/P2 spec as
*"auto-epic from `capabilitySlug` where it exists; otherwise cluster by title.
**Reuse `findRelatedIdea`.** New collection `improvement_epics`."*

## The measurement this answers

The queue board shipped with a number nobody had seen before: of production's
**407 open backlog items, 175 look like restatements of something that already
shipped** — 43% of the queue. The board could already fold restatements into
one and group by an `epicSlug`. What it could not do was **find** the groups. A
person scrolling 339 untried cards will not spot that rows 12, 88, 203 and 310
are one idea.

Run over the real 455 rows, the clusterer finds **113 themes covering 380 of
them**. The largest:

| theme | open ideas |
|---|---|
| "Live OpenRouter balance" | **10** ways of asking for one tool |
| Home Assistant entity/temperature discovery | 11, of which 10 already served |
| "Every lead about X has died barren" | 9 |
| Reliable workflow and service health | 9 |
| Delivery-status monitoring | 9 |
| Company Profile Lookup (Companies House) | 5 + 1 shipped |

Ten slots the engine would spend rebuilding one tool.

## The rule the whole thing is built under

**There is one definition of "related" in this engine and it lives in
`narrative.ts`.** A second matcher is the bug that left every driver unrecorded
for a fortnight, and the false-positive class that once had "Live OpenRouter
balance" served by `govuk_search` on the strength of "live" and "api". So:

- `looksAlreadyServed` was **renamed `looksSameSubject`** and now has three
  callers — the ledger, the board and the clusterer. They are one question with
  three sets of operands, so they get one predicate.
- `contentWords` (the tokeniser) and `subjectOverlap` (the strength behind the
  verdict) are exported. Neither is a second opinion: the index blocks on the
  same tokens the predicate counts, and the ranking uses the same arithmetic.
- `cluster.ts` is PURE. No database, no clock, no LLM. **Nothing in it writes a
  sentence**: a theme's label is the shortest member title verbatim, and its
  keywords are words the members actually share.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | How to cluster | (a) join every passing pair (single linkage), (b) join each item to its N strongest partners, (c) k-means/embeddings | **(b), N=1** | Measured, not chosen — see the table below. Single linkage chained **309 of 455 rows** into one component through a few generic bridging titles. Embeddings would be a second definition of "related" and an LLM bill for a job that takes 66ms. | Yes — `linksPerItem` is an option. |
| 2 | Rank ties by what | (a) alphabetical, (b) Jaccard tightness | **(b)** | A three-word title scores 1.00 against both its exact twin and a six-word title that merely contains it. Letting the alphabet break that tie is how a generic bridging title wins a link it has no business winning — caught by a unit test, not by inspection. | Yes. |
| 3 | Does accepting a theme fold its members? | (a) yes, (b) no — group only | **(b)** | "About the same subject" and "says the same thing" are two judgements. The first is one a matcher may make; the second **abandons rows**, and no matcher gets that authority here. Accepting writes `epicSlug` and the board's swimlanes light up; folding stays per-item, in the lane. | Yes — `ungroupEpic`. |
| 4 | When does it run | (a) nightly only, (b) on demand only, (c) both | **(c)** | 66ms of pure CPU over rows already read. Making the owner wait until tomorrow to see the duplicates would be a choice, not a constraint. Nightly it rides in the `gather` phase — no LLM, no budget. | Yes. |
| 5 | How many proposals a night | (a) all of them, (b) capped | **(b), six** | The first scan found 113 groupings at once. A room asking the owner to rule on 113 things is a room he closes. Six a night drains it in three weeks, and the button in the room offers the lot to anyone who wants them. The cap limits the ASKING, not the finding. | Yes. |
| 6 | Where the ledger lives | (a) a table, (b) datastore collection | **(b)** | `improvement_epics`, alongside the backlog it groups. No `drizzle push`, no rename prompt. | Yes. |
| 7 | Action kind for the nightly scan | (a) reuse `proposal`, (b) its own | **(b) `themes_found`** | A proposal is an idea for new work; this is an observation about work already queued. Folding it into the same counter inflates a number two dashboards print — the doctor's escalation kind exists for exactly this reason and a test caught it. | n/a |
| 8 | A declined theme | (a) may be re-proposed, (b) never | **(b), for that membership** | The rule `daydream_capabilities` was written under: the 19–29 Jul runs re-proposed "news digest" ten nights running because nothing recorded the no. A theme's slug is derived from its sorted members, so changed membership is a different claim and may be proposed again. | Yes. |

### Decision 1, measured over production's 455 rows

| links per item | clusters | grouped | biggest | runaway components |
|---|---|---|---|---|
| **1 (chosen)** | **113** | **380** | **9** | **none** |
| 2 | 30 | 223 | 24 | 4, up to 53 items |
| 3 | 19 | 109 | 20 | 2, one of 237 |
| every passing pair | 16 | 71 | 13 | 1 of 309 |

The cost of `1` is that a large theme can split into two tight sub-themes
rather than staying whole. That is the failure worth having: grouping too
little leaves two lanes to fold by hand; grouping wrongly would abandon the
wrong items on a matcher's say-so.

## Two filters, and only one of them is free

`looksSameSubject` needs **three** shared content words, which implies at least
one — so an inverted index over `contentWords` that only pairs items sharing a
word is a strict superset of what could pass. On production that cut 103,285
pairs to **14,641**, changing no verdict.

Skipping index keys carried by more than a third of the queue is **not** free,
and calling it an optimisation would be a lie: if two titles share exactly
three words and all three are queue-wide generic, the pair is dropped. That is
a deliberate second filter and it is wanted — but it is reported in
`skippedKeys` rather than buried. On production's queue it currently fires on
**nothing**; no word is that common.

## A bug worth recording

The first version keyed candidate pairs as `` `${a} ${b}` `` and split on the
space. A stray **NUL byte** got into that separator during editing, so every
title lookup missed and the clusterer returned zero groups — while
`pairsConsidered` and every count above it looked perfectly healthy. It also
made `grep` treat the file as binary, which is the same symptom
`reference_grep_binary_source_file` records for `workflowdoctor/run.ts`.

Pairs are held as tuples now. Nothing there needed a parseable key, so nothing
there has one.

## Files

- `src/lib/selfimprove/cluster.ts` + test — pure clustering, 21 tests.
- `src/lib/selfimprove/epics.ts` + test — the ledger and the decisions, 13 tests.
- `src/lib/selfimprove/narrative.ts` — `looksSameSubject`, `contentWords`,
  `subjectOverlap` exported; `overlap` gains `tightness`.
- `src/lib/selfimprove/types.ts` — `improvement_epics`, `EpicData`,
  `themes_found`, `MAX_THEME_PROPOSALS`.
- `src/lib/selfimprove/{run,seed-apis}.ts` — nightly scan, collection seed.
- `/api/daydream/thoughts` — `backlog_cluster`, `epic_decide`.
- `ThemeProposals.svelte` in the Improvement room, section **C2 / Themes**.
