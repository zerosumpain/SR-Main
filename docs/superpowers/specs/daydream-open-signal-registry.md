# Daydream: an open signal registry

**Status:** in build, 2026-08-27
**Brief (John, 2026-08-27):** "pondering / daydreaming should not limit itself to a
subset of attributes and should do so across every attribute or artefact it can
possibly find, including API connections or capabilities that might be built in
the future, or as a product of jkai self improvement loops." Plus: weather at the
**person's location**, indoor temperature, and the Tado heating once repaired.

## The problem, measured

Home Assistant exposes **415 entities** carrying **427 numeric attributes across
263 entities**. Daydream reads **five** of them — the `person.*` trackers — and
nothing else in the house reaches the feature store.

The feature store itself is a **wide table of 28 hand-written columns**. Every new
signal is a schema change, a `features/build.ts` edit and a sweep change, so the
set of things daydream can notice is fixed at the moment someone last edited that
file. That is the ceiling the brief is aimed at.

Two illustrations that are live right now:

- `sensor.john_s_echo_temperature` reads **21.8 °C**. Indoor temperature has been
  available all along and nothing has ever looked at it.
- `climate.downstairs_hallway` — the Tado — is `unavailable` with
  `restored: true`, and its `binary_sensor.downstairs_hallway_*` family
  (`early_start`, `overlay`, `power`, `window`) with it. When John repairs it,
  **nothing should have to be written** for daydream to start pondering it.

## Design

**A signal is a registered, named, unit-carrying series. Discovery registers;
nothing hand-writes.**

`daydream_signals` — one row per discovered series. Namespaced key
(`ha:sensor.john_s_echo_temperature`, `ha:weather.forecast_home#humidity`,
`weather:temperature_2m`, `journey:minutes_moving`, `health:hrv_ms`), plus label,
unit, value kind, source, first/last seen, observation count and a status.

`daydream_observations` — long and narrow: `(day, subject, signal_key) → value`.
One row per signal per day per subject, unique on that triple. Nullable by
absence, never by zero — the existing feature-store rule, carried over.

**Why not the existing wide table**: it cannot self-extend without a migration per
signal, which is the exact ceiling being removed. **Why not the datastore**
(the house pattern for engine state): the sweep correlates arbitrary pairs across
every signal and needs an indexed numeric column, not jsonb. Prod and `schema.ts`
were verified identical (144 tables each, no pending drops), so a push is safe —
the "drizzle push is unsafe" note from the P1b work is stale.

The wide `daydream_day_features` table **stays**. It is described in its own
comment as "a cache with opinions, not a record", and every existing sweep,
hypothesis and card reads it. Its columns are mirrored into the observation store
as registered signals, so there is one place to correlate from and no flag day.

### Discovery

A `daydream-discover` heartbeat action, hourly, modelled on
`heartbeat/auto-register.ts` — enumerate, register what is new, leave the rest
alone:

1. **HA**: one `/api/states` call. Register every entity whose state parses as a
   number or a boolean, and every numeric attribute of every entity. An entity
   that is `unavailable` registers nothing and is not an error — that is the Tado
   today, and it starts producing the day it is fixed.
2. **Internal**: the feature-store columns, journey features, weather.
3. **Future sources** register themselves by calling the same `registerSignal()`.
   That is the extension point the brief asks for: a connector or a
   self-improvement-built tool declares a signal and it is swept from then on,
   with no edit here.

### What a signal is allowed to reach

**The rules allow-list is NOT widened.** `rules/spec.ts` keeps its closed 24-fact
vocabulary, because a rule fires a notification and its facts are a security
boundary — the existing comment ("widening `FACT_KEYS` is a security decision")
stands. Signals feed **statistics and ponder**, which read and describe and
cannot act. Promoting a signal to a rule fact stays a deliberate, separate act.

### Sweep

`stats/` stops reading a hard-coded column list and reads the registry, gated on
the existing bars: numeric, `MIN_PAIRS` = 14 non-null overlapping days, and
Benjamini–Hochberg over the whole family. **The family grows with the registry,
so the correction gets stricter as more signals arrive** — which is correct, and
is the reason a coverage gate matters more than it did at 28 columns.

## Weather — at the person, not the house

HA has `weather.forecast_home` (met.no, home coordinates). **Not used as the
signal**: the brief is explicit that weather should be where the person is, and
half the interesting days are the ones spent somewhere else.

Open-Meteo instead — free, no key, already a trusted host in the `/api/jkai/cors`
allowlist. Keyed on each subject's **daily median trail position**, falling back
to home when a day has no usable fix. Its historical archive backfills, so
weather↔health starts against the 245 days of health already stored rather than
waiting a year.

## Phases

- **A** — `placesVisited` counts fixes, not visits (245 recorded on a day with 2
  distinct places); ask threshold moves to distinct days, not person-visits.
- **B** — the registry, the observation store, HA discovery, mirroring, sweep.
- **C** — weather at the person's location, with backfill.
- **D** — journeys as a first-class object; ponder reads the registry.

## Decision Log

| # | Decision | Options considered | Why | Reversible? |
|---|---|---|---|---|
| D1 | Narrow `daydream_observations` + `daydream_signals` registry | wide-table columns; datastore jsonb | only shape that self-extends AND indexes for pairwise correlation | yes — derived, rebuildable; day_features untouched |
| D2 | Register numeric states, booleans **and numeric attributes** | states only | the brief says attributes; indoor temp and the whole Tado family are attributes | yes — per-signal status |
| D3 | Open-Meteo at the person's median daily position | HA `weather.forecast_home`; home-only | brief is explicit; home-only misses every day out | yes — signals can be retired |
| D4 | Rules `FACT_KEYS` stays closed | auto-promote every signal | a rule buzzes a phone; the existing security boundary is deliberate | n/a — nothing widened |
| D5 | Keep `daydream_day_features`, mirror it in | migrate and drop it | everything reads it; no flag day | yes |
| D6 | Coverage gate per signal before it enters the sweep | sweep everything | 400+ signals × BH correction would bury real findings | yes — threshold is a constant |
