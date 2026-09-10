import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkMutation, failure, requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { removePersona } from '$lib/policy-analysis/server/personas';

/**
 * Remove a persona and everything observed about it.
 *
 * The assessments are untouched: an observation cascades from the persona, not
 * the other way round, and a future run would simply open a fresh dossier for
 * the same body.
 */
export const DELETE: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  checkMutation(event, owner);
  try {
    const removed = await removePersona(owner, event.params.id);
    if (!removed) error(404, 'Persona not found.');
    return json({ deleted: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    return failure(err);
  }
};
