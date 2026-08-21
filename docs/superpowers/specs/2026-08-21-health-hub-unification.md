# /health — one hub for the body and the ground it covers

**Date:** 2026-08-21
**Branch:** `feature/health-unified`
**Mode:** autonomous build (Full grade — zero human gates; every fork is a Decision Log entry)

## The brief

Merge the public `/health` page and the owner-gated `/trails` section into a single
`/health` route family.

1. `/health` landing: high-level, **non-disclosive** information for anonymous
   visitors — headline stats plus a redesigned pulse grid (better colour, neater grid).
2. Signed in: a much more detailed, consolidated picture that folds the `/trails`
   dashboard into the health analytics.
3. The segments section gets substantially more developed.
4. Every past activity in the list is annotated with **something excellent about it** —
   per-segment 1st–5th fastest, more efficient, harder, hottest, coldest, earliest,
   latest, best back-to-back segment, and so on.
5. The activity table filters by **any column header, on click**.
6. The owner can **exclude an activity from segment analysis** and **correct its type**
   (a ride logged as a walk).
7. A **daily suggestion** of an activity type that progresses health development, plus a
   **route plan targeting segments** that are realistically improvable on current form.

## What exists today (measured, not assumed)

| Surface | Path | Gate |
|---|---|---|
| Health dashboard | `/health` | **public** (prefix match in `hooks.server.ts`) |
| Activity list | `/trails` | owner |
| Activity detail | `/trails/[id]` | owner |
| Physio dashboard | `/trails/dashboard` | owner |
| Segments explorer | `/trails/segments`, `/trails/segments/[id]` | owner |
| Planner / routes / recorder | `/trails/plan`, `/trails/routes[/id]`, `/trails/record` | owner |

Production data (queried 2026-08-21): **1,136 activities** (836 with GPS tracks), spanning
2025-01-01 → 2026-08-20; **387 segments**; **6,317 segment efforts**; 463,662
`apple_health_metrics` rows. Type mix: walk 598, ride 315, run 161, other 56, hike 5, swim 1.

Temperature **is already ingested** — `activities.metadata->'temperature'` carries
`{qty, units}` (`degC` in the current corpus; the HAE export follows the phone's locale, so
`degF` is possible). `humidity`, `isIndoor` and `location` sit alongside it.

## Route map (target)

```
/health                      PUBLIC at the exact path — landing (anon) / full hub (owner)
/health/activities           owner   (was /trails)
/health/activities/[id]      owner   (was /trails/[id])
/health/segments             owner   (was /trails/segments)
/health/segments/[id]        owner   (was /trails/segments/[id])
/health/plan                 owner   (was /trails/plan)
/health/routes               owner   (was /trails/routes)
/health/routes/[id]          owner   (was /trails/routes/[id])
/health/record               owner   (was /trails/record)
/trails/*                    308 → the matching /health path
```

`/trails/dashboard` folds into owner-mode `/health` — there is no separate dashboard page.

**API paths do not move.** `/api/trails/*` stays exactly where it is. `/api/trails/segments`
is in the `hooks.server.ts` maintenance-secret allow-list and is driven from the VPS by
cron; renaming it would break a scheduled job to no benefit. (Decision D1.)

## The auth problem this creates, and the fix

`hooks.server.ts` currently makes `/health` public by **prefix**:

```ts
const PUBLIC_PATHS = ['/health', '/tools'];
if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return resolve(event);
```

Moving `/trails` under `/health` would therefore publish every GPS trace on the site the
moment the directory is created. Two changes close it:

1. `/health` becomes an **exact** public path. Sub-paths fall through to the normal
   owner gate. `/tools` keeps prefix semantics (it is a dead prefix today, but changing
   its meaning is out of scope).
2. `scripts/check-public-routes.mjs` cannot currently see this array at all — its
   `assertNoUnclassifiedHookPaths()` scans for `pathname === '…'` / `pathname.startsWith('…')`
   literals, and these entries are array members compared inside a callback. So the whole
   page-level public surface is **unmonitored today**. Rewriting the check as explicit
   literals makes the gate see it, and a new `HOOK_EXACT_BYPASSES` list records `/health`
   as public *only* at that exact path, so the generated snapshot stays honest.

Additionally the page itself must never *send* private data to an anonymous browser:
`+page.server.ts` builds two disjoint payloads and returns `mode: 'public' | 'owner'`.
Owner-only fields are **absent** from the anonymous payload, not hidden with CSS. A vitest
walks the public payload and fails on any key or value that could disclose location,
per-outing timing, or route geometry.

## Public landing vs owner hub

**Public (`mode: 'public'`)** — body metrics only, all aggregate:

- Hero: today's readiness band, headline, strap, RHR baseline delta.
- A headline stat row: 7-day activity count, weekly distance band, VO₂max estimate,
  sleep regularity score, current training-load zone — **numbers and bands, no outings**.
- The redesigned **Pulse Grid** (30 days × metric rows).
- The narrative paragraph and its week-in-numbers block (already public today).
- Curated featured activities — opt-in via `strava_activities.featured`, unchanged.

**Owner (`mode: 'owner'`)** — everything above, plus:

- **Today's session** — the coach card: recommended sport, intensity, target distance,
  the reasoning, and the target segments with realistic times.
- **The ground** — trails physio dashboard: EF and beats-per-km tiles and trends, load
  and volume charts, HR-zone distribution, the segments strip.
- **Recent outings** — the five most recent activities, each with its headline excellence.
- Training load / injury risk, recovery signals, sleep rhythm, correlations, the
  metric breakdown — the analytic sections that leave the public page.

## Data model changes

Two columns on `activities` (Drizzle, `npx drizzle-kit push`):

| Column | Type | Default | Why |
|---|---|---|---|
| `excluded_from_segments` | `boolean not null` | `false` | Owner drops a bad recording out of segment analysis |
| `type_override` | `text` (nullable) | — | Owner corrects a mis-recorded type without the next ingest clobbering it |

`activity_type` keeps holding **what the source said**. Everything that reads a type reads
`effectiveType(a) = a.typeOverride ?? a.activityType`. That way re-ingest is idempotent and
the correction survives it. (Decision D2.)

Both columns are additive, nullable-or-defaulted, and safe under `drizzle-kit push` on a
populated table — no `.unique()` involved.

## The excellence engine

`src/lib/trails/highlights.ts` — **pure**, vitest-covered, no DB (precedent:
`segments/similarity.ts` beside `segments-service.ts`).

```ts
computeHighlights(activities: ActivityFacts[], efforts: EffortFacts[]): Map<string, Highlight[]>
```

Families, in descending lead-weight:

| Kind | Computation | Guard |
|---|---|---|
| `segment_rank` | effort's rank by duration among all efforts on that segment; keep 1st–5th | segment needs ≥ 3 efforts |
| `segment_ef` | rank by efficiency factor on that segment; keep top 3 | pace sports only |
| `segment_bpk` | rank by beats-per-km (lowest = best); keep top 3 | pace sports only |
| `back_to_back` | consecutive efforts in one activity → ordered segment pair; rank the combined time across every activity that chained the same pair | pair needs ≥ 2 occurrences |
| `record_distance`/`_duration`/`_climb`/`_pace`/`_energy` | top-3 within the same effective type | — |
| `hardest` | Naismith equivalent-km from `difficulty.ts`; top-3 within type | — |
| `most_efficient` | whole-activity EF from `analytics/efficiency.ts`; top-3 | **pace sports only** |
| `hottest` / `coldest` | `metadata.temperature` normalised to °C; top/bottom 3 within type | outdoor only (`isIndoor === false`) |
| `earliest` / `latest` | local start hour from `start_date_local`; top/bottom 3 within type | — |
| `streak` | nth consecutive day with an activity; most outings in a rolling 7 days | ≥ 3 |
| `percentile` | "longer than 84% of your walks" | needs ≥ 8 of that type |
| `first_since` | "first swim since 4 March" / "your only swim" | always available — the floor |

**Every activity gets at least one highlight.** `first_since` and `percentile` are the
guaranteed floors; a unit test asserts the map has a non-empty entry for every input.

Rules that must not be "fixed":

- **EF and beats-per-km compare only within pace sports** (`run`, `trail_run`, `walk`,
  `hike`) — a ride's EF ≈ 4 would own every record. Same partition the segments explorer
  already applies.
- All activity-level records partition by **effective type**, never across types.
- Excluded activities contribute no segment efforts and are skipped by the segment families.
- Temperature units come from `metadata.temperature.units`; `degF` converts, anything else
  is dropped rather than guessed.

Assembly lives in `src/lib/trails/highlights-service.ts` — one load of activities + efforts,
one call into the pure engine, results memoised in-process for 5 minutes keyed on the max
`synced_at` (precedent: the physio service's shape, and it is cheap to invalidate).

## The activity table

`src/lib/components/health/ActivityTable.svelte`.

Columns: **Date · Type · Name · Distance · Time · Pace · Climb · Avg HR · Temp · EF ·
Segments · Excellence**.

Every header is a button. Clicking opens a popover carrying, for that column:

- sort ascending / descending,
- a filter appropriate to the type — checkbox list of distinct values (Type), min/max
  numeric inputs (Distance, Time, Pace, Climb, Avg HR, Temp, EF, Segments), a date range
  (Date), substring match (Name, Excellence),
- a clear-this-column action.

Active filters render as removable chips above the table with a "clear all". All of it is
client-side over one server load (1,136 rows today; the fetch is capped at 2,000 and the
cap is logged when hit, so silent truncation cannot pretend to be full coverage).

Per-row overflow menu → **Exclude from segment analysis** (toggle) and **Correct type**
(select). Both `PATCH /api/trails/activities/[id]`, which deletes the activity's efforts
when either changes and calls the existing `scheduleSegmentRebuild()`.

## The segments section

`/health/segments` keeps its filters, sorts and records panel and gains:

- a **Form** column — direction of travel over the last five efforts, with a sparkline;
- a **Gettable** score and a **Targets** view ranking segments by realistic improvement;
- a **Chains** panel — the ordered segment pairs ridden/run back-to-back most often, with
  the best combined time.

`/health/segments/[id]` gains an effort-by-effort table showing rank, temperature at the
time and the highlight earned; a PB-progression chart; and a conditions panel comparing the
temperature of the fastest efforts against the slowest. "Comparable ground" stays as built.

## The coach

`src/lib/trails/coach.ts` (pure scoring) + `src/lib/trails/coach-service.ts` (DB + ORS).

`getDailyPlan()`:

1. `proposeSession()` supplies the base sport / distance / readiness veto (unchanged).
2. A **progression overlay** picks the intensity from the training state — ACWR above 1.4
   forces recovery, below 0.8 invites a build, high monotony forces a *different* intensity
   from yesterday, a middle-heavy polarised distribution pushes to either easy-long or
   intervals, and an under-represented sport he has real history with gets a nudge.
3. `rankGettableSegments()` scores each segment of the chosen sport on how realistically it
   can be beaten today: a small but non-zero gap between the recent best and the PB, enough
   attempts to trust the numbers, a PB old enough to be catchable, a length that fits the
   target distance, and a rising EF trend. It returns the top five with target times and a
   one-line reason each.
4. A route is stitched through the best geographically-clustered targets via a new
   `viaRoute()` in `ors.ts` (ORS `directions` already accepts N coordinates; only the
   two-point wrapper is exported today), scored by the existing `scoreRoute()`.

**Degradation is explicit:** with no `ORS_API_KEY` the card still renders the session and
the target segments with their times, and says the route could not be drawn. homeserv has
no ORS key, so this is the local development path, not an edge case.

## Pulse Grid redesign

Today: a single amber ramp, one hue, higher = darker, RHR specially inverted, square cells
with 1px separators and a 110px label column.

Changes:

- **Diverging colour, anchored on each row's own 30-day median**, hue chosen by
  *direction of good*: cool ink (`--accent-ink`, #0e5b66) for better than baseline, warm
  (#8a3a08 → `--accent` #c4570a) for worse, the page cream at the midpoint. The RHR
  inversion becomes a `direction` field on the row rather than a special case in the ramp,
  and the grid becomes readable at a glance as "how was I doing" rather than "what was big".
- Palette steps are checked with the dataviz validator, not eyeballed.
- **Neater grid**: gapped tiles on a 2px surface gutter, a stronger rule every seven
  columns so weeks are countable, a capped tile height so wide screens do not stretch the
  grid, today's value moved into the row label, the per-row range moved into the tooltip,
  and a proper two-pole legend.
- The hover/focus tooltip and full keyboard reachability stay.

## Files to touch

**New**

| Path | Why |
|---|---|
| `src/lib/trails/highlights.ts` | pure excellence engine |
| `src/lib/trails/highlights.test.ts` | its tests, including "every activity gets one" |
| `src/lib/trails/highlights-service.ts` | DB assembly + memoisation |
| `src/lib/trails/coach.ts` | pure progression + gettable-segment scoring |
| `src/lib/trails/coach.test.ts` | its tests |
| `src/lib/trails/coach-service.ts` | DB + ORS assembly |
| `src/lib/trails/activity-meta.ts` | `effectiveType()`, temperature normalisation, local start hour |
| `src/lib/trails/activity-meta.test.ts` | unit conversion + override precedence |
| `src/lib/components/health/ActivityTable.svelte` | the filterable table |
| `src/lib/components/health/HighlightBadge.svelte` | one excellence, rendered |
| `src/lib/components/health/CoachCard.svelte` | today's session + targets |
| `src/lib/components/health/PublicStats.svelte` | the anonymous headline row |
| `src/routes/health/activities/+page.{server.ts,svelte}` | moved list + table |
| `src/routes/health/activities/[id]/+page.{server.ts,svelte}` | moved detail + highlights |
| `src/routes/health/segments/**` | moved + developed explorer and detail |
| `src/routes/health/{plan,routes,routes/[id],record}/**` | moved verbatim |
| `src/routes/trails/[...path]/+page.server.ts` | 308 redirects |
| `src/routes/api/trails/activities/[id]/+server.ts` | PATCH exclude / correct type |

**Modified**

| Path | Why |
|---|---|
| `src/hooks.server.ts` | `/health` becomes exact-match public |
| `scripts/check-public-routes.mjs` | see the page-level surface; add `HOOK_EXACT_BYPASSES` |
| `.github/public-routes.txt` | regenerated snapshot |
| `src/lib/db/schema.ts` | two new `activities` columns |
| `src/lib/trails/activities-service.ts` | effective type, temperature, EF, segment count on the row |
| `src/lib/trails/segments-service.ts` | honour exclusion + effective type; chains; form; gettable |
| `src/lib/trails/segments/matcher.ts` (or `rebuild`) | skip excluded activities, group by effective type |
| `src/lib/trails/ors.ts` | export `viaRoute()` |
| `src/lib/trails/planner.ts` | expose the pieces the coach reuses |
| `src/lib/components/health/v2/PulseGrid.svelte` | the redesign |
| `src/routes/health/+page.server.ts` | two disjoint payloads, owner detection |
| `src/routes/health/+page.svelte` | landing vs hub |
| navigation / sitemap / any `/trails` link | repoint |

**Deleted**: the `/trails` page routes that move (their `+page.svelte` bodies are reused, not rewritten).

## Verification

Stated before any code is written:

1. `npm run gate` in the worktree — public-routes, font-sizes, schema-imports, svelte-check, vitest, build.
2. `node -e` / vitest assertions on the excellence engine against **production data**:
   every one of the 1,136 activities returns ≥ 1 highlight.
3. A vitest that asserts the anonymous `/health` payload contains no polyline, no
   coordinate pair, no per-outing local timestamp and no segment name.
4. Local prod-build smoke on homeserv: `curl -s localhost:<port>/health | grep` for the
   public markers, and confirm `/health/activities` **302s to /login** without a session.
5. After deploy: `curl https://strangeramblings.com/health` shows the landing;
   `curl -sI https://strangeramblings.com/health/activities` shows the login redirect;
   `curl -sI https://strangeramblings.com/trails` shows 308 → `/health/activities`;
   and the owner view is screenshotted on the live site.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| D1 | Move `/api/trails/*` too? | move / keep | **keep** | `/api/trails/segments` is in the maintenance-secret allow-list and driven by VPS cron; renaming breaks a scheduled job for cosmetics | yes, trivially |
| D2 | Correct type in place vs override column | overwrite `activity_type` / add `type_override` | **`type_override`** | ingest upserts `activity_type` from the source, so an in-place edit is clobbered on the next sync | yes |
| D3 | Public/owner split mechanism | one payload + CSS/`{#if}` / two disjoint payloads | **two payloads** | hiding in the template still ships the data to the browser; a GPS trace starts at the front door | yes |
| D4 | `/health` public matching | keep prefix + guard each child / exact match | **exact match** | prefix means a future `/health/foo` is anonymous the moment the file exists, with nothing to review | yes |
| D5 | Table filtering | server-side / client-side over one load | **client-side**, capped at 2,000 rows with the cap logged | matches the segments explorer precedent (D4 there); 1,136 rows today | yes |
| D6 | Highlights computation | per-row query / one bulk load + pure engine | **bulk + pure** | ranks need the whole corpus anyway; pure engine is testable without a database | yes |
| D7 | Pulse grid colour | keep single amber ramp / diverging by direction-of-good | **diverging** | a single ramp answers "what was big"; the question the grid is for is "how was I doing" | yes |
| D8 | Old `/trails` URLs | delete / 308 redirect | **308** | the PWA, saved links and the jkai tools all carry `/trails` URLs | yes |
| D9 | Keep a separate `/trails/dashboard` page? | keep as `/health/dashboard` / fold into owner `/health` | **fold in** | the brief asks for one consolidated picture, not two dashboards | yes |
| D10 | Public landing scope | keep every existing section public / trim to high-level | **trim** | the brief says "high level … on the landing" and "much more detailed" once signed in; the analytic sections move behind the gate | yes |
