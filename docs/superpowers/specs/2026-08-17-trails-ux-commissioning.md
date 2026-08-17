# Trails UX: commissioning, difficulty, shared routes

**Date:** 2026-08-17 · **Follows:** the trails programme (PR #322–#327)

## Why

The planner shipped as a seven-control form. It worked, but commissioning a
route meant operating machinery: the health data's opinion was invisible until
after planning, nothing graded how *hard* a route is (the score is loop
*quality* — a different axis), and routes other people have mapped and shared
did not exist in the product at all.

## What shipped

1. **Natural-language commissioning** — one text box at the top of
   `/trails/plan`. `interpret.ts` maps free text → the existing `PlanRequest`
   via the LLM gateway (one-shot, temperature 0, 12 s timeout, same pattern as
   `health/narrative-service.ts`). Values are clamped server-side
   (`coerceCommission`, unit-tested; aliases coerced, never rejected). Named
   places geocode through ORS `geocode/search` — same key, same registered
   host. The parse fills the visible form and plans immediately; anything
   unsaid keeps its health-driven default. Never invents distances or places.

2. **Today's proposal** — `proposeSession()` in `planner.ts` generalises
   `suggestTarget()`: sport from the recent activity mix, distance from the
   8-week median nudged by ACWR + readiness, climbing shape from readiness
   (<55 → steady). Readiness under 40 vetoes the *impact* (walk proposed
   instead of a run), not just the distance. Rendered as a card with rationale
   and one "Plan this" button.

3. **Difficulty grade** — `difficulty.ts`, pure and tested. Naismith
   equivalence (`km + ascent/100`, steps-share multiplier) banded per sport:
   Easy / Moderate / Hard / Severe, with plain-language reasons and a
   Naismith time estimate. Chips on every candidate row, the saved-route
   page, and shared routes. When geometry has no elevation the grade says so
   ("graded on distance alone") rather than pretending.

4. **Shared routes nearby** — `discover.ts` queries OSM route relations
   (hiking/foot networks per sport) within 15 km of the start via Overpass,
   ported from the JKAImaps client (mirror fallback; mirrors re-probed and
   reordered 2026-08-17). Metadata list first (national → local network
   rank); geometry stitched on selection, elevation-enriched via ORS
   `elevation/line` when a key exists, graded, drawn on the planner map, and
   saveable through the existing route save/GPX flow as `source: 'imported'`.
   In-process caches: search 1 h, geometry 24 h.

## Decisions

- **OSM relations, not scraping.** Wikiloc/AllTrails have no public API;
  Strava is parked. OSM is free, keyless, ToS-clean, and honest about what it
  is (mapped trails, not popularity-ranked). Agreed with John 2026-08-17.
- **NL fills the form and plans in one action** (agreed same day). The form
  stays the source of truth — NL is an input method, not a second mode.
- **Difficulty is a second axis, never blended into the quality score.**
- Discovered routes get no quality score: without ORS surface/waytype data a
  terrain score would be a guess. Difficulty + distance + the map are honest.

## Verification

- `npx vitest run src/lib/trails/` — 176 tests inc. new difficulty/discover/
  interpret suites.
- Live smoke on homeserv: discover list returned the Coast to Coast Walk +
  Teesdale Way near Darlington; detail stitched 236 pts / 5.76 km and graded
  honestly without an ORS key. Interpret endpoint degraded gracefully with no
  OpenRouter key (homeserv has none; production resolves it).
- Screenshots desktop + 390 px mobile.
