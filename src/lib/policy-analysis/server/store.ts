import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { policyAnalyses, policyArtefacts, policyDocuments, policyExecutions, policyModelCalls, policyProvenance, policyStages, workflowRuns, workflows } from '$lib/db/schema';
import { STAGES, TRIGGER, WORKFLOW_ID, type Artefact } from '../contracts';
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
    const [analysis] = await tx.insert(policyAnalyses).values({ owner, title: input.title, jurisdiction: input.jurisdiction, policyArea: input.policyArea, context: input.context }).returning();
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
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [analysis] = await tx.select().from(policyAnalyses).where(and(eq(policyAnalyses.id, id), eq(policyAnalyses.owner, owner))).limit(1);
  return analysis ?? null;
}
export async function loadArtefacts(id: string, tx: DbExecutor = db): Promise<Artefact[]> {
  const rows = await tx.select().from(policyArtefacts).where(eq(policyArtefacts.analysisId, id)).orderBy(asc(policyArtefacts.stage), asc(policyArtefacts.createdAt), asc(policyArtefacts.id));
  const links = await tx.select().from(policyProvenance).where(eq(policyProvenance.analysisId, id));
  return rows.map(({ analysisId: _analysisId, stage: _stage, createdAt: _createdAt, updatedAt: _updatedAt, ...a }) => ({ ...a, refs: links.filter((p) => p.fromId === a.id).map((p) => p.toId) }) as Artefact);
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
  const artefactMetadata = await db.select({ id: policyArtefacts.id, stage: policyArtefacts.stage, createdAt: policyArtefacts.createdAt, updatedAt: policyArtefacts.updatedAt }).from(policyArtefacts).where(eq(policyArtefacts.analysisId, id));
  return { analysis, stages, documents, artefactMetadata, artefacts: await loadArtefacts(id), executions: executions.map((e) => e.execution), calls, heartbeat: run?.heartbeatAt ?? null };
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
