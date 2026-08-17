# /trails — running & route programme

**Date:** 2026-08-17
**Status:** Phase 1 specified, phases 2–3 outlined
**Grade:** autonomous (full) — design approved by John, "crack on"

## Problem

Two gaps, one surface.

**Receipt and visualisation.** `/api/health/apple/ingest` accepts only Health Auto Export's
`data.metrics` — daily aggregates. There is no workout record, no GPS trace, no per-workout
heart-rate series. Route geometry has only ever arrived as Strava summary polylines, and Strava
is dormant. So the richest artefacts Apple Health produces — the run itself — are invisible.

**Route planning.** The existing "outdoor route builder" is the `route_export` site-tool, whose
description instructs the model to "generate snapped OSM geometry" by hand. An LLM writing
coordinates is guesswork: it cannot know surface, gradient, or whether a lane is a dead end.
The result is the artefact John named — routes that pad distance by running down a lane and
turning back.

## Approach

One owner-gated route family, `/trails`, in `strange_rambling_svelte`. Built in three phases,
each shippable alone.

| Phase | Delivers | Depends on |
|---|---|---|
| 1. Spine | Workout ingest, tables, `/trails` list + detail | — |
| 2. Planner | ORS candidates + our loop-quality scorer, `/trails/plan` | 1 (health fit reads activities) |
| 3. Field kit | Port JKAImaps: offline tiles, recording, waypoints | 1 |

Why this repo and not a new one: `hooks.server.ts` gates every non-public path to the owner
already (`PUBLIC_PATHS = ['/health', '/tools']`), the Postgres/Drizzle DB is here, the twelve
`/health` analytics services the planner needs are here, and merging to `master` deploys. A
standalone app re-solves all four before writing a line of route code.

---

# Phase 1 — the activity spine

## Data model

Three new tables in `src/lib/db/schema.ts`.

**`activities`** — one row per workout, source-agnostic.

```
id                text pk          -- `${source}:${externalId}`
source            text notnull     -- 'apple' | 'strava' | 'whoop' | 'manual'
externalId        text
name              text notnull
activityType      text notnull     -- normalised: run | trail_run | ride | mtb | walk | hike | other
rawType           text             -- the source's own label, verbatim
startDate         integer notnull  -- unix seconds
endDate           integer notnull
startDateLocal    text notnull     -- ISO string for display
timezone          text
distanceM         double
durationS         integer notnull
activeDurationS   integer
elevationGainM    double
elevationLossM    double
avgHeartrate      integer
maxHeartrate      integer
activeEnergyKj    double
totalEnergyKj     double
avgPaceSPerKm     double
avgCadence        double
hasTrack          boolean notnull default false
metadata          jsonb            -- everything HAE sent that we don't model
syncedAt          integer default now
```

Unique index on `(source, externalId)`.

**`activity_tracks`** — the geometry, one row per activity.

```
id           serial pk
activityId   text notnull references activities.id on delete cascade
coordinates  jsonb notnull   -- [[lng, lat, ele|null, tOffsetS], ...]
pointCount   integer notnull
bounds       jsonb notnull   -- { n, s, e, w }
polyline     text            -- encoded, for cheap list rendering
distanceM    double
```

**`activity_series`** — one row per metric per activity, samples inline.

```
id           serial pk
activityId   text notnull references activities.id on delete cascade
metric       text notnull    -- heart_rate | speed | cadence | altitude | power
units        text notnull
sampleCount  integer notnull
samples      jsonb notnull   -- [[tOffsetS, value], ...]
```

Unique index on `(activityId, metric)`.

### Units: real units, no scaling

`apple_health_metrics` stores `value * 100` in an integer column. That convention has already
produced one class of bug in this codebase — values wrong by 100× on steps and strain, which
looked like display bugs and were not. **The new tables use `doublePrecision` and store SI units
verbatim**: metres, seconds, kilojoules, bpm. No multiplier anywhere. Any reader that wants
miles or pace converts at the edge.

### Why samples are jsonb, not rows

A one-hour run at 1 Hz is 3,600 heart-rate samples. Row-per-sample makes a 40-run history a
150,000-row table that is only ever read whole, per activity. One jsonb array per metric reads
in a single round trip and indexes on nothing we don't need.

## Ingest

Extend `src/routes/api/health/apple/ingest/+server.ts` to handle `data.workouts` alongside the
existing `data.metrics` loop, keeping that loop untouched.

Health Auto Export v2 sends, per workout: `name`, `start`, `end`, `distance`, `activeEnergy`,
`totalEnergy`, `elevationUp`, plus `heartRateData: [{date, qty, units}]` and
`route: [{lat, lon, altitude, timestamp}]`.

Mapping rules:

- **Identity.** `externalId` = HAE's workout `id` if present, else a deterministic hash of
  `(name, start, end)`. Re-posting the same workout updates in place; it never duplicates.
- **Type normalisation.** A lookup table maps Apple's workout names to our `activityType`.
  Unknown names store `activityType = 'other'` and keep `rawType` — never dropped, never guessed.
- **Time offsets.** Series and track timestamps are stored as **seconds from workout start**,
  not absolute. Keeps the payload small and makes chart maths trivial.
- **Per-workout isolation.** Each workout is wrapped in its own try/catch and contributes to the
  `errors[]` array, exactly as the existing metric loop does. One malformed workout must never
  drop a batch.
- **Missing route.** Indoor workouts have no `route`. `hasTrack` stays false; no track row.

### Payload size

HAE's own docs warn route-bearing exports reach hundreds of megabytes. Three mitigations:

1. `BODY_SIZE_LIMIT` set explicitly for adapter-node (default is 512 KB — every routed workout
   would 413 today).
2. The endpoint accepts a single workout per request, so the phone automation can be configured
   to post one at a time.
3. Track coordinates are decimated on write: consecutive points closer than 3 m are dropped.
   A 10 km run lands around 1,500 points rather than 6,000+ with no visible loss of shape.

## Surfaces

**`/trails`** — the activity list. Filter by type and date range. Each row: name, date, distance,
duration, pace, elevation, HR, and a sparkline of the track shape rendered from the encoded
polyline (no map instance per row).

**`/trails/[id]`** — one activity. Leaflet map with the trace (Leaflet is already vendored at
`static/vendor/`, loaded the way `MapArtifact.svelte` does it), elevation profile, splits table,
heart-rate against distance, and pace as a colour ramp on the trace.

Styling comes from `src/lib/styles/nm-tokens.css` and the Instrument surface ladder; charts
follow the `dataviz` skill. No new fonts, no new colour system.

## Errors

The `/health` `safe()` wrapper is the precedent: each panel resolves to null on failure and the
page renders without it. A missing series must never blank an activity.

## Tests

Vitest, colocated `*.test.ts` as the repo does.

- `hae-workouts.test.ts` — a real HAE workout fixture in, expected rows out. Covers: route
  present, route absent, unknown workout type, malformed workout inside a good batch, re-post
  idempotency.
- `track.test.ts` — decimation preserves endpoints and stays within tolerance of true length;
  bounds are correct; polyline round-trips through the existing `decodePolyline`.
- `activity-stats.test.ts` — pace, splits, elevation gain from a known synthetic track.

## Verification

```bash
# ingest
curl -sX POST localhost:5173/api/health/apple/ingest \
  -H "x-api-key: $APPLE_HEALTH_API_KEY" -H 'content-type: application/json' \
  --data @src/lib/trails/fixtures/hae-workout.json
# expect { workoutsSynced: 1 }

psql -c "select id, activity_type, distance_m, has_track from activities"
psql -c "select activity_id, point_count from activity_tracks"

# surfaces
curl -s localhost:5173/trails | grep -c 'data-activity-row'
```
Then a screenshot of `/trails` and `/trails/[id]`.

---

# Phase 2 — the planner (outline)

`/trails/plan`. ORS generates candidates; **the ranking is ours**, and it is the point.

- **Candidates.** N `round_trip` calls with different seeds for loops; `alternative_routes` for
  point-to-point. ORS free tier is 2,500/day and caps round-trips at 100 km — validated before
  the call, and candidates cached in Postgres on `(start, distance, profile, seed)` so a 429
  degrades to cached results instead of a blank page.
- **Overlap ratio.** Snap geometry to a grid; count edges traversed more than once.
- **Spur detection.** Find subpaths that enter and leave by the same node where the reversal
  point is a dead end or the stub is under a threshold share of total length. This is the
  "down a lane and back" artefact, and it is what stock `round_trip` produces most.
- **Terrain fit.** Score `extras.surface`, `extras.waytype`, `extras.steepness` against the
  profile — MTB wants unpaved, road wants sealed, running wants a mix.
- **Profile fit.** Elevation gain per km against target *and* gradient distribution, so one
  brutal wall loses to a steady climb when the ask was steady.
- **Health fit.** Readiness, ACWR training load and monotony from the existing `/health`
  services set the target distance and elevation band, and supply the reasoning shown to the user.

Returns the **top 3 with scores visible**. An "allow out-and-back" toggle covers the case where
John does want a spur.

Ships GPX through the existing `createRouteExport` in `src/lib/route-exports.ts` — not a new
export path — and replaces the `route_export` tool's hand-written-geometry instruction with a
`route_plan` tool that calls the real planner.

**Blocked on:** `ORS_API_KEY`. Free key from openrouteservice.org; cannot be self-issued.

# Phase 3 — field kit (outline)

Port from `~/offline-maps/` (6,366 lines, much of it directly reusable): `lib/geo/*`,
`lib/nav/*` (compass, naismith, off-route, progress), `lib/recording/*` (tracker, splits,
pace-heatmap, gpx-export, wakelock, battery), `lib/map/*` (OfflineTileLayer, tile-math,
download), and the Map / ElevationChart / SplitsTable / RouteCard components.

Tiles stay in IndexedDB — that code works. Routes and recordings move to Postgres so the
planner and `/health` can see them. The service worker registers at root scope, so tile caching
survives even though the PWA manifest is scoped to `/jkai/`.

`maps.strangeramblings.com` keeps serving JKAImaps until parity, then redirects.

---

# Decision Log

| # | Fork | Chosen | Why | Reversible? |
|---|---|---|---|---|
| 1 | Repo home | Section in `strange_rambling_svelte` | Auth gate, DB, `/health` services and CI deploy all already exist | Yes — code is modular |
| 2 | Ingest path | Extend HAE webhook only | John's answer. Consequence: **no history before switch-on** — HAE cannot push retroactively | Yes — upload page is additive |
| 3 | Routing engine | ORS hosted free tier | Free, native `round_trip`, terrain extras feed the visualisation, Docker-self-hostable later | Yes — client is one module |
| 4 | Visibility | Owner-gated | Default in `hooks.server.ts`; home location needs no fuzzing | Yes |
| 5 | Storage units | Real SI units in `doublePrecision` | The `*100` integer convention already caused 100×-wrong health values | Hard — would need a migration |
| 6 | Series storage | jsonb array per metric | Row-per-sample is 150k rows read only ever whole | Hard — migration |
| 7 | Track fidelity | Decimate at 3 m on write | ~4× smaller, no visible shape loss | No — lossy, but raw stays in `metadata` if ever needed |
| 8 | Existing activity tables | Left alone; `source` column allows union later | Strava is dormant; migrating dead data is unpaid work | Yes |
| 9 | Phase 2 without a key | Build and unit-test the scorer against fixtures; live calls blocked | Scorer is the valuable half and is pure functions | Yes |
| 10 | Worktree | `.worktrees/trails` off `origin/master` | Main checkout is on `intel-source-filters` with unrelated uncommitted work | Yes |

## Not building

Strava/Whoop backfill into the new tables, multi-user, sharing, self-hosted ORS, turn-by-turn
voice navigation, historical `export.zip` upload.
