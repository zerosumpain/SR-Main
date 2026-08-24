# Direct HA REST API Extraction

When MCP tools (`ha_get_history`) truncate due to large payloads, bypass them by calling HA's REST API directly from Python inside `execute_code`.

## Credentials

The long-lived access token lives in the app's PostgreSQL database.

Table: `home_assistant_config` (note: snake_case, not CamelCase)
Columns: `token` (the bearer token, single row with `id='default'`)

### ⚠ Broken approach: .env password extraction

The `.env` file has `DATABASE_URL=postgresql://app:***@localhost:5433/strange_rambling` — the password is literally `***` (not a shell masking artifact). Direct `psql` or `psycopg2` connections from outside the running app are impossible. Do NOT extract the password from `.env`.

### Correct approach: docker exec (homeserv, execute_code)

The Docker container has PG credentials in its own environment — no password needed:

```python
from hermes_tools import terminal

# CRITICAL: pipe psql output to a file — terminal() truncates long values
# (JWT tokens are ~183 chars but terminal() output caps and shows ellipsis)
terminal(
    "docker exec strange_rambling-app-db-1 psql -U app -d strange_rambling "
    "-t -A -c \"SELECT token FROM home_assistant_config LIMIT 1\" "
    "> /tmp/ha_tok.txt 2>&1",
    timeout=10
)

with open("/tmp/ha_tok.txt") as f:
    token = f.readline().strip()
```

### VPS token retrieval (from terminal, not execute_code)

When running from `terminal()` rather than `execute_code`, get the token via SSH to VPS:

```bash
HA_TOKEN=$(ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -t -A -c \"SELECT token FROM home_assistant_config LIMIT 1;\"") \
  && curl -s -H "Authorization: Bearer $HA_TOKEN" "http://homeserv.tail668b8c.ts.net:8123/api/states/person.fintan"
```

Container names differ: homeserv = `strange_rambling-app-db-1` (underscores), VPS = `strange-rambling-app-db-1` (hyphens).

## HA URL

From homeserv, HA is reachable at `http://homeserv:8123` (Tailscale hostname resolves locally).

## API pattern

Use `urllib` (stdlib — no pip installs needed):

```python
import urllib.request, json
from datetime import datetime, timedelta

HA_URL = "http://homeserv:8123"
HEADERS = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

def ha_history(entity_id, start, end):
    """Fetch state history for an entity over a time range."""
    url = (f"{HA_URL}/api/history/period/{entity_id}"
           f"?start_time={start.isoformat()}Z"
           f"&end_time={end.isoformat()}Z"
           f"&significant_changes_only=false")
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())
```

### Bulk extraction (multi-day, multi-person)

```python
# Pull 8 days × 5 people
entities = ["person.john", "person.katie", "person.fintan", "person.jemima", "person.rory"]
start = datetime(2026, 5, 8)
end = datetime(2026, 5, 15, 23, 59, 59)
delta = timedelta(days=1)

all_data = {}
for entity in entities:
    all_data[entity] = []
    day = start
    while day < end:
        chunk = ha_history(entity, day, day + delta)
        if chunk:
            all_data[entity].extend(chunk)
        day += delta
    print(f"{entity}: {len(all_data[entity])} state changes")
```

## Reverse geocoding

Use Nominatim (free, no API key) to convert coordinates to place names:

```python
import urllib.parse

def reverse_geocode(lat, lon):
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": "jkai-travel-analysis/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode())
        return data.get("display_name", "Unknown")
```

**Rate-limit:** Nominatim allows 1 req/sec. Add `time.sleep(1.1)` between calls in a loop.

## Key differences from MCP tools

| | MCP (`ha_get_history`) | Direct API |
|---|---|---|
| Payload size | Truncated at ~30-50 KB | Full JSON, no truncation |
| Multi-day ranges | Loses granularity beyond ~7 days | Per-day chunking gives full data |
| Response format | Tool-specific wrapper | Raw HA state objects |
| Speed attrs | Sometimes stripped | Full `attributes` including speed, lat/lon, battery |

## Pitfalls

- **`urllib` only.** `requests` is not installed in the sandbox. Always use `urllib.request`.
- **DB password from `.env`, not hardcoded.** Extract it from `DATABASE_URL` in `~/strange_rambling_svelte/.env` using regex. Do not hardcode.
- **Table is `home_assistant_config` (snake_case).** The Drizzle schema table name is snake_case in PostgreSQL. The `token` column holds the JWT in a single row (`id='default'`). Do NOT query `homeAssistantConfig` or `configKey`/`configValue` — those are wrong.
- **Password in `.env` is literally `***`.** Direct `psql` from the host won't work. Always use `docker exec` to query the DB container (it has its own PG environment vars with the real password). For VPS, SSH first then docker exec.
- **`terminal()` truncates long output values.** A ~183-char JWT token will appear truncated in `terminal()` stdout (e.g. shows only 13 visible chars). **Always pipe psql output to a file** (`> /tmp/ha_tok.txt`) then read it with Python's `open()`. Never rely on `result["output"].strip()` for long values.
- **HA internal URL only from homeserv.** `http://homeserv:8123` resolves because the code runs on the same machine as the Docker container. From the VPS, use the Tailscale hostname. HA port 8123 is exposed on the Docker host network.
- **Nominatim rate limits.** Max 1 req/sec. Batch geocoding needs `time.sleep(1.1)` between calls.
