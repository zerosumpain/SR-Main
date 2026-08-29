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

The removal is only half the fix, and the second half matters more. The CI lockfile
(`scripts/check-public-routes.mjs`) read `PUBLIC_PATHS` and the hook bypasses and had
**never** read `PUBLIC_API_PATHS` — which is precisely how five people's GPS history sat
in an allow-list unnoticed. Verified by adding a throwaway `/api/zzz-canary/stats` route
plus its allow-list line: `npm run gate:public-routes` printed "OK — 202
anonymously-reachable routes, unchanged" and exited 0. The script now extracts that array
as EXACT paths (never prefixes — `isPublicApiPath` compares with `===`) with
`/api/biome/state` as a canary, and the same canary route turns the gate red. The route
count stays 202: both surviving entries are already covered by the `/api/biome` and
`/api/landing` prefixes, so the reviewer's predicted 202→204 does not happen and the
snapshot diff is empty. That is the correct outcome — family-presence was the only entry
this array opened on its own, and the gate is for the next one. Landgrab's whole privacy
posture is "gated by absence", which is only as strong as the thing that notices an
addition.

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
| 7 | ~~Cycling excluded from v1~~ **REVERSED BY JOHN 2026-08-29: cycling counts, it just needs to be filterable** | The original reason (a bike loop encloses ~10× a run for the same effort) stands as a *viewing* concern, not a *scoring* one. Rides now capture like any other activity; every capture event and claim carries its activity type so the map and boards can filter by it | Yes |
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
| 18 | Close `/api/family-presence/stats` in this build, **and teach the CI lockfile to read `PUBLIC_API_PATHS`** | It anonymously serves five people's GPS history; no public consumer; leaving it open makes this page's gate decorative. Removing the occupant without sealing the blind spot only empties it — the gate had never read that array, which is how it sat there unnoticed | Yes, one line + one extractor |
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

---

## Phase 1 outcome (2026-08-29)

Built by Opus test-first, then taken apart by three adversarial reviewers (closure maths,
spec conformance, build safety) and repaired. **99 tests green**, 29 net new over the
first draft, 22 of which failed first as reproductions of real findings. `svelte-check`
clean in `src/lib/geo`; module-boundary and schema-import gates OK; nothing in the repo
imports `$lib/geo`, so the server-only isolation holds.

Findings that changed the design, not just the code:

- **`pointInRing` used the even-odd rule.** An exactly-retraced lap has winding 2, so an
  even number of laps read as *outside* — 1 lap 25 tiles, 2 laps 0, 3 laps 25, 4 laps 0.
  Replaced with a nonzero winding-number test. (The reviewer's own fixture did not
  reproduce it — insetting the laps makes the corners cross and the popper splits them —
  but their conclusion was right.)
- **Ownership had an as-of bounds bug family (the blocker).** `resolveOwnership` threw
  when `now` preceded every event on a tile, and the throw escaped the whole per-tile
  loop, taking down the recompute. `ownerSince` was also replayed over events later than
  `now`. Events are now filtered to `<= now` before replay; a tile whose only evidence
  post-dates the question has no owner yet.
- **New threshold `minRingWidthCells = 0.5`** — the thinness gate the spec lacked, as
  `2 × area / perimeter >= 0.5 × tileSideM`. The reviewers' first suggestion (Polsby-Popper
  compactness) was measured and rejected: it is length-dependent and lap-dependent, and
  would have thrown away the exact multi-lap claim the winding fix had just rescued.
  The width form is invariant to both. Rejects a 600 m out-and-back separated by 10–20 m;
  accepts a real 400×40 m block.
- **New thresholds `maxObservationGapS = 360`, `minMovingKmh = 1`** — the spec's
  stationary defence ("collapse jitter within 25 m") is blind at a 30-minute cadence.
- **`capturedAreaM2` now sits beside `areaM2`** — ring geometry (what a hand-check
  measures) and cell count × the per-latitude constant (what leaderboards pay) are
  different models and cannot be reconciled into one number, so both are carried.

Two residuals, stated rather than hidden:

1. **A 600 m out-and-back separated by 24–65 m still qualifies** and is awarded 8–12
   cells. Below 23 m the width gate rejects it; above ~65 m nothing closes at all. In
   that band no geometry distinguishes "down and back a dual carriageway" from "round a
   narrow block" — they are the same shape. The line is drawn at the grid's resolution
   rather than at a taste.
2. **Decision 7's "one-line filter" understated cycling exclusion.** It is implemented
   for Apple workouts via `excludedActivityTypes = ['ride','mtb']`, which is where the
   bike actually is. Life360 carries no activity type and its `mode` column derives from
   GPS speed, which the repo's own `MOVEMENT_MODES` comment says cannot separate running
   from cycling — both land in `active` at 6.5–18 km/h. Excluding `active` outright would
   delete John's runs. The Life360 half stays open.

Also worth recording: a source polled slower than 6 minutes now captures no loops,
because every leg is a hole in the record. Consistent with `segmentJourneys` upstream,
but a real behavioural narrowing to know before Phase 2 ingest.

## Amendment 1 — cycling is included and filterable (John, 2026-08-29)

Decision 7 is reversed. Rides capture ground like any other activity; the filtering
happens at the viewing layer, not the scoring layer.

Consequences:

- `excludedActivityTypes` defaults to empty. The field stays in `GeoThresholds` — it is
  now a caller-supplied filter rather than a policy — and is still persisted on each
  claim, so a future change of mind is legible in the history.
- `geo_capture_events` and `geo_claims` both gain `activity_type` (text, nullable). This
  is what makes the requirement "filterable" real: without it, a ride is indistinguishable
  from a walk once it is in the ledger, and the filter could only ever be applied at
  ingest — which is the thing John has just said he does not want.
- Nullable, because Life360 genuinely has no activity type. The honest filter dimensions
  are therefore `source_kind` (trail | activity) and `activity_type` (walk | run | hike |
  ride | mtb | null), and the UI must say "untyped" rather than guessing.
- The vehicle and rail exclusion is untouched — driving still never captures. That gate
  is about a car claiming the county, not about which sports count.
- This closes the Phase 1 residual honestly. The old note said Decision 7 was
  half-implemented because Life360 cannot separate running from cycling on GPS speed
  alone. Under the new rule that no longer matters: both count, and the family bike ride
  tracked only by phone simply appears as untyped trail capture.

## Phase 2 outcome (2026-08-29)

Amendment 1 applied first, then the interrupted ingest draft reviewed and finished.
**101 unit tests green** in `src/lib/geo` (99 before; the cycling block was rewritten from
"a ride captures nothing" to "a ride captures, and the filter still works when a caller
asks for it") plus **15 integration tests** against the local dev Postgres — 116 in all,
four of them added as reproductions of the findings above and failing first.
`svelte-check` clean; `gate:schema-imports`, `gate:boundaries` and `gate:public-routes` all
OK; nothing outside `src/lib/geo` imports it.

**The amendment, as shipped.** `excludedActivityTypes` defaults to `[]` and is documented
as a caller-supplied filter rather than a policy. The drop logic stays, and stays a *cut*
rather than a skip, so a filtered ride in the middle of a mixed journey severs the path
instead of letting the rasteriser draw a line across the gap. The service's allow-list —
which was the *other* half of the cycling exclusion and would have kept rides out on its
own — is now `CAPTURING_ACTIVITY_TYPES = run | trail_run | walk | hike | ride | mtb`. It is
still an allow-list, because `swim` and `other` have no ground under them.

`geo_capture_events.activity_type` and `geo_claims.activity_type` are both `text` and both
nullable, pushed with `drizzle-kit push` (`ALTER TABLE … ADD COLUMN "activity_type" text`,
twice). **`activity_type` is deliberately not in `geo_capture_events_unique_idx`**: a cell
walked and then ridden on the same day is one loop capture and one trample capture, and
adding the column to the key would make it two — reopening exactly the farming hole
Decision 10 closes. The honest cost is stated in the column comment: on such a day the
ledger keeps whichever kind got there first, so filtering rides out can remove a cell that
was also walked.

**The filter has one legal spelling, and it is exported.** Two things about
`activity_type` only became visible under review. First, it made the CELL LIST filterable
but not the MAP: `resolveOwnership` only ever ran over the unfiltered ledger, so a
foot-only view kept cells whose materialised owner had earned them by bike alone —
measured on one cell, a rider's loop scores 2.82 and a walker's trample 0.96, the cell
survives `activity_type is distinct from 'ride'` on the walker's evidence, and the only
owner anywhere in the schema is the rider. `resolveFilteredOwnership()` in
`$lib/geo/service` is now the one question a filtered view asks; `geo_tile_state` stays
the unfiltered fast path and the two agree when no filter is applied.

Second, **a bare `activity_type not in ('ride','mtb')` silently deletes the entire Life360
corpus.** The column is NULL for every trail journey — four of the five subjects — and
`null not in ('ride')` evaluates to NULL rather than true, so a WHERE clause drops the
row. Katie, Rory, Fintan and Jemima would show zero territory while John's typed Apple
rows looked correct, which reads as four broken phones rather than a query bug. It was
invisible on the corpus this amendment was measured on, because that corpus holds **no
untyped rows at all** (`select count(*) from geo_capture_events where source_kind='trail'`
returns 0 and `daydream_trail` is empty on the dev box), so both spellings agreed. Same
class as the standing rule that a `source` allow-list on `daydream_trail` drops the whole
`backfill` corpus. The filter is therefore written in exactly one place —
`activityTypeNotIn()` — which emits `is distinct from` for one value and
`(x is null or x not in (…))` for several, and there is an integration case that seeds an
untyped trail event beside a ride and asserts the bare form returns nothing while the
helper returns the trail row.

**Measured on the dev corpus.** Before the amendment the two real rides in
`activities` contributed **0** ledger rows. After: **376** capture events, every one
stamped `ride`. John's workout territory is **1,165 cells / 2.295 km²** unfiltered and
**854 cells / 1.682 km²** with rides filtered out — 311 cells, 26.7%, is cycling. The
difference between 376 ride cells and 311 lost cells is the 65 cells he has also covered on
foot, which is the filter behaving correctly: it filters *evidence*, not owners.

Neither real ride produced a **claim**, only trample. The 25 km/h ceiling cuts a ride's
fast legs, so what survives cleaning is rarely a closed shape. That is the gate about cars
doing its job on a bike, and it is a thing to watch in Phase 5 rather than a thing to
loosen now.

**One real bug found in the draft, and it was the fatal failure mode arriving by the side
door.** `detectLoops` cleans its input; `trampledTiles` does not — by design, since its two
constants are about the sampling gap and nothing else. The draft passed *raw* fixes to
both, so the trample half honoured **no accuracy gate, no mode gate and no speed gate**.
Every drive painted a weight-1 line down every road it used. A claim is worth three times a
trample per cell and a drive covers a hundred times the ground, so "driving never captures"
was true of claims only. `tilesOf` now rasterises `detectLoops`' cleaned segments, which
also makes a caller-supplied `excludedActivityTypes` mean the same thing on both halves.
There is an integration case for it: a 4 km vehicle loop sampled every 250 m — comfortably
inside both interpolation gates — scores zero events and zero claims, next to a walk on the
same ground that scores normally.

**Idempotency, at the database rather than in the report.** Seeded a 300 m square loop and
a 600 m out-and-back into `daydream_trail` as `source='backfill'`. Run 1: 1 claim,
85 events proposed, 85 written, 79 cells. Run 2: 1 claim, 85 proposed, **0 written**. The
claim measures 89,997.4 m² against a 90,000 m² hand-check, width 150 m (= side/2 for a
square), closure `endpoint` with a 0.00 m gap; the out-and-back produced 15 trample events
and no claim. Then three further passes over the whole corpus including a full rebuild with
the watermarks reset to the epoch: 1,493 events proposed and **0** written each time, and a
row-by-row `EXCEPT` in both directions across every column of all three tables (`id` and
the write-time stamps aside) returned **0 differing rows**. `owner_score` is materialised
as-of the recompute instant, so two runs only agree byte-for-byte when they are given the
same `now` — worth knowing before anyone diffs two runs an hour apart and calls it a bug.

**Two things the ledger has to be able to change its mind about.**

`tiles_taken` was read off `geo_tile_state` once, before any write, so every claim that
displaced another claim ingested in the SAME run recorded `{"unclaimed": n}`. Reproduced:
zz-john walking a 400 m square on 2026-08-05 and zz-katie the same square on 2026-08-20,
both `backfill`, one full ingest — both claims `{"unclaimed": 81}` while
`geo_tile_state.previous_owner` correctly named zz-john on all 100 contested cells. That
is Decision 19's founding land grab exactly, and equally the ordinary case of two family
members' journeys arriving in one hourly tick; claims are `ON CONFLICT DO NOTHING`, so no
later run repaired it and the capture feed would have said every claim landed on virgin
land. It is now resolved against the LEDGER at `capturedAt - 1 ms`, over the union of what
is already stored and what the run is about to write — the same technique that already
made `previous_owner` right, and the same rebuild-stability: deleting the claims and
rebuilding reproduces the identical value, which is asserted on a contested ring.

`rollDailySnapshots` only ever moved FORWARD from the newest snapshot day, so ground that
arrived for an already-snapshotted day was permanently missing from the weekly board and
no exposed call could repair it — the rebuild endpoint took no day and `writeDailySnapshot`
was reachable from no route, so the fix was a `DELETE` in psql. Reproduced: 18 snapshot
rows written for 2026-08-11..28, one capture event inserted for a new subject dated
2026-08-11, and the same call returned `{"days":[],"rows":0}`. Which is Phase 5 — merge,
backfill the four family subjects, rebuild — where the rebuild repairs the ledger and
`geo_tile_state` and not one snapshot row. The roll now reopens any day the ledger has
moved under, found by comparing `geo_capture_events.created_at` against that day's
snapshot `created_at` (bounded to days this call's horizon can actually reach, or a
snapshot beyond the horizon makes the roll report the same day stale forever). The upsert
refreshes `created_at`, and a repair is **not** capped by `maxDays` — a half-done repair
makes no progress, because the days it did not reach keep making the same event look late.
`POST /api/geo/rebuild` also gained `snapshotFrom` for the case automatic detection cannot
see: the scoring changed but the ledger did not.

**Residual.** The ledger is append-only with `ON CONFLICT DO NOTHING`, so rows written
before `activity_type` existed keep a NULL that no re-ingest will fill. That only ever
applied to the dev box — these tables have never been deployed — and those rows were
cleared and re-ingested. Anywhere else, a type backfill needs a delete-and-rebuild, not a
re-run.
