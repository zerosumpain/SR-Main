# Mapbox as the primary route for geocoding and travel planning

**Date:** 2026-09-06
**Grade:** autonomous (full) — kicked off with "make them the primary routes", finished with "push it live, I'm going to bed".

## The ask

Mapbox is already woven into jkai for *drawing* maps. The free-tier account also
carries geocoding, routing and several other services that were going unused.
Make those the primary routes for geocoding and route planning, and expose them
to jkai as preferred tools.

## What was actually there

| Job | Provider before | Notes |
|---|---|---|
| Map rendering | Mapbox | `pk.` browser token, URL-restricted, served by `/api/maps/config` |
| Forward geocoding | Nominatim | `$lib/workflows/site-tools/geocode`, 1 req/s serialised queue, 90-day cache |
| Reverse geocoding | Nominatim | `$lib/daydream/geocode`, zoom 18, 30-day cache |
| Sport route planning | openrouteservice | `$lib/trails/*`, scored on surface/steepness/retracing |
| **Ordinary A→B travel** | **nothing** | jkai could not answer "how long to drive to Norwich" at all |

That last row is the real gap. `route_plan` looks like it covers travel and does
not: it requires a lat/lng and a *sport*, and it plans a circular training route
scored on terrain.

## Free tier, as measured (mapbox.com/pricing, September 2026)

| API | Free per month | Rate limit |
|---|---|---|
| Search Box (forward/reverse) | 50,000 requests | 600/min |
| Directions | 100,000 requests | 300/min |
| Isochrone | 100,000 requests | 300/min |
| Matrix | 100,000 elements | 60/min (30 with traffic) |
| Vector tiles | 200,000 | — |
| Static images | 50,000 | — |

## Two findings that shaped the design

**1. The Geocoding API has no points of interest.** Mapbox v6 geocoding — the
obvious choice, and the more generous quota — stops at `address` and `street`.
POI data moved to the Search Box API. Nearly everything jkai geocodes is a POI
("Norwich Cathedral", a pub, an entity off the intel graph), so building on v6
would have made "Mapbox is primary" true only for postcodes, with a silent
fall-through to Nominatim on every real lookup. The build uses Search Box
`/forward` and `/reverse`, which are the per-request endpoints and need no
session token.

**2. The existing map token cannot be used server-side.** Verified against
production on 2026-09-06: the live `pk.` token returns **403 Forbidden** on both
Search Box and Directions. It is URL-restricted by design and Mapbox enforces
that on the Referer, which a server request does not send. Widening it would
publish an unrestricted token to every visitor, since that token is shipped to
browsers. So this needs a **second token**, held in the secret registry.

**3. Temporary geocoding may not be cached.** Mapbox's free tier is temporary
geocoding: results may be shown to whoever asked and then discarded, not written
to a database. Permanent geocoding needs a card on file. Nominatim's policy is
the opposite — it asks for heavy caching. The cache is therefore Nominatim-only.

## What shipped

**`$lib/maps/mapbox-api.ts`** — server-side client. Token from the secret
registry handle `mapbox-api` (query injection, `access_token`, bound to
`api.mapbox.com`, GET only), with `MAPBOX_API_TOKEN` as the homeserv fallback.
Mirrors `$lib/trails/ors.ts` exactly, including the "mis-bound credential is
surfaced, missing one falls through" rule. Covers Search Box forward/reverse,
Directions, Isochrone and Matrix.

**Geocoding, rewired.** `geocodePlace` and `suggestPlaceName` now try Mapbox
first and fall back to Nominatim. Only Nominatim results are cached. Every
existing caller inherits this without changing: `render_map`, `geocode_place`,
the drill map's place resolution, the daydream place namer.

**A new `travel` toolset**, three tools, all taking place NAMES:

- `route_directions` — a real route between places, live-traffic driving times
  with a delta against a normal day, optional turn-by-turn, drawn on a map.
- `travel_time_matrix` — every origin to every destination in one call.
- `reachable_area` — the area reachable in N minutes, as bands on a map.

Plus a `keyword-classifier` row so journey language actually loads the toolset,
and a `credential-requests` spec so jkai can ask for the token through the
supported modal rather than prose.

**openrouteservice stays** for the sport planner. Mapbox Directions returns no
elevation, no surface breakdown and cannot generate a circular route — the three
things `$lib/trails/scoring.ts` is built out of. Mapbox is primary for *going
somewhere*; ORS is primary for *going round*.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Which Mapbox search product | Geocoding v6 (100k/mo) vs Search Box (50k/mo) | Search Box | v6 has no POIs; 50k/mo is ~1,600/day against a site doing dozens | Yes — one module, one parser |
| 2 | Reuse the browser token vs a second one | Reuse / widen / separate | Separate registry credential | Measured 403 on the live token; widening publishes an unrestricted token to every visitor | Yes — delete the row |
| 3 | Cache Mapbox results | Cache like Nominatim / never cache | Never | Free tier is temporary geocoding; its terms forbid storing results | Yes, but should not be |
| 4 | Lookup order | Cache→Mapbox / Mapbox→cache | Mapbox first, cache second | Cache-first lets one old Nominatim answer outrank Mapbox for the full 90-day TTL, making "primary" decorative | Yes — one line |
| 5 | Replace ORS in the trails planner | Replace / keep / hybrid | Keep ORS | Mapbox returns no elevation, surface or round-trips; the scorer is built from exactly those | Yes |
| 6 | Which extra free-tier services | Directions only / + isochrone + matrix | All three | Same client, same token, same quota, and both answer questions jkai could not | Yes — unregister the tool |
| 7 | Ship without a token | Wait for the owner / ship dormant | Ship dormant | Every path falls back to today's behaviour; the capability activates the moment a token is registered | n/a |
| 8 | Behaviour when one place will not resolve | Route the rest / fail the call | Fail | Routing a subset answers a different question, confidently and silently — `render_map`'s existing rule | Yes |
| 9 | The third Nominatim caller, `$lib/vitals/location` | Move it too / leave it | Leave it | It wants a TOWN at zoom 12, where Nominatim is equal, and it has a 6-hour cache Mapbox's terms would force us to drop — trading one lookup every six hours for one every ten minutes, for nothing | Yes — a comment in the file says why |

## Owner action — one, ~2 minutes

Everything above is live and dormant. To switch Mapbox on:

1. Create a **new** token at <https://account.mapbox.com/access-tokens/> with
   **no URL restriction** (default public scopes are enough).
2. Add it at `/admin/ai/apis` under the handle `mapbox-api`, or just ask jkai
   for it — the credential modal now knows this provider.

Until then geocoding runs on Nominatim exactly as before, and the three travel
tools report that no token is configured.

## Review findings applied

A `/code-review high` pass over the branch found eight; all eight are fixed.

1. **The seeded catalogue entry declared an auth kind nothing implemented.**
   `ApiAuth` is declared twice — once for what a seed may say, once inside
   `apis.ts` for what `resolveApiAuth` branches on — and the new `query-env`
   kind reached only the first. A raw `api_call` against the Mapbox entry would
   have gone out with no token and returned 401 with nothing to explain it. The
   entry now uses `{kind:'secret', handle:'mapbox-api'}`, the path `apis.ts`
   itself documents as preferred, and `seed-apis.auth.test.ts` now fails if any
   seed ever names a kind the resolver does not implement.
2. **Every lookup paid a registry read and a thrown exception when no token was
   registered** — the state the site is in right now. Both callers gate on
   `mapboxApiConfigured()`, which memoises a *miss* for 60s and never memoises a
   hit, so registering a token still starts working on its own.
3. **`exclude` and `depart_at` were sent on profiles that reject them.** "A
   20-minute walk avoiding unpaved paths" would have 422'd. Filtered per mode.
4. **`includeDistance` on the traffic matrix** is unsupported by Mapbox and
   `drive` is the default, so it was the first thing anyone would hit. It now
   fails with a message naming `drive_free_flow` rather than swapping the
   profile silently and dropping traffic from the answer.
5. **`kindFromMapboxCategories` matched substrings**, reading "post office" as
   work and "funeral home" as home — and a wrong prefill becomes a memory when
   the owner accepts it. Now exact whole-category matching.
6. **`reachable_area` trimmed contours silently.** Asking for 15/30/45/60/90
   returned four bands with 90 quietly gone. It now rejects and names them.
7. **A caller-supplied `AbortSignal` replaced the 10s timeout** instead of
   composing with it. Latent; fixed with `AbortSignal.any`.
8. **The classifier's `traffic` and `nearest/closest` alternatives were too
   loose** — "traffic to the blog" and "closest match to that heading" both
   loaded the toolset. Tightened to journey context.

## Verification

- 87 new unit tests (`mapbox-api`, `geocode.provider`, `mapbox-spec`, `travel`,
  `seed-apis.auth`, plus the category mapper in `daydream/geocode`).
- Live check that the browser token 403s server-side — the premise of decision 2.
- Full gate on porkserv.
- Post-deploy: `travel` present in the production tool manifest, and the
  fallback geocoder still answering.
