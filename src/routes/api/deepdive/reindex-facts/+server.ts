// Re-embed research facts into the current embedding space. Used to migrate the
// corpus when the research embedding model changes (getEmbeddingModel). Owner or
// maintenance-secret (see $lib/server/maintenance-auth). Facts are stamped with
// their embedding model, so this is idempotent + resumable: loop POST until
// `scanned` is 0.
//
//   GET                 → { model, current, total }  (facts embedded under the current model)
//   POST ?limit=<n>     → re-embed up to n stale/unembedded facts (default 200, max 1000)

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reembedFacts, reembedGlobalEntities, factsInCurrentSpace } from '$lib/deepdive/source-index';
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';

export const GET: RequestHandler = async ({ locals, request }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) return json({ error: 'unauthorized' }, { status: 401 });
  return json(await factsInCurrentSpace());
};

export const POST: RequestHandler = async ({ locals, url, request }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) return json({ error: 'unauthorized' }, { status: 401 });
  const raw = url.searchParams.get('limit');
  const limit = raw && Number.isFinite(Number(raw)) ? Number(raw) : undefined;

  // ?entities=1 also re-embeds the cross-session global entity index into the
  // current space (one-shot; small set). Run it once alongside a fact batch.
  const entities = url.searchParams.get('entities') === '1' || url.searchParams.get('entities') === 'true';
  const globalEntities = entities ? await reembedGlobalEntities({}) : undefined;

  const result = await reembedFacts({ limit });
  return json({ ...result, globalEntities, ...(await factsInCurrentSpace()) });
};
