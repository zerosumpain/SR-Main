# Geocache Backfill for Dashboard Destinations

## Context

The family-presence workflow reverse-geocodes GPS coordinates via Nominatim and stores results in the `family_presence_geocache` data-store key. The geocache maps `"lat,lon"` (rounded to 2 decimal places) → human-readable address (e.g. `"Coniscliffe Road, Pierremont, Darlington"`).

When the geocache is sparse (few entries), the dashboard's destination clustering shows raw lat/lon instead of street addresses. The workflow only geocodes new locations during live runs, so historical clusters may have no geocache entry.

## Backfill technique

1. **Fetch the API** to get cluster centroids (`/api/family-presence/stats?range=30d` → `destinations[]`).
   **Owner-only since 2026-08-29** — it was removed from `PUBLIC_API_PATHS` in the Landgrab
   build (spec `docs/superpowers/specs/2026-08-29-landgrab-territory.md`, decision 18) because
   it served five people's GPS history anonymously. An anonymous curl returns 401 and that is
   correct: authenticate as the owner, or read `family_presence_current` from the data store
   directly. **Do not put it back in the allow-list to make this step work.**
2. **Reverse-geocode each centroid** via Nominatim:
   ```
   GET https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=18&addressdetails=1
   ```
   Rate limit: 1 req/sec. Use `User-Agent: jkai-presence-dashboard/1.0`.
3. **Build concise addresses** from the `address` object: join `road`, `suburb`, `city/town/village`, `county` (first 3 unique values, deduplicated case-insensitively).
4. **Merge with existing geocache** and update the VPS data store directly:
   ```sql
   UPDATE workflow_data_store
   SET value = '<merged_json>'::jsonb, updated_at = NOW()
   WHERE workflow_id = '75bd5bc5-3297-4509-956e-3851b3811491'
   AND key = 'family_presence_geocache';
   ```

## Geocache key format

Keys are `"{lat:.2f},{lon:.2f}"` — rounded to 2 decimal places (~1.1km precision boxes). Two entries 0.005° apart may refer to the same road. The clustering code matches centroids to geocache entries within 1km haversine distance (was 500m, widened in May 2026).

## Destination clustering (server-side)

The `/api/family-presence/stats` endpoint runs `clusterHistoryPoints()` which:
1. Filters `history[person][]` to non-home points with lat/lon
2. Greedy clustering: assigns each point to nearest existing cluster within 200m, or starts new cluster
3. Computes centroid lat/lon per cluster
4. Resolves centroid to nearest geocache entry within 1km
5. Falls back to raw `"{lat:.3f}, {lon:.3f}"` if no geocache match
6. Returns top 20 destinations sorted by visit count, with `persons[]` array

## Workflow ID reference

- `75bd5bc5-3297-4509-956e-3851b3811491` — family-presence-monitor (VPS production)
- Data-store keys: `family_presence_states`, `family_presence_events`, `family_presence_stats`, `family_presence_geocache`, `family_presence_patterns`
