# Family tracking — an outcomes-based review (2026-11-09)

John asked for an outcomes-based review of the iPhone app's family tracking, with
four things he wanted better, and "everything on the table" — how things are
calculated, presented, visualised, notified and tracked — to match and then
build on Life360:

1. The Home page's family tile is a sonar (the Orbit). Replace it with a block
   that *informs*, not a radar.
2. Live tracking is not effective: a family member moving in the tracking window
   should be seen moving on the map, smoothed over throttled/late GPS.
3. Each person should get their own walking statistics back: common journeys,
   average pace, patterns.
4. Notifications must be timely and effective.

Run autonomously (Full grade); this file is the spec and the Decision Log.

## The outcomes, and how each is measured

| # | Outcome (what a family member should experience) | Measure | Before (found) | Target |
|---|---|---|---|---|
| O1 | A glance at Home answers *who is where, since when, who is on the way and when they'll get there* | Questions answerable from the tile without a tap | 2 of 4: "how far / which way" (polar Orbit); place only in a legend chip; no "since", no ETA | 4 of 4, in words, one row per person |
| O2 | Someone moving is seen *moving* on the map, continuously | Time between visible pin movements while a member is travelling; path fidelity after a signal gap | Pin jumps every 5–30 s (close tracking committed every **30 s**); the viewer receives only the newest point, so a burst after no signal draws one straight jump; no animation at all | Continuous motion (10 fps playback) ~1 poll behind real time; a backlog replays along the recorded path |
| O3 | Everyone gets their own walking story back | Figures shown to the person themselves | None in the app: pace and common trips existed only on the owner's /home/people web page (`movementStats`) | Pace (median, trend by week), common journeys with time *and pace*, fastest, by-mode totals, walking-only HealthKit gait figures, when they walk |
| O4 | Alerts arrive while they are still news, once, and open the right thing | (a) fix → banner latency for leave/arrive; (b) banners per child trip; (c) taps landing on the person | (a) leave **0.5–2.6 min** (120 s observe tick); arrive **not pushed** — pulled by the follower's phone on its own wake: minutes to **hours**; (b) up to 5 (left, Live Activity alert, ETA, pulled "arrived", "stopped"); (c) every tap opened Home | (a) ≤ ~40 s for both; (b) ≤ 3 (left, ETA, arrived) with "stopped" only for places nobody is told about; (c) every household tap opens that person on Family |
| O5 | The family is told when a phone is about to go dark | Low-battery alert exists | None (battery stored, shown, never alerted) | One alert at ≤ 15 %, re-armed at ≥ 30 % |

## What was found (root causes)

**Home tile.** `HomeFamilyTile` draws `FamilyOrbitView` — home as the sun, people
on log-distance rings by bearing. It answers "how far, which way", which is the
question nobody asks of their family at a glance. Where people are sits in a
scrolling legend; when they got there, and when the mover will arrive, is
nowhere.

**Live map.** Five hops (phone → pilot → Main → view → app) were cut on 11-01 by
the pilot overlaying each source's newest point. Three things remained:

- Close tracking (leaving a watched place — the very window John means) buffers
  1 Hz fixes and **commits every 30 s** (`Outing.commitEvery`), so the overlay's
  newest point moves in 30 s steps.
- The overlay sends **only the newest point**, without speed: after a dead patch
  the queued route arrives in one upload and the pin jumps straight across it.
- `FamilyMapCanvas` places an `Annotation` at the coordinate; **no animation**.
- The 5 s poll only starts when SR-Main's `moving` flag (1–2 min late) says so.

**Walking stats.** `stats.ts` computes walking pace (median/p75 m/s, weekly) and
common trips (median time, usual departure) — for `/home/people` only. No native
route; common trips carry no distance, so no pace per journey.

**Notifications.**

- Crossings run inside `daydream-observe`, every **120 s**.
- An *arrival* is never pushed: `planLeavePushes` pushes departures only; arrivals
  go to the pilot queue, which a follower's phone drains on ITS OWN wake
  (`HouseholdAlerts`, ≥ 60 s, only on its own location/HealthKit activity). A
  phone lying still at home sleeps behind the motion gate — the alert waits.
- Household pushes carry inconsistent userInfo (no `kind`, no `subject`), and the
  app routed every one of them to Home.
- "Stopped at X" (guardians) repeats the arrival for every completed trip, ~10–12
  min later.
- No low-battery alert.

## What changes

| Piece | Where | Outcome |
|---|---|---|
| Crossings, delivery and Live Activities move from `daydream-observe` (120 s) to `household-live` (30 s), straight after the pull; the duplicate ETA call leaves observe | SR-Main `household-live.ts`, `home-observe.ts` | O4a |
| Arrivals are PUSHED too (`planCrossingPushes`): arrive = active, leave = time-sensitive; userInfo `{id, category, kind, subject, url}` on every household push (crossings, ETA) | SR-Main `alerts.ts`, `eta-alerts.server.ts` | O4a, O4c |
| "Stopped at X" is skipped for a guardian already pushed the arrival at that place for that trip | SR-Main `parent-alerts.ts/.server.ts` | O4b |
| Low battery: ≤ 15 % on a fix under 30 min old → followers, once; re-armed at ≥ 30 % | SR-Main `battery-alerts.ts/.server.ts` (+ `household-live`) | O5 |
| Common trips carry `medianMetres` and, on foot, `medianPaceSecPerKm` and `fastestSeconds`; weekly distance on foot | SR-Main `stats.ts` | O3 |
| `GET /api/native/family/movement?subject=&days=30\|90` — `movementStats` for a person the viewer may open (`mayOpenPerson`): their own, a ward's, the owner anyone's | SR-Main route | O3 |
| Overlay adds `live: {speedMps, accuracyM, points: [[lat, lon, epochSec]…]}` — every fix of the last 3 min, newest last | SR-AppleApp pilot `app.mjs` | O2 |
| Close tracking commits every 5 s (was 30) | App `Outing.swift` | O2 |
| `FamilyLiveMotion` (pure): per person a de-jittered, time-ordered track; playback at *now − lag* with interpolation along the recorded path, short dead-reckoning past the newest point, catch-up (fast-forward) after a gap, outliers (impossible speed, poor accuracy) dropped | App `Family/FamilyLiveMotion.swift` + tests | O2 |
| Map draws the played-back position at 10 fps while somebody is live (`TimelineView`, paused otherwise), with a fading "comet" of the last minute and a heading arrow; poll goes to 5 s on the overlay's own evidence | App `FamilyMap.swift`, `FamilyStore.swift` | O2 |
| Home: **Family board** replaces the Orbit — one row per person: picture, name, *where · since when*, a coloured day strip (home / out / travelling, 06:00→now), and for a mover a journey bar *from → to, ETA* from the forecast; battery and staleness flags | App `Home/HomeFamilyBoard.swift`, `HomeTiles.swift` | O1 |
| Family tab opens on the Map (Orbit stays one tap away) | App `FamilyScreen.swift` | O2 |
| **Your walking**: own pace (and trend), common journeys with time + pace, fastest, by mode, HealthKit walking speed / step length / steadiness (30-day), when you walk (from the move-history grid) | App `Family/FamilyWalking*.swift`, linked from your own person page and Home's board | O3 |
| `household` notification category; taps open the person on Family; a queued (pulled) alert already delivered by push is acknowledged without a second banner | App `SRAppleApp.swift`, `Household.swift`, `AlertActions.swift` | O4b, O4c |

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Replacement for the Orbit on Home | map thumbnail; place-grouped circles (old Today card); per-person board with since/ETA/day strip | Per-person board | A map is a picture to decode; circles grouped by place already lost to the Orbit; the board answers the four glance questions in words, and the day strip adds the one thing no competitor shows — the shape of everyone's day | Yes — the Orbit view is kept (Family tab) |
| Where smoothing happens | server (Kalman on ingest); phone | Phone, from server-supplied recent points | The viewer knows its own clock and lag; the pilot only has to hand over what it already stores | Yes |
| Smoothing method | Kalman filter; spline; piecewise-linear playback with lag | Lagged piecewise-linear playback + ≤ 20 s dead reckoning + outlier gate | Points come every 1–5 s on roads; replaying the recorded path is truer than any curve fit, and a lag of one poll makes motion continuous. Kalman adds tuning risk for no visible gain at this cadence | Constants in one file |
| Live point window | newest only; 60 s; 3 min | 3 min, ≤ 200 points | Covers a typical dead patch replay; bounded payload | Constant |
| Close-tracking commit | 30 s; 5 s; 1 s | 5 s | Matches `liveUploadEvery`; the vehicle path already writes the queue at ≤ 5 s | Constant |
| Arrival push level | passive; active; time-sensitive | active (leave stays time-sensitive) | "Arrived" is reassurance, not an emergency; it should not break a Focus | One line |
| Crossing cadence | keep 120 s; also run in household-live; move | Move to household-live (30 s) | Two activities on one per-person state race; one owner, four times faster | Yes |
| "Stopped" dedupe | drop "stopped"; skip when the arrival was pushed | Skip per recipient when an arrive push for that place went within the trip | Keeps "stopped" for unwatched places, where it is the only signal | Yes |
| Low-battery threshold | 10/15/20 % | 15 % (re-arm 30 %) | Same floor at which close tracking already gives up the GPS | Constants |
| Walking-stats source | phone-only (HealthKit); server trail; both | Both | The trail knows journeys (from → to); HealthKit knows gait. Each says something the other cannot | Yes |
| Who sees walking stats | self only; self + wards; anyone | `mayOpenPerson`: self, wards, owner anyone | Same gate as the person page and move history; "back to them" first | Gate in one place |
| Release order | — | SR-Main → pilot → app on TestFlight (John only, branch build) | Server changes are additive; old phones ignore new fields; family get the app only when John presses Release | — |

## Not in this round

Speeding against OSM limits, crash detection, "phone went quiet" for followers
(owner's watch alerts cover it), per-follower per-place alert choices, live
traffic ETA.
