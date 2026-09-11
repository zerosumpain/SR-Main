import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { policyDocuments, policyExecutions, policyModelCalls, policyStages } from '$lib/db/schema';
import { checkMutation, failure, requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { control, ownedAnalysis, sealOf } from '$lib/policy-analysis/server/store';
import { unsealRow } from '$lib/policy-analysis/server/seal';
export const POST: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event); checkMutation(event, owner);
  if (!['cancel', 'resume'].includes(event.params.action)) error(404, 'Action not found.');
  if (!(await ownedAnalysis(owner, event.params.id))) error(404, 'Analysis not found.');
  if (event.params.action === 'resume' && process.env.POLICY_ANALYSIS_ENABLED === '0') error(503, 'Policy analysis is currently disabled.');
  try { return json(await control(owner, event.params.id, event.params.action as 'cancel' | 'resume')); }
  catch (err) { return failure(err); }
};
export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  if (!(await ownedAnalysis(owner, event.params.id))) error(404, 'Analysis not found.');
  if (event.params.action === 'document') {
    const [row] = await db.select().from(policyDocuments).where(eq(policyDocuments.analysisId, event.params.id));
    if (!row) error(404, 'Document not found.');
    // On a sealed run the stored bytes are ciphertext and the filename with them.
    // This is the owner, holding the key, asking for their own paper back — which
    // is the whole point of sealing rather than simply not keeping it.
    const document = unsealRow(await sealOf(event.params.id), 'document', row);
    return new Response(Buffer.from(document.content, 'base64'), { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`, 'x-content-type-options': 'nosniff' } });
  }
  if (event.params.action === 'audit') {
    const id = event.url.searchParams.get('call');
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) error(400, 'A model call is required.');
    const [row] = await db.select({ call: policyModelCalls }).from(policyModelCalls).innerJoin(policyExecutions, eq(policyExecutions.id, policyModelCalls.executionId)).innerJoin(policyStages, eq(policyStages.id, policyExecutions.stageId)).where(and(eq(policyStages.analysisId, event.params.id), eq(policyModelCalls.id, id)));
    if (!row) error(404, 'Model call not found.');
    return json(row.call);
  }
  error(404, 'Action not found.');
};
