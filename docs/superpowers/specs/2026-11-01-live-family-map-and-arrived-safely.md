# Live family map, full routes after no signal, "arrived safely" (2026-11-01)

John asked for three Life360-parity changes plus one app nicety:

1. The family map should move while someone travels, not jump every minute or two.
2. No signal (parts of Darlington) should not cost the route: best-effort updates
   while moving, then the full route sent when signal or Wi-Fi returns.
3. When a drive or train journey ends, everyone following that person gets
   "arrived safely": where, how long, how far, top speed, and for a drive a
   short safe-driving line (harsh braking / acceleration; speeding later).
4. App tray: tapping the place you're on goes Home; again goes back.

## What was found

- **Pilot bug (root cause of thin close-tracking trails, fatal for a backlog):**
  the household lane paged by `(received, user_id, id)`; one upload shares one
  `received`, ids are random, and SR-Main skips a fix older than the last it
  wrote — it kept a handful of each multi-point batch.
- The phone already keeps every recorded point until uploaded and the server
  uses late in-order points; but it recorded one point per 30 s moving, sent a
  request per point, and nothing flushed on reconnect.
- Map latency was five polled hops (phone → pilot → Main pull 30 s → views push
  → app poll 15 s): 30–90 s per update.
- No journey-end push existed; trip end (`extractTrips`, 10 still minutes) and
  phone speed did. No accelerometer, no speed-limit data anywhere.

## What shipped

| Piece | Where |
|---|---|
| Held people never live sources | SR-Main #1291 |
| Recorded-order paging (cursor `v2`), live overlay of each source's newest point on `GET household/view` | SR-AppleApp #173 (+ hotfix #175: SQLite temp on the data volume) |
| 5 s moving / 1 s car cadence, batched uploads (≤ 500), flush on reconnect/Wi-Fi, 5 s Family poll while someone moves, tray toggle | SR-AppleApp #174 |
| Harsh braking/acceleration from raw 1 Hz fixes at ingest (`drive.ts`), "arrived safely" (`journey-alerts.ts`) superseding "stopped" for covered guardians | this PR |

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Live map transport | SSE like Manhunt; pilot overlay + faster poll | Overlay + 5 s poll while someone moves | SR-Main never holds fresh points (pull); overlay removes 3 hops with no new infra (cloudflared buffering) | Yes — SSE can sit on the same overlay |
| Cadence | 5 s; 1 s; 5 s + 1 s in car; keep 30 s | 5 s, 1 s ≥ 8 m/s (John) | Braking needs 1 Hz; GPS still sleeps when still | Settings, per phone |
| Speed limits | OSM later; OSM now; paid API; none | OSM later (John) | v1 lands sooner | — |
| Recipients | followers; parents; kids only | Followers, as left-home (John) | one follow list | Per-member `alerts.follow` |
| Harsh-event storage | new table; trail at 1 Hz; app_settings | `app_settings` `home.presence.drive.<subject>` (tail + newest 300) | no schema push/GRANT hazard; trail stays at 5 s | Yes |
| Where braking is computed | phone; Main ingest | Main ingest from raw fixes | phone unchanged; thresholds tunable server-side | Yes |
| Thresholds | — | 3.5 m/s² over a 2–4 s pair, faster end ≥ 25 km/h, accuracy ≤ 20 m, distance-consistency 25 % | insurer-box line; rejects unknown speed sent as 0 | Constants in `drive.ts` |
| Units | km; miles | miles + mph | UK roads | Copy |
| Timing | on arrival crossing; on trip end | trip end (~10 min after arriving) | precedent (`stopNotices`), needs the dwell to know it ended | Yes |
| Late fix into a gap (server) | accept out-of-order; keep skip | keep skip | phone uploads in order; recorded-order paging fixes the real loss | Yes |
| Flights, phone use | — | not in v1 | no data source yet | — |

## Review fixes (independent review, 2026-11-01)

- A location hold leaves the held owner out of "arrived safely" (his real trips were being told).
- The harsh-braking store (`home.presence.drive.<subject>`) is erased with the companion trail (delete-my-data and People erase), and fixes rejected by the deletion floor never enter it.
- "No harsh braking" is only said for a drive watched at 1 Hz for ≥ 50 % of its seconds (`coverageBetween`); a 5 s or 30 s phone gets no driving line rather than a false all-clear.
- A pair with an unknown speed (sent as 0) is never judged; braking to a standstill is still caught on the pair before 0.
- The journey step failing cannot stop the stop / school-late notices.
- Phone: only one-point batches merge (re-joining a refusal's halves made one bad point block the queue); below car speed points write at once; a hand-set cadence stays that cadence in a car.
