# Landgrab — family territory capture from Life360 trails and Apple workouts

**Date:** 2026-08-29
**Route:** `/projects/landgrab` (owner-only, no card on `/projects`)
**Branch:** `feature/landgrab`
**Process:** researched with a 12-agent ultracode fan-out; designed by three independent
fable panels plus a fable synthesis judge; built by Opus. Autonomy grade: **Full** —
John's kick-off was "keep it private, and crack on with the plan", so every fork below
is a self-approved decision with a logged reason.

## The brief (John's words, verbatim)

> The principle is that life360 tracks from the family and apple workouts should be
> overlaid on a map. Each track that creates a closed geometry (ie has done a circle, or
> loop) captures that section in a colored box when closed. Where multiple people have
> created a geometry shape, the person with the most, and most recent "win" that section.
> People can win geometry within anothers (ie if john had a large section of darlington
> from a circular run, but katie has completed a large number of smaller block walks
> within, the big section should be colored JK and the smaller sections colored for katie.
> Any shape geometry exists until it's been taken over by someone else. There should be a
> leaderboard for a number of different elements; Area of Geo's, number of Geos, most
> recent Geos captured, +/- geo's in the past week. Geo's dont need to be perfectly closed
> to count, but need to be close to closed. The interface should be beautiful and bold,
> with a real gamified feel.

## Ground truth (measured on production, 2026-08-29)

These five facts constrain every decision below. All were measured, not inferred.

- **PostGIS is not available.** The app DB is `pgvector/pgvector:pg16`; the only
  extensions on offer are `cube`, `earthdistance` and `vector`. No `ST_Polygonize`,
  no `ST_Difference`, no `ST_Node`. All geometry is pure TypeScript.
- **Family corpus:** 52,352 trail fixes across five subjects, 2026-07-28 → 2026-08-29.
  Only 33 days exist because daydreaming started then. `TRAIL_RETENTION_DAYS = 90` and
  `pruneTrail` hard-deletes hourly — the trail is a rolling window, so captured territory
  must persist in its own tables or it evaporates.
- **Workout corpus:** 840 usable tracks, 600,857 route points (avg 714, max 10,751) in
  `activity_tracks.coordinates` (jsonb `[[lng,lat,elev,secs],…]`, one row per activity).
- **Workouts are John's alone.** `activities` has no person column and every row is
  `source='apple'`, arriving through one shared `APPLE_HEALTH_API_KEY` webhook. Katie,
  Jemima, Rory and Fintan can only capture ground via Life360.
- **Volume is comfortable:** ~650k points total is an hourly heartbeat job in JS.

Life360 cadence, measured from the HA recorder over 30 days (16,724 real fixes): a new
point every **~45 s while moving**, **~30 min while still**. Family subjects are
poll-only at 120 s; only John has a push stream.

## The one place this departs from the literal brief

**Territory is scored on a hidden grid, not on traced polygons.** The reasons:

1. Run An Empire shipped John's exact loop-enclosure mechanic and publicly reversed it
   onto a grid. Ingress refused to resolve nested polygon ownership at all. Paper.io
   solved "circle it and everything inside is yours" with a cell fill.
2. Family polling is 120 s. A block walk is 3–6 fixes, so a "true" polygon of it is a
   wonky hexagon whose area is sensor noise. On a grid both data sources land in the same
   cells and the asymmetry disappears.
3. The nesting rule — the hardest part of the brief — becomes a one-line argmax instead
   of a noding/polygonize/sliver/planar-partition pipeline that would need `jsts`, an
   unproven Vite-interop dependency, with no PostGIS to fall back on.

**The visual intent is preserved exactly.** The grid is never shown. Each person's owned
cells are dissolved server-side into connected components, boundary-traced, and smoothed
with two Chaikin passes, so territory reads as organic painted ground. The client
receives tens of rings, never cells. John gets his coloured sections; Katie's block walks
still punch holes through the middle of his big loop, in her colour.

Reversible: the ledger is append-only and stores each claim's real ring geometry, so a
polygon renderer could be layered on later without losing history.

## Rules

**Scoring atom** — a Web Mercator slippy tile at **z19** (~44 m across, ~1,970 m² at
Darlington's 54.5°N), keyed by integer (x,y), computed with the existing
`src/lib/trails/field/tile-math.ts`. Zero new dependencies.

**Two ways to write a capture event**
- **Loop capture, weight 3** — a journey that closes stamps every tile whose centroid
  falls inside the ring (hand-written ray-cast over locally-projected metres).
- **Trample, weight 1** — any qualifying journey claims the tiles its path crosses,
  rasterising consecutive fixes as line segments (Bresenham; the Strava heatmap rule —
  segments, never points, so 45–120 s sampling does not paint a dotted map).
  Interpolation is refused across any leg > 300 m or > 180 s so a GPS teleport cannot
  stripe the county.

**Closure** — per journey from the existing `segmentJourneys()`, after cleaning (drop
`accuracy_m > 75`; drop `vehicle`/`rail`/>25 km/h legs; collapse stationary jitter within
25 m; decimate at 10 m). A journey closes if **either**:
- *endpoint test* — path ≥ 400 m AND first-to-last gap ≤ max(60 m, 5% of path length)
  AND the closing chord ≤ 25% of path length. The synthetic closing segment is drawn
  dashed in the UI so the tolerance is visible, not hidden.
- *self-intersection test* — any segment pair crosses (O(n²) over a few dozen decimated
  points). Each sub-path between crossings is its own ring, so a lollipop route's head
  counts and a figure-of-eight yields both lobes; enclosed tiles are unioned so winding
  signs cannot cancel.

A ring qualifies only if it encloses **≥ 2 tile centroids** (~4,000 m² floor — kills
bus-stop jitter flowers and the stationary-day polygon around the house) and
**≤ 1,000 tiles** (~2 km² ceiling — a misclassified drive cannot win Darlington in one
trip). Thresholds live in `src/lib/geo/loops.ts` and are **stored on every claim row**,
so they can be retuned after week one without invalidating history.

**Ownership** — per tile, per person:

```
score = Σ over that person's qualifying events of  weight × exp(−age_days / 43.3)
```

A 30-day half-life: 1.00 today, 0.85 at a week, 0.50 at a month, 0.06 at four months.
Owner = argmax of score, ties broken by most recent event. This is John's "most, and most
recent win" collapsed into one monotone number with no cliff and no expiry job. Because
exponential decay preserves ratios, **a tile can never flip on its own** — everyone's
score shrinks together and ownership changes only when someone actually goes there. That
honours "any shape exists until it's been taken over" literally, while stale ground still
gets progressively cheaper to steal. At most **one qualifying event per (person, tile,
UTC day, kind)** — ten laps of the garden score once.

**Nesting is emergent, not implemented.** Katie's block walks write weight-3 events on
exactly the tiles her rings enclose; her fresher, denser score out-ranks John's month-old
single big-loop event on those tiles, and the hole punches through while he keeps
everything around it. Partial overlap is a bite out of a border. Two people tracing the
same park circuit resolve by decayed score. "A loop crossing another's boundary" is
meaningless because boundaries are not objects.

**Leaderboards** — area (cell count × the per-latitude Mercator constant, so no
projection bugs and no geodesic library), number of geos, most recent captures, and the
weekly board as **two columns, gained and lost, never one signed number**. Plus *longest
held* (days since your oldest still-owned tile's `owner_since`) — the one board a
low-mileage walker can win outright — and a per-person dangle line ("walked 12.4 km this
week, enclosed 0.31 km²").

## Schema

Four new tables, all owner-gated. `schema.ts` takes no `$lib` imports.

- **`geo_capture_events`** — append-only ledger; every board derives from it.
  `uniqueIndex(subject, tile_x, tile_y, day, kind)` is the idempotency and anti-farming key.
- **`geo_claims`** — one row per detected loop; the feed and the capture-line art. Stores
  the real `ring` jsonb, `polyline`, `closure` jsonb (method, gap, thresholds used),
  `area_m2`, `tiles_taken` jsonb (`{victim: count}`), and a lat/lon bbox as the
  no-PostGIS index substitute.
- **`geo_tile_state`** — materialised current ownership, recomputed for touched tiles
  only; carries `owner_since` for the longest-held board.
- **`geo_daily_snapshot`** — the honest basis for the weekly ± board. Never replay a
  decayed ledger to reconstruct past state.

Watermarks live in existing settings keys (`geo:watermark:<subject>`); note
`setSetting(k, null)` cannot unset, so a reset writes the epoch.

## Privacy posture

This is five people's movement history, three of them children, where the densest cluster
is the front door and the second densest is the school. The posture is the repo's
established binary doctrine — **owner-only, no partial disclosure, no redaction theatre**:

1. Page guard copied verbatim from `/projects/family-life360-history`: owner or 404, plus
   `cache-control: private, no-store`. `/projects` is a public *prefix* in `PUBLIC_PATHS`,
   so this load-function guard is the entire gate.
2. **No card on `/projects`.** `registry-cards.test.ts` would force the slug into
   `STATIC_PROJECT_KEYS`, which silently flips the visibility default to PUBLIC on first
   deploy. Cardless is fail-closed.
3. The single API route (`POST /api/geo/rebuild`) is added to **none** of `PUBLIC_PATHS`,
   `PUBLIC_API_PATHS` or the hook bypasses — gated by absence. There is no public data
   endpoint; rings, claims and feed ship only inside the owner-gated page load.
4. Nothing is blurred, because nothing leaves the owner session. A claim ring's vertices
   are real GPS fixes and would correctly trip `disclosureLeaks()`. Sharing this beyond
   the household is a redesign (aggregates only, home-adjacent cells suppressed, no
   per-person names), not a toggle.
5. Home can never become contested territory: the 2-centroid floor plus jitter collapse
   mean a stationary day forms no claim.

**Companion fix, folded in:** `/api/family-presence/stats` is in `PUBLIC_API_PATHS` and
serves all five family members' clustered GPS history and current positions anonymously,
by first name. It answers 503 today only because its backing workflow datastore row is
empty — it is a loaded gun with an empty magazine, and it is invisible to the CI
public-routes lockfile. No browser or public consumer references it (only an internal
jkai tool, which reads the datastore directly). It is removed from the allow-list in
Phase 1; leaving it open would make this page's gate decorative.

## Build phases

1. **Geometry core** — `src/lib/geo/{tiles,rings,loops,ownership,dissolve}.ts`, pure TS,
   no DB, no deps. *Verify:* vitest green on fixtures (square closes; out-and-back
   tramples only; figure-of-eight yields both lobes; lollipop via self-intersection;
   jitter flower and drive ring rejected; nesting flips inner tiles only; decay never
   self-flips). `npm run check` with the heap bump; grep proves no `src/lib/geo` import
   reaches a client component.
2. **Schema, service, rebuild endpoint** — tables + `drizzle-kit push`; watermarked
   ingest of both sources (never a `source` allow-list on the trail — `backfill` rows
   exist outside `TRAIL_SOURCES`); incremental touched-tile recompute; owner-gated POST.
   *Verify:* rebuild twice on the local dev DB yields identical row counts and tile state;
   a loop-shaped workout produces a claim whose area matches a hand-check within a few
   percent; a straight out-and-back produces trample events but no claim.
3. **Heartbeat + snapshots** — hourly `geo-territory` activity with an in-run day-rollover
   snapshot (never a separate daily job — the active-hours lockout makes a missed daily
   window skip forever). *Verify:* second invocation is a no-op; five snapshot rows;
   kill mid-run and re-invoke leaves no duplicates.
4. **The page** — route, verbatim guard, `TerritoryMap` / `CaptureFeed` / `LandgrabBoards`,
   capture animation, empty state. Full `sr-design`. *Verify:* on homeserv dev **:5174**
   (not :5173 — that is the always-on build); anonymous curl → 404 with `private, no-store`;
   `npm run check` and `gate:font-sizes` green; no horizontal scroll at phone width.
5. **Backfill, ship, verify live** — merge to master (CI deploys; never `deploy.sh`), then
   `backfillFromHomeAssistant` for katie/fintan/jemima/rory, then rebuild. *Verify:*
   `build/.deploy-sha` matches the merge SHA; anonymous curl of the live route → 404; no
   card on the index; all five subjects present in `geo_capture_events`; per-subject totals
   are single-digit km² (proves the vehicle gate held); the next heartbeat tick advances
   `max(captured_at)`.

## Decision Log

| # | Decision | Why | Reversible? |
|---|---|---|---|
| 1 | Cells, not traced polygons | Nesting becomes an argmax; 120 s family polling makes true polygons sensor noise; Run An Empire reversed this exact mechanic; jsts is unproven with no PostGIS fallback | Yes — claims store real ring geometry |
| 2 | z19 cells (~44 m), not z18 | Nesting must be visible: a block walk encloses 4–9 z19 centroids vs 1–4 at z18. Client cost is unchanged because of the dissolve | Yes, constant |
| 3 | Trample capture in at weight 1 vs loop 3 | Loops-only scores the school run, shop walk and dog walk at zero, disengaging four of five players | Yes — delete one constant |
| 4 | Self-intersection closure in v1 | Lollipop routes are the commonest runner shape and endpoint-proximity can never see them; ~30 lines | Yes |
| 5 | Decay the score, never the ownership | Preserves ratios, so a tile cannot flip without a visit — "exists until taken over", literally | Yes |
| 6 | Gates: accuracy 75 m, speed 25 km/h + mode, jitter 25 m, interpolation 300 m / 180 s | 50 m starves poll-only family phones; 150 m feeds noise to geometry; defence in depth against the one fatal failure — a drive claiming the county | Yes, constants |
| 7 | Cycling excluded from v1 | A bike loop encloses ~10× a run for the same effort and would end the family contest in a week | Yes, one-line filter |
| 8 | All Apple workouts attribute to John | No person column exists; only John posts to the shared webhook key. Retrofit is cheap until the ledger has history | Yes, flagged in risks |
| 9 | Co-walked outings credit everyone present | Two phones on one walk is the commonest family case; the decayed score already resolves who does it more often | Yes |
| 10 | One event per (person, tile, day, kind) | Foursquare's distinct-days rule; without it ten garden laps break the game in an afternoon | Yes |
| 11 | Rebuild is an owner POST endpoint, not a form action | Long-running; matches the `rebuildSegments` precedent; absent from every allow-list means gated for free | Yes |
| 12 | Hourly heartbeat with in-run snapshot | The active-hours lockout makes a missed daily window skip forever; short-cadence jobs self-heal | Yes |
| 13 | SVG renderer, not preferCanvas | Hatch `<pattern>` fills — the colour-blind second channel — need SVG; the dissolve keeps features in the tens | Yes |
| 14 | Colours from `CLUSTER_COLOURS`, always paired with hatch + mono initial | Five on-brand hues cannot be simultaneously ≥3:1 on cream and deuteranope-safe, so colour never carries identity alone | Yes |
| 15 | No `/projects` card at launch | A carded slug must enter `STATIC_PROJECT_KEYS`, flipping the visibility default to PUBLIC on first deploy | Yes — a card ships with an `is_public=false` row |
| 16 | Backfill ~30 days for all four family subjects as a launch gate | Four of five players have ~2 days of trail; without it the launch map is a monument to John | Yes |
| 17 | Ledger is append-only and independent of `daydream_trail` | `pruneTrail` hard-deletes evidence at 90 days | No — by design |
| 18 | Close `/api/family-presence/stats` in this build | It anonymously serves five people's GPS history; no public consumer; leaving it open makes this page's gate decorative | Yes, one line |
| 19 | Backfill everyone equally and bill week one as "the founding land grab" | The game needs a populated board to be worth opening; decay means August's ground is already cheap to steal by October | Yes |
| 20 | Owner-only v1; family views on John's devices or a kitchen display | Widening the guard is contained work once the page exists; shipping should not wait on auth design | Yes — fast-follow |
| 21 | Built in an isolated worktree `.worktrees/landgrab` off `origin/master` | The primary checkout sits on `fix/jkai-code-route-always-offered` with 23 uncommitted files that are not mine to disturb | Yes |

## Out of scope, said out loud

Polygon geometry libraries of any kind (turf / jsts / PostGIS / h3), MapLibre, seasons or
map resets, workout attribution for other family members, any public or shared version,
per-tile history UI, offline tiles, badges and medals.

## Risks

1. **Vehicle leakage is the one fatal failure mode** — the `mode` column's derivation
   quality is unverified and one misclassified drive out-encloses every walk. Five
   independent gates plus a Phase 5 sanity check that per-subject totals are single-digit km².
2. Family polling at 120 s may mean closure thresholds tuned on synthetic data reject real
   family walks. Trample keeps those walks scoring regardless; Phase 5 budgets a retune.
3. First full rebuild must be **timed on prod** before it is trusted — fast on homeserv
   proves nothing (the pgvector lesson).
4. If per-tile geometry ever leaks to the client the SVG renderer crawls at ~12k features.
   Phase 4 verification includes a payload check.
5. Apple attribution goes silently wrong the day a second family watch posts to the shared
   key — add a subject column before the ledger accrues history.
6. A bug found after 90 days cannot be fixed by full replay; the heartbeat should alert if
   the watermark age approaches the retention window.
7. Chaikin-smoothed dissolve and Leaflet hatch fills have no repo precedent — genuinely new
   rendering work.
