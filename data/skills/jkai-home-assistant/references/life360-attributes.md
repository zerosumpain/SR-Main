# Life360 device_tracker attributes (HA integration)

Entity shape: `device_tracker.life360_<name>` (e.g. `device_tracker.life360_john_kelly`). Observed attributes: `latitude`, `longitude`, `gps_accuracy`, `speed`, `driving` (bool), `place`, `address`, `at_loc_since`, `last_seen`, `battery_level`, `battery_charging`, `wifi_on`, `source_type`.

## `speed` is km/h — NOT m/s, NOT mph

Empirically verified 2026-07-20 against a known-context day (car journey + Norfolk Broads boat trip), by pulling `ha_get_history` over the journey window:

- `driving: true` peak readings ~49.6 → 31 mph as km/h (plausible B-road driving); 111 mph as m/s (absurd)
- Broads cruiser readings ~7–9 → 4.5–5.5 mph as km/h (matches the 6 mph river limit); 16–20 mph as m/s (impossible for a hire cruiser)
- Stationary/moored readings 0–2.7 (GPS drift)

Correct conversions from the raw attribute:

| Target | Multiply raw `speed` by |
|--------|------------------------|
| mph    | 0.621371 |
| knots  | 0.539957 |

Do NOT use × 2.23694 — that's m/s→mph and inflates km/h readings ~2.2×. (mph→knots is × 0.868976, fine once mph is right.)

## Pitfall: generated workflow code assumed m/s

An LLM-generated `code-execute` node wrote `mph = rawSpeed * 2.23694` inside a sampler that only accepted a 2–12 mph band. Every genuine cruising fix (7–9 km/h) computed to 16–20 "mph" and was rejected, the shared rolling-window record stayed empty, and the reporter workflow stayed silent for an entire 2-hour journey — only near-stationary readings (≈1–5 km/h → 2–12 "mph") ever passed, producing exactly one message. **Whenever a workflow filters on Life360 speed, verify the conversion constant against the table above before trusting the filter band.** Symptom signature: schedule fires, runs complete, zero errors, but the downstream "silent when no data" branch always wins.

## Plausibility-check technique for unknown units

When any HA numeric attribute's units are undocumented or uncertain: pull `ha_get_history` over a window with known real-world context (a car journey, a boat trip, a run) and test each candidate unit against what the context physically allows. Magnitudes eliminate wrong units immediately.

## Other attribute notes

- `state` is `home` / `not_home` / `driving` — `driving` appears when Life360 detects car movement (not boating).
- `at_loc_since` = arrival time at the current location — use it to determine when a journey ended.
- `last_seen` = last Life360 cloud update; on rural / poor-signal stretches it can lag several minutes behind reality.
- `speed: 0` is reported both when stationary AND intermittently mid-journey (GPS noise) — never treat a single 0 reading as "stopped".
