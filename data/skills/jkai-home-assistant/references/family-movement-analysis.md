# Family Movement Analysis via HA History

## Data source: `person.*` entities (NOT raw `device_tracker`)

**Always use `person.*` entities as the primary data source.** They are far superior to `device_tracker.life360_*` for multi-day analysis:

| | `person.*` | `device_tracker.life360_*` |
|---|---|---|
| State churn | Already collapsed by HA zone logic | Raw — every 30-min battery update is a state change |
| History depth | 7+ days of clean transitions | ~24h before truncation |
| Noise | Minimal (zone boundary only) | Massive (GPS drift, battery, signal loss) |
| Joint analysis | Clean, comparable across members | Each person has different update frequency |

Only fall back to raw `device_tracker.*` when debugging accuracy issues (e.g. "why does HA think John is home when Life360 shows him away?").

## Discover person entities

Don't guess entity IDs. Enumerate with a template:

```
{% for state in states.person -%}{{ state.entity_id }} ({{ state.state }}, last_changed: {{ state.last_changed }})
{% endfor %}
```

Life360 person entities tracked in this household:
- `person.john`, `person.katie`, `person.fintan`, `person.jemima`, `person.rory`
- Sources: `device_tracker.life360_<name>_kelly`

## Pull history

Call `ha_get_history` for each `person.*` entity in **parallel** (5 calls at once is fine). Pass explicit `start`/`end` ISO 8601 strings — the default 24h window is usually wrong for analysis requests.

```python
# All 5 in parallel:
for entity in ["person.john", "person.katie", "person.fintan", "person.jemima", "person.rory"]:
    ha_get_history(entity_id=entity, start="2026-05-08T00:00:00Z", end="2026-05-15T23:59:59Z")
```

## Processing pattern: dump to execute_code

The raw history data is large (each person = 30-50 state changes per week). Don't try to process it incrementally with tool calls. Instead:

1. Pull all 5 person histories in parallel via `ha_get_history`
2. Dump the events into `execute_code` as Python lists
3. Do all the collapse/correlation/metrics math in one script
4. Print the formatted report

This keeps the analysis in a single code block where you can cross-reference everyone.

## Collapse state churn

Life360 produces noisy transitions: `home → not_home → driving → not_home → home` for a single outing. Collapse into two states:

```python
state = "home" if e["state"] == "home" else "away"
```

Then deduplicate consecutive same-state entries (keep only transitions). Extract away periods as `(start, end, duration)` tuples by finding `away → home` boundaries.

Skip very short gaps (< 3 min) as GPS noise — they're phone drift near the zone boundary.

## Cross-correlation: joint outings

**This is the key forensic technique.** After collapsing each person's outings, cross-reference by timestamp to find when family members were at the same place at the same time:

```python
# Look for matching timestamps ±2 min across members
# Same timestamp at same GPS coords = same car, same destination
```

Signals of joint travel:
- **Same departure time** from home (within 2 min) → likely same car
- **Same arrival time** at a non-home location → shared destination
- **Same return time** to home → drove back together

When you find convergence, report: who, when, destination coords, distance from home, and the duration they were all away together.

## Furthest-point analysis

Each away period has GPS coordinates on every state change. Track the point furthest from home (haversine distance) for each outing to identify destinations:

```python
def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # km
    dlat, dlon = radians(lat2-lat1), radians(lon2-lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * asin(sqrt(a))
```

## Summary metrics to compute

Per person:
- **Days out** / 7 — how many days had at least one outing
- **Total hours away** — sum of all away durations
- **Number of outings** — count of distinct away→home periods
- **Driving trips** — count of outings where at least one `driving` state appeared
- **Longest single absence** — max duration period
- **Furthest destination** — max haversine distance from home for the week
- **Typical departure/return windows** — earliest/latest departure and return times

Cross-family:
- **Joint outings** — same timestamp + same location = travelled together
- **School run pattern** — cluster all weekday morning departures to find the window
- **Evening pickup pattern** — who gets driven home vs walks
- **Anomalies** — unusually long days, same-time pickups for multiple kids

## Visualization

Render a map with two layers:
1. **Points layer** — home, school, and all notable destinations (weighted by visit count)
2. **Track layer** — home → destination → home for each major outing

Render a bar chart of total hours away per person.

## Known locations (Kelly household)

| Label | Coords | Notes |
|-------|--------|-------|
| Home (Elton Parade) | 54.51962, -1.57187 | `zone.home` |
| School | 54.5243, -1.5864 | ~1.1 km SW of home; kids walk |
| Morton Park / Faverdale | 54.527, -1.594 | ~1.7 km W; after-school sports? |

Additional locations discovered on-the-fly (label them descriptively when they appear):
- **North Darlington venue:** 54.5435, -1.5780 — 2.7 km NNE; possibly a sports/leisure centre
- **Stockton direction:** 54.519, -1.505 — 4.3-4.6 km E; retail park or restaurant area
- **North Road:** 54.5375, -1.5711 — 1.8 km N; Katie visits occasionally

HA zones: currently only `zone.home` is defined. No custom zones for school or other locations.

## Pitfalls

- **Not all "not_home" means away.** Life360 can flip to `not_home` briefly when the phone's GPS drifts near the zone boundary. Collapse very short gaps (< 3 min) back into "home".
- **Driving state is transient.** Never treat `driving` as a separate category from `not_home` for presence analysis — always fold it into "away". But DO track its presence to distinguish walked vs driven outings.
- **History API returns state changes, not positions.** The `latitude`/`longitude` attributes on each state change give you where the transition happened, not the full route.
- **`ha_get_history` is limited to ~7 days of useful granularity.** Longer windows return aggregated data that loses the individual transitions.
- **Tool results truncate large history payloads.** The `ha_get_history` response for a full week of person.* data is 30-50 KB — often truncated in the tool response. Don't try to process it incrementally with more tool calls. Instead, manually transcribe the visible events into a Python list inside `execute_code` and do all analysis there. The truncation usually keeps the most recent data; if you need earlier days, query per-day ranges. **For bulk extraction beyond the MCP limit**, use HA's REST API directly — credentials + full pattern documented in [ha-direct-api-extraction.md](ha-direct-api-extraction.md).
- **Kid GPS can bounce.** If a kid shows rapid home→away→home→away in <5 min, the phone is likely in someone else's pocket or bag. Don't count these as separate outings.
