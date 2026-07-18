import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { DatastoreError, getRecordByKey } from '$lib/datastore';
import { executeTool } from '$lib/workflows/site-tools/registry';
import { COLLECTIONS } from '$lib/selfimprove/types';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). Verifies a single
// catalogued API by replaying its first example request through the SSRF-guarded
// `api_call` tool. That tool (running as the `jkai` actor, which has write on
// api_catalog) stamps the entry `verified`/`broken` itself — we just re-read the
// fresh status to return to the UI.

const OWNER = 'owner';

interface CatalogEntry {
  name?: string;
  baseUrl?: string;
  status?: string;
  lastVerifiedAt?: string;
  exampleRequests?: Array<{ label?: string; method?: string; url: string; body?: unknown }>;
}

/** POST { key } — probe a catalogue entry and return its updated status. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) return json({ error: '`key` is required' }, { status: 400 });

  let entry: CatalogEntry;
  try {
    const rec = await getRecordByKey(COLLECTIONS.apiCatalog, key, OWNER);
    entry = rec.data as CatalogEntry;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') {
      return json({ error: `No catalogued API "${key}".` }, { status: 404 });
    }
    throw err;
  }

  const examples = entry.exampleRequests ?? [];
  const example = examples.find((e) => (e.method ?? 'GET').toUpperCase() === 'GET') ?? examples[0];
  if (!example?.url) {
    return json({ error: 'This API has no example request to probe.' }, { status: 400 });
  }

  const result = await executeTool('api_call', {
    api: key,
    url: example.url,
    method: example.method ?? 'GET',
    body: example.body,
  });

  // Re-read for the status/lastVerifiedAt that api_call just wrote.
  let updated: CatalogEntry = entry;
  try {
    const fresh = await getRecordByKey(COLLECTIONS.apiCatalog, key, OWNER);
    updated = fresh.data as CatalogEntry;
  } catch {
    /* keep the pre-call entry */
  }

  return json({
    ok: result.success,
    error: result.success ? undefined : result.error,
    status: updated.status,
    lastVerifiedAt: updated.lastVerifiedAt,
    call: result.data,
  });
};
