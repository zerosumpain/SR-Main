# Trails dashboard metrics + segment explorer filtering/leaderboard

**Date:** 2026-08-19 · **Grade:** Full autonomous (brief: "do this autonomously")

## Brief

1. Dashboard extends to the new segment-era metrics — beats-per-km and
   efficiency factor — as a really polished view in keeping with the design
   system.
2. Segments filterable by things like the most climb, offroad, etc.
3. Segment explorer gains filtering, a leaderboard, and the ability to measure
   similar efficiencies / similar climbs across segments.

## What exists (precedents copied)

- `/trails/dashboard` — `.page-hdr` + `.nm-sec` + signal tiles + `DateLineChart`
  grid, fed by `getTrailsDashboard()`. EF already charted; b/km absent.
- `/trails/segments` — type-filter chips (server links), busiest-first list.
- `/trails/segments/[id]` — `.stats` dl grid, `SegmentLeaderboard` (per-effort
  ranks via `rankEfforts`), EF-over-time chart.
- `effortMetrics` already stores `efficiencyFactor` + `beatsPerKm` per effort.
- `segmentDescriptor` already classifies terrain (climb ≥ +20 m net, descent,
  rolling ≥ 40 m gain, flat) — the filter must reuse those exact thresholds.

## Design

### Services

- `segments/naming.ts`: extract `segmentTerrain()` (climb|descent|rolling|flat)
  from the descriptor so chips and prose can never disagree.
- `format.ts`: `isOffroadType()` — trail_run | mtb | hike. Segments carry no
  surface data; activity type is the honest proxy (Decision D3).
- `segments-service.ts`:
  - `listSegments` gains per-segment bests via one grouped-aggregate query over
    efforts: best time, best pace, best EF (max), best b/km (min), plus each
    row's terrain + gradient (net/distance) computed in `toListRow`.
  - `getSegmentHighlights()` — dashboard strip: totals, all-time records
    (fastest pace, best EF, lowest b/km, biggest climb) and recent PRs (best
    effort on a ≥3-effort segment set in the last 30 days). One light efforts
    query + the list projection, composed in JS (1.5k rows — no SQL gymnastics).
  - `getSimilarSegments(segment)` — same-type candidates scored by the pure
    functions below; returns the two panels for the detail page.
- `segments/similarity.ts` (new, pure, vitest-covered):
  - `similarByClimb(ref, candidates)` — closeness in net gradient % + log
    distance ratio; climbs compare with climbs.
  - `similarByEfficiency(ref, candidates)` — |Δ best EF| relative; "ground that
    costs you the same".
- `physio-service.ts`: `WorkoutPhysio.beatsPerKm` (from the shared
  `beatsPerKm()` helper); `TrailsDashboard.efficiency` = `{ ef, bkm }`
  TrendSeries built from per-day means over pace sports, so the tiles get the
  same today-anchored trailing means every other tile uses.

### Pages

- **Dashboard**: two new signal tiles (Efficiency EF, Cost b/km — 7d vs 28d,
  down-is-good on cost); a Cost chart beside the EF chart; a "Segments" section
  with records stat-grid, recent PRs, and deep links into pre-filtered explorer
  views (biggest climbs, offroad, best efficiency).
- **Explorer**: server sends ALL segments (with bests) once; filtering/sorting
  is client-side `$derived` — type chips, terrain chips (climb/descent/rolling/
  flat), offroad toggle, sort select (efforts | climb | steepest | longest |
  fastest | efficiency | cost | recent). Initial state from URL params so
  dashboard deep links work. Records panel (stat-grid) recomputed over the
  filtered set. Rows gain best-pace / best-EF / best-cost readouts.
- **Detail**: "Comparable ground" section — similar-climb table and
  similar-cost table, each row showing Δ vs this segment.

### Files to touch

| File | Why |
|---|---|
| `src/lib/trails/segments/naming.ts` | export `segmentTerrain()` |
| `src/lib/trails/segments/naming.test.ts` | pin terrain thresholds |
| `src/lib/trails/segments/similarity.ts` | NEW — pure similarity scoring |
| `src/lib/trails/segments/similarity.test.ts` | NEW — TDD for the above |
| `src/lib/trails/format.ts` | `isOffroadType()` |
| `src/lib/trails/format.test.ts` | pin the offroad set |
| `src/lib/trails/segments-service.ts` | bests aggregate, highlights, similar |
| `src/lib/trails/physio-service.ts` | b/km per workout + efficiency trends |
| `src/routes/trails/dashboard/+page.server.ts` | fetch highlights |
| `src/routes/trails/dashboard/+page.svelte` | tiles, cost chart, segments strip |
| `src/routes/trails/segments/+page.server.ts` | send all + initial params |
| `src/routes/trails/segments/+page.svelte` | filters, sort, records panel |
| `src/routes/trails/segments/[id]/+page.server.ts` | similar segments |
| `src/routes/trails/segments/[id]/+page.svelte` | comparable-ground section |

No schema changes. No new dependencies.

### Verification

- `npx vitest run` on the touched test files, then the full suite.
- `NODE_OPTIONS=--max-old-space-size=8192 npm run check` (sandbox off for build).
- Prod build + `node --env-file=.env build/index.js` on a spare port; Playwright
  screenshot of all three pages (owner-gated → AUTH_BYPASS locally is fine on
  homeserv LAN only).
- Ship via PR → CI deploy → verify live on strangeramblings.com (curl for new
  markup + screenshot).

## Decision Log

- **D1 — "filter segments … highest elevation, offroad" read as explorer
  filtering + dashboard deep links.** Options: (a) filter UI on the dashboard
  itself, (b) filters live in the explorer, dashboard links into pre-filtered
  views. Chose (b): a dashboard is a read, not a query surface, and duplicate
  filter UIs drift. Reversible — links become embedded filters if wanted.
- **D2 — "highest elevation" = most climb (elevationGainM).** Segments don't
  store absolute altitude in the list projection; climb is the meaningful axis
  and matches the existing descriptor language. Reversible (altitude max could
  be computed from coordinates at rebuild time later).
- **D3 — offroad = activity type ∈ {trail_run, mtb, hike}.** No surface data
  exists for segments (discovered routes deliberately get no quality score for
  the same reason). Type is the honest proxy; a surface-tagging pass over OSM
  would be a separate feature. Reversible.
- **D4 — explorer filtering is client-side over the full list.** 161 segments
  today, capped at 200 in the query; shipping them all once is cheaper than a
  server round trip per chip. URL params still honoured on first load so links
  work. Reversible to server-side if the list ever outgrows the cap.
- **D5 — efficiency tiles use pace sports only** (run/trail_run/hike/walk),
  matching the existing EF chart's filter — a ride's EF is not comparable and
  would corrupt the trailing means.
- **D6 — no new chart component.** `DateLineChart` and the `.stats` dl grid
  cover every new visual; inventing a bespoke leaderboard component would
  violate the design-system discipline for no gain.
- **D7 — similarity is a pure module, thresholds pinned by tests**, mirroring
  how the matcher's traps are pinned in `matcher.test.ts`.

### Post-review decisions (self-reviewed via /code-review high, 10 findings)

Applied: pace-sport partition on the EF/cost/fastest sorts (matching the
records panel), steepest by |gradient|, biggest-climb record requires positive
gain, `?type=` validated like terrain/sort, cost-tile delta at 1 dp, explorer
list limit raised to 1000, highlights queries parallelised, and the three
stat-grid CSS forks replaced with the shared `.cellgrid` primitive.

- **D8 — near-flat reverse twins may match in similarByClimb.** Under 1%
  either way it is the same flat ground; comparing the two directions is
  legitimate. Real climbs still never match their descent. Doc updated instead
  of code.
- **D9 — best-direction stays encoded per site, not unified on
  BEST_DIRECTION.** The SQL aggregate cannot read the TS table, each site is
  comment-locked and test-covered, and the one "divergence" (explorer records
  scope by filter, dashboard records are pace-only) is deliberate.
- **D10 — full-table efforts aggregates stay.** 1.5k rows today; a Postgres
  GROUP BY at 10× this size is still sub-millisecond work. Revisit if efforts
  reach six figures.
