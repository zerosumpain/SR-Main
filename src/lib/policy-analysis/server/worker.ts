import { and, eq, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { policyAnalyses, policyDocuments, policyExecutions, policyStages, workflowRuns } from '$lib/db/schema';
import { executeStage } from '../pipeline';
import { PolicyError } from '../validation';
import { ingest } from './ingest';
import { loadArtefacts, neighbourSummaries, persistArtefacts, queueStage } from './store';
import { modelCaller } from './provider';
import { research } from './research';

/** Interruptions are free, but not infinitely free. */
const EXECUTION_CEILING = 12;

/**
 * A stage's wall clock, sized to its fan-out.
 *
 * A flat 45 minutes was written for a stage that makes one model call. Stage 1
 * makes one PER PASSAGE — a 100-page policy is 100 calls at roughly half a minute
 * each — so the flat bound killed exactly the long documents this feature exists
 * to read, and reported it as an interruption.
 */
export function stageBudgetMs(ordinal: number, all: { kind: string; id: string }[]): number {
  const count = (kind: string) => all.filter((a) => a.kind === kind).length;
  const units = ordinal === 1 ? count('passage')
    : ordinal === 4 ? Math.max(1, count('actor'))
    : ordinal === 6 ? count('research_question') + 1
    : ordinal === 7 || ordinal === 9 ? 8
    : ordinal === 10 ? Math.max(1, count('profile'))
    : 1;
  return Math.min(6 * 60 * 60_000, 20 * 60_000 + units * 3 * 60_000);
}

async function lockLease(tx: DbExecutor, analysisId: string, stageId: string, runId: string, workerId: string) {
  const [analysis] = await tx.select().from(policyAnalyses).where(eq(policyAnalyses.id, analysisId)).for('update');
  const [run] = await tx.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).for('update');
  const [stage] = await tx.select().from(policyStages).where(and(eq(policyStages.id, stageId), eq(policyStages.analysisId, analysisId)));
  if (!analysis || !stage || stage.runId !== runId || stage.status === 'completed' || analysis.cancelledAt || run?.claimedBy !== workerId || run.status !== 'running' || !run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= Date.now()) return null;
  return { analysis, stage };
}
/** One durable stage in the existing workflow queue. Completion and continuation commit together. */
export async function executePolicyRun(claimed: { id: string; input: Record<string, unknown> | null }, workerId: string): Promise<void> {
  const analysisId = String(claimed.input?.analysisId ?? '');
  const stageId = String(claimed.input?.stageId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(analysisId) || !/^[0-9a-f-]{36}$/i.test(stageId)) throw new Error('Invalid policy queue envelope');
  const started = await db.transaction(async (tx) => {
    const locked = await lockLease(tx, analysisId, stageId, claimed.id, workerId);
    if (!locked) return null;
    // An attempt is consumed where the stage FAILS, not where it is claimed: a
    // deploy, an OOM or a lease blip used to burn one of the three, so three
    // merges to master during a long analysis killed it with nothing wrong.
    // `EXECUTION_CEILING` is the backstop against an interruption loop instead.
    const [{ runs }] = await tx.select({ runs: sql<number>`count(*)::int` }).from(policyExecutions).where(eq(policyExecutions.stageId, stageId));
    if (locked.stage.attempts >= 3 || runs >= EXECUTION_CEILING) {
      const message = locked.stage.attempts >= 3
        ? 'This stage failed three times. Completed artefacts are retained; resume to try again.'
        : 'This stage was interrupted too many times to continue automatically. Completed artefacts are retained; resume to try again.';
      await tx.update(policyStages).set({ status: 'failed', error: message }).where(eq(policyStages.id, stageId));
      await tx.update(policyAnalyses).set({ status: 'failed', error: message, updatedAt: new Date() }).where(eq(policyAnalyses.id, analysisId));
      await tx.update(workflowRuns).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(workflowRuns.id, claimed.id));
      return null;
    }
    await tx.update(policyExecutions).set({ status: 'interrupted', completedAt: new Date(), error: 'Worker lease expired; continuing from the last committed stage.' }).where(and(eq(policyExecutions.stageId, stageId), eq(policyExecutions.status, 'running')));
    const [execution] = await tx.insert(policyExecutions).values({ stageId, runId: claimed.id }).returning();
    await tx.update(policyStages).set({ status: 'running', startedAt: locked.stage.startedAt ?? new Date(), error: null }).where(eq(policyStages.id, stageId));
    await tx.update(policyAnalyses).set({ status: 'running', error: null, updatedAt: new Date() }).where(eq(policyAnalyses.id, analysisId));
    return { ...locked, execution };
  });
  if (!started) return;
  const abort = new AbortController();
  // Cancellation and lost leases stop further model/research calls. Commit also
  // checks the lease under row locks, so a late result cannot win after resume.
  const check = setInterval(() => {
    void db.select({ status: workflowRuns.status, owner: workflowRuns.claimedBy, expiry: workflowRuns.leaseExpiresAt }).from(workflowRuns).where(eq(workflowRuns.id, claimed.id)).then(([r]) => {
      if (!r || r.status !== 'running' || r.owner !== workerId || !r.expiry || r.expiry.getTime() <= Date.now()) abort.abort();
    }).catch(() => abort.abort());
  }, 2000);
  const all = await loadArtefacts(analysisId);
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(stageBudgetMs(started.stage.ordinal, all))]);
  try {
    const previousStages = await db.select({ warnings: policyStages.warnings }).from(policyStages).where(eq(policyStages.analysisId, analysisId));
    const [document] = await db.select().from(policyDocuments).where(eq(policyDocuments.analysisId, analysisId));
    const extracted = started.stage.ordinal === 0 ? await ingest(Buffer.from(document.content, 'base64'), document.filename, document.mimeType) : null;
    const output = extracted ?? await executeStage({ stage: started.stage.ordinal, title: started.analysis.title, jurisdiction: started.analysis.jurisdiction, policyArea: started.analysis.policyArea, context: started.analysis.context, priorWarnings: previousStages.flatMap((s) => s.warnings), artefacts: all }, { model: modelCaller(started.execution.id, claimed.id, signal, all), research, signal, neighbours: () => neighbourSummaries(started.analysis.owner, analysisId) });
    signal.throwIfAborted();
    await db.transaction(async (tx) => {
      const locked = await lockLease(tx, analysisId, stageId, claimed.id, workerId);
      if (!locked) return;
      await persistArtefacts(tx, analysisId, started.stage.ordinal, output.artefacts);
      if (extracted) await tx.update(policyDocuments).set({ extractedText: extracted.text, metadata: extracted.metadata }).where(eq(policyDocuments.analysisId, analysisId));
      await tx.update(policyExecutions).set({ status: 'completed', completedAt: new Date() }).where(eq(policyExecutions.id, started.execution.id));
      await tx.update(policyStages).set({ status: 'completed', completedAt: new Date(), warnings: output.warnings, output: { artefactIds: output.artefacts.map((a) => a.id), contractVersion: 1 } }).where(eq(policyStages.id, stageId));
      await tx.update(workflowRuns).set({ status: 'completed', completedAt: new Date() }).where(eq(workflowRuns.id, claimed.id));
      const [next] = await tx.select().from(policyStages).where(and(eq(policyStages.analysisId, analysisId), eq(policyStages.ordinal, started.stage.ordinal + 1)));
      if (next) {
        await queueStage(tx, analysisId, next.id);
        await tx.update(policyAnalyses).set({ updatedAt: new Date() }).where(eq(policyAnalyses.id, analysisId));
      } else {
        const stages = await tx.select().from(policyStages).where(eq(policyStages.analysisId, analysisId));
        if (stages.some((s) => s.status !== 'completed')) throw new PolicyError('incomplete', 'Cannot complete an analysis with unfinished stages.');
        const gaps = stages.some((s) => s.warnings.length > 0);
        await tx.update(policyAnalyses).set({ status: gaps ? 'completed_with_gaps' : 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(policyAnalyses.id, analysisId));
      }
    });
  } catch (err) {
    const message = err instanceof PolicyError ? err.message : signal.aborted ? 'Execution was interrupted or reached this stage’s time limit. Completed work is retained.' : 'The stage failed. Completed work is retained; resume to retry.';
    await db.transaction(async (tx) => {
      const locked = await lockLease(tx, analysisId, stageId, claimed.id, workerId);
      if (!locked) return;
      const interrupted = !(err instanceof PolicyError) && signal.aborted;
      const attempts = interrupted ? locked.stage.attempts : locked.stage.attempts + 1;
      const retry = attempts < 3 && !(err instanceof PolicyError && ['budget', 'extraction'].includes(err.code));
      await tx.update(policyExecutions).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(policyExecutions.id, started.execution.id));
      await tx.update(workflowRuns).set({ status: 'failed', error: message, completedAt: new Date() }).where(eq(workflowRuns.id, claimed.id));
      await tx.update(policyStages).set({ status: retry ? 'pending' : 'failed', attempts, error: message }).where(eq(policyStages.id, stageId));
      if (retry) await queueStage(tx, analysisId, stageId, 15_000 * Math.max(1, attempts));
      await tx.update(policyAnalyses).set({ status: retry ? 'queued' : 'failed', error: message, updatedAt: new Date() }).where(eq(policyAnalyses.id, analysisId));
    });
  } finally { clearInterval(check); }
}
