# /trails — intra-route segment analysis

**Date:** 2026-08-19 · **Branch:** `feature/trails-segments`

## The ask

Where the same ground is covered more than once, compare the efforts against
each other. A "stretch" qualifies at **≥ 500 m** shared, with the two traces
staying **within 20 m** of one another (GPS drift tolerance). Matched stretches
get a what3words-style title; efforts on them are compared on avg HR, speed,
time, and a pace-versus-HR combination.

## Decisions (agreed 2026-08-19)

| Question | Decision |
|---|---|
| Reverse traversal | **Two separate segments.** A climb and its descent are not comparable efforts. Falls out of the matcher for free: reverse co-traversals show a *decreasing* index correspondence and are rejected. |
| Combo metric | **Efficiency Factor ranked first, beats-per-km alongside.** EF already exists in `$lib/health/analytics/efficiency.ts` with its methodology citation and is on the activity pages and physio dashboard — reuse, not invention. |
| Titles | **Word triple plus auto descriptor** — `heron.copper.stile · 1.2 km · +48 m climb · 9 efforts`. Triple is the identity, descriptor is derived at render time. |
| Minimum efforts | **2.** Enough to compare; sparse groups can be filtered in the UI, undetected ones cannot. |

Not asked, decided by precedent: laps *within a single activity* count as
separate efforts (that is the most literal reading of "intra-route"); segments
never cross activity types; thresholds live in one constants block.

## Algorithm

Pure functions in `$lib/trails/segments/`, no DB, no network — same contract as
`track.ts`, so every stage is testable on synthetic traces.

1. **Resample** (`resample.ts`). Each stored track (decimated at 3 m, irregular)
   is re-cut to a uniform **10 m** spacing with lng/lat/elevation/time linearly
   interpolated. Uniform spacing is what makes everything downstream cheap:
   run-length in points *is* distance (50 points = 500 m), and a true
   co-traversal advances both traces one point per step.
2. **Project.** Equirectangular metres about the dataset centroid. Locally
   conformal to well under a metre at these scales, and ~10× cheaper than
   haversine in the inner loop. Reported distances still use `haversineM`.
3. **Grid.** One 20 m cell grid per activity type over every resampled point of
   that type. A 3×3 neighbourhood query is guaranteed to find everything within
   20 m.
4. **Correspond.** For each reference track, nearest in-tolerance partner point
   per index, then scan for maximal runs that advance monotonically with a
   bounded step, bridging up to 5 missed points (a GPS blip must not sever a
   2 km stretch). Monotonic-increasing only — that is the direction decision.
   Repeated up to 4 passes with matched partner points peeled off, so a
   4-lap park loop yields four efforts rather than one.
5. **Level sets.** Support count per reference point; for each support level,
   the longest interval at that level ≥ 500 m becomes a candidate. This yields
   both "the long stretch two of us share" and "the shorter core eight of us
   share" instead of forcing a choice.
6. **Dedupe.** Candidates from different references that overlap ≥ 80 % in the
   same direction collapse to the best-supported one.
7. **Recruit + measure.** Every run covering ≥ 90 % of a surviving candidate
   contributes an effort, its time window read off the stored index mapping.

## Storage

`activity_segments` + `activity_segment_efforts` (new tables, real SI units in
`doublePrecision`, matching the `activities` convention rather than the
`*100` integer convention of `apple_health_metrics`).

Rebuild **reconciles** rather than truncates: a recomputed segment that matches
a stored one geometrically keeps its id *and its name*, so URLs stay valid and
`heron.copper.stile` does not become something else because a rebuild shifted
the start by 30 m.

## Surfaces

- `/trails/segments` — hub, grouped by activity type.
- `/trails/segments/[id]` — leaderboard + map + efficiency trend.
- `/trails/[id]` — "Segments on this one" card with this activity's ranks.
- `POST /api/trails/segments` — rebuild, owner-gated.

## Verification

- `npx vitest run src/lib/trails/segments` — synthetic traces with known answers.
- Rebuild against the real 291-track prod dataset and read the output.
- Prod: `/trails/segments` renders groups; a leaderboard ranks efforts.
