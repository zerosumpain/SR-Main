# Family Presence Monitor System (v2)

Automated presence monitoring for the Kelly family (John, Katie, Fintan, Jemima). Runs as a cron workflow on the VPS every 5 minutes, pulls HA person states, detects stationary periods, sends WhatsApp alerts.

## Architecture (v2 — June 2026)

```
Trigger (*/5 * * * *)
 │
 ├─► data-store: get previous states
 └─► HA template: get all person states (person.* + device_tracker.life360_*)
      │
      ▼
   merge (deep-merge previous + current)
      │
      ▼
   code-execute: detect & track (~130 LOC)
   ↳ Detects home/away transitions
   ↳ Tracks stationary periods (coordKey-based)
   ↳ School geofence filter
   ↳ Per-person notification cooldown
      │
      ▼
   code-execute: enrich & log (~150 LOC)
   ↳ High-precision Nominatim geocoding (1.1s rate limit)
   ↳ Event logging (90-day, pruned)
   ↳ Simplified dashboard stats (stops, top destinations)
   ↳ Builds LLM context
      │
   ┌──┴──────────────────┐
   ▼                      ▼
 4× data-store       conditional (any departures?)
 (states, events,    │
  stats, geocache)   ├─ [true]  → llm-call (glm-5.1) → WhatsApp
                     └─ [false] → (no action — edge removed)
```

## Notification Logic (v2 rules)

**Silent (no WhatsApp):**
- Left home (just departed)
- Moving to a new location (not stationary long enough)
- Arrived within 500m of school geofence (Carmel College, Hummersknott)
- Stationary <10 minutes
- Already notified for current location (cooldown until they move on)

**WhatsApp alert sent:**
- **Stationary ≥10 min at a non-school location** → High-precision geocode + LLM analysis ("where they stopped, why they might be there")
- **Arrived home** → Brief confirmation with away duration

After notifying a stationary location, no further alerts until the person moves to a new coordKey, which resets the cooldown.

## Tracking State Design

Per-person tracking state (stored in `family_presence_states.tracking`):

```json
{
  "awaySince": "ISO timestamp",
  "lastCk": "lat,lon (3dp) string",
  "stationarySince": "ISO timestamp or null",
  "notifiedLoc": "coordKey string or null",
  "notifiedAt": "ISO timestamp or null"
}
```

Location comparison uses `coordKey(lat, lon)` = `${lat.toFixed(3)},${lon.toFixed(3)}` — ~111m grid, coarse enough to absorb GPS jitter without haversine.

## School Geofence

Carmel College, Hummersknott, Darlington: `{ lat: 54.525, lon: -1.587, radiusM: 500 }`. Any stationary event within this radius is silently skipped.

## Key IDs (all on VPS DB)

| Item | ID |
|------|-----|
| Workflow | `75bd5bc5-3297-4509-956e-3851b3811491` |
| code-execute: detect & track | `code-execute-2739a9eb-5` |
| code-execute: enrich & log | `code-execute-log-stats` |
| conditional | `conditional-2739a9eb-6` |
| llm-call | `llm-call-journey-analysis` |
| WhatsApp | `whatsapp-2739a9eb-7` |
| data-store: states | `data-store-2739a9eb-8` |
| data-store: events | `data-store-events` |
| data-store: stats | `data-store-stats` |
| data-store: geocache | `data-store-geocache` |

## Data Store Keys

| Key | Contents |
|-----|----------|
| `family_presence_states` | Primary state: `states`, `locations`, `tracking`, `geocache` |
| `family_presence_events` | 90-day event log (pruned). Each entry: `ts, person, name, type, lat, lon, geocoded, stationaryMin, awayDuration` |
| `family_presence_stats` | Simplified per-person stats: `stops7d, stops30d, home7d, topDestinations` |
| `family_presence_geocache` | Cached Nominatim results (`lat,lon → place name`) |

## Event Types (v2)

| Type | Meaning |
|------|---------|
| `left_home` | Transition home → not_home (silent) |
| `location_change` | Moved to new coordKey while away (silent) |
| `stationary` | Same coordKey for ≥10 min at non-school location (WhatsApp alert) |
| `arrived_home` | Transition to home (WhatsApp alert with away duration) |

## HA Entity Mapping

| Person | HA Entity | Device Tracker |
|--------|-----------|----------------|
| John | `person.john` | `device_tracker.life360_john_kelly` |
| Katie | `person.katie` | `device_tracker.life360_katie_kelly` |
| Fintan | `person.fintan` | `device_tracker.life360_fintan_kelly` |
| Jemima | `person.jemima` | `device_tracker.life360_jemima_kelly` |

HA credentials stored in VPS `home_assistant_config` table (NOT env vars).

The HA template queries both `person.john` and `person.john_kelly` — these may be duplicate sources from different device trackers. The detect node uses `john` primarily and falls back to `john_kelly` location if `john` has none.

## API Endpoint

`GET /api/family-presence/stats` — **owner-only since 2026-08-29**. Returns current states, events, geocache, stats. It was in `PUBLIC_API_PATHS` and served five family members' clustered GPS history and current positions anonymously, by first name; it was removed in the Landgrab build (spec `docs/superpowers/specs/2026-08-29-landgrab-territory.md`, decision 18). An anonymous curl now returns 401 — that is correct, not an outage. jkai's `family_presence_current` tool is unaffected because it reads the datastore directly.

**Note:** The API endpoint code may still expect v1 data shapes (haversine history arrays, per-person trends). After the v2 rewrite, the data shapes changed. If the dashboard breaks, check whether the API endpoint needs updating to match v2 event/stats structures.

## Dashboard

Live at `/projects/family-presence-dashboard/`. Static HTML reading from the API endpoint. May need updating post-v2 to match new data shapes (event types changed, history arrays removed, stats simplified).

## What v2 Removed vs v1

- **Haversine distance, speed, bearing computation** — replaced by coordKey grid
- **DBSCAN clustering** — removed (was O(n²) over full event history every tick)
- **Z-score anomaly detection** — removed (stats simplified)
- **Departure heatmap, pattern profiles** — removed
- **Journey tracking with departure/arrival times** — simplified to stationary detection
- **Fallback WhatsApp edge** (false branch of conditional) — removed (was sending blank messages)
- **HA history fetching** — v1 fetched 7d history per person via REST; v2 uses the HA template node for current state only

## Editing the Workflow

Production workflow lives on VPS PostgreSQL. Edit via:
1. `/jkai/canvas/75bd5bc5-3297-4509-956e-3851b3811491` (scoped canvas tools)
2. Direct SQL on VPS DB (for bulk config changes — see `jkai-platform-internals → references/database-access.md`)

SSH: `ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38`
DB: `docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling`

**Pitfall — data store format transitions:** When doing a major node rewrite that changes the data store schema (e.g., v1 used `trends/history/journeys` keys, v2 uses `tracking`), the old stored data may not parse correctly in the new code. Either (a) reset the data store keys to clean defaults as part of the migration, or (b) add backward-compat parsing in the new code. In the v2 migration, the events array was reset to `[]` and tracking was initialized empty.
