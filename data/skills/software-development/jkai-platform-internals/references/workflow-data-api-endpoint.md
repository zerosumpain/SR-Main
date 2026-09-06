# Workflow Data → API Endpoint → Dashboard Pattern

When a workflow accumulates data in `workflow_data_store` and the user wants a web dashboard to visualise it, the pattern is:

## 1. Public API endpoint

Create `src/routes/api/<topic>/stats/+server.ts` — a SvelteKit GET handler that:

1. Queries the workflow data store via Drizzle ORM (`db.select().from(workflowDataStore).where(...)`)
2. Reads the specific keys the workflow writes (e.g. `family_presence_events`, `family_presence_stats`)
3. Computes any derived statistics (per-person breakdowns, time-range filtering, aggregations)
4. Returns JSON

**Only if the data is genuinely public:** add the route to `PUBLIC_API_PATHS` in
`src/lib/server/public-api-paths.ts` (it moved out of `hooks.server.ts`) so it skips Google
OAuth. Without this, unauthenticated requests get "Unauthorized" — which for anything
carrying people's locations, names or health is the CORRECT answer, not a bug to work
around.

```ts
// src/lib/server/public-api-paths.ts
'/api/biome/state',
```

`/api/family-presence/stats` used to be the worked example here. It was removed from that
list on 2026-08-29 because it served five family members' GPS history and current
positions anonymously, by first name. Note the trap that let it sit there: the CI
public-routes lockfile (`scripts/check-public-routes.mjs`) read `PUBLIC_PATHS` and the
hook bypasses and had **never** read `PUBLIC_API_PATHS`, so an entry added here was
invisible to the gate.

That is fixed in the same change — the lockfile now extracts `PUBLIC_API_PATHS` as exact
paths and a new entry shows up as a `+` line in `.github/public-routes.txt` for review.
So adding one is visible, which is not the same as it being right: a dashboard page
needing the data belongs behind the same owner session as its endpoint, not in this
array.

### Data store access pattern

```ts
import { db } from '$lib/db/db';
import { workflowDataStore } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

const workflowId = '<workflow-uuid>';

// Read a specific key
const rows = await db.select({ value: workflowDataStore.value })
  .from(workflowDataStore)
  .where(and(
    eq(workflowDataStore.workflowId, workflowId),
    eq(workflowDataStore.key, 'family_presence_events')
  ));

// Parse the JSONB value
const events = rows[0]?.value as any[] || [];
```

### Time-range filtering

Accept `?range=7d|30d|90d` as a query parameter. Filter events by timestamp client-side in the endpoint (the data store is a single JSONB blob per key, not individual rows):

```ts
const rangeMs: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const days = rangeMs[url.searchParams.get('range') || '7d'] || 7;
const since = new Date(Date.now() - days * 86400000);
const filtered = events.filter(e => new Date(e.ts) >= since);
```

## 2. Standalone HTML dashboard

Build a single `index.html` file that:
- Fetches from the **relative** API path (`/api/<topic>/stats?range=7d`)
- Uses the shared Mapbox renderer (`$lib/maps/loader`) for maps and Chart.js for charts
- Applies the SR design system tokens (Archivo Black, DM Sans, JetBrains Mono, cream/brown palette)

Register via `register_chat_build` → publish via `build_control(action=publish)` → served at `/projects/<slug>/`.

The dashboard lives at a different path than the API, but since both are on `strangeramblings.com`, the relative `/api/...` path works without CORS issues.

## 3. Deploy sequence

When adding both an API endpoint and a workflow DB mutation:

1. **Git commit + push** the API endpoint code
2. **Deploy** the code to VPS (`deploy.sh` or manual rsync if timeout)
3. **Apply the SQL migration** to the VPS DB (separate from code deploy — the data-store schema doesn't change, only the node configs)
4. **Restart** the VPS service
5. **Verify** the API endpoint returns data
6. **Register + publish** the dashboard HTML

The SQL migration and code deploy are independent — either can go first, but both must be done before the API will return meaningful data.

## Key pitfalls

- **PUBLIC_PATHS is required** — without it, the API returns "Unauthorized" for all requests
- **Data store values are JSONB** — must be parsed; the schema column is `value` (not `data`)
- **Workflow data store is per-workflow** — must filter by `workflowId`
- **VPS data vs homeserv data** — the API endpoint on the VPS reads the VPS database. If the workflow only runs on VPS, only the VPS DB has data. Test with `curl` against the VPS, not localhost on homeserv.
- **register_chat_build runs the builder pipeline** — for pre-built dashboards this is unnecessary overhead, but it's the only way to get a `/jkai/builds/<id>` gallery page. Use `publish_page` if the gallery isn't needed.
