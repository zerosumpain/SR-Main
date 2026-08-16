// Recalculating the cluster roster, from the box.
//
// The same operation the button on /jkai/intel performs, on its own path so it
// can be driven with the maintenance secret. That matters because the things
// which INVALIDATE a partition — an ingest sweep, a channel-artefact flag, a
// source-facet backfill — all run without a browser attached, and until this
// existed the graph they had changed kept its old clusters until someone
// happened to open the page and press a button.
//
// Its own route rather than an action on ../+server.ts deliberately. The hooks
// allow-list that lets a secret-carrying call through matches a PATH, not a
// request body, so putting this on the shared endpoint would have handed the
// same secret `rename` — which writes a name the user reads back as their own —
// and `narrate`, which spends model budget. Those stay owner-session-only.
//
//   POST { resolution? }  re-tune, re-detect, reconcile, return the roster
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recalculateClusterRoster } from '$lib/jkai/intel/cluster-roster';
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) {
    return json({ error: 'not authorised' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const requested = body.resolution === undefined ? undefined : Number(body.resolution);
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw error(400, 'resolution must be a positive number');
  }

  const roster = await recalculateClusterRoster(requested);
  // The full roster is large and this caller is a script; the summary is what
  // tells you whether the run did anything.
  return json({
    resolution: roster.resolution,
    stats: roster.stats,
    clusters: roster.clusters.length,
    candidates: roster.candidates,
  });
};
