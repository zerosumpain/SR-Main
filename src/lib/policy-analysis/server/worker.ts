import { and, eq, gt, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { policyAnalyses, policyDocuments, policyExecutions, policyModelCalls, policyStages, workflowRuns } from '$lib/db/schema';
import { isThinkingLevel } from '$lib/models/thinking';
import { boundWarnings } from '../budget';
import { PERSONA_STAGE, type Concurrency } from '../contracts';
import { executeStage, graphUncovered } from '../pipeline';
import { PolicyError } from '../validation';
import { ingest } from './ingest';
import { loadArtefacts, neighbourSummaries, persistArtefacts, queueStage, sealOf } from './store';
import { sealRow, unsealRow } from './seal';
import { applyPersonaLinks, priorsFor } from './personas';
import { modelCaller } from './provider';
import { research } from './research';

// A bare `[0-9a-f-]{36}` matches thirty-six hyphens, which Postgres cannot cast to
// uuid — so a malformed id raised a 500 where it should have been a 404.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Interruptions are free, but not infinitely free — measured as a RATE.
 *
 * This was a lifetime count, and on 2026-09-10 that nearly destroyed a healthy
 * five-and-a-half-hour assessment. A liveness probe restarted the web process
 * every two minutes for twenty minutes, and because the worker lives in that
 * process each restart expired the lease and opened a new execution: ELEVEN of
 * twelve spent without the work failing once. A lifetime count cannot tell a
 * two-minute restart loop from a long run interrupted a few times an hour apart,
 * and the second is an ordinary afternoon.
 *
 * Twelve inside an hour is a loop and still stops the stage. Twelve across six
 * hours is a Thursday, and now costs nothing.
 */
const EXECUTION_CEILING = 12;
const EXECUTION_WINDOW_MS = 60 * 60_000;

/**
 * A runaway guard on model calls, not a budget.
 *
 * A 400-page document at `deep` legitimately issues several hundred calls — one
 * per passage at stage 1 alone, plus profiles, research, ten patterns, eight
 * scenarios and a red-team pass per actor. Nothing bounded the total, so a
 * pathological document could have spent without limit. This stops a run that has
 * clearly lost the plot; it is deliberately far above any real assessment.
 */
const MODEL_CALL_CEILING = 1500;

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
    // The graph now makes one call per resolved body, exactly as the profiles do.
    : ordinal === 3 || ordinal === 4 ? Math.max(1, count('actor'))
    : ordinal === 6 ? count('research_question') + 1
    : ordinal === 7 || ordinal === 9 ? 8
    : ordinal === 10 ? Math.max(1, count('profile'))
    // The persona library makes one merge call per profiled actor, exactly as the
    // red team does. A flat budget here would kill the stage on a wide policy.
    : ordinal === 13 ? Math.max(1, count('profile'))
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
/**
 * `beat` is injected rather than imported, and that is a layering rule not a
 * preference: `$lib/workflows` already imports this module to dispatch a policy
 * envelope, so importing `engine-runtime` back would close a cycle neither module
 * could then be tested or moved out of. The caller owns the batch and ends it in
 * its own `finally`, which also means no failure on the way in here can leak one.
 */
export async function executePolicyRun(claimed: { id: string; input: Record<string, unknown> | null }, workerId: string, beat?: (phase: string) => void): Promise<void> {
  const analysisId = String(claimed.input?.analysisId ?? '');
  const stageId = String(claimed.input?.stageId ?? '');
  if (!UUID.test(analysisId) || !UUID.test(stageId)) throw new Error('Invalid policy queue envelope');
  const started = await db.transaction(async (tx) => {
    const locked = await lockLease(tx, analysisId, stageId, claimed.id, workerId);
    if (!locked) return null;
    // An attempt is consumed where the stage FAILS, not where it is claimed: a
    // deploy, an OOM or a lease blip used to burn one of the three, so three
    // merges to master during a long analysis killed it with nothing wrong.
    // `EXECUTION_CEILING` is the backstop against an interruption loop instead.
    const [{ runs }] = await tx.select({ runs: sql<number>`count(*)::int` }).from(policyExecutions)
      .where(and(eq(policyExecutions.stageId, stageId), gt(policyExecutions.startedAt, new Date(Date.now() - EXECUTION_WINDOW_MS))));
    if (locked.stage.attempts >= 3 || runs >= EXECUTION_CEILING) {
      const message = locked.stage.attempts >= 3
        ? 'This stage failed three times. Completed artefacts are retained; resume to try again.'
        : `This stage was interrupted ${runs} times in the last hour, which is a restart loop rather than slow progress. Completed artefacts are retained; resume once the cause is fixed.`;
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
  const all = await loadArtefacts(analysisId);
  /**
   * Tell the liveness probe this process is BUSY, not broken.
   *
   * Assembling a stage's context is synchronous and, on a large assessment, slow:
   * measured at 17-20 seconds a call on 2026-09-10 against the probe's five
   * second threshold. Every one of those read as a wedged process, so the
   * watchdog restarted the service mid-call, over and over, and the stage could
   * never finish.
   */
  const stagePhase = `stage ${started.stage.ordinal} · ${started.stage.name}`;
  const check = setInterval(() => {
    // The beat rides the lease check rather than a timer of its own, and that is
    // the point: a blocked event loop cannot fire this callback, so the beat
    // stops exactly when the process really is wedged and the restart becomes
    // correct again. A batch that has gone stale excuses nothing.
    beat?.(stagePhase);
    void db.select({ status: workflowRuns.status, owner: workflowRuns.claimedBy, expiry: workflowRuns.leaseExpiresAt }).from(workflowRuns).where(eq(workflowRuns.id, claimed.id)).then(([r]) => {
      if (!r || r.status !== 'running' || r.owner !== workerId || !r.expiry || r.expiry.getTime() <= Date.now()) abort.abort();
    }).catch(() => abort.abort());
  }, 2000);
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(stageBudgetMs(started.stage.ordinal, all))]);
  // ONE CODEC FOR THE STAGE. `lockLease` selects the analysis row raw, so on a
  // sealed run `started.analysis.title` is ciphertext until this decodes it —
  // and it is handed straight to the model prompt, which is exactly where an
  // undecoded value would be least visible and most wrong.
  const seal = await sealOf(analysisId);
  const analysis = unsealRow(seal, 'analysis', started.analysis);
  try {
    const [{ made }] = await db.select({ made: sql<number>`count(*)::int` }).from(policyModelCalls)
      .innerJoin(policyExecutions, eq(policyExecutions.id, policyModelCalls.executionId))
      .innerJoin(policyStages, eq(policyStages.id, policyExecutions.stageId))
      .where(eq(policyStages.analysisId, analysisId));
    if (made >= MODEL_CALL_CEILING) throw new PolicyError('budget', `This assessment has made ${made.toLocaleString()} model calls, past the ${MODEL_CALL_CEILING.toLocaleString()} this implementation allows for one document. Completed stages are retained; submit a shorter document or split it.`);
    const previousStages = (await db.select({ ordinal: policyStages.ordinal, warnings: policyStages.warnings, output: policyStages.output }).from(policyStages).where(eq(policyStages.analysisId, analysisId)))
      .map((r) => unsealRow(seal, 'stage', r));
    // How much of the knowledge graph triage threw away. The deterministic checks
    // read that stage's output, so a verdict drawn from a fragment must say so
    // rather than reading as coverage.
    const graph = previousStages.find((s) => s.ordinal === 3)?.output as { artefactIds?: string[]; rejected?: number } | null;
    const kept = graph?.artefactIds?.length ?? 0;
    const lost = graph?.rejected ?? 0;
    const discarded = kept + lost > 0 ? lost / (kept + lost) : 0;
    // The second arm, and the one that was missing. Triage discarding nothing is
    // not the same as the graph holding anything: a stage can be handed a
    // fraction of the inventory, keep all of it, and report a discard rate of
    // zero. Measured against the resolved actors, which is what a structural
    // check about authority, funding or accountability is reasoning over.
    //
    // ONE DEFINITION, imported. This arithmetic was written out a second time
    // here, and the copy counted `node` artefacts — which is why it returned
    // "fully covered" for a graph reaching half the bodies. `graphUncovered`
    // explains what it counts now and why.
    const graphLoss = Math.max(discarded, graphUncovered(all));
    // `content` is base64 of up to 10 MB and only stage 0 has any use for it.
    // Selecting the whole row on all thirteen stages moved ~13 MB through the
    // connection twelve times for nothing.
    const extracted = started.stage.ordinal === 0
      ? await (async () => {
          const [row] = await db.select({ content: policyDocuments.content, filename: policyDocuments.filename, mimeType: policyDocuments.mimeType }).from(policyDocuments).where(eq(policyDocuments.analysisId, analysisId));
          const document = unsealRow(seal, 'document', row);
          return ingest(Buffer.from(document.content, 'base64'), document.filename, document.mimeType);
        })()
      : null;
    // A SEALED RUN DOES NOT LEAVE ITS OWN BLAST RADIUS. Each of these three is a
    // channel by which this paper's prose would reach somewhere shredding its key
    // could never follow:
    //
    // - **research** sends queries derived from the document to a search provider,
    //   whose logs are nobody's to delete. `query-guard` already stops a verbatim
    //   quotation; it cannot stop the TOPIC of an unpublished paper.
    // - **neighbours** would put another assessment's artefacts in this prompt and,
    //   through the cross-policy finding it produces, this paper's prose on that
    //   assessment's page. (`neighbourSummaries` separately refuses to offer a
    //   sealed run to anyone else.)
    // - **personas** are a library that outlives the run by design. A dossier
    //   trait drawn from a sealed paper would survive its purge — the precise
    //   residue this feature exists to remove.
    const sealedRun = !!analysis.sealed;
    const noResearch: typeof research = async () => ({
      artefacts: [],
      warnings: ['This is a sealed assessment, so no external research was carried out: a search provider\u2019s logs are not ours to erase. It rests on the policy document and explicitly labelled inferences only.'],
    });
    const output = extracted ?? await executeStage({ stage: started.stage.ordinal, title: analysis.title, jurisdiction: analysis.jurisdiction, policyArea: analysis.policyArea, context: analysis.context, depth: analysis.depth as 'standard' | 'deep', sealed: sealedRun, graphLoss, priorWarnings: boundWarnings(previousStages.flatMap((s) => s.warnings)), artefacts: all }, { model: modelCaller(started.execution.id, claimed.id, signal, all, { model: analysis.model, thinkingLevel: isThinkingLevel(analysis.thinkingLevel) ? analysis.thinkingLevel : null, sealed: sealedRun }), research: sealedRun ? noResearch : research, signal, concurrency: analysis.concurrency as Concurrency | null, onProgress: (phase) => beat?.(`${stagePhase} · ${phase}`), neighbours: sealedRun ? async () => [] : () => neighbourSummaries(analysis.owner, analysisId), personas: sealedRun ? async () => [] : (actors) => priorsFor(analysis.owner, actors, analysisId) });
    signal.throwIfAborted();
    await db.transaction(async (tx) => {
      const locked = await lockLease(tx, analysisId, stageId, claimed.id, workerId);
      if (!locked) return;
      await persistArtefacts(tx, analysisId, started.stage.ordinal, output.artefacts, seal);
      // The persona library is written here, not by the pipeline: a rolled-back
      // stage must leave no rows behind, and a re-run must replace its own
      // observation rather than adding a second one.
      //
      // Inside a SAVEPOINT, because a library write that fails must not roll back
      // a completed assessment: the report was finished at the previous stage and
      // the reader is owed it whatever happens to the dossier.
      // A SEALED RUN CONTRIBUTES NOTHING TO THE LIBRARY. The stage still runs and
      // its `persona_link` artefacts still belong to the assessment; what does not
      // happen is the write into `policy_personas`, whose rows deliberately
      // outlive the analyses that fed them.
      if (started.stage.ordinal === PERSONA_STAGE && !sealedRun) {
        try {
          await tx.transaction(async (inner) => { await applyPersonaLinks(inner, analysis.owner, analysisId, analysis.title, output.artefacts, all); });
        } catch {
          output.warnings.push('This assessment could not be written into the persona library. Its own findings are unaffected; the library simply does not have this run.');
        }
      }
      if (extracted) await tx.update(policyDocuments).set(sealRow(seal, 'document', { extractedText: extracted.text, metadata: extracted.metadata })).where(eq(policyDocuments.analysisId, analysisId));
      await tx.update(policyExecutions).set({ status: 'completed', completedAt: new Date() }).where(eq(policyExecutions.id, started.execution.id));
      // `output` is identifiers the pipeline minted and stays in the clear — the
      // structural checks read it, and it holds no words from the paper. The
      // WARNINGS do: they quote artefact labels.
      await tx.update(policyStages).set({ status: 'completed', completedAt: new Date(), ...sealRow(seal, 'stage', { warnings: output.warnings }), output: { artefactIds: output.artefacts.map((a) => a.id), contractVersion: 1, rejected: 'rejected' in output ? output.rejected : 0 } }).where(eq(policyStages.id, stageId));
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
      // A deadline is deterministic: the same model on the same page will run out
      // of time again. Retrying it twice more cost the first white-paper run two
      // hours and told the reader nothing new.
      const retry = attempts < 3 && !(err instanceof PolicyError && ['budget', 'extraction', 'timeout'].includes(err.code));
      // A FAILURE MESSAGE CAN QUOTE THE PAPER — a triage rejection names the
      // artefact labels it discarded — so on a sealed run it is encrypted into the
      // three policy tables and NEVER written to `workflow_runs`. That table is
      // the whole site's queue: the canvas, the ops surfaces and the run list all
      // read it, none of them know what sealing is, and its rows are reached only
      // by the purge's delete rather than by the key. A generic line there keeps
      // sealed prose out of a shared table entirely.
      await tx.update(policyExecutions).set({ status: 'failed', ...sealRow(seal, 'execution', { error: message }), completedAt: new Date() }).where(eq(policyExecutions.id, started.execution.id));
      await tx.update(workflowRuns).set({ status: 'failed', error: seal.sealed ? 'A sealed policy stage failed. The reason is recorded on the assessment.' : message, completedAt: new Date() }).where(eq(workflowRuns.id, claimed.id));
      await tx.update(policyStages).set({ status: retry ? 'pending' : 'failed', attempts, ...sealRow(seal, 'stage', { error: message }) }).where(eq(policyStages.id, stageId));
      if (retry) await queueStage(tx, analysisId, stageId, 15_000 * Math.max(1, attempts));
      await tx.update(policyAnalyses).set({ status: retry ? 'queued' : 'failed', ...sealRow(seal, 'analysis', { error: message }), updatedAt: new Date() }).where(eq(policyAnalyses.id, analysisId));
    });
  } finally { clearInterval(check); }
}
