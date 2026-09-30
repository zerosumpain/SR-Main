# Route planner, live follow and offline maps in the SR app

**Date:** 2026-09-30 · **Repos:** SR-AppleApp (most of it), SR-Main (native lane + live session), SR-Health (none)

## What John asked for

Take the route planner from /health onto the SR app. It plans a route to your spec, then offers to live-track
someone round it. An option downloads the map tiles so the route works with no signal.

## Decisions (John, 2026-09-30)

| # | Question | Answer |
|---|---|---|
| D1 | Who is tracked | **Either, app-to-app.** Whoever walks the route on the SR app is tracked; family circle members on the app follow. |
| D2 | Who can follow | **Family circle, plus a private share link** — unguessable, and dead once the session ends. |
| D3 | Offline map stack | **MapLibre Native + OpenFreeMap** vector tiles, route-corridor offline packs. |
| D4 | Shipping | **All four phases, in order**, each a TestFlight build plus a live SR-Main merge. |

Self-decided (from precedent, reversible):

- **Planning is the owner's.** SR-Health is single-owner (its service lane speaks as the owner). A member does not plan;
  the owner *sends* a saved route to a member's phone and they walk it (D1's "either").
- **Only the route screens use MapLibre.** Every other map stays on SwiftUI `Map`. One dependency, one place.
- **Live fixes go direct to Main every 15 s**, not via the companion (30 s commit + 120 s home-observe = 2–3 min late).
- **The live card reuses the family-journey Live Activity** with a `kind`, rather than a second ActivityKit type.

## Correcting the premise

The /live walk feed **was removed on 2026-09-13** (SR-Health `879b304`, SR-Main `e710605b5`). It was a position feed from
the maps PWA with no route geometry and no off-route test, owner-only. So live tracking is new work; what makes it cheap
now is the app's close-tracking mode (`Outing.swift`) and the family-journey Live Activity (`live-journey.ts`).

## What already exists and is reused, not rebuilt

| Need | Where |
|---|---|
| Plan: loop / A→B, 6 sports, distance, climb, steady/spiky, top 3 scored | SR-Health `POST /api/trails/plan` (`planner.ts`, `scoring.ts`) |
| Plan from words ("10 km hilly loop from Roseberry") | `POST /api/trails/interpret` |
| Published OSM routes nearby, graded | `GET /api/trails/discover` + `difficulty.ts` |
| Save / list / get / delete / waypoints / GPX | `/api/trails/routes[/id][/gpx]`, `planned_routes`, `route_waypoints` |
| Progress, off-route (50 m), remaining, Naismith time | `src/lib/trails/field/nav.ts` |
| Fix filter (≤100 m accuracy, ≥3 s, ≤12.5 m/s) | `src/lib/trails/field/tracker.ts` |
| Save a walked route as an activity | `POST /api/trails/recordings` with `routeId` |
| Phone → Health | SR-Main `/api/native/health/*` → `native-trails.ts` → `getFromExtracted('health', …)` |
| Members on the native lane | `withNativeAccess(area)` in `native-handler.ts` (opt-in per route) |
| 1 Hz GPS with battery floor and 4 h cap | app `Outing.swift` close tracking |
| Lock Screen card for followers, push-started | `live-journey.ts`, `household_journey[_viewer]`, app `Journey/`, `SRAppleLive` |
| Public token page precedent | SR-Health `/health/shared/<token>` (`activity-shares.ts`) |

## Phases

### P1 — Plan on the phone

**SR-Main**
- `src/lib/server/native-routes.ts` — the same job `native-trails.ts` does: call Health over the service lane, turn
  `[lng,lat,ele]` into `[lat,lng]`, thin candidates for drawing (the full geometry stays on the saved route), and
  never forward Health's error text.
- `src/routes/api/native/health/routes/+server.ts` — GET list, POST save.
- `…/routes/[id]/+server.ts` — GET detail (full geometry, for following and offline), DELETE.
- `…/routes/plan/+server.ts` — POST plan, GET suggested distance for a sport.
- `…/routes/interpret/+server.ts` — POST text → form values.
- `…/routes/discover/+server.ts` — GET nearby, or one by `osmId`.
- All `withDevice` (owner-only) in P1. Unit tests beside `native-trails.test.ts`.

**App**
- `HealthRoute.routes` → `RoutesScreen`: saved routes (name, sport, km, climb, time). No difficulty chip in P1: Health grades only discovered routes, and Main does not recompute Health's numbers — adding `difficulty` to Health's plan/list responses is a small SR-Health follow-up plus "Plan a route".
- `PlanRouteSheet`: typed request *or* form (sport, distance with the suggested value filled in, loop / to a place,
  climb, steady/spiky, out-and-back allowed); start is your location, which you can move.
- `RouteCandidatesScreen`: the 3 candidates on one map, each with score, difficulty and notes; save one with a name.
  "Nearby published routes" as a second tab from discover.
- `RouteDetailScreen`: map, elevation, stats, GPX share sheet, and (from P2/P3/P4) Follow · Download · Track live.
- `RouteModels.swift`, `RouteStore`, `RouteDemoFixtures.swift` (Central Park, synthetic), `RouteTests`, a showcase
  screenshot of candidates and detail.

### P2 — Follow it on the phone

- Swift port of `nav.ts` + the `tracker.ts` filter: `RouteNav.swift`, with tests using the same numbers as
  `nav.test.ts`, so the phone and the web agree.
- Saved routes you open are kept on disk (`RouteCache`, the JSON detail), so following needs no network.
- `FollowRouteScreen`: the route, you, done / left, time left, an "off route" banner with haptic past 50 m, and a
  pause/finish control. GPS through the close-tracking mode (`.otherNavigation`, best accuracy).
- Finish → `POST /api/native/health/recordings` (new SR-Main proxy onto `/api/trails/recordings`, `routeId` set),
  queued when there's no signal, like the upload outbox.

### P3 — Offline maps

- SPM `maplibre-gl-native-distribution` in `ios/project.yml`; `SRRouteMap` (UIViewRepresentable around
  `MLNMapView`), OpenFreeMap `liberty` style, restyled to the SR palette where the style allows. Attribution is
  MapLibre's own and stays visible (a licence term — see the Mapbox stacking bug in `project_sr_apple_app`).
- "Download for offline" on route detail: `MLNShapeOfflineRegion` around the route buffered to ~500 m, z10–16,
  estimate before, progress during, `complete`/`partial` after. "Offline maps" list in Settings with size + delete.
- Every route map (candidates, detail, follow, live) uses `SRRouteMap`, so an offline pack shows wherever that
  route is drawn. Proof = airplane mode on a simulator/phone, not "the download finished"
  (the web kit's trap: caching tiles is half of offline).
- Fallback if OpenFreeMap objects to packs: their weekly planet MBTiles → a UK extract served from our own host.

### P4 — Live tracking round the route

**SR-Main**
- Tables `route_session` (id, route_id, route snapshot geometry, walker subject, started/ended/end_reason,
  last state, share_token hash, share_expires_at) and `route_session_fix` (session_id, t, lat, lng, acc, speed).
- `$lib/home/presence/route-session.ts`: start, append fixes, derive state (along, left, off-route, pace ETA —
  the same `nav` maths, server side), end (finish reached within 50 m, 30 min stopped, 6 h cap, walker ends).
- `POST /api/native/route-session` (start, `withNativeAccess('family')` so a member can walk),
  `POST …/[id]/fixes` (batch, idempotent on `t`), `POST …/[id]/end`, `GET …/[id]` (followers' view).
- Followers: the walker's family circle viewers (`pilotRecipients`), never the walker. Live Activity through
  `live-journey.ts` with `kind: 'route'` — progress = along/total, headline "Sam · 6.2 of 10 km", detail
  "~48 min left" / "Off route 120 m". Updates on change buckets, within Apple's budget.
- Share link: `/follow/<token>` — a public page (exact-path gate entry, like `/health/shared`), 32-byte token,
  stored hashed, dead the moment the session ends or after its expiry. It shows the route, the dot and progress, and
  no trail history, no name beyond the walker's first name, and nothing after the end.

**App**
- Route detail → "Track me live" → start session, then `FollowRouteScreen` also sends fixes every 15 s (queued offline).
  Share sheet offers the link.
- Follower screen `LiveRouteScreen`: route, live dot, trail so far, progress; opened from the Live Activity or the
  family tab. `JourneyAttributes`/`ContentState` gain `kind` (decoded `IfPresent`, default `journey`);
  `JourneyTests` decodes the server's literal JSON — both sides change together.
- Owner can send a saved route to a member's phone ("Send to Sam") — the member sees it under Routes and walks it.

## Verification per phase

- **P1:** curl each `/api/native/health/routes*` on prod with a 10-minute temporary device row (the documented recipe),
  then the showcase screenshots from CI; TestFlight build installs and plans a real route.
- **P2:** `RouteTests` parity with `nav.test.ts`; a simulator GPX-driven walk shows progress and the off-route banner.
- **P3:** simulator in airplane mode renders the downloaded corridor; outside it is blank.
- **P4:** session started from a test device, fixes posted by curl, the Live Activity updates on the phone,
  `/follow/<token>` renders while live and 404s after end.

## Risks

- MapLibre adds binary size (~10 MB) and a CI compile on a 10× Mac runner.
- Live Activity update budget: bucket updates like `worthPushing` does.
- Public share page exposes a live location: token hashed, session-bound, no history, and a `public-routes` gate
  test that proves `/follow/` answers only with a live token.
