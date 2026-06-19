# Broads Pilot — Design Spec

> **Status:** approved direction, pre-implementation.
> **Working name:** "Broads Pilot" (slug `broads-pilot`) — changeable; alternatives considered: Tideline, Reach, Staithe.
> **Companion:** `2026-06-19-broads-pilot-research-brief.md` holds the sourced data-grounding (network, speed zones, restrictions table, moorings, fleet, fuel model). This spec references it rather than repeating figures.
> **Lives in:** `~/strange_rambling_svelte/` → route `/projects/broads-pilot`.

---

## 1. Purpose & audience

A trip-planner for a **Norfolk Broads boating holiday**. The user is a holidaymaker (likely a Richardsons hire-boat customer) who wants to understand *what they can realistically do* from where they are: where they can get to, how long it takes, what it costs in fuel, what's moored/walkable/drinkable/eatable there, and — critically — **what their specific boat can and cannot pass** (bridges, narrow dykes, the Breydon tidal crossing) and the risks involved.

The product promise: **"Pick your boat, drop a pin, and see exactly where you can go today — safely."**

It must work as a normal responsive web app and as an **installable mobile PWA** (online-first, with the core planner/data working offline; map tiles online-first).

---

## 2. Goals & non-goals (v1)

**Goals**
- Select a **Richardsons boat** (or a generic fallback) and carry its air-draft / beam / length / bridges-blocked into every calculation.
- **True waterway routing** along the actual river network (not crow-flies), respecting per-stretch **speed limits** (3/4/5/6 mph).
- Per-leg **travel time, distance, fuel burn + £ estimate**, and network-distance **reachability ("how far can I get")**.
- **Restriction & risk surfacing keyed to boat size**: bridges (pass/marginal/blocked), the Mutford lock, narrow dykes, shallow broads, conservation no-go zones, the Breydon tidal crossing, and the **hire-boat daylight (sunrise–sunset) rule** — as advisory warnings.
- **Moorings** (tier, charge, facilities incl. shore-power, capacity caveat) and **POIs** near moorings: pubs (food, **dog-friendly filter**), **dog walks** from moorings, attractions — each with a **rating + deep-link**.
- **Multi-stop itinerary** builder with per-day daylight budgeting; save to `localStorage` + shareable URL.
- **Two flippable map themes**: default SR warm-brutalist "chart", toggle to a nautical sea-chart style.
- A **`/method`** page documenting sources, assumptions, and the safety disclaimer.
- Installable **PWA**; planner + routing + datasets work offline.

**Non-goals (deferred to v2+)**
- Full **tide-optimal time-windowed router** (auto-timed Breydon crossings against the live Gt Yarmouth tide curve). v1 treats tide/daylight as **advisory**.
- **Offline map-tile pack** for the Broads bbox (v1 tiles are online-first). Pattern exists in `~/offline-maps/`.
- **Multi-operator** fleets (v1 = Richardsons only, the named operator).
- **Live Project Troll** real-time bridge-clearance feed integration (needs permission). v1 = worst-case AHW + safety margin + "check the gauge board".
- **DB-backed saved/published/shared routes** (v1 = client-side `localStorage` + URL state).
- Account/login (v1 = fully public, anonymous).

---

## 3. Locked decisions

| # | Decision | Choice |
|---|---|---|
| Scope | Ambition | Full v1, built autonomously |
| Data | Sourcing | Pragmatic mix (scrape Richardsons; OSM + BA for nav/moorings; model fuel; curated POIs; deep-link ratings) |
| Arch | Integration / offline | Native SvelteKit routes, online-first, installable PWA (datasets cached offline, tiles online-first) |
| Routing | Time model | **Graph routing + advisory tides** — legal-speed river routing + fuel/range + restriction filtering; Breydon/daylight as warnings with a slack-water helper |
| Map | Visual language | **Flippable themes** — default custom SR warm-brutalist chart; toggle to nautical sea-chart |
| Ratings | Source | **Google Places numeric rating + cacheable highlight/lowlight review snippets** (ToS-compliant window + attribution) + deep-link out to TripAdvisor/Google |

---

## 4. Architecture overview

Native SvelteKit, mirroring the **`policy-engine`** project pattern (shared rune-store + `+layout`), but the core is a **single-page map planner** with deep-linkable URL state rather than many sub-routes.

```
src/routes/projects/broads-pilot/
  +layout.server.ts        # requireProjectPublic('broads-pilot') guard + cache headers
  +layout.svelte           # shell: header (SR brand), theme toggle, loads appState
  +page.svelte             # THE PLANNER (map + boat picker + plan panel + layers)
  method/+page.svelte      # data sources, assumptions, SAFETY DISCLAIMER
  lib/
    appState.svelte.ts     # rune-store: boat, location, waypoints, route, layers, theme, narrative
    graph.ts               # load bundled graph; build node/edge index; nearest-node snap
    router.ts              # Dijkstra/A* over edges; reachability; respects passability + speeds
    passability.ts         # boat × restriction → pass | marginal | blocked (per edge/bridge)
    fuel.ts                # Lph(v) consumption model; per-leg litres + £; electric variant
    daylight.ts            # sunrise/sunset (astronomical, no API) → daily cruising budget
    tide.ts                # advisory Breydon slack-water helper (next ~LW+1h windows)
    moorings.ts            # mooring lookup, tiers, facilities, POI adjacency join
    ratings.ts             # client helper hitting /api/broads-pilot/ratings (cached)
    permalink.ts           # encode/decode plan ↔ URL (like policy-engine scenarios)
    format.ts              # units (mph, mi/km, ft/m, £), time formatting
    types.ts               # shared TS types for all datasets
  components/
    BroadsMap.svelte       # Leaflet wrapper; theme-aware tiles; layers; markers; route polyline
    BoatPicker.svelte      # Richardsons fleet select + spec card + bridge pass-matrix
    PlanPanel.svelte       # leg summary: time/dist/fuel/£ + restrictions en route + warnings
    Reachability.svelte    # "how far can I get" list + range rings toggle
    ItineraryBuilder.svelte# multi-stop, per-day daylight budget
    LayersControl.svelte   # toggle restrictions / moorings / pubs / walks / attractions; dog filter
    MooringCard.svelte     # tier, charge, facilities, shore-power, capacity caveat, nearby POIs
    PoiCard.svelte         # pub/walk/attraction; rating + highlight/lowlight; deep-link; dog flag
    RestrictionCallout.svelte # bridge/lock/zone detail; clearance vs your boat; tide caveat
    ThemeToggle.svelte     # warm-brutalist ⇄ nautical map theme
    SafetyBanner.svelte    # persistent "advisory only — check the gauge board" disclaimer

static/broads-pilot/        # bundled, SW-precached datasets (built by scripts/)
  graph.json               # nodes + edges (length, limit_mph, name, nav tags, restriction refs)
  restrictions.json        # bridges + lock + speed zones + tidal/conservation zones
  moorings.json            # moorings (tier, charge, facilities, last_verified)
  pois.json                # pubs/walks/attractions (+ tripadvisor/google deep-link, place_id)
  mooring_pois.json        # mooring_id → [{poi_id, dist_m}] adjacency (precomputed)
  fleet.json               # Richardsons boats (air_draft, beam, length, bridges_blocked, …)
  meta.json                # build timestamp, source versions, attribution

src/routes/api/broads-pilot/
  ratings/+server.ts       # Google Places proxy: place_id → {rating, count, highlight, lowlight}, cached
  # (optional v2) tide/+server.ts, refresh/+server.ts (service-to-service, secret + hooks bypass)

scripts/broads-pilot/       # build-time data pipeline (run locally, output → static/broads-pilot/)
  build-graph.ts           # Overpass extract → connected waterway graph + broad snapping
  build-speed-zones.ts     # hand-transcribed BA Schedule 1 → per-edge limit_mph
  build-restrictions.ts    # curated bridge/lock/zone table (from research brief, re-verified)
  build-moorings.ts        # BA + OSM → moorings.json
  build-pois.ts            # OSM → pois.json + precompute mooring_pois.json
  scrape-richardsons.ts    # fleet specs → fleet.json
  lib/overpass.ts, lib/geo.ts (haversine, union-find, snapping)
```

**Why this shape:** routing data is small (~200–500 edges) so it ships as **static JSON, fetched + SW-precached** → instant routing, works offline, no server round-trips for the core experience. The **only** server endpoint is `ratings` (server-side Google Places key + a small cache, since Places ratings can't live in the client/bundle). User trip data is **client-side** (`localStorage` + URL permalink) — no login, no DB, friction-free for holidaymakers.

---

## 5. Data model (bundled datasets)

All under `static/broads-pilot/`, typed in `lib/types.ts`. `meta.json` carries build time + source versions for the `/method` page and a "data last updated" stamp.

- **graph.json** — `{ nodes: {id, lat, lng}[], edges: {id, from, to, length_m, limit_mph, river, way_id, nav_tags, geometry:[ [lat,lng]… ], restriction_ids:[…], min_air_draft_m?, max_beam_m?, max_draft_m?, conservation?:bool, tidal_zone?:'breydon'|null}[] }`. Edges carry their own restriction refs so the router can filter without a separate join.
- **restrictions.json** — `{ bridges: {id, name, river, clearance_ahw_m, clearance_band_m:[min,max], tide_dependent:bool, pilot:'mandatory'|'recommended'|null, opens_on_request:bool, practically_closed?:bool, notes, lat, lng}[], lock: {…Mutford specs, hours, booking}, speed_zones: {edge_id, limit_mph}[], zones: {id, type:'conservation'|'tidal'|'no_hire', geometry, notes}[] }`.
- **moorings.json** — `{ id, name, lat, lng, tier, rate:{amount, unit:'night'|'metre_night'|'day'|'hour'|'free'}, waived_with_meal:bool, facilities:{water, shore_power, pump_out, toilets, showers, refuse}, capacity?:number, capacity_caveat:bool, last_verified:'YYYY', source }[]`.
- **pois.json** — `{ id, name, kind:'pub'|'walk'|'attraction'|'shop'|'fuel', lat, lng, dog_friendly?:bool|null, food?:bool, description, place_id?:string, tripadvisor_url?, google_url?, osm_id, source }[]`.
- **mooring_pois.json** — `{ [mooring_id]: {poi_id, dist_m, on_foot:bool}[] }` (radius buckets 200 m / 500 m / 1 km).
- **fleet.json** — `{ slug, name, class, propulsion, sleeps, bedrooms, toilets, showers, length_ft?, beam_ft?, air_draft_ft, air_draft_m, water_draft_m?:null, fuel_tank_l?:null, bridges_blocked:string[], image?, url }[]` + a `generic` fallback boat (35 ft cruiser defaults).

**Safety/freshness fields are mandatory**: bridges store a **clearance band + tide flag**; moorings store **`last_verified` + year**; fleet stores nullable fuel fields flagged low-coverage.

---

## 6. Routing & calculation engine

- **Graph router** (`router.ts`): Dijkstra (A* with haversine heuristic for point-to-point). Edge weight = **time** = `length_m / ground_speed(limit_mph)` with an efficiency factor (`~0.9`) and `min(limit, boat_cruise)`. Returns ordered edges → polyline geometry + per-edge time/distance.
- **Passability filter** (`passability.ts`): before routing, mark edges **blocked** for the selected boat where `boat.air_draft_m > bridge.clearance_band_min − SAFETY_MARGIN (0.3 m)` (and `practically_closed` bridges like Potter Heigham Old are blocked for standard cruisers), or `boat.beam_m > arch_width`, or `boat.draft_m > edge.max_draft`. **Marginal** = within the band ± margin → routable but flagged amber, **never auto-cleared**. Routes avoid blocked edges; if the only path crosses a blocked bridge, report "unreachable for this boat (blocked at X)".
- **Reachability**: multi-source Dijkstra from the current node, capped by the day's **daylight budget** (`daylight.ts`, astronomical sunrise/sunset for the date at Broads latitude) → set of reachable moorings/POIs with time/dist, plus optional **network-distance range rings** rendered on the map.
- **Fuel/cost** (`fuel.ts`): `Lph(v)=a+b·(v/v_max)³` (a≈0.5, b≈1.2, v_max=6) integrated over the route's per-edge speeds → litres; `× diesel £/L` → cost. Electric boats use the energy/charge variant and surface charge-points instead of fuel. **Fuel is shown as cost/refuel info, not a range gate** (diesel range ≫ a week's cruising).
- **Advisory tide/daylight** (`tide.ts`, `daylight.ts`): if a route includes the `breydon` tidal zone, show a **non-blocking warning** with the **next slack-water windows** (~LW+1h at Gt Yarmouth) and planning transit times (~2¼ h from Acle, ~2 h from Reedham). If cumulative cruising for a day exceeds `[sunrise,sunset]`, warn and suggest an intermediate mooring. (Tide times v1: a lightweight/approximate source or link-out; exact tide feed is v2.)

---

## 7. Restrictions & safety model (the core differentiator)

For the selected boat, **every bridge/edge is classified pass / marginal / blocked** and rendered with traffic-light colour. The **bridge pass-matrix** in `BoatPicker` shows, per named bridge, whether *this* boat clears it. `RestrictionCallout` shows clearance band, **tide caveat**, pilot requirement, and the boat's verdict.

**Safety posture (non-negotiable, baked into the design):**
- Apply a **0.3 m / 1 ft margin** to every clearance; treat figures as **average-high-water advisory**.
- **Never auto-clear a marginal bridge** — always require the user to confirm against the on-site gauge board.
- **Potter Heigham Old** = practically closed for standard cruisers (0 boats passed 2024); **pilot-mandatory** bridges (Potter, Wroxham) labelled as such; **swing bridges** (Reedham, Somerleyton) labelled "opens on request".
- A **persistent `SafetyBanner`** ("Planning aid only — clearances are tidal & advisory; check the gauge board and Broads Authority notices") and a full disclaimer on `/method`.
- **Conservation broads** (Hoveton Great, Cockshoot, Upton, etc.) are non-navigable no-go zones, never routed into.

---

## 8. UX flow

1. **Land** on the planner: map (default warm-brutalist theme) + a prompt to pick a boat and set location.
2. **Pick boat** → spec card + bridge pass-matrix; all map restrictions recolour to that boat.
3. **Set location** → GPS (geolocation, snapped to nearest navigable node), tap-map, or named place.
4. **Reachability** auto-shows: reachable destinations list (time/dist/fuel/£) + optional range rings; daylight budget indicator.
5. **Tap a destination/mooring** → route drawn along the river; `PlanPanel` shows distance, cruising time, fuel + £, **restrictions en route** (per-bridge verdict, speed zones, Breydon/daylight warnings). **Add to itinerary**.
6. **Itinerary** → ordered stops, per-day daylight budgeting, warnings; **save (localStorage) + share (URL)**.
7. **Mooring/POI drawers** → `MooringCard` (tier/charge/facilities/shore-power/capacity caveat + nearby POIs) and `PoiCard` (rating + highlight/lowlight + deep-link + dog flag). **Dog-friendly filter** on the pubs/walks layers.
8. **Theme toggle** flips map between warm-brutalist chart and nautical sea-chart.

Mobile-first: map fills viewport; panels are bottom-sheets/drawers; controls thumb-reachable; geolocation prominent.

---

## 9. Design system & the two map themes

**Chrome is 100% SR warm-brutalist** (per CLAUDE.md design discipline): DM Mono brand mark, Archivo Black display, DM Sans body, JetBrains Mono labels, burnt-orange `#c4570a` accent, cream `#ede4d4` base, `.nm-sec`/`.nm-text-input`/`.nm-save-btn` patterns, opaque elevated surfaces for drawers (portal to body to escape stacking contexts). No invented fonts.

**Two flippable map themes** (`ThemeToggle`, persisted in `appState`):
- **Warm-brutalist chart (default):** custom tile style — parchment/cream land, **desaturated warm water** (honours the SR no-blues/greys rule), dark-brown labels, burnt-orange routes & markers. Implemented via a custom raster/vector tile style (MapTiler/CARTO custom) or a CSS/canvas tile filter over OSM as a pragmatic first cut.
- **Nautical sea-chart:** a mariner aesthetic (blue water, buoyage/depth feel) for users who want a conventional chart. This deliberately departs from the no-blues rule, which is *why* it's a non-default, user-chosen alternative.

Both themes share the same data layers; only tiles + marker palette swap. Routes/restriction colours remain legible in both.

---

## 10. Data sourcing & build pipeline

Build-time scripts (run locally; outputs committed to `static/broads-pilot/` and deployed via `data`/`static` rsync). Each writes a `meta.json` provenance stamp.

- **build-graph** — Overpass over bbox `52.30,1.28,52.85,1.80`; `waterway=river|canal` + named `natural=water`; union-find connectivity check; **snap navigable broads** to the line network via access dykes; filter conservation broads against the BA Navigation Map. Browser/realistic User-Agent (default UA → 406).
- **build-speed-zones** — hand-transcribe BA **Speed Limit Byelaws 1992 Schedule 1**; geo-reference zone boundaries onto edges so each edge gets one `limit_mph`.
- **build-restrictions** — curate the **verified bridge/lock/zone table** from the research brief; store clearance **bands** + tide flags + pilot flags. **Independent re-verification of every clearance + speed zone is a required step before ship** (the workflow's verification pass misfired).
- **build-moorings** — BA Moorings/Broadcaster PDF (via Wayback + `pdftotext` since the BA site is Cloudflare-gated) + OSM `mooring`/`leisure=marina`; stamp `last_verified` + year.
- **build-pois** — OSM `amenity=pub`(+`dog=*`), `restaurant/cafe`, `tourism=*`, `leisure=nature_reserve`, footpaths; enrich names/descriptions; **precompute `mooring_pois.json`** proximity adjacency (200 m/500 m/1 km).
- **scrape-richardsons** — `/all-boats/` index + per-boat pages; parse **air draft** + **bridges-blocked note** (the load-bearing fields) + dimensions where present; nullable fuel/draft flagged; verify count against sitemap.

**Licensing/attribution:** OSM data under **ODbL** with visible attribution (map + `/method`). BA PDFs, CanalPlanAC, and the "Green Book" are used as **build-time cross-checks**, not redistributed verbatim. Google Places content shown per its display/attribution terms.

---

## 11. Ratings (compliant)

- **Numeric rating + review count** from **Google Places API** via `/api/broads-pilot/ratings` (server-side key; small cache keyed by `place_id`, refreshed within Google's permitted window).
- **Highlight / lowlight snippets**: store the top positive and top critical **Google review snippet** per place (with required attribution + within the permitted cache window) — surfaced in `PoiCard`/`MooringCard`. Editorial curation is the fallback where Places has no reviews.
- **Deep-link out** to TripAdvisor and/or Google for full reviews — **no TripAdvisor scraping or caching** (their ToS forbids it).
- Each POI carries `place_id` (Google) + optional `tripadvisor_url`. Re-verify TripAdvisor + Google Places ToS before build; degrade gracefully to deep-link-only if a key/quota is unavailable.

---

## 12. Offline / PWA

- **Installable**: web manifest + icons (reuse SR PWA infra at `static/`/service worker).
- **Service worker** precaches the **app shell + all `static/broads-pilot/*.json` datasets** → planner, routing, restrictions, moorings, POIs work **offline**.
- **Map tiles online-first** (StaleWhileRevalidate / NetworkFirst); offline shows last-viewed tiles only. Tile-pack precaching for the Broads bbox is **v2** (pattern in `~/offline-maps/`).
- **Ratings** are network-only (graceful "ratings unavailable offline").
- Extend the existing `src/service-worker.ts` with a `broads-pilot` cache scope rather than a second worker.

---

## 13. Risks & mitigations

Carried from the research brief's risk register:
1. **Advisory/tide-dependent clearances** → tolerance band + 0.3 m margin + never-auto-clear + defer-to-gauge + disclaimer + re-verify before ship.
2. **Tide/daylight realism** → v1 advisory warnings + slack-water helper; full solver is v2.
3. **Broad snapping** → biggest build task; hand-verify each navigable broad's dyke connection; union-find validation; conservation filter.
4. **Source fragility/freshness** → provenance stamps + `last_verified`; Cloudflare-gated BA via Wayback/`pdftotext`.
5. **Richardsons fuel gap** → air-draft + bridges-blocked drive routing; range = flagged class-default; fuel shown as cost not gate.
6. **Ratings ToS** → Google Places + deep-link only; no TripAdvisor caching.

---

## 14. Visibility, auth, deploy

- **Public project** (the `projectVisibility` table defaults to public; no row needed). `+layout.server.ts` uses `requireProjectPublic('broads-pilot')` like policy-engine; share-token + cache headers handled by the existing guard.
- **`/api/broads-pilot/ratings`** requires auth-bypass only if called anonymously — add `broads-pilot` ratings path handling consistent with how public APIs (e.g. `space-lander`) are exempted in `PUBLIC_PATHS` / hooks; key stays server-side.
- **Deploy** via `scripts/deploy.sh` (full build + `static`/`data` rsync + restart). Add `broads-pilot` card to `/projects` index (`+page.svelte` + `+page.server.ts`).

---

## 15. Testing approach

- **Graph**: union-find connectivity test (1 component); nearest-node snapping; haversine length sanity vs CanalPlanAC reference distances.
- **Router**: known-route distances/times vs hand-computed expectations on a few legs (e.g. Stalham→Acle, Horning→Ranworth); blocked-edge avoidance (tall boat never routed under Potter Heigham).
- **Passability**: unit tests over the bridge table × representative boats (Dominica clears all; Commodore blocked at Potter/Wayford/Wroxham/Beccles).
- **Fuel**: `Lph(v)` reproduces the 0.65–1.70 L/hr band at 3–6 mph; range monotonic in tank.
- **Daylight**: sunrise/sunset within minutes of reference for sample dates.
- **Data integrity**: every mooring has `last_verified`; every bridge has a clearance band + tide flag; every POI has a deep-link or place_id.
- **PWA**: datasets resolve from cache offline; tiles degrade gracefully.

---

## 16. Open items to resolve during implementation (not blocking design)

- Custom warm-brutalist tile style: MapTiler/CARTO custom vs a pragmatic CSS/canvas filter over OSM for the first cut.
- Tide-time source for the advisory helper (approximate harmonic vs free tide API vs link-out).
- Google Places key provisioning + cache table vs in-memory cache for ratings.
- Exact Richardsons fleet enumeration (sitemap vs `/all-boats/` index) and per-boat field coverage.
