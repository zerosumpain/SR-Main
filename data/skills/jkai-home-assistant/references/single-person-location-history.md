# Single-Person Location History Analysis

Analyse where one person spent their time over N days — ranked by total duration, reverse-geocoded, mapped. Complementary to `family-movement-analysis.md` (which asks "when is everyone together/away"); this asks "where was John, and for how long."

## Pipeline

```
ha_get_history(person.X, start, end)
  → filter stationary states (home + not_home, skip driving)
  → cluster by lat/lng proximity
  → sum duration per cluster
  → reverse-geocode cluster centroids
  → render map
```

## Step 1 — Pull history

Use `ha_get_history` with explicit ISO 8601 start/end. The default 24h window is never right for multi-day analysis.

```
ha_get_history(entity_id="person.john", start="2026-07-27T00:00:00Z", end="2026-08-03T20:00:00Z")
```

**Pitfall — tool response truncation.** Full-week history for `person.*` is 30–50 KB and the MCP tool response may truncate it. If you see "omitted" or incomplete data, use `execute_code` to ingest what *is* visible and analyse it there. For bulk extraction beyond the MCP limit, use HA's REST API directly (pattern in [ha-direct-api-extraction.md](ha-direct-api-extraction.md)).

## Step 2 — Process in execute_code

The raw history output is too large to analyse incrementally with tool calls. Paste the visible events into a Python list inside `execute_code` and do all processing there.

Each event shape:
```python
{
    "entity_id": "person.john",
    "state": "home" | "not_home" | "driving",
    "last_changed": "2026-07-27T00:00:00+00:00",
    "attributes": {
        "latitude": 54.5196,
        "longitude": -1.5719,
        "gps_accuracy": 15
    }
}
```

## Step 3 — Filter stationary states

Keep only `home` and `not_home`. Skip `driving` — those are transitions, not destinations. A stationary state is any state change where the person was actually at a location for measurable time:

```python
if state == "driving":
    continue  # skip, not a destination
```

## Step 4 — Calculate per-segment duration

The time a person spent in one state is the interval until the **next non-driving state change**:

```python
for i, entry in enumerate(raw_events):
    ts = parse(entry["last_changed"])
    state = entry["state"]
    if state == "driving":
        continue

    # Find end time = next non-driving state change
    end_time = PERIOD_END
    for j in range(i+1, len(raw_events)):
        if raw_events[j]["state"] != "driving":
            end_time = parse(raw_events[j]["last_changed"])
            break

    duration_min = (end_time - ts).total_seconds() / 60
```

**Pitfall — `driving` states ping-pong.** Life360 often flips `not_home` ↔ `driving` rapidly when the phone loses/regains GPS fix while parked. These are GPS noise, not real transitions. Always skip `driving` when calculating duration — use only the *next non-driving state* as the segment boundary.

## Step 5 — Classify by location cluster

Group `not_home` segments by geographic proximity. A simple approach: define named clusters by lat/lng thresholds. The home zone is known from `zone.home` (54.5196, -1.5719 in this household — validate your own).

```python
threshold_m = 500  # merge points within 500m
def classify_area(lat, lon):
    # Known locations first
    if distance_from_home(lat, lon) < 200:
        return "Home"
    # Named clusters from reverse-geocoded centroids
    if nearby((54.9568, -1.6749), lat, lon, threshold_m):
        return "Gateshead / Dunston"
    if nearby((52.1928, 0.1366), lat, lon, threshold_m):
        return "Cambridge city centre"
    # ... additional clusters discovered on-the-fly
```

For unknown clusters discovered during analysis, capture their centroid coords as you go and reverse-geocode them later.

**Pitfall — GPS drift near the home zone boundary.** Person entities may report `not_home` with coords within ~100m of home. Life360 accuracy (~15m nominal, often worse) combined with zone radius (~100m) means someone can show "away" while literally next door. If coords are within 200m of home and state is `not_home`, tag as "Nearby / home-ish" rather than a real destination.

## Step 6 — Reverse-geocode cluster centroids

The `reverse_geocode_osm` extended tool sometimes returns HTTP 400 with lat/lon parameters. Fallback: use `execute_code` to call the Nominatim API directly:

```python
import urllib.request, json

url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&addressdetails=1"
req = urllib.request.Request(url, headers={"User-Agent": "jkai-sr/1.0"})
resp = urllib.request.urlopen(req, timeout=10)
data = json.loads(resp.read())
addr = data.get("address", {})
# Build a readable address from structured fields
parts = [addr.get(k) for k in ["road", "suburb", "city", "town", "village", "county", "postcode"] if k in addr]
```

Nominatim requires a descriptive User-Agent header or it may rate-limit you (1 req/s max, handled automatically at low volume).

## Step 7 — Rank and present

Sort clusters by total duration descending. Present as a numbered list with:
- **Location name** (street address + area)
- **Total time** (hours + minutes)
- **Days/visits count** for frequency
- **Reasoning** — what kind of visit (overnight stay, day trip, passing through)

```python
for area, total_mins in sorted(area_totals.items(), key=lambda x: -x[1]):
    hours = int(total_mins // 60)
    mins = int(total_mins % 60)
    days = sorted(day_names[area])
    # Present: "## 1. Location — Xh Ym · N visits\nDays: Mon, Wed..."
```

## Step 8 — Render map

Use `render_map` with a points layer for visualisation. Each cluster gets one pin labelled with name + duration:

```json
{
  "layers": [{
    "kind": "points",
    "points": [
      {"lat": 54.5196, "lng": -1.5719, "label": "Home — 128h"},
      {"lat": 52.1928, "lng": 0.1366, "label": "Cambridge — 17h 52m"}
    ]
  }],
  "center": [53.8, -1.2],
  "zoom": 6,
  "caption": "Locations over past 7 days — sized by duration"
}
```

## Known locations (Kelly household)

| Label | Lat | Lon | Notes |
|-------|-----|-----|-------|
| Home (Elton Parade) | 54.5196 | -1.5719 | `zone.home` |
| Darlington town centre | 54.5242 | -1.5544 | Horsemarket / Bank Top area |
| Blackwell | 54.5178 | -1.5775 | A67 / Hummersknott |
| Piercebridge | 54.5418 | -1.6858 | Cock Lane / Barton area |
| Gateshead / Dunston | 54.9568 | -1.6749 | Hollinside Road, NE11 |
| Colburn / Richmond | 54.3824 | -1.6856 | Carter Close, DL9 |
| Redmarshall / Stockton | 54.5840 | -1.4029 | Church Lane, TS21 |
| Cambridge station | 52.1928 | 0.1366 | Station Square, CB1 |

New locations discovered during analysis should be added to this table after confirming with John.

## Pitfalls

- **History API truncation.** See Step 1 above.
- **Driving ↔ not_home ping-pong.** Life360 oscillates rapidly between `driving` and `not_home` when GPS signal is weak (underpasses, parking garages, narrow streets between tall buildings). Always skip `driving` entirely — do not count it as a stationary state change.
- **Zone boundary drift.** Home zone radius is 100m. Life360 accuracy is ~15m nominal but can drift to 50m+. A `not_home` state at 150m from the home center is GPS drift, not a real outing. Treat coords within 200m of home as "home-ish."
- **Overnight stays need manual resolution.** A `not_home` segment that spans midnight (e.g. 19:00 → 13:00 next day) is an overnight stay. Check surrounding state changes to confirm the person didn't just leave the phone somewhere.
- **Big cities reduce GPS accuracy.** Life360 accuracy in dense urban areas (e.g. Cambridge city centre) can be 25-50m, making street-level resolution unreliable. Report the area, not the specific address.