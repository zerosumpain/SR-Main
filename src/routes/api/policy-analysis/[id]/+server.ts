import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkMutation, failure, requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { detail, purge } from '$lib/policy-analysis/server/store';
import { census } from '$lib/policy-analysis/server/census';
import { keyDir } from '$lib/policy-analysis/server/seal';
import { buildReceipt } from '$lib/policy-analysis/receipt';
export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  const result = await detail(owner, event.params.id);
  if (!result) error(404, 'Analysis not found.');
  return json(result);
};

/**
 * Purge an analysis, and say what is left.
 *
 * An uploaded policy paper is somebody's unpublished work, held in full. Every
 * child table cascades from `policy_analyses`, but a cascade was never the whole
 * deletion: queue envelopes orphaned, and cross-policy findings written ABOUT
 * this paper live on a different analysis where no cascade reaches them.
 * `purge()` now takes both, and shreds a sealed run's key BEFORE the delete.
 *
 * The census then asks rather than asserts. Its counts — and the plain list of
 * what a purge cannot reach — come back in the response so the caller can keep
 * the receipt; nothing about it is stored, because a record of the purge sitting
 * in the database it emptied would be a new trace of the run.
 */
export const DELETE: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  checkMutation(event, owner);
  try {
    const purged = await purge(owner, event.params.id);
    if (!purged) error(404, 'Analysis not found.');
    return json({
      deleted: true,
      receipt: buildReceipt({ ...purged, analysisId: purged.id, probes: await census(purged.id), keyLocation: keyDir() }),
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    return failure(err);
  }
};
