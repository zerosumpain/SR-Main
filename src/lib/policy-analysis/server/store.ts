import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { policyAnalyses, policyArtefacts, policyDocuments, policyExecutions, policyModelCalls, policyProvenance, policyStages, workflowRuns, workflows } from '$lib/db/schema';
import { STAGES, TRIGGER, WORKFLOW_ID, type Artefact } from '../contracts';
import type { Neighbour } from '../pipeline';
import { PolicyError } from '../validation';
import type { Submission } from './ingest';

export async function queueStage(tx: DbExecutor, analysisId: string, stageId: string, delayMs = 0) {
  const runId = randomUUID();
  await tx.insert(workflows).values({ id: WORKFLOW_ID, name: 'Policy analysis', description: 'Private, staged policy assessment. Managed by the policy analysis pipeline.' }).onConflictDoNothing();
  await tx.insert(workflowRuns).values({ id: runId, workflowId: WORKFLOW_ID, trigger: TRIGGER, status: 'pending', startedAt: new Date(Date.now() + delayMs), inputData: { analysisId, stageId } });
  await tx.update(policyStages).set({ runId, status: 'pending' }).where(eq(policyStages.id, stageId));
  return runId;
}
export async function createAnalysis(owner: string, input: Submission) {
  return db.transaction(async (tx) => {
    // Serialises intake by owner, including concurrent browser submissions.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`policy:${owner}`}))`);
    const active = await tx.select({ id: policyAnalyses.id }).from(policyAnalyses).where(and(eq(policyAnalyses.owner, owner), inArray(policyAnalyses.status, ['queued', 'running'])));
    if (active.length >= 3) throw new PolicyError('capacity', 'Three analyses are already active. Cancel or finish one before starting another.');
    const [analysis] = await tx.insert(policyAnalyses).values({ owner, title: input.title, jurisdiction: input.jurisdiction, policyArea: input.policyArea, context: input.context, depth: input.depth }).returning();
    await tx.insert(policyDocuments).values({ analysisId: analysis.id, filename: input.filename, mimeType: input.mimeType, size: input.bytes.length, sha256: createHash('sha256').update(input.bytes).digest('hex'), content: input.bytes.toString('base64') });
    const stages = await tx.insert(policyStages).values(STAGES.map((name, ordinal) => ({ analysisId: analysis.id, ordinal, name }))).returning();
    await queueStage(tx, analysis.id, stages.find((s) => s.ordinal === 0)!.id);
    return analysis;
  });
}
export async function listAnalyses(owner: string) {
  return db.select().from(policyAnalyses).where(eq(policyAnalyses.owner, owner)).orderBy(desc(policyAnalyses.createdAt)).limit(50);
}
export async function ownedAnalysis(owner: string, id: string, tx: DbExecutor = db) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [analysis] = await tx.select().from(policyAnalyses).where(and(eq(policyAnalyses.id, id), eq(policyAnalyses.owner, owner))).limit(1);
  return analysis ?? null;
}
export async function loadArtefacts(id: string, tx: DbExecutor = db): Promise<Artefact[]> {
  const rows = await tx.select().from(policyArtefacts).where(eq(policyArtefacts.analysisId, id)).orderBy(asc(policyArtefacts.stage), asc(policyArtefacts.createdAt), asc(policyArtefacts.id));
  const links = await tx.select().from(policyProvenance).where(eq(policyProvenance.analysisId, id));
  // Grouped once rather than scanned per artefact: this ran on the web process's
  // event loop for every six-second dashboard poll, and 2,000 artefacts against
  // 10,000 links is twenty million comparisons a poll.
  const byFrom = new Map<string, string[]>();
  for (const link of links) byFrom.set(link.fromId, [...(byFrom.get(link.fromId) ?? []), link.toId]);
  return rows.map(({ analysisId: _analysisId, stage: _stage, createdAt: _createdAt, updatedAt: _updatedAt, ...a }) => ({ ...a, refs: byFrom.get(a.id) ?? [] }) as Artefact);
}
export async function detail(owner: string, id: string) {
  const analysis = await ownedAnalysis(owner, id);
  if (!analysis) return null;
  const stages = await db.select().from(policyStages).where(eq(policyStages.analysisId, id)).orderBy(asc(policyStages.ordinal));
  const documents = await db.select({ id: policyDocuments.id, filename: policyDocuments.filename, mimeType: policyDocuments.mimeType, size: policyDocuments.size, sha256: policyDocuments.sha256, metadata: policyDocuments.metadata }).from(policyDocuments).where(eq(policyDocuments.analysisId, id));
  const executions = await db.select({ execution: policyExecutions }).from(policyExecutions).innerJoin(policyStages, eq(policyStages.id, policyExecutions.stageId)).where(eq(policyStages.analysisId, id)).orderBy(asc(policyExecutions.startedAt));
  // Model prompts/output are private audit data, fetched separately on demand.
  const calls = await db.select({ id: policyModelCalls.id, executionId: policyModelCalls.executionId, callKey: policyModelCalls.callKey, promptVersion: policyModelCalls.promptVersion, inputHash: policyModelCalls.inputHash, status: policyModelCalls.status, provider: policyModelCalls.provider, model: policyModelCalls.model, usage: policyModelCalls.usage, startedAt: policyModelCalls.startedAt, completedAt: policyModelCalls.completedAt, error: policyModelCalls.error }).from(policyModelCalls).innerJoin(policyExecutions, eq(policyExecutions.id, policyModelCalls.executionId)).innerJoin(policyStages, eq(policyStages.id, policyExecutions.stageId)).where(eq(policyStages.analysisId, id));
  const queued = stages.find((s) => s.runId && s.status !== 'completed');
  const [run] = queued?.runId ? await db.select({ heartbeatAt: workflowRuns.heartbeatAt, leaseExpiresAt: workflowRuns.leaseExpiresAt }).from(workflowRuns).where(eq(workflowRuns.id, queued.runId)) : [];
  // `loadArtefacts` already reads stage and updatedAt off every row and threw
  // them away, so the page used to be sent every artefact id three times over.
  const artefacts = await loadArtefacts(id);
  const artefactMetadata = await db.select({ id: policyArtefacts.id, stage: policyArtefacts.stage, updatedAt: policyArtefacts.updatedAt }).from(policyArtefacts).where(eq(policyArtefacts.analysisId, id)).limit(4000);
  // A cross-policy exposure is written onto the assessment that FOUND it. This
  // page belongs to the other half of that pair as much as it does to the finder,
  // so pull in the exposures that name this analysis from elsewhere.
  const inbound = await db.select({ id: policyArtefacts.id, label: policyArtefacts.label, statement: policyArtefacts.statement, data: policyArtefacts.data, analysisId: policyArtefacts.analysisId, analysisTitle: policyAnalyses.title })
    .from(policyArtefacts)
    .innerJoin(policyAnalyses, eq(policyAnalyses.id, policyArtefacts.analysisId))
    .where(and(eq(policyAnalyses.owner, owner), eq(policyArtefacts.kind, 'cross_policy'), sql`${policyArtefacts.data} ->> 'otherAnalysisId' = ${id}`))
    .limit(50);
  return { analysis, stages, documents, artefactMetadata, artefacts, executions: executions.map((e) => e.execution), calls, inbound, heartbeat: run?.heartbeatAt ?? null };
}
export async function persistArtefacts(tx: DbExecutor, analysisId: string, stage: number, artefacts: Artefact[]) {
  if (!artefacts.length) return;
  for (let i = 0; i < artefacts.length; i += 250) {
    await tx.insert(policyArtefacts).values(artefacts.slice(i, i + 250).map(({ refs: _refs, ...row }) => ({ ...row, analysisId, stage })));
  }
  const links = artefacts.flatMap((a) => [...new Set(a.refs)].map((toId) => ({ analysisId, fromId: a.id, toId })));
  for (let i = 0; i < links.length; i += 1000) await tx.insert(policyProvenance).values(links.slice(i, i + 1000));
}
export async function control(owner: string, id: string, action: 'cancel' | 'resume') {
  return db.transaction(async (tx) => {
    const [analysis] = await tx.select().from(policyAnalyses).where(and(eq(policyAnalyses.id, id), eq(policyAnalyses.owner, owner))).for('update');
    if (!analysis) throw new PolicyError('missing', 'Analysis not found.');
    if (['completed', 'completed_with_gaps'].includes(analysis.status)) throw new PolicyError('state', 'This analysis has finished. Submit a new analysis to reassess it.');
    const stages = await tx.select().from(policyStages).where(eq(policyStages.analysisId, id)).orderBy(asc(policyStages.ordinal));
    const stage = stages.find((s) => s.status !== 'completed');
    if (!stage) throw new PolicyError('state', 'There is no incomplete stage.');
    if (action === 'cancel') {
      if (stage.runId) await tx.update(workflowRuns).set({ status: 'cancelled', claimedBy: null, leaseExpiresAt: null, completedAt: new Date() }).where(eq(workflowRuns.id, stage.runId));
      await tx.update(policyStages).set({ status: 'cancelled' }).where(eq(policyStages.id, stage.id));
      await tx.update(policyExecutions).set({ status: 'cancelled', completedAt: new Date() }).where(and(eq(policyExecutions.stageId, stage.id), eq(policyExecutions.status, 'running')));
      await tx.update(policyAnalyses).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(policyAnalyses.id, id));
    } else {
      if (!['failed', 'cancelled'].includes(analysis.status)) return { status: analysis.status };
      await tx.update(policyStages).set({ attempts: 0, error: null }).where(eq(policyStages.id, stage.id));
      await queueStage(tx, id, stage.id);
      await tx.update(policyAnalyses).set({ status: 'queued', cancelledAt: null, error: null, completedAt: null, updatedAt: new Date() }).where(eq(policyAnalyses.id, id));
    }
    return { status: action === 'cancel' ? 'cancelled' : 'queued' };
  });
}

/**
 * Compact summaries of this owner's OTHER completed assessments, for the
 * cross-policy stage.
 *
 * Bounded on purpose. The stage needs enough to recognise that two policies land
 * on the same actor or rest on the same assumption, not the other assessments in
 * full — and the model context ceiling is 180,000 characters for the whole call.
 * Statements are clipped and only the kinds that can collide are carried.
 */
const NEIGHBOUR_KINDS = ['actor', 'mechanism', 'assumption', 'exploit', 'finding'];
const NEIGHBOUR_LIMIT = 6;
const NEIGHBOUR_ARTEFACTS = 60;

export async function neighbourSummaries(owner: string, exclude: string): Promise<Neighbour[]> {
  const others = await db.select({ id: policyAnalyses.id, title: policyAnalyses.title, policyArea: policyAnalyses.policyArea, jurisdiction: policyAnalyses.jurisdiction, completedAt: policyAnalyses.completedAt })
    .from(policyAnalyses)
    .where(and(eq(policyAnalyses.owner, owner), inArray(policyAnalyses.status, ['completed', 'completed_with_gaps'])))
    .orderBy(desc(policyAnalyses.completedAt)).limit(NEIGHBOUR_LIMIT + 1);
  const shortlist = others.filter((o) => o.id !== exclude).slice(0, NEIGHBOUR_LIMIT);
  if (!shortlist.length) return [];
  const rows = await db.select({ analysisId: policyArtefacts.analysisId, id: policyArtefacts.id, kind: policyArtefacts.kind, label: policyArtefacts.label, statement: policyArtefacts.statement, data: policyArtefacts.data })
    .from(policyArtefacts)
    .where(and(inArray(policyArtefacts.analysisId, shortlist.map((o) => o.id)), inArray(policyArtefacts.kind, NEIGHBOUR_KINDS)))
    // `desc()` alone is NULLS FIRST in Postgres, which would fill the comparison
    // budget with exactly the rows an assessment was least sure about. The
    // kind/id tiebreak keeps the 60-row cut stable between runs.
    .orderBy(sql`${policyArtefacts.confidence} DESC NULLS LAST`, asc(policyArtefacts.kind), asc(policyArtefacts.id))
    .limit(shortlist.length * NEIGHBOUR_ARTEFACTS);
  return shortlist.map((o) => ({
    id: o.id, title: o.title, policyArea: o.policyArea, jurisdiction: o.jurisdiction,
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    artefacts: rows.filter((r) => r.analysisId === o.id).slice(0, NEIGHBOUR_ARTEFACTS)
      // Actors carry their type and aliases so identity can be judged on more
      // than a matching label - see `crossIdentityHints`.
      .map((r) => ({ id: r.id, kind: r.kind, label: r.label, statement: r.statement.slice(0, 600), entityType: r.kind === 'actor' ? String(r.data.entityType ?? '') : undefined, aliases: r.kind === 'actor' && Array.isArray(r.data.aliases) ? (r.data.aliases as string[]).slice(0, 12) : undefined })),
  }));
}

/**
 * Delete an analysis, its document bytes, artefacts, provenance, executions and
 * model-call audit. Any queue envelope still pointing at it is cancelled first,
 * so a worker cannot resurrect rows behind the delete.
 */
export async function remove(owner: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const analysis = await ownedAnalysis(owner, id, tx);
    if (!analysis) return false;
    const stages = await tx.select({ runId: policyStages.runId }).from(policyStages).where(eq(policyStages.analysisId, id));
    const runIds = stages.map((s) => s.runId).filter((r): r is string => !!r);
    if (runIds.length) await tx.update(workflowRuns).set({ status: 'cancelled', claimedBy: null, leaseExpiresAt: null, completedAt: new Date() }).where(inArray(workflowRuns.id, runIds));
    await tx.update(policyAnalyses).set({ cancelledAt: new Date(), status: 'cancelled' }).where(eq(policyAnalyses.id, id));
    await tx.delete(policyAnalyses).where(eq(policyAnalyses.id, id));
    return true;
  });
}
