# Broads Pilot — Feature search, home-base map lock, and styled route line

Date: 2026-06-19
Status: Approved (design questions resolved with the user)

Three additive features for `/projects/broads-pilot`, all building on the existing
Leaflet map (`BroadsMap.svelte`), the rune-store (`appState.svelte.ts`) and the
pure routing engine (`router.ts`).

## 1. Free-text feature search

A floating search box (top-left) that fuzzy-matches **all named features**:
the 13 bridges, Mutford Lock, the 35 moorings/boatyards, and the 536 POIs
(pubs/walks/attractions/shops/fuel/fishing/swim). Bare graph nodes
(broads/staithes) are **excluded** — they are not a `Selection` kind and cannot
open the detail drawer.

- New pure module `lib/search.ts`:
  - `buildSearchIndex(data): SearchEntry[]` — flattens the four selectable
    feature sets into `{ kind: 'mooring'|'poi'|'bridge'|'lock', id, name, lat,
    lng, sublabel }`. Built once from `app.data` (stable).
  - `searchIndex(index, query, limit=12): SearchEntry[]` — ranked: exact >
    prefix > word-boundary prefix > substring > subsequence (fuzzy). Case-
    insensitive. Ties broken by shorter name.
- New `components/SearchBar.svelte`: input + results dropdown grouped with a
  per-kind glyph; ↑/↓/Enter/Esc keyboard nav; an `onPick(entry)` callback.
- Selecting a result (in `+page.svelte`): `app.select({kind,id})` (opens the
  existing `MooringCard`/`PoiCard`/`RestrictionCallout` drawer) **and**
  `mapComp.flyTo(lat,lng,14)`. `flyTo` auto-unlocks the map (see §2).

## 2. Home-base map lock

The map opens **centred and pinned on the start** (which already defaults to
`staithe-stalham`, labelled "Stalham (Richardsons)"), with an explicit unlock.

- New `app.mapLocked = $state(true)`.
- New `BroadsMap` `$effect` reacting to `app.mapLocked` + `app.origin`:
  - **locked** → `setView(origin, max(zoom,13))` and disable `dragging`,
    `scrollWheelZoom`, `doubleClickZoom`, `boxZoom`, `keyboard`, `touchZoom`,
    `tap`. The `+/-` zoom buttons stay (zoom about centre, staying on home).
  - **unlocked** → re-enable all of the above.
- Map init centres on the home coordinate `[52.7772, 1.5072]` (was the magic
  `[52.68,1.46]`), so the very first paint sits on home; the effect refines to
  `app.origin` once data loads (same point — no visible jump).
- Tap-to-drop-origin (`map.on('click')`) is gated: no-op while locked.
- **Auto-unlock on navigation**: `flyTo`/`fitTo` set `mapLocked=false` before
  moving (so the camera move isn't yanked back); `startCruise()` also unlocks.
- A lock toggle button beside the search bar: 🔒 "Locked: <start label>" /
  🔓 "Free roam". `mapLocked` is **ephemeral** (not persisted to permalink/
  localStorage).

## 3. Styled route line (range colour + speed dash)

The route polyline — drawn per-edge in `drawLegEdges()` — gains a band **colour**
(cumulative travel time) and a **dash** pattern (speed limit). Colour = time,
dash = speed (orthogonal signals on one line, over the unchanged dark casing).

- Export `edgeTimeS()` from `router.ts` (currently private) — single source of
  truth for per-edge duration.
- New pure module `lib/route-style.ts`:
  - `styleRoute(legs, { from }): StyledEdge[]` — walks the ordered edges summing
    `edgeTimeS`, returning `{ edge, t0, t1, midT, passed }`. When `from`
    (a `[lat,lng]`) is given, it finds the nearest route edge, zeroes the clock
    there, and flags earlier edges `passed:true`.
  - `bandColor(t_s)` — 5 linear 1-hour bands, RdYlGn-reversed isochrone ramp:
    `≤1h #1a9850 · 1–2h #91cf60 · 2–3h #fee08b · 3–4h #fc8d59 · 4h+ #d73027`.
    `passed` segments render warm-grey `#9a8c7a`.
  - `speedDash(limit_mph)` — graduated: `6 solid · 5 '14 7' · 4 '7 7' · ≤3 '2 7'`.
- `drawLegEdges(legs, from)` rebuilt to colour + dash each edge from `styleRoute`.
  **Range source (smart):** `from = (cruiseActive && userPosition) ? [lat,lng] :
  null` — time-from-start while planning, time-from-GPS while cruising (earlier
  edges greyed as "passed").
- The marginal-bridge **amber line recolour** is removed (colour now means time);
  the marginal/blocked **"!" markers** are kept for hazard signalling.
- New `components/RouteLegend.svelte`: compact key (5 colour bands + 4 dash
  patterns + a "from start / from your position" caption). Shown only when a
  route exists. Desktop: top-centre. Mobile: below the search bar. Collapsible.

### Known simplifications
- An edge straddling a band boundary is coloured by its **midpoint** time (no
  geometry splitting).
- The 6 mph speed cap in `edgeTimeS` is unchanged (no per-boat speed yet).

## Files

- *New*: `lib/search.ts`, `lib/search.test.ts`, `lib/route-style.ts`,
  `lib/route-style.test.ts`, `components/SearchBar.svelte`,
  `components/RouteLegend.svelte`.
- *Changed*: `lib/router.ts` (export `edgeTimeS`), `lib/appState.svelte.ts`
  (`mapLocked`, `unlockMap`/`lockMap`, unlock in `startCruise`),
  `components/BroadsMap.svelte` (init on home, lock effect, gated origin-tap,
  reworked `drawLegEdges`, GPS-projected range source, `flyTo`/`fitTo` unlock),
  `+page.svelte` (mount `SearchBar` + lock button + `RouteLegend`, wire pick,
  mobile zoom-control nudge).

## Testing & deploy
- TDD the two pure modules (`vitest`). `npm run check` with
  `NODE_OPTIONS=--max-old-space-size=8192`.
- Build + `scripts/deploy.sh` (sandbox disabled), then verify live.
