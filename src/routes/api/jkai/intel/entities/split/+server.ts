// Repairing a conflated entity, from the box.
//
// `splitEntity` is the operation; this is the only thing that calls it, and it
// has to exist for a second reason beyond convenience: a module nothing imports
// is not in the bundle. `split.ts` shipped with no caller and Rollup tree-shook
// it out entirely, so the deployed build had no split in it at all — the same
// class of trap as a new `scripts/` file missing its rsync line.
//
// Maintenance-secret rather than owner-session, because the repairs are driven
// from the VPS against production and a conflation is found by measuring the live
// graph, not by clicking. Its own path rather than an action on the entities
// endpoint, for the reason ../clusters/recalculate is: the hooks allow-list
// matches a PATH, not a body, so folding this in would hand the same secret
// everything else that endpoint can do.
//
//   POST { fromId, to, relationshipIds, reason }   move edges off a conflated entity
//   POST { action: 'undo', key }                   put one back
//   GET                                            what has been split
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { splitEntity, undoSplit, listSplits } from '$lib/jkai/intel/resolve/split';
import { runConflationSweep } from '$lib/jkai/intel/resolve/conflation.server';
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';

// Both verbs re-check. A GET that lists what has been repaired is still a
// disclosure about the graph, and "the read-only one is fine" is how the
// loopback half of this condition — theatre on a VPS behind cloudflared, where
// every request appears to come from 127.0.0.1 — becomes the only control.
export const GET: RequestHandler = async ({ request, locals }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) {
    return json({ error: 'not authorised' }, { status: 403 });
  }
  return json({ splits: await listSplits() });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) {
    return json({ error: 'not authorised' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // The detector, on demand. Folded in here rather than given its own path
  // because it is the SAME capability — it splits entities — so a separate route
  // would hand the same secret nothing new while costing a fourth registration.
  //
  // `dryRun` does everything except the writes. That is how the detector was
  // checked against production before it was allowed to touch it, and it stays
  // because the judgement is a model's: the first question about any night's
  // proposals is "what would this have done".
  if (body.action === 'sweep') {
    const dryRun = body.dryRun === true;
    const limit = body.limit === undefined ? undefined : Number(body.limit);
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw error(400, 'limit must be a positive number');
    }
    return json(await runConflationSweep({ apply: !dryRun, limit }));
  }

  if (body.action === 'undo') {
    const key = String(body.key ?? '').trim();
    if (!key) throw error(400, 'key is required');
    return json(await undoSplit(key));
  }

  const fromId = String(body.fromId ?? '').trim();
  if (!fromId) throw error(400, 'fromId is required');

  const relationshipIds = Array.isArray(body.relationshipIds)
    ? body.relationshipIds.map((id) => String(id)).filter(Boolean)
    : [];
  if (!relationshipIds.length) throw error(400, 'relationshipIds must be a non-empty array');

  const reason = String(body.reason ?? '').trim();
  if (!reason) throw error(400, 'reason is required');

  const to = body.to as Record<string, unknown> | undefined;
  if (!to || typeof to !== 'object') throw error(400, 'to is required');
  const target =
    typeof to.entityId === 'string' && to.entityId.trim()
      ? { entityId: to.entityId.trim() }
      : typeof to.name === 'string' && to.name.trim() && typeof to.typeId === 'string' && to.typeId.trim()
        ? { name: to.name.trim(), typeId: to.typeId.trim() }
        : null;
  if (!target) throw error(400, 'to must be { entityId } or { name, typeId }');

  try {
    return json(await splitEntity({ fromId, to: target, relationshipIds, reason }));
  } catch (err) {
    // A plan written against a stale snapshot names entities that may have been
    // merged away since. That is a bad request, not a server fault.
    throw error(400, err instanceof Error ? err.message : 'split failed');
  }
};
