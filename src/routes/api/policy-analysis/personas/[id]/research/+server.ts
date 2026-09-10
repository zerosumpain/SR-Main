import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkMutation, failure, requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { researchPersona } from '$lib/policy-analysis/server/personas';

/**
 * Enrich one persona from public sources, on the reader's instruction.
 *
 * Deliberately not part of a run: researching every actor of every assessment
 * would spend on bodies nobody asked about. `checkMutation` applies the same
 * origin check and the same token bucket every other mutation here does, which
 * is what stops this becoming a way to run unbounded searches.
 *
 * The retrieval is the assessment's own adapter, so the SSRF guard, the domain
 * classification and the refusal to accept a model-authored URL all still apply.
 */
export const POST: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  checkMutation(event, owner);
  try {
    const result = await researchPersona(owner, event.params.id, AbortSignal.any([event.request.signal, AbortSignal.timeout(300_000)]));
    return json(result);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    return failure(err);
  }
};
