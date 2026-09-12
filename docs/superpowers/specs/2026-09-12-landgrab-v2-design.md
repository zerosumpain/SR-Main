# Landgrab v2 — map-first, focused, historical, and delivered on Sundays

**Date:** 2026-09-12
**Route:** `/projects/landgrab` (owner-only; the load function is the whole gate)
**Branch:** `feat/landgrab-v2` (worktree `~/wt-landgrab`)
**Process:** design-gated autonomous run. Fable reviewed the shipped page and the
ledger, asked ONE batched design round, and plans; Opus subagents implement
(John, 2026-09-12: "build the plan, but make sure it's implemented by opus").
Every later fork is a self-approved decision in the Decision Log at the end.

## The brief (John's words, 2026-09-12)

> 1. UI design, I want it professional looking; mirror the general site design
> theme (ie take notes from /health especially how it renders maps, activities
> and segments). I want this to be responsive and well designed to use on a phone
> 2. I want the mapping performance to be better, and for the zoom level of the
> map render to centre on where the most change has been — the default zoom area
> and height are incorrect. Probably best biasing Darlington unless in the time
> period there was a cluster of activity somewhere else worth focussing on
> 3. I want the product to send an end of week summary through jkai of movers
> and shakers
> 4. I want feature suggestions from you; how can we make this a combination of
> simpler and more effective at demonstrating how much land people have.
> 5. Finally it would be great to show the history of ownership of particular
> geometries, with battle stats for each group/section

Design round answers (all four recommendations taken, plus the board cut):
map-first layout; the Sunday-letter digest pattern; region drill + battlegrounds;
share-of-Darlington headline, handover pulse layer, next-best-move, and cutting
the geos + longest-held boards.

## What the review found (measured in code, 2026-09-12)

1. **The register is already right.** The page wears `HealthShell` +
   `unifiedNav`, the ink cover band, five `SectionHead`s, and the QA script
   (`scripts/qa/landgrab-preview.mjs`) walks ten widths. What is wrong is WHERE
   the map sits: section 03, under the standings and the filter, two screens down
   on a phone; a 380px rail beside a 68vh map; the busy `outdoors-v12` basemap
   with a comment claiming desaturation that no code performs; no picture frame,
   head row or key of the kind `SegmentGround.svelte` gives a map.
2. **Performance is structural, in the shared adapter.** `MapLayer.draw()` in
   `src/lib/maps/mapbox.ts` adds ONE GeoJSON source, ONE fill layer, ONE line
   layer and ONE canvas hatch image PER POLYGON, and `TerritoryMap` makes one
   polygon per dissolved region. Standings report `geos` per player in the
   hundreds, so the map carries hundreds of sources and layers plus a hover popup
   bound to each. Mapbox GL's cost is per layer (a draw call each) and per source
   (a worker job each), not per feature.
3. **The zoom is the county because the fit is the county.** `fitBounds` runs
   over every cell anyone owns (`maxZoom: 16`), and John's rides reach the coast.
4. **The digest has an exact precedent**: `daydream-weekly.ts` — Sunday 17:00–21:00
   Europe/London, deduped on a `daydream_digests` row, deterministic facts + a
   model narrative verified at temperature 0, WhatsApp first via
   `executeTool('whatsapp_send')`, `postHeartbeatNote` into the latest jkai
   conversation as the floor.
5. **History is a replay, and it is cheap.** `geo_capture_events` is append-only;
   `resolveOwnership` already walks each cell's events and notes "the leader as at
   each event" — ownership can only change at an event because decay preserves
   ratios. Exposing those flips gives a full ownership timeline in O(events).
   Regions have no stable identity (they are recomputed per load), so a drill
   keys on a CELL and resolves the region around it under the current filter.
6. **Contested cells cluster.** `readVisitorSets` already gives "who has stood
   on each cell"; the 4-connected components of cells with 2+ visitors are stable
   sections where a fight actually exists. That is the unit "battle stats" mean
   something on — 91% of ground has one visitor and no battle.

## Ground truth that constrains the design

- No PostGIS; all geometry is pure TypeScript in `$lib/geo` (unchanged).
- The default window is `30d` and the page replays ownership live under it —
  the materialised `geo_tile_state` is only read for the unfiltered all-time view.
- `mapbox-gl` 3.29.0 is declared, lockfiled, and present in this checkout's
  node_modules. Data-driven `fill-pattern` needs images registered on the map.
- Owner rendering on prod cannot be scripted past Google auth; the map cannot
  load on homeserv without a Mapbox credential in the local DB. Verification is
  therefore: unit tests for every pure module, the Playwright preview for the
  DOM at ten widths, the porkserv gate plus the structural gates, and a
  post-deploy check that the deployed CSS carries the new scoped classes.
- Source footprint headroom (2026-09-12): production 632k/910k, projects
  79k/100k. The route lives under `src/routes/projects` — a 21k-line ceiling.
- `daydream_digests` has a unique `(subject, day)` — a second subject needs no
  schema change. **No schema change anywhere in this build.**

## Architecture

### 1. The map adapter grows one primitive (`src/lib/maps/mapbox.ts`)

- New layer kind `'collection'`: `M.featureCollection(features, opts)` where
  `features: Array<{ rings: LatLng[][]; properties: Record<string, unknown> }>`
  (still `[lat, lon]` at the boundary, converted inside). `draw()` adds ONE
  source holding a `FeatureCollection` of Polygons and the same fill (+hatch
  image) and line layers the polygon kind adds — so a player's whole territory
  is 1 source, 2 layers, 1 image. Five players: 5 sources, 10 layers, 5 images.
- `setData(features)` replaces the source data in place (filter changes no
  longer tear layers down).
- `bindTooltip(text | (properties) => string, opts)` — a function is evaluated
  against the hovered feature's properties.
- `on('click', fn)` on a collection hands `fn` `{ latlng, properties }` of the
  top feature.
- `setPaint(props)` forwards known keys (`line-opacity`, `fill-opacity`) to
  `setPaintProperty` on the layer's ids — the pulse layer animates this.
- `M.map(el, { theme: 'schematic' | 'nautical' | 'outdoors' })` resolves the
  style BEFORE construction (the same mapping `setTheme` uses), so a light
  basemap does not cost a second style load. Landgrab uses `schematic`
  (`light-v11`): the basemap is context, and five hatched colours must be the
  only saturated thing on screen.

Nothing existing changes behaviour: `polygon`, `polyline`, markers and the
health/trails maps are untouched.

### 2. Pure geo modules (`$lib/geo`, all tested, no DB)

- **`ownership.ts`** exports `ownershipTimeline(events, now): TileFlip[]` —
  `{ key, at, day, from: string | null, to: string }` for every moment a cell's
  leader changed, reusing `dedupeEvents` and `standingsAt`. `resolveOwnership`
  is left as is (it is the hot path of the ingest).
- **`history.ts`** — `regionHistory(events, cells, now)` → `RegionHistory`:
  a `timeline` (one point per day on which any flip occurred, plus a final point
  at `now`, each `{ day, cells: Record<subject, number> }` — cells held over the
  region), the `flips` aggregated per day per `(from, to)`, a `battle` row per
  subject (`events`, `loops`, `tramples`, `fills`, `activeDays`, `cellsNow`,
  `cellsPeak`, `took`, `lost`, `firstAt`, `lastAt`), and `handovers` (flips whose
  `from` is not null). O(events).
- **`focus.ts`** — `chooseFocus({ changed, active, home })` → `MapFocus`.
  Weight 3 per cell that changed hands in the window, 1 per cell with an event
  in the window. Bin at z14 (shift 5 from the z19 ledger ≈ 1.4 km bins), grow
  8-connected clusters over bins carrying ≥ 10% of the heaviest bin. The home
  cluster is the heaviest one intersecting `HOME_BOX`. Rule: pick the heaviest
  away cluster only if its weight is ≥ 2× the home cluster's AND ≥ 25% of the
  total; otherwise home. No weight at all → `reason: 'quiet'` and the home box.
  Bounds = the cluster's cell bbox padded 10%, never narrower than 1.5 km on
  either axis (one block walk must not zoom to z18). `label` is a sentence the
  map head prints.
- **`battlegrounds.ts`** — `findBattlegrounds({ visitors, ownerByCell,
  ownerThenByCell, minCells = 6 })` → `Battleground[]` (4-connected components
  of cells with 2+ visitors; `id` = the lexicographically smallest tile key;
  `holders` desc; `handovers` = cells in the component whose owner differs from
  a week ago; `contenders`), ranked by handovers then cells. And
  `nextMoves({ owned, subjects })` → `NextMove[]`: for each player P, cells held
  by someone else within Chebyshev distance 2 of P's ground, `gap = ownerScore −
  P's score there` (P's score is `runnerUpScore` when P is the runner-up, else
  0 — an overestimate of the gap, so a move is never sold as easier than it
  is); take the 60 cheapest, 8-connect them, report the largest component:
  `cells`, majority `holder`, `centre`, `maxGap`, and `loopCells =
  floor(LOOP_WEIGHT / maxGap)` — "a single loop of up to N cells takes them".
  Cells with `gap > 1` are ignored (nothing short of a week of visits moves them).
- **`weekly.ts`** — `gatherLandgrabWeek(now)` (DB, thin), and pure
  `phraseLandgrabWeek(facts)`, `weekFactLines(facts)`, `numericStats(facts)`,
  plus `saveLandgrabWeekly` / `landgrabWeeklyExists` / `latestLandgrabWeekly`
  on `daydream_digests` under subject `landgrab-weekly`. Facts, all under the
  page's default 30-day window so the letter and the page agree:
  per subject cells now / a week ago / gained / lost / net (and km²), active
  days in the week, current streak (consecutive days with ≥ 1 event ending
  today or yesterday); `takes` — the handover matrix `{ from, to, cells }` top
  5; `biggestClaim` of the week from `geo_claims`; contested holds now vs then;
  the battleground of the week (most handovers, named); `quiet` when the week
  had no events. The phrase is deterministic and names movers first:
  "Week to Sun 13 Sep. Rory +0.21 km² (took 0.09 off John around South Park),
  Katie +0.12, John −0.30. Biggest claim: John's 1.2 km² ride loop on Tuesday.
  Contested ground: Rory 55% → 58%." A quiet week says so.

### 3. Server (`src/routes/projects/landgrab`)

- **`query.server.ts`** — the filter parse and the ownership resolution
  extracted VERBATIM from the loader: `parseFilter(url)`, `resolveBoard({ now,
  filter })` returning `{ ownedNow (full TileOwnership incl. scores), ownedThen,
  visitors, tileRange, cellAreaM2, players, … }`. One definition, two callers.
  The unfiltered `geo_tile_state` branch now selects the score, runner-up and
  last-event columns too, so both branches return the same shape.
- **`+page.server.ts`** — composes the payload from `resolveBoard`, adding:
  `focus` (from `chooseFocus`), `handovers` (cells whose owner differs from a
  week ago, dissolved with `chaikinPasses: 0` so the outline reads as ground
  that moved, not as a blob), `share` (per player: cells, share of household
  ground, and share of `HOME_BOX` = cells inside the box × cell area ÷ box
  area), `battlegrounds` (top 12, named), `nextMoves`, `letter` (the latest
  `landgrab-weekly` row or null), and `geo` (a validated `?geo=x:y` deep link,
  or null). The geos and longest-held boards are no longer computed.
- **`names.server.ts`** — `nameFor(centre)`: the nearest `daydream_places`
  label within 250 m, else `suggestPlaceName` (its own app_settings cache),
  at most 3 uncached lookups per load, sequential. Unnamed battlegrounds render
  as "near 54.52, −1.55" rather than blocking the page.
- **`geo/+server.ts`** — `GET ?x=&y=&activity=&who=&window=` → `RegionHistory`
  JSON. Guarded by `isOwnerRequest` → 404 BEFORE any query, `private, no-store`,
  with a `guard.test.ts` copied from the page's. Resolves ownership under the
  same filter (window included — the region must be the one on screen), finds
  the 4-connected same-owner component containing the cell (or one of its 8
  neighbours — a tap between smoothed rings), reads every event in the
  component's bbox from `geo_capture_events` under the activity + subject
  filter but NOT the window (history is history; the drawer says so), filters
  to the component's cells in memory, and returns `regionHistory(...)`. A miss
  is 404 `{ error: 'no ground here' }`. The route is added to
  `.github/public-routes.txt` via `npm run gate:public-routes -- --write` with
  the self-gate confirmed in the PR.

### 4. The page (five sections — the QA script asserts five heads)

Cover band (ink, unchanged register): eyebrow · "WALK IT / TO OWN IT." ·
standfirst · deck = **Ground in play** (km², cells) · **Changed hands**
(cells, this window) · **Battlegrounds** (count).

- **01 / The map — WHERE THE GROUND MOVED.** `MapStage.svelte`: the filter
  toolbar (activity chips, window radios, player chips — each group a
  horizontally scrolling row under 700px), then the map in `SegmentGround`'s
  picture frame (2px `--card-border`, 12px padding, head row "Territory · light
  basemap" + the focus label), the map (`60vh` desktop, `aspect-ratio: 4 / 5`
  with `min-height: 420px` under 700px), a segmented control over the map's
  top-right (**Changed · Home · All** — fit the focus bounds, the home box, or
  every territory), and a key row under the frame (player swatches with km²,
  plus the accent "changed hands" swatch). Tap a territory → the drill.
- **02 / The standings — WHO HOLDS THE GROUND.** `ShareBar.svelte`: ONE
  stacked 100% bar of household ground in player colours + hatches, then a row
  per player: badge, name, km², share, "n% of Darlington", `+gained` /
  `−lost`. Open seats stay as muted rows so the roster's shape is visible.
- **03 / Battlegrounds — WHERE IT IS A FIGHT.** `Battlegrounds.svelte`: a
  fixed-layout table (name · cells · holder with a share bar · handovers ·
  contenders); a row opens the drill. Beneath it **Next best move**: one line
  per player from `nextMoves` ("Katie → 40 of John's cells near South Park —
  a single loop of up to 37 cells takes them").
- **04 / The boards — THE WEEK, READ THREE WAYS.** `LandgrabBoards.svelte`
  trimmed to contested ground, this week (gained/lost), most recent captures;
  the capture feed and the effort lines move here from the old map rail.
- **05 / The letter & the method — LAST WEEK, AND HOW IT IS SCORED.**
  `WeeklyLetter.svelte` (the latest letter: week ending, narrative if verified,
  the deterministic summary; or "the first letter goes out Sunday evening"),
  then the rules list and the method paragraph.

**The drill** — `RegionDrill.svelte`, shell copied from `MethodologyDrawer`
(backdrop, panel, Escape, click-out; a bottom sheet at ≤ 700px, `max-height:
85dvh`). Head: name or "Territory", holder badge, cells + km², held since, and
the line "History ignores the date window". `StackedTimeline.svelte`: a stacked
area of cells held per player over the region, player colours, a padded viewBox
in `TraceChart`'s manner, x labels at first/mid/last day, y = cells. Then the
battle table (player · events as L/T/F · active days · holds now · peak · took
· lost) and the last ten handovers. Opens from a map tap, a battleground row,
and `?geo=x:y` on load (the client fetches the endpoint; the loader only
validates the shape). Mounted ONCE.

`Swatch.svelte` replaces the three copies of the hatch-swatch CSS.

Phone rules: chips ≥ 40px tall under `(pointer: coarse)`; every table
`table-layout: fixed` + `<colgroup>`; nothing may escape the viewport at any
of the ten QA widths except inside a deliberate `overflow-x` scroller.

### 5. The Sunday letter (`src/lib/heartbeat/activities/landgrab-weekly.ts`)

Registered in `registry.ts` (`seedDefaultActions` inserts the row on the next
boot). `defaultCadenceSeconds: 6 * 3600`, active hours 17:00–21:00
Europe/London, Sunday only (`isLocalSunday`), skipped when `geo.enabled` is
false, deduped on the `landgrab-weekly` row for the local day. Narrative:
`resolveDaydreamModel` + `budgetStatus` exactly as `daydream-weekly`, a 2–4
sentence draft over `weekFactLines`, verified at temperature 0, dropped whole
if UNSUPPORTED. Delivery: WhatsApp (`🏁 *Landgrab — the week*`, narrative or
summary, link `https://strangeramblings.com/projects/landgrab`, ≤ 1200 chars)
then a `postHeartbeatNote` into the latest conversation as the floor. Result
`details` carries `quota`, `channel`, `verified`, `facts`.
`config.preview: true` gathers and phrases, returns the facts in `details`,
saves nothing and sends nothing — the Saturday verification run.

## Data flow

```
geo_capture_events ──resolveBoard──▶ ownedNow / ownedThen / visitors
        │                                   │
        │              ┌────────────────────┼──────────────────────┐
        │        chooseFocus          findBattlegrounds       nextMoves
        │        (focus)              (+ names.server)        (moves)
        │                                   │
        └── geo/+server ── component ── regionHistory ──▶ RegionDrill
daydream_digests(landgrab-weekly) ◀── landgrab-weekly handler ──▶ WhatsApp / chat note
```

## Error handling

- The map failing to load (no token, no WebGL) keeps the page: the frame shows
  the existing status line and every board still renders.
- A drill fetch that 404s shows "No ground here" in the drawer and closes on
  the next tap; a network failure shows the message and keeps the drawer open.
- Naming failures fall back to coordinates; they never block the load.
- The letter records `written but not delivered` as an error outcome, exactly
  as the daydream letter does; a failed narrative ships the summary alone.

## Verification (the commands, before the code)

- Unit: `npx vitest run src/lib/geo src/routes/projects/landgrab` — new tests
  for `focus`, `history` (+ `ownershipTimeline`), `battlegrounds`, `weekly`
  phrasing, the endpoint guard; existing suites stay green.
- Render: `SP=<dir> BASE=http://127.0.0.1:5199 node scripts/qa/landgrab-preview.mjs`
  against `vite dev --port 5199` in the worktree (moved out of `.worktrees/` so
  HMR works). Extended to assert: five heads; band ink; the map frame, the
  segmented control and the key exist; the share bar has one segment per
  seated player; the battlegrounds table (when the dev db has contested seed);
  `?geo=x:y` opens the drawer; nothing escapes the viewport at ten widths.
  When the map reports `data-lg-sources`, assert it is ≤ 6.
- Gates: commit, `git add -A`, `./scripts/gate-structural.sh` locally (public
  routes, font sizes, measure, schema imports, boundaries, footprint), then
  `./scripts/gate-remote.sh --build` on porkserv.
- Heartbeat: after deploy, set `config.preview = true` on the `landgrab-weekly`
  row and force `next_run_at = now()`; read the pulse details; restore.
- Live: `build/.deploy-sha` on the VPS matches the merge; the deployed CSS
  carries `.lg-stage`, `.lg-share`, `.lg-drill` scoped classes; the endpoint
  answers 404 anonymously (`curl -sI https://strangeramblings.com/projects/landgrab/geo?x=1&y=1`).

## Out of scope (deliberately)

- Polygon rendering, a time scrubber over per-cell snapshots, and any schema
  change. A per-cell daily snapshot would be the enabling table for a
  scrubber; noted, not built.
- Naming via a second Mapbox token — Nominatim + the household's own places
  suffice, cached.
- Changing the scoring rules. Nothing in this build alters a weight, a
  half-life or the outing alpha.

## Decision Log

| # | Fork | Chosen | Why | Reversible |
|---|---|---|---|---|
| 1 | Per-polygon layers vs one collection per player vs one collection for all | One per player | 5 sources/10 layers instead of hundreds; per-player fill-pattern needs no data-driven image expression; legend isolation is `setLayoutProperty('visibility')` | Yes — adapter keeps `polygon` |
| 2 | Basemap: keep outdoors vs light | light-v11 via a `theme` opt | The comment already claimed desaturation; hatch colours must be the only saturation | Yes — one option |
| 3 | Drill data: in the page payload vs full-page `goto` vs a guarded endpoint | Guarded endpoint | Every region's history in the payload is O(regions × events) per load; a `goto` reloads the whole board on every tap; the endpoint reuses the page's own guard and is a visible line in the public-routes snapshot | Yes |
| 4 | Region identity | Anchor cell under the current filter | Regions are recomputed per load and have no id; a cell is stable and the URL stays readable | Yes |
| 5 | History under the window or not | History ignores the window, respects activity + subject | A history that starts at the window's edge is not a history; the drawer says which | Yes |
| 6 | Letter storage | `daydream_digests` subject `landgrab-weekly` | Unique `(subject, day)` fits; no schema push | Yes |
| 7 | Letter window | The page's default (30d) | The WhatsApp numbers must match what the page shows on Sunday | Yes — one constant |
| 8 | Model narrative | Verified-or-dropped, as `daydream-weekly` | The precedent's bargain: a letter that invents its week is worse than none | Yes |
| 9 | Focus bias rule | Away wins only at ≥ 2× home AND ≥ 25% of total | "Bias Darlington unless a cluster elsewhere is worth focussing on" needs both a ratio and a floor, or one long ride wins every week | Yes — two constants |
| 10 | Darlington's extent | A fixed box (54.497–54.556 N, −1.607 to −1.490 E, ≈ 49.6 km²) in `identity.ts` | No town boundary is available without a geodata dependency; a box is honest if labelled "the Darlington box" | Yes |
| 11 | Next-move gap when P is neither owner nor runner-up | Treat P's score as 0 | Overestimates the gap, so a move is never sold as easier than it is | Yes |
| 12 | Battleground naming | Household places first, Nominatim second, ≤ 3 uncached per load | Nominatim is 1 req/s and the page must not wait on it | Yes |
| 13 | Handover outline smoothing | `chaikinPasses: 0` | Moved ground should read as a crisp edge, not as a second blob | Yes |
| 14 | Boards cut | geos + longest held removed, not hidden | John chose it; the standings' `geos` field stays in the type for the letter | Yes (git) |
| 15 | Which agent builds | Opus on every implementation and review subagent | John's instruction, and the standing rule in memory | — |
