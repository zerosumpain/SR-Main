# Broads Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build `/projects/broads-pilot` — a Norfolk Broads boat route-planner: true waterway routing over an OSM-derived graph, boat-size restriction filtering, moorings/POIs/dog-walks, flippable map themes, Google Places ratings, installable PWA.

**Architecture:** Native SvelteKit (policy-engine pattern) under `src/routes/projects/broads-pilot/`. A build-time data pipeline (`scripts/broads-pilot/`) emits small static JSON datasets to `static/broads-pilot/`. The browser loads them, runs a Dijkstra/A* router with boat-aware passability filtering, and renders a Leaflet map with two flippable themes. One server endpoint (`/api/broads-pilot/ratings`) proxies Google Places. User trips persist in `localStorage` + URL.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, Leaflet (CDN, `/live` pattern), Vitest, Drizzle (ratings cache only), existing Workbox service worker, SR design tokens.

**Reference:** `docs/superpowers/specs/2026-06-19-broads-pilot-design.md` + `-research-brief.md` (sourced facts: bridge clearances, speed zones, fleet, fuel model).

---

## File structure (decomposition)

```
src/routes/projects/broads-pilot/
  +layout.server.ts +layout.svelte +page.svelte  method/+page.svelte
  lib/ types.ts data.ts(load+cache datasets) appState.svelte.ts
      graph.ts router.ts passability.ts fuel.ts daylight.ts tide.ts
      moorings.ts ratings.ts permalink.ts format.ts geo.ts
  components/ BroadsMap.svelte BoatPicker.svelte PlanPanel.svelte
      Reachability.svelte ItineraryBuilder.svelte LayersControl.svelte
      MooringCard.svelte PoiCard.svelte RestrictionCallout.svelte
      ThemeToggle.svelte SafetyBanner.svelte
src/routes/api/broads-pilot/ratings/+server.ts
static/broads-pilot/ graph.json restrictions.json moorings.json pois.json
      mooring_pois.json fleet.json meta.json  manifest.webmanifest
scripts/broads-pilot/ build-graph.ts build-restrictions.ts build-moorings.ts
      build-pois.ts scrape-richardsons.ts lib/overpass.ts lib/geo.ts lib/seed-*.ts
src/lib/db/schema.ts (add broadsPilotRatings table)
src/service-worker.ts (add broads-pilot cache scope)
src/routes/projects/+page.svelte +page.server.ts (add card)
```

**Engine modules are pure TS, unit-tested with Vitest.** UI components verified via dev server + `/run`.

---

## Phase A — Scaffold & contracts

### Task A1: Types module
**Files:** Create `src/routes/projects/broads-pilot/lib/types.ts`
- [ ] Define and export all dataset + domain interfaces exactly as in spec §5 and the engine contracts:

```ts
export type LatLng = [number, number]; // [lat, lng]
export interface GraphNode { id: string; lat: number; lng: number; }
export interface GraphEdge {
  id: string; from: string; to: string; length_m: number; limit_mph: number;
  river: string; way_id: number; geometry: LatLng[];
  restriction_ids: string[]; conservation?: boolean;
  tidal_zone?: 'breydon' | null; max_beam_m?: number | null; max_draft_m?: number | null;
}
export interface WaterGraph { nodes: GraphNode[]; edges: GraphEdge[]; }
export interface Bridge {
  id: string; name: string; river: string;
  clearance_ahw_m: number; clearance_band_m: [number, number];
  tide_dependent: boolean; pilot: 'mandatory' | 'recommended' | null;
  opens_on_request: boolean; practically_closed?: boolean;
  arch_width_m?: number | null; notes: string; lat: number; lng: number;
}
export interface Lock { id: string; name: string; max_loa_m: number; max_beam_m: number;
  max_draft_m: number; hours: string; booking: string; notes: string; lat: number; lng: number; }
export interface Zone { id: string; type: 'conservation' | 'tidal' | 'no_hire';
  geometry: LatLng[]; notes: string; }
export interface Restrictions { bridges: Bridge[]; lock: Lock; zones: Zone[]; }
export interface Mooring {
  id: string; name: string; lat: number; lng: number;
  tier: 'ba_free' | 'ba_staffed' | 'yacht_station' | 'pub' | 'private' | 'marina' | 'hire_yard';
  rate: { amount: number; unit: 'night' | 'metre_night' | 'day' | 'hour' | 'free' };
  waived_with_meal: boolean;
  facilities: { water: boolean; shore_power: boolean; pump_out: boolean; toilets: boolean; showers: boolean; refuse: boolean };
  capacity?: number | null; capacity_caveat: boolean; last_verified: string; source: string;
}
export interface Poi {
  id: string; name: string; kind: 'pub' | 'walk' | 'attraction' | 'shop' | 'fuel';
  lat: number; lng: number; dog_friendly?: boolean | null; food?: boolean;
  description: string; place_id?: string | null; tripadvisor_url?: string | null;
  google_url?: string | null; osm_id?: string; source: string;
}
export type MooringPois = Record<string, { poi_id: string; dist_m: number; on_foot: boolean }[]>;
export interface Boat {
  slug: string; name: string; class: 'modern' | 'classic' | 'dayboat' | 'generic';
  propulsion: 'diesel' | 'electric' | 'unknown';
  sleeps: number; bedrooms?: number; toilets?: number; showers?: number;
  length_ft?: number | null; beam_ft?: number | null;
  air_draft_ft: number; air_draft_m: number; beam_m?: number | null;
  water_draft_m?: number | null; fuel_tank_l?: number | null;
  bridges_blocked: string[]; image?: string | null; url?: string;
}
export type Verdict = 'pass' | 'marginal' | 'blocked';
export interface RouteLeg { edges: GraphEdge[]; distance_m: number; time_s: number;
  blockedAt?: Bridge | null; bridges: { bridge: Bridge; verdict: Verdict }[]; crossesBreydon: boolean; }
export interface Meta { built_at: string; sources: Record<string, string>; attribution: string; }
```
- [ ] Commit: `feat(broads-pilot): dataset + engine types`

### Task A2: geo helpers (TDD)
**Files:** Create `lib/geo.ts`, `lib/geo.test.ts`
- [ ] Test: `haversine([52.7,1.5],[52.7,1.51])` ≈ 674 m (±5). `nearestIndex` returns closest point index.
- [ ] Implement `haversine(a:LatLng,b:LatLng):number` (metres, R=6371000), `polylineLength(pts:LatLng[]):number`, `nearestIndex(target:LatLng, pts:LatLng[]):number`.
- [ ] Run `npx vitest run src/routes/projects/broads-pilot/lib/geo.test.ts` → PASS. Commit.

### Task A3: Route scaffold + visibility guard + projects card
**Files:** Create `+layout.server.ts`, `+layout.svelte`, `+page.svelte`; Modify `src/routes/projects/+page.svelte`, `+page.server.ts`, `src/lib/auth.ts` (PUBLIC_PATHS add `/projects/broads-pilot` already covered by `/projects` prefix — verify; add `/api/broads-pilot`).
- [ ] `+layout.server.ts`: copy policy-engine pattern — `requireProjectPublic('broads-pilot', event)`, set cache headers.
- [ ] `+layout.svelte`: SR header/brand, `<slot/>`, import appState; load Leaflet CSS/JS in `<svelte:head>` (the `/live` `/vendor/leaflet.*` pattern).
- [ ] `+page.svelte`: placeholder "Broads Pilot" heading using `.nm-sec`.
- [ ] Add a project card to `/projects` index (title "Broads Pilot", blurb, link `/projects/broads-pilot`) matching existing hardcoded cards.
- [ ] Verify route loads: `npm run dev`, GET `http://homeserv:5173/projects/broads-pilot` → 200. Commit.

---

## Phase B — Data pipeline (produce REAL datasets)

> Network access required (Overpass, Richardsons). BA site is Cloudflare-gated → curate restrictions/moorings from the research brief as typed seed modules, enrich with OSM where possible. Every dataset writes provenance into `meta.json`.

### Task B1: Overpass + geo build helpers
**Files:** Create `scripts/broads-pilot/lib/overpass.ts`, `scripts/broads-pilot/lib/geo.ts` (Node copy of haversine + union-find).
- [ ] `overpass(query:string):Promise<OsmJson>` — POST to `https://overpass-api.de/api/interpreter`, **descriptive User-Agent** (default → 406), retry/backoff, 90s timeout.
- [ ] `unionFind(n)` with `union`/`find`/`components()`.

### Task B2: build-graph (Overpass → connected waterway graph)
**Files:** Create `scripts/broads-pilot/build-graph.ts`; Output `static/broads-pilot/graph.json`
- [ ] Overpass over bbox `52.30,1.28,52.85,1.80`: `way["waterway"~"river|canal"]` (+ `out body; >; out skel qt;`). Pull node coords.
- [ ] Build nodes (shared/endpoint OSM nodes) + edges (inter-node segments, `length_m` via haversine over the way's node coords, `geometry`, `river` from name, `way_id`, `limit_mph` default by river rule from brief §2, `restriction_ids:[]`).
- [ ] Run union-find; assert the main rivers form ≥1 large connected component; log component sizes; keep the giant component + reachable broads; drop tiny orphan fragments (log count dropped — **no silent truncation**).
- [ ] Snap navigable broads: for the named broads in the seed list (Wroxham, Salhouse, Ranworth/Malthouse, Barton, Hickling, Horsey Mere, Oulton, South Walsham, Womack), connect each broad's entrance node (nearest river node to the access dyke) — emit a destination node at the broad centroid + a short edge from the entrance. Conservation broads excluded.
- [ ] Write `graph.json` + provenance. Run `tsx scripts/broads-pilot/build-graph.ts`; assert nodes>200, edges>200, ≤2 large components. Commit graph.json.

### Task B3: build-restrictions (curated, re-verified)
**Files:** Create `scripts/broads-pilot/lib/seed-restrictions.ts`, `build-restrictions.ts`; Output `restrictions.json`
- [ ] Hand-encode the bridge table from research brief §3 (every bridge: name, river, clearance_ahw_m, clearance_band_m, tide_dependent, pilot, opens_on_request, practically_closed, lat/lng). Potter Heigham Old `practically_closed:true`.
- [ ] Encode Mutford lock + conservation/tidal zones (Breydon polygon approx; conservation broads list as no-go zones).
- [ ] **Re-verify** each clearance against ≥1 independent source (operator-rehosted BA bridge sheet, e.g. huntersyard.co.uk; Wikipedia) — note the source per bridge; flag any disagreement >0.1 m by widening `clearance_band_m`.
- [ ] Associate bridges to graph edges (by nearest edge to bridge lat/lng) → write `restriction_ids` back into `graph.json`. Run; assert all bridges mapped to an edge. Commit.

### Task B4: build-moorings
**Files:** Create `scripts/broads-pilot/lib/seed-moorings.ts`, `build-moorings.ts`; Output `moorings.json`
- [ ] Seed ~30–50 key moorings from brief §4 (Acle Bridge, Coltishall Common, Horning Staithe, How Hill, St Benet's, Reedham Quay, Ranworth, Norwich YS, Yarmouth YS, Salhouse, Brundall Bay, Ferry Marina Horning, Stalham/Richardsons, pub moorings) with tier/rate/facilities/`last_verified:'2025'`.
- [ ] Enrich/augment via OSM Overpass (`mooring`, `leisure=marina`) — dedupe against seeds by proximity (<80 m). Snap each mooring to nearest graph node (store `node_id`). Run; assert ≥30 moorings, all snapped. Commit.

### Task B5: build-pois (+ mooring adjacency)
**Files:** Create `scripts/broads-pilot/build-pois.ts`, `lib/seed-pois.ts`; Output `pois.json`, `mooring_pois.json`
- [ ] Overpass: `amenity=pub|restaurant|cafe` (capture `dog`, `food`), `tourism=attraction|museum|viewpoint`, `leisure=nature_reserve` over the bbox. Map to `Poi` (kind, dog_friendly, food, description from tags).
- [ ] Seed curated dog-walks + named pubs from brief §7 (Ranworth boardwalk, How Hill trails, Salhouse woods; Swan/New/Ferry Inn Horning, Ferry Inn Stokesby, Lion Thurne, Ship Reedham, Maltsters Ranworth, Berney Arms) with `tripadvisor_url`/`google_url`/`place_id` where known.
- [ ] Precompute `mooring_pois.json`: for each mooring, POIs within 1 km (haversine), bucketed 200/500/1000 m, `on_foot` if a footpath exists nearby (approx: within radius). Run; assert pubs>20, every mooring has an adjacency entry (possibly empty). Commit.

### Task B6: scrape-richardsons (fleet)
**Files:** Create `scripts/broads-pilot/scrape-richardsons.ts`, `lib/seed-fleet.ts`; Output `fleet.json`
- [ ] Fetch `/all-boats/` index (realistic UA), collect boat slugs; fetch each `/all-boats/{slug}/`; parse name, sleeps, berth config, **air draft** ("6ft 9in"→m), dimensions where present, and the **bridge-passability sentence** → `bridges_blocked` (map phrases "cannot pass Potter Heigham/Wroxham/Wayford/Beccles" to bridge ids).
- [ ] Fallback `seed-fleet.ts` with ~12 known boats (Dominica, Broadway, Broadsman, Commodore, San Francisco, Broadsventure, etc. from brief §5) if the scrape under-returns; merge. Add a `generic` 35ft cruiser (air_draft_m 2.3, beam_m 3.7, draft 1.0, tank 110L). Run; assert ≥12 boats, all have `air_draft_m`+`bridges_blocked`. Commit.

### Task B7: meta + dataset loader
**Files:** Create `lib/data.ts`; Output `meta.json`
- [ ] `meta.json`: `built_at`, per-source version strings, OSM ODbL attribution.
- [ ] `lib/data.ts`: `loadDatasets():Promise<{graph,restrictions,moorings,pois,mooringPois,fleet,meta}>` — `fetch('/broads-pilot/*.json')`, cache in a module singleton. Commit.

---

## Phase C — Engine (pure TS, TDD)

### Task C1: passability (TDD)
**Files:** Create `lib/passability.ts`, `lib/passability.test.ts`
- [ ] Constants: `SAFETY_MARGIN_M = 0.3`, `groundSpeedMs(mph)=mph*0.44704`.
- [ ] Tests (use a fixture Bridge: clearance_band_m `[1.98,2.03]`, plus Acle `[3.66,3.66]`):
  - generic cruiser (air 2.3 m) at Potter Heigham (band min 1.98) → `blocked`.
  - boat air 3.4 m at Acle (3.66) → `marginal` (within 0.3 m). boat air 3.0 m at Acle → `pass`. boat air 3.7 m at Acle → `blocked`.
  - bridge.practically_closed → `blocked` regardless. bridge id ∈ boat.bridges_blocked → `blocked`.
- [ ] Implement `bridgeVerdict(bridge:Bridge, boat:Boat):Verdict`:
```ts
export function bridgeVerdict(b: Bridge, boat: Boat): Verdict {
  if (boat.bridges_blocked.includes(b.id)) return 'blocked';
  if (b.practically_closed && boat.class !== 'dayboat') return 'blocked';
  const clear = b.clearance_band_m[0];
  if (boat.air_draft_m > clear) return 'blocked';
  if (boat.air_draft_m > clear - SAFETY_MARGIN_M) return 'marginal';
  return 'pass';
}
```
- [ ] `edgeVerdict(edge, restrictions, boat):Verdict` = worst of its bridges (+ beam/draft vs edge.max_beam/max_draft). `edgePassable = verdict!=='blocked'`. Run → PASS. Commit.

### Task C2: graph index + nearest (TDD)
**Files:** Create `lib/graph.ts`, `lib/graph.test.ts`
- [ ] Test on a 3-node fixture graph: `buildAdjacency` yields correct neighbours; `nearestNode` returns closest node id.
- [ ] Implement `buildAdjacency(graph):Map<string,{edge:GraphEdge;to:string}[]>` (both directions), `nearestNode(graph,lat,lng):string`. Run → PASS. Commit.

### Task C3: router — Dijkstra with passability + speeds (TDD)
**Files:** Create `lib/router.ts`, `lib/router.test.ts`
- [ ] Tests on a fixture graph with a blocked bridge on the short edge:
  - shortest-time route avoids the blocked edge and reports `blockedAt` only when no alternative.
  - `time_s` uses `length_m / groundSpeedMs(limit_mph)`.
  - `reachable(from, budget_s)` returns the set within budget.
- [ ] Implement:
```ts
export function route(graph, restrictions, boat, fromId, toId): RouteLeg { /* Dijkstra over time weight; skip edgeVerdict==='blocked'; collect bridges+verdicts; crossesBreydon = any edge.tidal_zone==='breydon' */ }
export function reachable(graph, restrictions, boat, fromId, budgetS): Map<string,{time_s:number;dist_m:number}> { /* multi-target Dijkstra capped at budgetS */ }
```
  efficiency factor 0.9 on speed; `min(limit, boatCruise=6)`. Run → PASS. Commit.

### Task C4: fuel + daylight + tide (TDD)
**Files:** Create `lib/fuel.ts` `lib/daylight.ts` `lib/tide.ts` + tests
- [ ] fuel test: `lph(3)≈0.65, lph(5)≈1.19, lph(6)=1.70` (±0.02). `routeFuel(leg, boat, pricePerL)` sums per-edge `time_hr*lph(speed)`; returns `{litres, cost}`.
```ts
export const lph = (vmph:number)=>0.5+1.2*Math.pow(vmph/6,3);
```
- [ ] daylight test: `sunTimes(date, 52.6, 1.5)` returns sunrise/sunset within ±3 min of reference (e.g. 2026-06-21 ≈ 04:33 / 21:42 BST). Implement NOAA solar algorithm; `daylightHours()`.
- [ ] tide test: `nextSlackWindows(refLowWater:Date, count)` returns windows centred ~LW+1h spaced 12h25m; `breydonAdvice(legStartNode)` returns guidance text + transit estimate. Implement (semidiurnal period 44700 s). Run all → PASS. Commit.

---

## Phase D — State + planner UI

### Task D1: appState rune-store
**Files:** Create `lib/appState.svelte.ts`, `lib/format.ts`, `lib/permalink.ts`
- [ ] `class AppState`: `$state` for `boat:Boat|null`, `origin:{lat,lng,node}|null`, `route:RouteLeg|null`, `itinerary:string[]` (mooring/poi ids), `layers:{restrictions,moorings,pubs,walks,attractions:boolean}`, `dogOnly:boolean`, `mapTheme:'warm'|'nautical'`, `units:'imperial'|'metric'`, `selected:{kind,id}|null`. `$derived` reachable set when origin+boat set. Persist to `localStorage`; encode/restore from URL via `permalink.ts`.
- [ ] `format.ts`: `fmtDist(m,units)`, `fmtTime(s)`, `fmtMoney(n)`, `mToFtIn(m)`. Commit.

### Task D2: BroadsMap (Leaflet, 2 themes)
**Files:** Create `components/BroadsMap.svelte`
- [ ] `onMount` init Leaflet (guard `window.L`), default centre `[52.68,1.45]` z11. Two tile layers: **warm** (custom style — first cut: OSM tiles + CSS filter `sepia()/hue-rotate/saturate` to parchment/warm; later swap to a MapTiler style URL) and **nautical** (OpenStreetMap + OpenSeaMap seamark overlay). Toggle by `appState.mapTheme`.
- [ ] Render layers reactively ($effect): route polyline (burnt-orange), restriction markers coloured by current boat verdict, mooring markers by tier, POI markers (filter by layers + dogOnly), origin marker, range-ring circles. Click handlers set `appState.selected`. Geolocation control → set origin (snap to nearest node). Commit.

### Task D3: BoatPicker + SafetyBanner
**Files:** Create `components/BoatPicker.svelte`, `components/SafetyBanner.svelte`
- [ ] BoatPicker: select from `fleet.json` (grouped modern/classic/dayboat + generic). On select → spec card (air draft ft+m, beam, length, berths, propulsion) + **bridge pass-matrix** (each named bridge → pass/marginal/blocked chip via `bridgeVerdict`). SR `.nm-sec` styling.
- [ ] SafetyBanner: persistent dismissible-per-session strip — "Planning aid only — clearances are tidal & advisory; check the gauge board & BA notices." Commit.

### Task D4: PlanPanel + RestrictionCallout
**Files:** Create `components/PlanPanel.svelte`, `components/RestrictionCallout.svelte`
- [ ] PlanPanel (shown when `route` set): distance, cruising time, fuel litres + £, list of bridges en route with verdict chips, Breydon advisory (via `tide.breydonAdvice`) if `crossesBreydon`, daylight warning if `time_s*2 > daylightBudget`. "Add to itinerary" button.
- [ ] RestrictionCallout (drawer when a bridge/lock selected): clearance band, tide caveat, pilot/opens-on-request, this-boat verdict, phone/notes. Commit.

### Task D5: Reachability + LayersControl + ThemeToggle
**Files:** Create `components/Reachability.svelte`, `components/LayersControl.svelte`, `components/ThemeToggle.svelte`
- [ ] Reachability: when origin+boat set, list reachable moorings/destinations (time/dist/fuel) sorted by time, within daylight budget; "range rings" toggle draws network-distance circles. Click → route there.
- [ ] LayersControl: toggles for restrictions/moorings/pubs/walks/attractions + dog-only filter. ThemeToggle: warm⇄nautical. Commit.

### Task D6: MooringCard + PoiCard + ratings client
**Files:** Create `components/MooringCard.svelte`, `components/PoiCard.svelte`, `lib/ratings.ts`
- [ ] MooringCard (drawer): tier label, charge (rate+unit, waived_with_meal note), facilities row (shore-power highlighted), capacity caveat, `last_verified`, **nearby POIs** (from `mooring_pois`, grouped by distance bucket, dog filter applied).
- [ ] PoiCard: name, kind, dog flag, food flag, description, **rating + count + highlight/lowlight** (via `ratings.ts` → `/api/broads-pilot/ratings?place_id=`), deep-link buttons (TripAdvisor/Google). `ratings.ts` caches in-memory + fails soft (deep-link only) when offline/no key. Commit.

### Task D7: Assemble +page.svelte (the planner)
**Files:** Modify `+page.svelte`
- [ ] Compose: full-screen BroadsMap + overlay panels (BoatPicker top-left, LayersControl + ThemeToggle, Reachability/PlanPanel as bottom-sheet on mobile / side panel desktop, drawers for selected mooring/POI/restriction, SafetyBanner). Wire all to `appState`. Mobile-first CSS (`@media (pointer:coarse)` bottom sheets, thumb targets).
- [ ] Load datasets on mount via `lib/data.ts`; loading state. Restore plan from URL. Verify end-to-end in dev. Commit.

---

## Phase E — Ratings API, PWA, method page, polish

### Task E1: ratings endpoint + cache table
**Files:** Create `src/routes/api/broads-pilot/ratings/+server.ts`; Modify `src/lib/db/schema.ts` (add `broadsPilotRatings`), `src/lib/auth.ts`/`hooks.server.ts` (public path `/api/broads-pilot/ratings`).
- [ ] `broadsPilotRatings(place_id PK, rating, count, highlight, lowlight, fetched_at)`.
- [ ] GET `?place_id=`: serve cache if `fetched_at` within window (e.g. 21 days, Places ToS); else fetch Google Places Details (`GOOGLE_PLACES_API_KEY`), extract rating/count + top positive + top critical review snippet, upsert, return. Fail soft (200 with `{available:false}`) when no key. Commit.

### Task E2: PWA manifest + service worker scope
**Files:** Create `static/broads-pilot/manifest.webmanifest`, icons; Modify `src/service-worker.ts`, `+layout.svelte` (manifest link, theme-color).
- [ ] Manifest: name "Broads Pilot", start_url `/projects/broads-pilot`, display standalone, SR colours, icons.
- [ ] SW: precache `/broads-pilot/*.json` (StaleWhileRevalidate); tiles NetworkFirst; ratings NetworkOnly. Commit.

### Task E3: /method page + disclaimer
**Files:** Create `method/+page.svelte`
- [ ] Document: data sources + licensing (OSM ODbL attribution, BA, Richardsons), the routing/fuel/daylight models + assumptions, the **safety disclaimer** (advisory clearances, 0.3 m margin, check gauge board, not for navigation-critical decisions), `meta.built_at` "data last updated". Commit.

### Task E4: Independent safety re-verification pass
**Files:** Modify `restrictions.json` / `seed-restrictions.ts` as needed
- [ ] Dispatch verification of every bridge clearance + speed zone against independent sources; correct any value; widen bands on disagreement; record source per bridge in notes. Re-run build-restrictions. Commit.

### Task E5: Full verification + deploy
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npm run check` (engine/types clean).
- [ ] `npx vitest run src/routes/projects/broads-pilot` → all PASS.
- [ ] `npm run build` (sandbox disabled) → success.
- [ ] Visual smoke via `/run` or dev: pick boat → set origin → route → restrictions/moorings/POIs render; theme toggle; mobile layout; PWA installable.
- [ ] Deploy via `scripts/deploy.sh`; verify live at `strangeramblings.com/projects/broads-pilot`. Commit + push branch.

---

## Self-review notes
- **Spec coverage:** boat select (D3) ✓ · waterway routing+speeds (C3) ✓ · time/dist/fuel/range (C3/C4/D4) ✓ · restrictions+risk by boat size (C1/D3/D4) ✓ · moorings+charges (B4/D6) ✓ · POIs/pubs/dog-walks (B5/D6) ✓ · ratings (E1/D6) ✓ · GPS/manual location (D2) ✓ · flippable themes (D2/D5) ✓ · PWA offline datasets (E2) ✓ · safety posture (C1/D3/E3/E4) ✓ · /method (E3) ✓ · deploy (E5) ✓.
- **Types consistent:** `RouteLeg`, `Verdict`, `bridgeVerdict`, `groundSpeedMs`, `lph`, `loadDatasets` referenced identically across tasks.
- **No silent caps:** build-graph logs dropped fragments; fleet/moorings assert minimum counts.
- **Hedged unknowns:** fuel fields nullable+flagged; clearances banded+margined; tide advisory only.
