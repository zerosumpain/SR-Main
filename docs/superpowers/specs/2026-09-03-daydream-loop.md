# Daydream, the loop — P5 of the 2026-09-02 overhaul

Autonomous build. Brief: John's ask (4) — "it's not clear how daydreaming
benefits self improvement and vice versa. self improvement could/should think
about new intelligence sources that could benefit daydreaming and build
them." Items 4.1–4.5.

## What was measured (2026-09-02)

Two edges ran from daydream into self-improve (starvation, health faults) and
starvation returned nothing for the owner by its own comment. One edge ran
back (tool signals). Not fed back: unknown-metric rejections, retrieval
failures, ponder audit drops, barren leads, failed lookups, barren tool
harvests, silent sources. The Improvement room showed tools shipped versus
called and stopped.

## Design

### 4.1 The fault ledger

`daydream_faults` (drizzle table — the loop room aggregates over it and it
joins to signals, leads and thoughts, which are tables): `kind`,
`identifier`, `wants`, `site`, `detail`, `subject`, `count`,
`first_seen_at`, `last_seen_at`, `status` (open / closed / declined),
`closed_by`, `closed_at`; unique on `(kind, identifier)` so a re-raise
updates one row. `faults.ts`: `raiseFault` (soft — a ledger that cannot be
written must not cost the tick), `openFaults`, `closeFault`, `faultCounts`.

Written at: unknown-metric rejections (proposer and ponder leads →
`wants: numeric_tool`), `needs_source` verdicts (→ `reader_tool`, keyed on
the evidence kinds cited), leads abandoned barren (→ `more_days`), failed
pack lookups (→ `reader_tool`), failed and barren tool harvests (→ `repair`
/ `decline`), silent sources and source errors in `daydream-signals` (→
`connector`).

Self-improve's `learnInsights` reads the open build-shaped faults FIRST
(`numeric_tool`, `reader_tool`, `connector`), ahead of health faults,
starvation and question-mining; each idea's detail carries the shape the
toolsmith must satisfy in plain words.

### 4.2 Source discovery

`discoverApis(insights, budget, extraNeeds)` takes the open connector and
numeric-tool faults as needs beside `topUnmet`, so a missing source is
searched for in the catalogue, then the web, then registered — before the
build phase that night.

### 4.3 The return edge

`closeFaultsForSignals()` in `daydream-signals`: a tool signal that has
become sweepable closes any open `metric_unknown` fault whose identifier the
signal's key or label carries, with `closed_by = <signal key>`. Ponder cards
new sweepable tool signals (`newSourceCards`) so the pack knows a facet
exists.

### 4.4 Engine proposals

`engine-proposals.ts` (deterministic): detectors silent 30 days, kinds with
a useful rate under 0.3 over ≥ 5 votes, metrics shared by ≥ 2 abandoned
leads, a reviewer uncertain rate over 40% in 30 days (`needs_source`
excluded). Each is a backlog item of kind `engine` — proposal-only: the
toolsmith never picks that kind and no PR is opened; they are visible on the
ledger.

### 4.5 The loop room

`loadLoopHealth` gains faults (open / closed), backlog (open, engine),
findings (7 days) and thoughts (7 days). The Improvement room opens on six
even cells: faults raised → ideas → tools built → signals → findings →
thoughts.

## Verification

- Unit: fault-key parsing from rejection strings, `wantsFor`, the engine
  proposal thresholds on fixtures.
- porkserv gate with build; five lint gates.
- Live: after deploy the next hypothesise / review / explore ticks write
  faults; the next `daydream-improve` run's backlog carries fault-derived
  ideas first; the loop room's six cells are non-zero where the data is.

## Decision Log

| # | fork | chosen | why | reversible |
|---|---|---|---|---|
| 1 | datastore collection vs table | table | aggregates and joins; the backlog's own paging pathology | yes |
| 2 | fault per thought vs per evidence kind for `needs_source` | per evidence kind | a fault is a missing capability, not a missing row | yes |
| 3 | `engine` as a fourth backlog kind vs a title prefix | fourth kind | `pickWork` filters by kind, which is what makes proposal-only mechanical | yes |
| 4 | return-edge matching | substring of identifier in key or label | no shared id exists between a metric name and a tool; a fuzzy close that can be reopened by the next re-raise is cheaper than a wrong link that cannot | yes |
