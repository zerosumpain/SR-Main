import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkMutation, failure, requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { detail, remove } from '$lib/policy-analysis/server/store';
export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  const result = await detail(owner, event.params.id);
  if (!result) error(404, 'Analysis not found.');
  return json(result);
};

/**
 * Remove an analysis and everything under it.
 *
 * An uploaded policy paper is somebody's unpublished work held in full in the
 * database; there was no way to take it back. Every child table cascades from
 * `policy_analyses`, so the row is the whole deletion.
 */
export const DELETE: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  checkMutation(event, owner);
  try {
    const removed = await remove(owner, event.params.id);
    if (!removed) error(404, 'Analysis not found.');
    return json({ deleted: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    return failure(err);
  }
};
