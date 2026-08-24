# Person Tracking Pitfalls

## Zone Boundary Precision

HA zones are circles with a configurable radius (default 100m, often set to 20–50m). A person is `home` only when their GPS point falls inside the circle. GPS from Life360 and phone device trackers can drift by 50–200m, especially:

- In urban areas (multipath from buildings)
- Shortly after waking / leaving a building (stale GPS)
- When the phone's location service is set to "battery saving" (wifi/cell-only, lower precision)

**Symptom:** Person shows `not_home` but coordinates are within ~100–200m of the home zone center. This is almost always a GPS precision issue, not an actual departure.

**How to handle in status checks:** When coordinates are close to home, report as "nearby" rather than "away." Don't alarm on it unless the pattern persists (e.g., 3+ consecutive readings away).

## Family Presence Workflow Notes

- The family-presence-monitor cron workflow handles this by computing trend statistics over multiple readings before firing an alert.
- For quick ad-hoc checks, the template in the SKILL.md "Bulk Status Check" pattern already returns coordinates — use distance judgment rather than raw `home`/`not_home` state.
- See `references/family-presence-system.md` for the full workflow architecture.

## Entity IDs in This House

- `person.john`, `person.katie`, `person.jemima`, `person.fintan`, `person.rory`
- No `lock.*` entities configured — door security relies on `binary_sensor.*_door*` contact sensors.
- Temperature comes from Echo devices (e.g. `sensor.john_s_echo_temperature`), not a dedicated climate/temperature sensor.
