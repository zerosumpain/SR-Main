# Family travel desk — /home/people

2026-09-28. The owner asked for /home/people to bring the household's movement,
calendar and routes together in one place, predict travel times and surface
anomalies, with a data shape the SR app can read later. The standard to meet is
the /health/analytics dashboard redesign: one page, a filter bar, KPIs, then cards.

## What was actually wrong

The UI was weak because the analysis behind it was starved:

- **`insights.ts` threw away 92% of the Life360 trail.** A Life360 phone reports
  only when it moves, so a two-minute Home Assistant poll of a still phone
  repeats one reading for hours. The median `reading_age_s` across the household
  was 16–36 minutes, and the engine refused anything over 120 s. The result was
  1–5% coverage and zero learned routes over 28 days.
- **Journeys broke at 6-minute gaps.** Life360 reports a moving phone every few
  minutes, on its own schedule, so 24 of 37 school runs were lost.
- **Overlapping place circles:** an unnamed street cluster "won" arrivals over
  the named place it overlapped, and drift at a door read as a trip.
- Three pages (Overview, Insights, Places) and two engines (`stats.ts`,
  `insights.ts`) each told part of the story.

Phase 1 (#1058) fixed the engine. Coverage is now 90–97% and school-run recall
is 30 of 37. The fix re-dates readings to when they were seen (`normaliseReadings`),
treats repeats as stationary heartbeats for up to 6 h, sets `CONTINUOUS_GAP_MINS = 10`,
lets named places win, counts only still minutes toward a stay, and keeps broken
trips out of the time estimates.

## Decisions (owner, 2026-09-28)

| Question | Decision |
|---|---|
| Scope | All four phases |
| Calendar attribution | Infer (calendar map, then family names in the title, then owner), with an owner override per calendar |
| Routing for unseen trips | openrouteservice via the secret registry (`openrouteservice` handle) |
| Pages | /insights folds into /home/people (308); /places stays as the map editor |

## Shape

- **`forecast.ts` (pure)** — routines (route × day type × usual departure, share
  counted from the first run), `nextMoves`, `watchItems` (overdue / running-long /
  quiet), `learnedTravel` (the person's trips, then the household's) and
  `departureGrid`. `FamilyForecast` is the contract the app reads.
- **`agenda.ts` (pure) + `agenda.server.ts`** — calendar (`readCalendar`, with
  exclusions) → assignment → place match (by name, else geocoded point) → origin
  (the previous engagement, else the current place, else home) → travel (learned,
  else routed) → leave-by (start − p80) → issues (tight, overlap, unplaced).
  Geocodes and routes are cached 30 days in `app_settings`, at most 6 lookups per read.
- **`watch-alerts.server.ts`** — per-kind switches, all off by default, raised
  through `notifyOwner` under the new `family` category (phone only by default)
  with a dedupe key per occurrence. It runs on the home-observe heartbeat.
- **`/api/native/family/forecast`** — the same forecast for the app, scoped like the page.
- **Page** — sticky filter bar (person, 7/28/90 d) → KPI strip → ink Now band
  (map + each person's next move) → Coming up | Watch → Routines (dot strips and
  an inspector plotting departure time against journey time) → Patterns heatmap |
  naming queue (one-tap map suggestions, posted to /places' own actions) →
  movement detail.

## Scoping

Nothing changed in who sees what. `insightMembers` and `mayOpenPerson` still
decide everything. The calendar, the naming queue, the notification switches and
the calendar map are owner-only, checked in the load and in every action.

## Known limits

- Mode is still coarse (vehicle vs active). Health workouts do not refine it yet.
- Leave-by has no live traffic; a routed time is widened by fixed factors.
- Routines need three clean trips. A new term or a new job takes a week or two to learn.
