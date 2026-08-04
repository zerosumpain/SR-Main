# Intel entity resolution — moving matching off the LLM

Autonomous run, 2026-08-04. Steps 1–3 shipped interactively (PRs #101–#103);
this spec covers 3.5–7, run end to end.

## Where this started

The LLM does two jobs in intel ingestion: it finds entities in prose, and it
offers a `possibleMatchId` saying which existing entity a mention is. Only the
second is replaceable by an algorithm, and the algorithm already exists —
`resolve/match.ts` — it was simply not good enough to trust.

Measured over a snapshot of production: **561 duplicate candidates, zero above
the 0.85 auto-merge bar, 396 of them at exactly 0.55**. An unblocked all-pairs
scan finds the same 561, so nothing was being missed. The defect was
discrimination, not recall.

Three repairs shipped before this run: a guard against notification addresses
proving identity (#101, 43 merges reversed), a canonical-name signal for names
that differ only in packaging (#102, 0 → 22 auto-mergeable), and a tightened
acronym rule (#103, 28 merges reversed, 1,447 links restored).

## Steps in this run

| # | Change | Why now |
|---|---|---|
| 3.5 | Graduated email trust | `ea@e.ea.com` has two identities, below the shared-sender threshold, and is proposing `EdTech Architect` → `EA` today |
| 4 | Shared-neighbour signal | The only evidence that separates true from false where names and embeddings both fail |
| 5 | Clustering + nightly automation | Nothing runs the resolver unless a human clicks; merging is single-linkage and chains |
| 6 | Calibration from labelled merges | The scores are hand-picked constants; ~250 confirmed merges can price them |
| 7 | Write-time resolution | Where the LLM finally stops being asked to match |

## Decision Log

**D1 — Graduated trust rather than a lower threshold.** Options: (a) drop the
shared-sender threshold from three identities to two; (b) graduate it — one
identity is proof, two needs the names to corroborate, three or more proves
nothing; (c) keep a deny-list of known senders. Chose (b). (a) breaks the
owner's own address, which carries two identity groups that are variants of
each other; (c) needs maintaining forever. Reversible: threshold constants.

**D2 — Shared neighbours corroborate, they do not accuse.** Options: (a) let
neighbour overlap create candidates on its own; (b) use it only to strengthen or
rescue a pair some name rule already proposed. Chose (b). The graph averages
~2 edges per entity, so overlap is sparse and high-precision but far too thin to
carry a match alone. It also overrides the low-similarity penalty, which was
burying true duplicates like `Card ending 6878` / `Card *6878` (0.53 cosine,
4 shared neighbours). Reversible: one scoring branch.

**D3 — Anti-chaining by clique check, not correlation clustering.** Options:
(a) full correlation clustering; (b) connected components; (c) refuse any merge
that would put two entities together that are not themselves a candidate pair.
Chose (c). (b) is what the greedy loop already effectively does and is exactly
the chaining fault. (a) is a large piece of machinery for a graph with tens of
candidate pairs. Reversible: the guard can be dropped.

**D4 — Nightly auto-merge is ON, capped, and logged.** Options: (a) detect and
report only; (b) merge automatically above the bar. Chose (b) with a cap of 25
per night, every merge written to the run log, kill switch
`INTEL_AUTO_RESOLVE=0`. The brief is explicitly to lean on fast non-LLM
resolution; a resolver that only runs when someone remembers to click is the
status quo that let 41 people fuse into one entity unnoticed. Reversible: every
merge replays through `unmergeEntity`.

**D5 — Calibration in TypeScript, not Splink.** Options: (a) Splink in the
`jkai-sandbox` container (it has Python 3.12, pip and network); (b) a
Fellegi–Sunter calculation in the repo. Chose (b). The nightly path runs in the
Node app on the VPS, which has no `src/lib/jkai` and no Python step; adding a
sidecar to serve ~250 labelled pairs is disproportionate. The statistics are
arithmetic. Splink remains the right tool if this ever needs modelling at scale.

**D6 — Calibration reports; it does not silently retune.** The labelled set is
small and its negatives are sampled. The calibrator prints observed rates per
signal against confirmed merges and against random pairs, and the constants move
only where the evidence is unambiguous. Blindly fitting 0.93 to a number
computed from 250 rows would be false precision.

**D7 — A stored `canonical_name` column for write-time resolution.** Options:
(a) compute candidates per insert by querying on tokens; (b) store the canonical
form and index it. Chose (b): one indexed lookup instead of a scan, and the
column is derivable, so a bad backfill is fixable by recomputing. Additive
nullable column, safe for non-interactive `drizzle-kit push`.

**D8 — The LLM keeps `possibleMatchId`.** Deterministic resolution runs first
and wins; the model's suggestion becomes the fallback rather than the primary.
Removing it entirely would lose the one case an algorithm cannot reach — a
mention whose surface form shares nothing with the entity's name.

## Verification

Each step: unit tests, `gate:check`, full intel suite, a dry run against a
production snapshot, then deploy and re-measure on the live graph. No step is
"done" until the deployed SHA is confirmed on the VPS.
