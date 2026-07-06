// Backfill the research source-material index (`source_chunk`): embed the content
// of research sources that have no chunks yet. New research indexes its sources
// automatically in phase 2; this covers sources gathered before the index
// existed. Owner-only — the authed area is deny-by-default owner-only, but we
// require a session for defence in depth. Mirrors /api/files/index/backfill.
//
//   GET                      → { indexedSources }
//   POST                     → snippet backfill (stored excerpts; no outbound requests)
//   POST ?refetch=1          → re-fetch each source's live page for full content (outbound)
//   POST ?sessionId=<id>     → scope to one session
//   POST ?limit=<n>          → cap sources processed (default 500, max 2000)

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { backfillSourceChunks, indexedSourceCount } from '$lib/deepdive/source-index';

export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  if (!session?.user?.email) return json({ error: 'unauthorized' }, { status: 401 });
  return json({ indexedSources: await indexedSourceCount() });
};

export const POST: RequestHandler = async ({ locals, url }) => {
  const session = await locals.auth();
  if (!session?.user?.email) return json({ error: 'unauthorized' }, { status: 401 });

  const refetch = url.searchParams.get('refetch') === '1' || url.searchParams.get('refetch') === 'true';
  const sessionId = url.searchParams.get('sessionId') ?? undefined;
  // Absent `limit` must fall through to the backfill default (500), NOT 0:
  // Number(null) === 0 and Number.isFinite(0) is true, so guard on the raw string.
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit && Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : undefined;

  const result = await backfillSourceChunks({ refetch, sessionId, limit });
  return json({ ...result, indexedSources: await indexedSourceCount() });
};
