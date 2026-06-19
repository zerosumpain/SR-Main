# Broads Pilot — Research Brief (grounding for the design)

> Produced 2026-06-19 by a parallel research workflow (8 domain researchers → synthesis).
> All facts carry source provenance. Treat this as the **authoritative data-grounding** for
> the design spec (`2026-06-19-broads-pilot-design.md`). Safety-critical figures (bridge
> clearances, speed zones) must still be **independently re-verified during implementation**
> before they ship — the dedicated verification pass in the research workflow misfired
> (domain-key mismatch → 0 verifier agents), so the numbers below are single-sourced research.

---

## 1. The navigable network + routable-graph build from OSM

**Network shape.** A lock-free, tidal network of **~125 miles / ~200 km** of navigable waterway over **seven rivers** (Bure, Yare, Waveney, Ant, Thurne, Chet, Wensum-to-Norwich) and **63 broads (lakes)**, of which **~13 are open to navigation + 3 more have navigable channels**; the rest are conservation/private. The network is **two halves joined only at Great Yarmouth**: Northern (Bure/Ant/Thurne) ↔ Southern (Yare/Wensum/Chet/Waveney + Oulton Broad) via tidal **Breydon Water** — the *sole* through-route. **Haddiscoe (New) Cut** (OSM way 23341381, `waterway=canal`) links Yare↔Waveney lock-free, bypassing Breydon. Per-river navigable lengths: Bure 31.3 mi, Yare 31.6 mi (CanalPlanAC main-nav reach 28.8 mi), Waveney 21.6 mi, Thurne 5.8 mi, Chet 3.5 mi, plus Ant + Wensum. *(Source: Wikipedia "The Broads"; BroadsNet; CanalPlanAC o922; confidence high on totals, medium on per-river.)*

**RECOMMENDATION — build the graph from OSM; coverage is HIGH-confidence and routable as-is.** Live Overpass queries (OSM base 2026-06-18) proved the six main navigable rivers are **165 connected `waterway=river` ways forming exactly ONE connected component** (union-find: 1 component, 0 disconnected) totalling **213.8 km / 132.9 mi** of mapped channel — confluences share OSM nodes, so the river skeleton is already a topologically connected line graph. **510 ways carry explicit navigation tags** (`boat`/`motorboat`/`CEMT`/`ship`); the Chet itself is `boat=yes`. **48 named broad polygons** are present as `natural=water` (Wroxham, Salhouse, Ranworth/Malthouse, Barton, Hickling, Horsey Mere, Oulton, Breydon Water=relation 1621648, etc.). The Broads area = `protected_area` relation 2568322. *(Source: live Overpass overpass-api.de.)*

**Extraction method.**
1. **EXTRACT** via Overpass over bbox `52.30,1.28,52.85,1.80`: all `waterway=river`/`waterway=canal` ways, `natural=water` polygons named `*Broad/Mere/Water/Dyke*`, plus protected_area rel 2568322 as area mask. Use `out body; >; out skel qt;` to get node-refs for topology. **Set a descriptive User-Agent** (default curl UA → HTTP 406). **Match river names permissively** — the Chet is tagged `name='Chet'` (no "River" prefix); an over-strict regex returns 0 Chet ways. Prefer a Geofabrik England extract for reproducibility over the live API.
2. **NODE/EDGE MODEL:** every OSM node shared by ≥2 ways or at a way endpoint → graph **NODE**; each inter-node way-segment → **EDGE** with `length = Σ haversine(segments)`; preserve `way_id`, `name`, and `boat/motorboat/CEMT` tags as edge attributes. The 6 rivers already form ONE component → no stitching needed for the river skeleton.
3. **SNAP broads to the line network** (the single biggest build task): broads are POLYGONS, not lines. For each navigable broad take its access dyke way (Womack Water, Fleet Dyke, Salhouse access, Ranworth Dyke) which already connects to the parent river, and either route to the broad's entrance node or generate a polygon centreline/medial-axis connected at the dyke mouth.
4. **FILTER navigability:** drop conservation-only broads (Hoveton Great, Decoy, Cockshoot, Burnt Fen, Upton, Mautby Decoy) — cross-check against the BA **Navigation Map 2025** PDF; keep edges with boat/motorboat tags or on named navigable rivers.
5. **VALIDATE** with a union-find component check (already passes) and spot-check the three Yarmouth confluences + Haddiscoe Cut share nodes.

**Expected scale:** ~235 OSM ways (165 river + ~70 canal/dyke) → **order 200–500 graph edges** at OSM way granularity; thousands if densified to ~50 m for per-metre routing. Small enough to **bundle client-side as a static JSON/GeoJSON asset** (PWA-friendly).

**Coverage confidence: HIGH. Fallback if OSM is patchy:** use **CanalPlanAC** (o922) as an independent routable model — it gives River Yare as 23 named waypoints with explicit junctions (Bure/Chet/Waveney/Haddiscoe Cut/named dykes), all "0 locks", as an edge/junction cross-check and canonical distance source. Patchy access dykes (sometimes mapped `waterway=stream/ditch` or missing) should be hand-repaired against the BA map.

---

## 2. Speed-limit model

Limits are **statutory** (Broads Authority Speed Limit Byelaws 1992, in force 1 Nov 1992): **3, 4, 5 or 6 mph**, in *statute miles/hour measured "over the ground"* (not through-water — matters on a tidal system), signed on riverbanks. **Conversions to bake in:** 3 mph = 1.341 m/s, 4 = 1.788, 5 = 2.235, 6 = 2.682 m/s. **The authoritative machine-readable source is Schedule 1 of the byelaws PDF** — every navigable segment has exactly one limit with metre-precise boundaries. **There is NO public GIS/shapefile/ArcGIS layer**; the byelaws table must be transcribed and geo-referenced by hand against river geometry.

**Concrete zones (from Schedule 1):**
- **River Yare** (Trowse→Berney Arms): alternates **5 mph through villages/ferries** (Postwick, Bramerton, Surlingham Ferry, Brundall, Buckenham Ferry, Cantley, Reedham Ferry, Reedham, Berney Arms) and **6 mph in open reaches**. **Wensum** (New Mills→Yare, Norwich): **4 mph throughout**.
- **River Bure** (Yarmouth→Coltishall): **6** open reaches, **5** through villages (Stokesby, Acle, Horning area), dropping to **4** (Horning, Belaugh–Wroxham, Coltishall–Belaugh) then **3** (Belaugh, Coltishall/Horstead Mill).
- **River Waveney** (Geldeston→Burgh Castle): **3** upper non-tidal, then **4–6** alternating (Beccles 4; open reaches 6; villages/staithes 5).
- **Rule of thumb for assignment:** dykes/narrow channels/small broads = **3–4 mph** (Surlingham, Rockland dykes, Langley, Upton, Catfield, Waxham Cut, River Ant main = 4, River Chet = 4); larger broads = **5–6 mph** (Rockland 5, Barton 5, Hickling 5, Horsey Mere 5, Haddiscoe Cut 5, Oulton Broad 6).

**Attach to edges:** split every edge at each Schedule-1 boundary so each edge carries one `limit_mph`; `base_time = length / (limit as ground-speed)`; apply an efficiency factor ~0.85–0.95 or `min(limit, hull_cruise)`. **Seasonal/time rules apply ONLY to Schedule-2 water-ski zones and Schedule-3 boatyard-trial vessels — NOT general cruising**, so the limit value depends only on location. *(Source: BA Speed Limit Byelaws 1992 PDF; per-river BA navigation notes; confidence high.)*

---

## 3. RESTRICTIONS TABLE (corrected values where verification changed a number)

Air-draft figures are **"central clearance at average HIGH water"** — arched bridges give the LEAST clearance near high water, MOST near low water. BA explicitly warns "tidal levels can vary considerably." A boat passes iff `air_draft_canopy_down ≤ clearance(tide_at_t)` AND `beam ≤ arch_width`.

| Feature | River | Clearance (AHW) | Flags / notes |
|---|---|---|---|
| **Potter Heigham OLD Road** | Thurne | **~1.98–2.03 m / 6'6"–6'8"** | **PILOT MANDATORY**, tide-dependent. Semicircular arch, sides fall sharply. Phoenix Fleet 01692 670460, £10. **[VERIFIED] effectively impassable: 3 boats through in 2023, 0 in 2024, 1 in 2025** — treat as a *practically closed edge* for standard hire cruisers, not merely "pilot-gated". |
| **Wroxham Road** | Bure | **~2.21 m / 7'3"** (BA sheet 2.29 m / 7'6") | **PILOT MANDATORY for hire craft** (07775 297 638, ~£15 return). 1619 arch, strong currents, height+tide-affected. |
| **Yarmouth Vauxhall** (old rail) | — | **2.06 m / 6'9"** | Tide-dependent; lowest of the Yarmouth pair, ~3" lower than Acle Rd. Breydon transit. |
| **Yarmouth Acle Road** | — | **2.13 m / 7'** | Tide-dependent. Breydon transit. |
| **Yarmouth Haven** | — | **2.90 m / 9'6"** | **Hire craft PROHIBITED beyond Haven Bridge** (Port / North Sea, strong drag). |
| **Breydon Fixed / Lifting span** | — | **3.96 m / 13'** fixed; **~3.50 m / 11'6"** lifting | Use right-hand span between the two arrows. |
| **Beccles Old Road** | Waveney | **1.98 m / 6'6"** | Tied lowest arched road bridge; tide-dependent, **no pilot** but care required. Bypass = 4.27 m / 14'. |
| **Ludham Bridge** | Ant | **2.59–2.60 m / 8'6"** | Tide-affected, canopy down, **no pilot**. |
| **Wayford Bridge** | Ant | **2.13 m / 7'** | Tide-affected. |
| **Acle Bridge** | Bure | **3.66 m / 12'** | Tide-affected. |
| **Wroxham Railway** | Bure | **4.57 m / 15'** | High; not a constraint for hire craft. |
| **Reedham SWING** | Yare | fixed **3.05 m / 10'** (Wikipedia 3.16 m / 10'4") | **OPENS on request** — 3 long horn blasts / VHF Ch 12 / 0330 858 4655. Won't open if you fit. 1 red flag=operational, 2=out of service. |
| **Somerleyton SWING** | Waveney | fixed **2.60 m / 8'6"** | OPENS on request (3 long blasts / VHF 12). |
| **St Olaves** | Waveney | **2.44 m / 8'** | Tide-affected. |
| **Haddiscoe Flyover** | New Cut | **7.32 m / 24'** | Not a constraint. |
| **Thorpe Railway (×2)** | Yare (Norwich) | **1.83 m / 6'** | Very low; on the dead-end into Norwich/Whitlingham. |
| **MUTFORD LOCK** (Oulton Broad) | — | LOA **22 m**, beam **6.5 m**, draft **~1.7 m at LW** | **The ONLY lock** — gateway to Lake Lothing/sea. Bi-directional design. Hours Apr–Oct ~08:00–12:00 & 13:00–17:00; Nov–Mar ~08:00–12:00 (closed bank hols). **Book ≥24 hr ahead**, 01502 531778 / VHF Ch 73, ~£17/day. Mutford road bridge alongside = 2.40 m / 7'10". |

**BREYDON / tidal constraint (the Northern↔Southern bottleneck):** cross at **SLACK WATER, ~1 hr after Low Water at Great Yarmouth Yacht Station** — simultaneously weakest current AND max clearance under the low Yarmouth bridges. Cruisers commonly pass ~2–3 hr after and up to ~1 hr before LW. Transit times for planning: **~2¼ hr from Acle, ~2 hr from Reedham or St Olaves**. Keep strictly inside red/green posts ("Up, Red, Right"); last safe waiting moorings ~4 mi out at Berney Arms / Burgh Castle. **Do NOT approach Haven Bridge.** Model as a **time-windowed tidal edge** keyed to the Yarmouth tide curve, binding constraint = min clearance of Vauxhall/Acle-Road at crossing time. *(Source: BA "Crossing Breydon Water" PDF; Herbert Woods; confidence high.)*

**HIRE-BOAT NIGHT RULE:** **hire boats may NOT navigate before sunrise or after sunset** (no nav lights, no night insurance). Clamp the cumulative cruising clock to **[sunrise, sunset]** each day and force a mooring node before dusk. Norfolk daylight ranges **~7.5 hr midwinter to ~16.5 hr midsummer** (Lowestoft 52.47°N) — itineraries are daylight-bounded and seasonal. *(Source: BA "Crossing Breydon Water" PDF; Broom Boats; confidence high.)*

**Live-clearance feed:** **broads.bridgeheight.com ("Project Troll")** publishes real-time tide-adjusted clearance for Beccles, Yarmouth Yacht Station, Potter Heigham Old, Acle. Use as advisory only ("check bridge boards"); reuse needs permission. **Safety:** treat published figures as advisory, apply a **~0.3 m / 1 ft margin** (operator norm), and defer final go/no-go to the on-site gauge board.

---

## 4. Moorings & charges model

**Four practical tiers + a free hire-yard channel.** Authoritative dataset = BA **Moorings-Map / Broadcaster PDF** (per-site lengths in feet, mooring-type codes, facility columns) + BA "Visitor moorings" pages + the **interactive Google moorings map**; a third-party **Green Book** table mirrors it with length-in-feet and type codes. OSM supplements via `leisure=marina` + `mooring=yes/private/guest` with `capacity=*`, `fee=*`, `maxstay=24:00`, `power_supply=*`, `sanitary_dump_station=*`, `amenity=shower/toilets` (Overpass over ~52.55–52.80N, 1.30–1.75E).

| Tier | Example | Charge | Facilities |
|---|---|---|---|
| BA 24-hr free (~60 sites) | Acle Bridge, Coltishall Common, Horning Staithe, How Hill, St Benet's (~60 spaces), Neatishead | **free ≤24 h** (some now charge) | bankside; some electric/water points |
| BA 24-hr staffed | Reedham Quay, Ranworth Staithe | Reedham **£6 day / £12 overnight** (since 6 Jun 2023); Ranworth charging in progress | staffed |
| BA Yacht Stations | Norwich; Great Yarmouth | Norwich **£18 o/n, £8 day**; Yarmouth **£12 o/n, £6 day** (2025) | showers, toilets, water (free to customers else £3), electric £1 cards; season 29 Mar–2 Nov 2025 |
| Pub moorings | Swan/New/Ferry Inn Horning, Ferry Inn Stokesby | **~£5 overnight, usually waived with a meal** | minimal |
| Private broad/island | Salhouse Broad, Horning Perci's Island | Salhouse **£10 o/n / £5 day / £2–3 hr**; Perci's **£8 o/n / £4 day** | limited/none |
| Full-service marina | Brundall Bay (~330 berths), Ferry Marina Horning, Wroxham Swan | **per-metre**: Brundall Bay **£21/m/night**; Horning/Wroxham ~£20 flat | water, metered shore power (£1 cards/kWh), pump-out (fee ~£15–20), showers, wifi, fuel |
| Free hire-yard | Bridge Craft Acle, Broom/Silverline Brundall, Ferry Marina, Richardsons Stalham, etc. | **free** at own + Hire Boat Federation yards (first/last night) | yard facilities |

**Schema must store `rate_unit` (flat vs per-metre), a `waived_with_meal` flag, and a `last_verified` date + year label** — charges change annually/mid-season (Reedham went paid 2023; Ranworth in progress; new free sites Aldeby Hall + Hardley Mill opening 2025). **Engine-running at moorings is a byelaw offence** (max £1,000 fine, esp. 8pm–8am) — which is *why* shore-power moorings carry premium value; surface a `shore_power` flag prominently. Free staithes are small + first-come (Horning ~10 berths) — do NOT show as "available" without an occupancy caveat. *(Source: BA moorings/yacht-station pages + Broadcaster PDF; broads.co.uk; Herbert Woods; Transeurope Marinas; confidence high.)*

---

## 5. Richardsons fleet structure + scrapable spec fields

**Largest Broads operator** (Stalham; est. 1944), **200+ boats** ("more than 210"). Three product lines:
1. **Overnight CRUISERS** — the bulk; split on-site into **"Richardson's Fleet"** (modern: bow/stern thrusters, low-wash hulls, reverse cameras, electric mud-winches) and **"Richardson's Classic Fleet"** (older).
2. **DAY BOATS** (6/8-seater, half/full day, Stalham + Wroxham).
3. **ELECTRIC eco line — within the DAY-BOAT range only.**

**Scrape URL patterns:** index `/all-boats/` ("Find My Holiday" filter, ~107+ named slugs visible — *may undercount the true 200+ fleet; verify against sitemap/dropdown*); per-boat `/all-boats/{slug}/`; legacy alias `/boats/{slug}/` (dedupe). Day boats under `/norfolk-broads-day-boat-hire/` with `/6-seater-electric-day-boat/` and `/8-seater-electric-day-boat-stalham-copy/`.

**Reliably present per boat:** name, sleeps, berth/bedroom config, toilets, showers, **AIR DRAFT** (ft/in, e.g. Dominica 7ft, Broadway 6ft9in, Commodore 8ft9in), feature flags (thrusters/240V/heating/canopy), and a **qualitative bridge-passability note** (e.g. Dominica "will pass under all Broads bridges"; Broadsventure "cannot pass Potter Heigham; Wroxham requires pre-booked pilotage"; Commodore "cannot pass Potter Heigham, Wayford, Wroxham or Beccles") — parse into a per-bridge boolean map.
**Sparse (nullable):** length & beam (Dominica "45ft × 12ft"; absent on Broadway/Broadsman/Commodore/San Francisco).
**NEVER published (the absent fields):** water draft, fuel type, fuel-tank capacity, engine model/HP, water-tank capacity, fuel economy.

**ECO/electric:** confirmed ONLY on **2 day-boat SKUs** (6-seater + 8-seater electric: "noise-free/silent electric propulsion", emission-free, 8-seater 1020 kg max load, retractable canopy, USB charging, up to 2 pets; **no published battery kWh or range**). **No hybrid or electric OVERNIGHT cruiser exists in Richardsons' fleet** — their cruiser "green" story is low-wash hulls only. Do not assume an "eco cruiser" class.

**Recommended scrape schema:** `{name, slug, class(modern|classic|dayboat), propulsion(diesel|electric|unknown), sleeps, bedrooms, berth_config, toilets, showers, length_ft?, beam_ft?, air_draft_ft, water_draft?:null, fuel_tank?:null, engine?:null, bridges_blocked[]}`. **`air_draft` + `bridges_blocked` are the load-bearing routing fields and both are obtainable.** Parse air draft "6ft 9in" → decimal ft/m robustly (reflects canopy-DOWN). *(Source: richardsonsboatingholidays.co.uk per-boat pages; confidence high on air-draft, medium on cruiser=diesel inference.)*

---

## 6. Fuel / range / consumption model

**Displacement-hull diesel cruiser.** Cited base: **cruising ~1–1.5 L/hr**; rule "**1 L/hr per 10 hp used**"; a Broads cruiser uses ~15–25 hp of a 15–40 hp engine. Fuel type is *never published by Richardsons* — assume diesel (medium confidence). Tank, water-draft, engine HP and economy are all absent and must be sourced off-site or by contacting the operator (01692 668975); assume tank **~90–140 L** and water draft **~2.5–3.5 ft / 0.8–1.1 m** as Broads-cruiser defaults until per-boat truth is obtained.

**Parametric formula the app should use** (below hull speed, fuel ∝ engine load ∝ ~speed³):

```
Lph(v) = a + b · (v / v_max)³
  a   ≈ 0.5  L/hr   (idle/auxiliary baseline)
  b   ≈ 1.2  L/hr   (cruise increment)
  v_max = 6 mph (max legal ground speed)
```

This reproduces the cited band: 3 mph→0.65, 4→0.86, 5→1.19, 6→1.70 L/hr (cruise figures land squarely in the 1–1.5 L/hr observed range). **Range:** `range_hrs = tank_L / Lph(v)`; `range_miles = range_hrs · v`. Worked example: 110 L tank at 5 mph (1.19 L/hr) → ~92 hr → ~460 mi between fills — i.e. diesel range is effectively **non-binding** over a 1-week hire; fuel is a *cost/refuel-stop* concern, not a range limiter. Surface fuel as litres-burned + £ estimate per leg, not a range gate.

**Electric boats differ fundamentally** — model on **energy/charge, not litres:**
```
range_hrs = battery_kWh / P_draw(v)        P_draw(v) ≈ p0 + k·(v/v_max)³  (kW)
```
Day-boat electrics have **no published kWh/range**, so use a conservative placeholder (`battery_kWh` TBD) and treat range as **day-boat-only, charge-anxiety-bounded** with shore-charge points at Neatishead, Potter Heigham (Repps Bank), Gt Yarmouth YS as recharge nodes. **Engine-running-at-moorings byelaw** doesn't constrain electrics, a genuine UX selling point. Flag all propulsion fields **low-coverage**. *(Source: insure4boats.co.uk; abcboathire.com; confidence medium.)*

---

## 7. POI sourcing (pubs, dog-friendly walks, attractions)

**Primary geospatial source: OSM/Overpass** over the Broads bbox — `amenity=pub` (+ `dog=yes` / `dog=leashed` for dog-friendly), `amenity=restaurant/cafe`, `tourism=attraction/museum/viewpoint`, `leisure=nature_reserve`, `highway=footpath`/`route=hiking` for walks. **Find POIs near a mooring** by a spatial proximity query: for each mooring node, return OSM POIs within a walking radius (e.g. 200 m / 500 m / 1 km buffer) ranked by distance — precompute as a `mooring → [poi_id, dist_m]` adjacency at build time so it ships in the static bundle. Enrich pub/attraction names + descriptions from **broads.co.uk** and operator guides; dog-friendly walks from OSM footpaths radiating from staithes (Coltishall Common, Ranworth, How Hill all have walks). Attribute OSM under ODbL. *(Confidence: high for the mechanism, medium for completeness — OSM POI tagging is uneven; allow a curated override layer.)*

---

## 8. Ratings approach (TripAdvisor constraints)

**TripAdvisor's Content API forbids storing/caching its review content and requires their branded widget for display, with tight rate limits and approval gating** — not viable for a deep-linked ratings model in a static PWA. **RECOMMENDED COMPLIANT OPTION:** do NOT scrape or cache TripAdvisor; instead **store only your own first-party deep-links** (`tripadvisor.com/...` URLs per mooring/pub/attraction) and render an outbound "View on TripAdvisor" link, optionally augmented with their official widget where a live embed is acceptable. For an *aggregate rating surface* that you can store/sort/filter, use **OSM-tagged ratings where present + a curated editorial score**, and/or **Google Places API** (which permits storing place_id + displaying ratings + limited-window cached review snippets under its terms) as the cacheable numeric source. Net: **deep-link out to TripAdvisor (compliant), store numeric ratings + highlight/lowlight snippets only from a source whose ToS allows caching (Google Places or first-party).** *(Confidence: medium — verify current TripAdvisor + Google Places Content ToS before build.)*

---

## 9. Confidence ledger

**SOLID (high confidence — design can rely on these):**
- OSM river skeleton = 1 connected component, 213.8 km, routable as-is (live-verified).
- Speed limits 3/4/5/6 mph "over the ground"; Schedule 1 is the per-stretch truth.
- Bridge clearance table (BA sheet); Mutford Lock specs (22 m × 6.5 m × 1.7 m).
- Breydon slack-water rule (~1 hr after LW); hire-boat night ban (sunrise–sunset).
- Potter Heigham Old practically impassable (0 boats 2024).
- Richardsons: air-draft + qualitative bridge-passability published per boat; electric = day-boats only.
- Mooring tier structure + headline charges (Norwich £18, Yarmouth £12, Reedham £6/£12, pubs ~£5, Brundall £21/m).

**SHAKY (hedge these in the design):**
- **Per-river navigable lengths** (medium) — raw OSM name-match overshoots ~200 km by ~14 km (non-nav upper reaches); clip by boat tags / BA limits, not name.
- **Bridge clearances disagree by a few cm across sources** (Wroxham 2.21 vs 2.29 m; Potter Old 1.98 vs 2.03 m; Beccles Bypass 3.66 vs 4.27 m; Reedham 3.05 vs 3.16 m) — store a **tolerance band + 0.3 m safety margin**, never auto-clear marginal bridges.
- **All clearances are "average high water" advisory** — tide-dependent; defer to live gauge / Project Troll.
- **Mooring charges change annually/mid-season** — every record needs `last_verified` + year.
- **Fuel/range model** (medium) — formula calibrated to a 1–1.5 L/hr band; tank/HP/economy all absent for Richardsons, so figures are class-defaults not per-boat truth.
- **Cruiser fuel type = diesel is an inference**, not an on-page fact.
- **Richardsons fleet enumeration** — visible ~107 slugs vs true 200+; verify against sitemap.
- **Tidal-stream correction** — byelaws give no stream data; per-reach estimates keyed to Gt Yarmouth tides are modelled, not measured.
- **TripAdvisor / Google Places ratings ToS** — must be re-verified before build.
- **Source access:** broads-authority.gov.uk is behind Cloudflare (403 to scripted fetch) — use Wayback `web/2id_/` + browser UA + pdftotext, or operator-rehosted copies (e.g. huntersyard.co.uk bridge sheet).

---

## Top risks (carried into the design)

1. **Safety-critical bridge clearances are advisory + tide-dependent + cm-divergent across sources.** Store a tolerance band, apply a ~0.3 m / 1 ft safety margin, never auto-clear a marginal bridge, defer final go/no-go to the live gauge board.
2. **Tidal + time-windowed routing is the hard part** (speeds "over the ground", Breydon slack-water window, daylight clamps). v1 handles tide/daylight as **advisory warnings**, not a baked-in solver; full time-windowed routing is v2.
3. **Broad polygon-to-line snapping is the biggest unscoped build task** — ~235 ways assembled by shared-node topology; conservation-only broads filtered out.
4. **Data freshness + source-access fragility** — BA site behind Cloudflare; key data only in PDFs; charges change mid-season. Every transcribed record needs a version stamp + `last_verified`.
5. **Richardsons spec gap for fuel/range** — water draft, fuel type, tank, HP, economy never published. Air-draft + bridges-blocked are the only reliable per-boat routing fields; all range modelling uses flagged class-defaults.
6. **TripAdvisor caching is non-compliant** — deep-link out; numeric + snippet ratings only from a ToS-permissive provider (Google Places / first-party).
