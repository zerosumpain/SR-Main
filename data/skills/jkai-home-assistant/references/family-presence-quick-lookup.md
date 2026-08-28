# Family Presence Quick Lookup

The canonical "where is everyone right now" flow. Used when John asks about family locations outside the automated presence monitor workflow.

## Flow

1. **Get HA token** — pipe to file to avoid truncation (see `ha-direct-api-extraction.md`)
2. **Query `person.*` states** — single `/api/states` call, filter in Python
3. **Reverse geocode** coordinates via Nominatim (rate-limited, 1 req/sec)
4. **Return terse summary** — who, where, grouped by proximity

## Person entities

```
person.john    — source: device_tracker.life360_john_kelly
person.katie   — source: device_tracker.life360_katie_kelly
person.jemima  — source: device_tracker.life360_jemima_kelly
person.fintan  — source: device_tracker.life360_fintan_kelly
person.rory    — source: device_tracker.life360_rory_kelly
```

All tracked via Life360. `person.*` entities aggregate `device_tracker.*` sources and expose `latitude`, `longitude`, `source` attributes.

## Quick code template

```python
import urllib.request, json, time
from hermes_tools import terminal, read_file
import re

# 1. Token (see ha-direct-api-extraction.md for full credential retrieval)
with open("/tmp/ha_tok.txt") as f:
    token = f.readline().strip()

# 2. Query person states
HEADERS = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
req = urllib.request.Request("http://localhost:8123/api/states", headers=HEADERS)
with urllib.request.urlopen(req, timeout=15) as resp:
    states = json.loads(resp.read().decode())
persons = [s for s in states if s["entity_id"].startswith("person.")]

# 3. Reverse geocode each person's coordinates
for p in sorted(persons, key=lambda x: x["attributes"].get("friendly_name", "")):
    attrs = p["attributes"]
    lat, lon = attrs.get("latitude"), attrs.get("longitude")
    if lat and lon:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
        req = urllib.request.Request(url, headers={"User-Agent": "jkai-presence/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        addr = data.get("address", {})
        # Build readable location (venue, road, area, city)
        loc_parts = []
        for key in ["amenity", "shop", "leisure", "tourism", "road", "suburb", "city"]:
            if addr.get(key):
                loc_parts.append(addr[key])
                if len(loc_parts) >= 3:
                    break
        print(f"{attrs.get('friendly_name')}: {', '.join(loc_parts)}")
        time.sleep(1.1)  # Nominatim rate limit
    else:
        print(f"{attrs.get('friendly_name')}: {p['state']}")
```

## When all coordinates are identical or very close

If everyone has nearly identical coordinates (within ~50m), they're together — say so in the response rather than listing each person's slightly different geocoded address.

## Style

John prefers terse bullet points for location queries. One line per person, grouped when together. No prose explanation of the process.

## Contextual location reporting (mandatory)

A raw address is never sufficient. After reverse geocoding, you MUST:

1. **Research the venue** — web-search the geocoded place name to understand what it is (school, sports centre, shop, park, etc.). One quick search is enough; use the top result.
2. **Propose why they might be there** — based on the venue type, time of day, and any known patterns. E.g., "likely reason: school day" or "possibly at football training."
3. **Flag deviations from known patterns** — if a person's location doesn't match their expected routine (e.g., not at school on a weekday, or at an unusual place at an unusual time), call it out explicitly.

Known routines to check against (stored in memory, kept current):
- **Jemima, Fintan, Rory** — Carmel College, Monday–Friday school hours. Not at school on a weekday = flag it.

If coordinates are within ~50m of each other, group them as "together" rather than listing each person's slightly different geocoded address.
