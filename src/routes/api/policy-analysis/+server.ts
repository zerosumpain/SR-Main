import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkMutation, failure, requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { readSubmission } from '$lib/policy-analysis/server/ingest';
import { createAnalysis, listAnalyses } from '$lib/policy-analysis/server/store';
export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  return json({ analyses: await listAnalyses(owner) });
};
export const POST: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event); checkMutation(event, owner);
  if (process.env.POLICY_ANALYSIS_ENABLED === '0') return json({ error: 'New policy analyses are currently disabled.' }, { status: 503 });
  try { return json(await createAnalysis(owner, await readSubmission(event.request)), { status: 201 }); }
  catch (err) { return failure(err); }
};
