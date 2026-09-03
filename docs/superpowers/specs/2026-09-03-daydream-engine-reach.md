# Daydream engine reach — P4 of the 2026-09-02 overhaul

Autonomous build. Brief: John's ask (3) — "the engine needs to be fully
connected to every facet of intelligence… allow me to tailor how much time
is spent on identifying new correlates, testing them, and proposing them".
Items 3.1–3.6; decisions D3(a), D4(a), D5(a) as recommended.

## What was measured (2026-09-02)

- Twenty-three activities and no dial: `DEPTH_PLANS` governed composition
  only; the discover/test/propose caps were constants in six files.
- Sweep findings lived on the pulse and reached nothing.
- Hypotheses could name only the 22 day-feature columns; 277 registered
  signals were sweepable but never askable.
- Not read: the health hub's derived layer, trail segment forms, research
  facts, timeline density. Steer had 0 rows ever.

## Design

### 3.1 The effort dial

`effort.ts` (pure): three shares 0..100, `resolveEffort` → per-activity
numbers, `applyEffort(explicit, fromEffort)` where an explicit heartbeat-row
config key still wins. At 50/50/50 every number is what shipped. Setting
`daydream.effort` (`effort.server.ts`), API `effort` / `set_effort`, three
sliders on the Engine room with the resolved numbers beside them. Threaded
caps: ponder's parser and prompt take `caps`; `runSweep` takes `maxSignals`;
`runExplorationRound`'s hard clamp rises to `HARD_MAX_LEADS_PER_RUN = 8`;
review, hypothesise and compose read their values through `applyEffort`.
Spend stays under the Codex caps — the dial decides what the allowance is
spent on.

### 3.2 Persisted sweep findings

`daydream_sweep_findings` (subject, day, a, b, labels, lag, r, p, q, n;
unique on subject/day/a/b/lag). `daydream-sweep` upserts every surviving
finding; `ponder` cards the strongest recent ones (`sweepCards`). The
hypothesis proposer is deliberately NOT shown them — its pre-registration is
what makes q meaningful. Discoveries keeps reading the pulse for now.

### 3.3 Askable signals

`validateHypothesis(raw, allowed)` takes the allow-list in; the proposer's
menu adds every sweepable signal (top 40 by observed days, with label and
days) and passes `SWEEP_METRICS ∪ signal keys`. `test.ts` / `detail.ts`
resolve a key containing `:` from `daydream_observations` (subject or
household) aligned to the feature-store days. `FACT_KEYS` for rules stays
untouched — that is the security boundary; this is not.

### 3.4 New facets, as signals

`signals/research.ts` (sessions started, facts discovered, mean confidence,
narrative items, timeline events dated per day), `signals/segments.ts`
(segment forms improving / holding / slipping, sampled once a day),
`signals/health-derived.ts` (tripwires tripped and close, moves, experiments
live, verdict instruments green, forecast direction — once a day, through a
new `$lib/health/derived.server.ts` that assembles the same instrument inputs
the /health route does). Each is one block in `daydream-signals`; a registered
signal joins the sweep at `MIN_PAIRS` days like every other.

### 3.5 Steer into the notebook

A steer is a notebook note tagged `steer`. `add_steer` writes one;
`listSteers` reads them; `activeSteers` in the proposer reads them; the
`daydream_steers` table is left in place, unread. One owner-input mechanism.

### 3.6 Spend view

Deferred: `/jkai/improvement` already shows the toolsmith's cash spend; a
duplicate cell on the Engine room is a tidy for later.

## Verification

- Unit: `resolveEffort` at 50 reproduces the shipped numbers; `applyEffort`
  precedence; `validateHypothesis` with a signal key in the allow-list.
- porkserv gate with build; five lint gates.
- Live: the next `daydream-sweep` pulse writes rows into the findings table;
  the next `daydream-signals` pulse reports the three new sources; the engine
  room shows the dial and the pulse summaries quote the resolved numbers.

## Decision Log

| # | fork | chosen | why | reversible |
|---|---|---|---|---|
| 1 | three independent shares vs shares that sum to 100 | independent | three sliders that fight each other are a puzzle; the caps in `budget.ts` bound spend regardless | yes |
| 2 | explicit heartbeat config vs the dial | explicit wins | a value typed on the row is a decision | yes |
| 3 | show sweep findings to the hypothesis proposer | no | pre-registration; the proposer must not be led | yes |
| 4 | refactor the /health route to share its assembly vs a parallel assembly | parallel, in `$lib/health/derived.server.ts` | the route was rebuilt twice this week; the registrar samples once a day and can drift a little without harm | yes, the route can adopt it later |
| 5 | steer table vs notebook | notebook, table left | one input; nothing deleted | yes |
| 6 | spend view | deferred | already visible on /jkai/improvement | yes |
