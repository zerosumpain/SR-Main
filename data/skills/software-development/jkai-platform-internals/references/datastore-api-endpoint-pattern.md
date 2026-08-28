# Datastore Collection → API Endpoint → SvelteKit Dashboard Pattern

When a workflow accumulates data in a shared **datastore collection** (the `database` node with `collection: <slug>`) and the user wants a live dashboard, use this pattern instead of the older `workflow_data_store` approach. Collections are shared across workflows, support row-level permissions, and use the `$lib/datastore` access layer.

## 1. SvelteKit API endpoint

Create `src/routes/api/<topic>/current/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRecordByKey } from '$lib/datastore';

const COLLECTION = 'my_collection';
const ACTOR = 'jkai';

export const GET: RequestHandler = async () => {
  try {
    const record = await getRecordByKey(COLLECTION, 'my_key', ACTOR);
    const data = record.data as MyDataType;
    // Process data (group into journeys, compute stats, etc.)
    return json({ success: true, data: processedData });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    // Return empty state gracefully when no data exists yet
    if (msg.includes('not found') || msg.includes('permission')) {
      return json({ success: true, data: emptyFallback });
    }
    return json({ success: false, error: msg }, { status: 500 });
  }
};
```

## 1a. Making the route public (PUBLIC_PATHS)

If the page needs to be reachable without a login session (e.g. shared via WhatsApp link, embedded in another site, or used by people who don't have a login), **both** the page route and the API endpoint must be added to `PUBLIC_PATHS` in `src/lib/auth.ts`:

```ts
const PUBLIC_PATHS = [
  // ... existing paths ...
  '/broads',        // covers /broads/speed, /broads, /broads/* etc.
  '/api/broads',    // covers /api/broads/current, /api/broads/*
];
```

Without this, the page renders the Google OAuth sign-in screen and the API returns 401 regardless of correct data.

⚠ **The gate will catch public-route additions.** After adding entries to `PUBLIC_PATHS`, the `npm run gate:public-routes` check fails with a diff of what changed. You must confirm the intent:

```bash
npm run gate:public-routes -- --write   # confirms: yes, these routes should be public
```

This writes the updated manifest to `.github/public-routes.txt`. Commit this file alongside the code change.

## 2. SvelteKit dashboard page

Create `src/routes/<topic>/<slug>/+page.svelte` — a SvelteKit page that fetches from the API endpoint and renders the data. This is preferable to a standalone HTML file because:

- Same origin = no CORS issues
- Full SvelteKit layout (design system, navigation)
- No deploy/build needed — just push + deploy

Key patterns for the page:

- **Data fetching:** Use `fetch('/api/<topic>/current')` on mount, re-fetch every 30s with `setInterval`
- **Mapper integration:** If using Leaflet, load it via CDN in `svelte:head`
- **Auto-refresh:** Call `setInterval(fetchData, 30000)` in `onMount`
- **Svelte 5 runes:** Use `$state()` for mutable state, `$derived()` for computed values, NOT `$:` syntax
- **Chart rendering:** Use `<canvas>` with 2D context for speed charts (no extra dependencies)

### Journey detection heuristic

When samples have timestamps, group them into "journeys" (contiguous periods of activity) using a gap threshold:

```ts
function groupIntoJourneys(samples: Sample[], gapMinutes = 30): Journey[] {
  const journeys: Journey[] = [];
  let current: Sample[] = [];
  for (const s of samples) {
    if (current.length === 0) {
      current.push(s);
    } else {
      const gap = new Date(s.ts).getTime() - new Date(current[current.length - 1].ts).getTime();
      if (gap > gapMinutes * 60 * 1000) {
        journeys.push(finalize(current));
        current = [s];
      } else {
        current.push(s);
      }
    }
  }
  if (current.length > 0) journeys.push(finalize(current));
  return journeys;
}
```

## 3. Workflow → Datastore

Workflows write to datastore collections via the `database` node with `operation: upsert/set` and `collection: <slug>`. The sampler and reporter workflows share a collection via the same key.

**Key insight:** The workflow engine's `database` node writes to the `datastore_records` table under the hood (via `$lib/datastore`). The collection must exist before the workflow writes to it (it was created by the first workflow run that used that collection slug).

## 4. Deploy sequence

Deploy via **CI only** — never rsync, scp, or ssh files into `/opt/strange-rambling-svelte/`. The production `.env` is `chattr +i` (immutable) to prevent accidental overwrites. There is no manual deploy path.

1. **Branch, commit, push:**
   ```bash
   git checkout -b feat/broads-dashboard
   git add src/routes/api/<topic>/ src/routes/<topic>/ src/lib/auth.ts
   git commit -m "feat: add <topic> dashboard with live map"
   git push -u origin HEAD
   ```
2. **Create a PR** — `gh pr create --fill`
3. **Run the gate** — `npm run gate` (includes type-check, tests, and the public-routes check). If public paths were changed, the gate fails with a diff — acknowledge with `npm run gate:public-routes -- --write`, commit the manifest update, and push again.
4. **Merge** — `gh pr merge --squash` (merging to master triggers the CI deploy)
5. **Verify** — CI builds and deploys on the VPS self-hosted runner. Check:
   ```bash
   curl -s -o /dev/null -w '%{http_code}' https://strangeramblings.com/<topic>/<slug>
   curl -s -o /dev/null -w '%{http_code}' https://strangeramblings.com/api/<topic>/current
   ```
   Both should return 200.

### Troubleshooting: page returns sign-in or 401

If the page loads the login screen:
- **Page** — the route isn't in `PUBLIC_PATHS` (see §1a). Add it and redeploy.
- **API** — same fix: add `/api/<topic>` to `PUBLIC_PATHS`.

### Troubleshooting: CI build fails

- **If the gate fails** (hosted runner) — type error or test broke. Check `gh run view <id> --log-failed`.
- **If the build/deploy fails** (VPS self-hosted runner) — usually memory. The VPS runner is capped at 7G. A failed deploy does NOT take the live site down — production keeps serving the previous build. Re-run with `gh run rerun <id>` once the cause is fixed.
- **If `drizzle-kit push` times out during deploy** — a destructive schema change is waiting on confirmation. Run it manually via SSH with deliberate review.

## Pitfalls

- **MCP datastore tools read PRODUCTION (since 2026-08-03):** the bridge's upstream is `https://strangeramblings.com/api/mcp`, so `datastore_query` / `datastore_list_collections` already return production data — no SSH, no direct SQL. Treat their writes as production writes. (Was previously homeserv's dev DB; that database still exists but the MCP tools no longer talk to it.)
- **Workflow data vs Datastore data:** The older `workflow_data_store` table is per-workflow. The newer `datastore_records` table is shared across workflows via collection. They are DIFFERENT tables — don't confuse them.
- **Error handling:** The `getRecordByKey` call throws if the collection or key doesn't exist. Always wrap in try/catch and return a graceful empty state.
- **Public-routes gate blocks merge:** Adding routes to `PUBLIC_PATHS` causes `npm run gate:public-routes` to fail. Run `npm run gate:public-routes -- --write` to acknowledge, commit the `.github/public-routes.txt` update, and re-push. The gate then passes.
- **Page 200 but API 401:** Both the page AND the API need separate entries in `PUBLIC_PATHS`. Adding `/broads` does NOT cover `/api/broads` — add them separately.
- **CI is slow:** The gate runs 2896 tests on a hosted runner. Expect 5-10 minutes from merge to live deploy.
- **Service doesn't restart immediately:** The CI deploy restarts the service. If verification fails, check `sudo systemctl status strange-rambling-svelte.service` on the VPS — it may still be starting up. Poll the public URL with `timeout 60 bash -c 'until curl -fsS \"https://strangeramblings.com/<path>\" >/dev/null 2>&1; do sleep 2; done'` instead of a single curl.
