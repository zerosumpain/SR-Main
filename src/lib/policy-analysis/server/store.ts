import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { policyAnalyses, policyArtefacts, policyDocuments, policyExecutions, policyModelCalls, policyPersonaObservations, policyPersonas, policyProvenance, policyStages, workflowRuns, workflows } from '$lib/db/schema';
import { STAGES, TRIGGER, WORKFLOW_ID, type Artefact } from '../contracts';
import type { Neighbour } from '../pipeline';
import { PolicyError } from '../validation';
import type { Submission } from './ingest';
import { recountSightings } from './personas';
import { mintKey, openSeal, readKey, sealRow, sealWithKey, shredKey, unsealRow, type Seal } from './seal';

/**
 * The codec for one analysis, read from its `sealed` flag.
 *
 * Every read and write of a free-text policy column goes through this. An
 * unsealed run — which is every run before 2026-09-11 and every run that does not
 * ask to be sealed — gets the pass-through codec, which costs one indexed lookup
 * and no cipher at all.
 */
export async function sealOf(analysisId: string, tx: DbExecutor = db): Promise<Seal> {
  const [row] = await tx.select({ sealed: policyAnalyses.sealed }).from(policyAnalyses).where(eq(policyAnalyses.id, analysisId)).limit(1);
  if (!row?.sealed) return openSeal();
  return sealWithKey(await readKey(analysisId));
}

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
    // THE ID IS MINTED HERE, NOT BY THE DEFAULT, so a sealed run's key exists
    // before its first row does. Letting the insert allocate the id would mean
    // writing the title and context in the clear and encrypting them a statement
    // later — and an updated row still leaves its first version in the WAL.
    const id = randomUUID();
    const key = input.sealed ? await mintKey(id) : null;
    const seal = key ? sealWithKey(key) : openSeal();
    try {
      const [analysis] = await tx.insert(policyAnalyses).values({
        id, owner, sealed: !!input.sealed, depth: input.depth, model: input.model, thinkingLevel: input.thinkingLevel, concurrency: input.concurrency,
        ...sealRow(seal, 'analysis', { title: input.title, jurisdiction: input.jurisdiction, policyArea: input.policyArea, context: input.context }),
      }).returning();
      await tx.insert(policyDocuments).values({
        analysisId: analysis.id, mimeType: input.mimeType, size: input.bytes.length,
        // The digest stays in the clear: it is the run's own integrity check, it
        // never leaves the owner's session, and the offline pack already withholds
        // it from a shared copy for the confirmation-oracle reason.
        sha256: createHash('sha256').update(input.bytes).digest('hex'),
        ...sealRow(seal, 'document', { filename: input.filename, content: input.bytes.toString('base64') }),
      });
      const stages = await tx.insert(policyStages).values(STAGES.map((name, ordinal) => ({ analysisId: analysis.id, ordinal, name }))).returning();
      await queueStage(tx, analysis.id, stages.find((s) => s.ordinal === 0)!.id);
      return unsealRow(seal, 'analysis', analysis);
    } catch (err) {
      // A key with no run is litter, and litter in a directory whose whole job is
      // to hold exactly the live keys is how one gets missed at purge time.
      if (key) await shredKey(id).catch(() => {});
      throw err;
    }
  });
}
export async function listAnalyses(owner: string) {
  const rows = await db.select().from(policyAnalyses).where(eq(policyAnalyses.owner, owner)).orderBy(desc(policyAnalyses.createdAt)).limit(50);
  // Only the sealed rows touch the key directory, so an account with none pays
  // nothing for this.
  return Promise.all(rows.map(async (r) => (r.sealed ? unsealRow(await sealOf(r.id), 'analysis', r) : r)));
}
export async function ownedAnalysis(owner: string, id: string, tx: DbExecutor = db) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [analysis] = await tx.select().from(policyAnalyses).where(and(eq(policyAnalyses.id, id), eq(policyAnalyses.owner, owner))).limit(1);
  if (!analysis) return null;
  return analysis.sealed ? unsealRow(sealWithKey(await readKey(analysis.id)), 'analysis', analysis) : analysis;
}
export type ArtefactMeta = { id: string; stage: number; updatedAt: Date };

/**
 * Artefacts and their per-row metadata from ONE pass.
 *
 * `loadArtefacts` reads `stage` and `updatedAt` off every row and discards them,
 * so asking for them separately meant a second full scan and shipping every
 * artefact id to the browser twice over.
 */
export async function loadWithMeta(id: string, tx: DbExecutor = db): Promise<{ artefacts: Artefact[]; meta: ArtefactMeta[] }> {
  const seal = await sealOf(id, tx);
  const rows = (await tx.select().from(policyArtefacts).where(eq(policyArtefacts.analysisId, id)).orderBy(asc(policyArtefacts.stage), asc(policyArtefacts.createdAt), asc(policyArtefacts.id)))
    .map((r) => unsealRow(seal, 'artefact', r));
  const links = await tx.select().from(policyProvenance).where(eq(policyProvenance.analysisId, id));
  const byFrom = new Map<string, string[]>();
  for (const link of links) byFrom.set(link.fromId, [...(byFrom.get(link.fromId) ?? []), link.toId]);
  return {
    artefacts: rows.map(({ analysisId: _a, stage: _s, createdAt: _c, updatedAt: _u, ...a }) => ({ ...a, refs: byFrom.get(a.id) ?? [] }) as Artefact),
    meta: rows.map((r) => ({ id: r.id, stage: r.stage, updatedAt: r.updatedAt })),
  };
}

export async function loadArtefacts(id: string, tx: DbExecutor = db): Promise<Artefact[]> {
  // THIS AND `loadWithMeta` ARE THE ONLY PLACES AN ARTEFACT IS READ, which is why
  // sealing needed no change anywhere above them: the pipeline, the view modules
  // and every component see exactly the plaintext they saw before.
  const seal = await sealOf(id, tx);
  const rows = (await tx.select().from(policyArtefacts).where(eq(policyArtefacts.analysisId, id)).orderBy(asc(policyArtefacts.stage), asc(policyArtefacts.createdAt), asc(policyArtefacts.id)))
    .map((r) => unsealRow(seal, 'artefact', r));
  const links = await tx.select().from(policyProvenance).where(eq(policyProvenance.analysisId, id));
  // Grouped once rather than scanned per artefact: this ran on the web process's
  // event loop for every six-second dashboard poll, and 2,000 artefacts against
  // 10,000 links is twenty million comparisons a poll.
  const byFrom = new Map<string, string[]>();
  for (const link of links) byFrom.set(link.fromId, [...(byFrom.get(link.fromId) ?? []), link.toId]);
  return rows.map(({ analysisId: _analysisId, stage: _stage, createdAt: _createdAt, updatedAt: _updatedAt, ...a }) => ({ ...a, refs: byFrom.get(a.id) ?? [] }) as Artefact);
}
/** Page counts and extraction errors, without the document's text a second time. */
function summariseExtraction(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const m = metadata as { kind?: string; pages?: { index: number; text?: string; error?: string }[] };
  if (!Array.isArray(m.pages)) return metadata;
  return {
    ...m,
    pages: m.pages.map((p) => ({ index: p.index, characters: p.text?.length ?? 0, ...(p.error ? { error: p.error } : {}) })),
  };
}

export async function detail(owner: string, id: string) {
  const analysis = await ownedAnalysis(owner, id);
  if (!analysis) return null;
  // One codec for the whole page. `ownedAnalysis` above has already used its own
  // to decode this analysis's own row.
  const seal = await sealOf(id);
  const stages = (await db.select().from(policyStages).where(eq(policyStages.analysisId, id)).orderBy(asc(policyStages.ordinal)))
    .map((r) => unsealRow(seal, 'stage', r));
  const rawDocuments = await db.select({ id: policyDocuments.id, filename: policyDocuments.filename, mimeType: policyDocuments.mimeType, size: policyDocuments.size, sha256: policyDocuments.sha256, metadata: policyDocuments.metadata }).from(policyDocuments).where(eq(policyDocuments.analysisId, id));
  // `metadata.pages[].text` is a SECOND full copy of the extracted document — up
  // to 600,000 characters — and it rode the response on first load and on every
  // six-second poll while a run was active. The page wants the shape, not the text.
  const documents = rawDocuments
    .map((d) => unsealRow(seal, 'document', d))
    .map((d) => ({ ...d, metadata: summariseExtraction(d.metadata) }));
  const executions = await db.select({ execution: policyExecutions }).from(policyExecutions).innerJoin(policyStages, eq(policyStages.id, policyExecutions.stageId)).where(eq(policyStages.analysisId, id)).orderBy(asc(policyExecutions.startedAt));
  // Model prompts/output are private audit data, fetched separately on demand.
  const calls = await db.select({ id: policyModelCalls.id, executionId: policyModelCalls.executionId, callKey: policyModelCalls.callKey, promptVersion: policyModelCalls.promptVersion, inputHash: policyModelCalls.inputHash, status: policyModelCalls.status, provider: policyModelCalls.provider, model: policyModelCalls.model, usage: policyModelCalls.usage, startedAt: policyModelCalls.startedAt, completedAt: policyModelCalls.completedAt, error: policyModelCalls.error }).from(policyModelCalls).innerJoin(policyExecutions, eq(policyExecutions.id, policyModelCalls.executionId)).innerJoin(policyStages, eq(policyStages.id, policyExecutions.stageId)).where(eq(policyStages.analysisId, id));
  const queued = stages.find((s) => s.runId && s.status !== 'completed');
  const [run] = queued?.runId ? await db.select({ heartbeatAt: workflowRuns.heartbeatAt, leaseExpiresAt: workflowRuns.leaseExpiresAt }).from(workflowRuns).where(eq(workflowRuns.id, queued.runId)) : [];
  const { artefacts, meta: artefactMetadata } = await loadWithMeta(id);
  // A cross-policy exposure is written onto the assessment that FOUND it. This
  // page belongs to the other half of that pair as much as it does to the finder,
  // so pull in the exposures that name this analysis from elsewhere.
  const inbound = await db.select({ id: policyArtefacts.id, label: policyArtefacts.label, statement: policyArtefacts.statement, data: policyArtefacts.data, analysisId: policyArtefacts.analysisId, analysisTitle: policyAnalyses.title })
    .from(policyArtefacts)
    .innerJoin(policyAnalyses, eq(policyAnalyses.id, policyArtefacts.analysisId))
    .where(and(eq(policyAnalyses.owner, owner), eq(policyArtefacts.kind, 'cross_policy'), sql`${policyArtefacts.data} ->> 'otherAnalysisId' = ${id}`))
    .limit(50);
  // Which of this assessment's actors are bodies the reader has met before. The
  // link is read from the observation rows rather than from the persona_link
  // artefacts: a NEW persona is minted by the server at commit, so the artefact
  // that asked for it carries a null id and could not be followed.
  const personas = await db.select({ actorId: policyPersonaObservations.actorId, personaId: policyPersonas.id, name: policyPersonas.name, entityType: policyPersonas.entityType, sightings: policyPersonas.sightings })
    .from(policyPersonaObservations)
    .innerJoin(policyPersonas, eq(policyPersonas.id, policyPersonaObservations.personaId))
    .where(and(eq(policyPersonaObservations.analysisId, id), eq(policyPersonas.owner, owner)))
    .limit(60);
  return { analysis, stages, documents, artefactMetadata, artefacts, executions: executions.map((e) => unsealRow(seal, 'execution', e.execution)), calls, inbound, personas, heartbeat: run?.heartbeatAt ?? null };
}
export async function persistArtefacts(tx: DbExecutor, analysisId: string, stage: number, artefacts: Artefact[], seal?: Seal) {
  if (!artefacts.length) return;
  // The caller passes its seal when it already has one — the worker holds one for
  // the whole stage — and otherwise it is read here, so no call site can forget.
  const codec = seal ?? (await sealOf(analysisId, tx));
  for (let i = 0; i < artefacts.length; i += 250) {
    await tx.insert(policyArtefacts).values(artefacts.slice(i, i + 250).map(({ refs: _refs, ...row }) => sealRow(codec, 'artefact', { ...row, analysisId, stage })));
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
    // A SEALED RUN IS NEVER A NEIGHBOUR. Cross-policy comparison works by putting
    // one assessment's artefacts into another's prompt, and that prompt is stored
    // — so a sealed paper's prose would end up in an unsealed run's
    // `policy_model_calls.input`, where shredding its key could never reach it.
    // The worker also declines to ASK for neighbours on a sealed run; this is the
    // half that protects the sealed paper from everyone else's runs, and it has
    // to live here because it is about rows this query can see.
    .where(and(eq(policyAnalyses.owner, owner), eq(policyAnalyses.sealed, false), inArray(policyAnalyses.status, ['completed', 'completed_with_gaps'])))
    .orderBy(desc(policyAnalyses.completedAt)).limit(NEIGHBOUR_LIMIT + 1);
  // The first assessment on an account has no neighbours at all, and an empty
  // `inArray` is not a shape to hand Postgres. Leave before the document queries.
  if (!others.some((o) => o.id !== exclude)) return [];
  // A redraft of the SAME paper is not another policy. Submitting v2 after acting
  // on v1's plays is the intended way to use this, and without the hash check the
  // two drafts would be reported as conflicting with each other.
  const [mine] = await db.select({ sha256: policyDocuments.sha256 }).from(policyDocuments).where(eq(policyDocuments.analysisId, exclude));
  const shas = await db.select({ analysisId: policyDocuments.analysisId, sha256: policyDocuments.sha256 }).from(policyDocuments).where(inArray(policyDocuments.analysisId, others.map((o) => o.id)));
  const sameDocument = new Set(shas.filter((d) => mine && d.sha256 === mine.sha256).map((d) => d.analysisId));
  const shortlist = others.filter((o) => o.id !== exclude && !sameDocument.has(o.id)).slice(0, NEIGHBOUR_LIMIT);
  if (!shortlist.length) return [];
  // Queried per analysis, not once across all of them: a single confident
  // assessment used to fill the whole budget and leave the others with nothing,
  // silently. Exploits carry `confidence = exposure`, so a paper with several
  // severe plays scores near 1.0 and would always have been the one that won.
  const perAnalysis = await Promise.all(shortlist.map((o) => db
    .select({ analysisId: policyArtefacts.analysisId, id: policyArtefacts.id, kind: policyArtefacts.kind, label: policyArtefacts.label, statement: policyArtefacts.statement, data: policyArtefacts.data })
    .from(policyArtefacts)
    .where(and(eq(policyArtefacts.analysisId, o.id), inArray(policyArtefacts.kind, NEIGHBOUR_KINDS)))
    // `desc()` alone is NULLS FIRST in Postgres, which would fill the budget with
    // exactly the rows an assessment was least sure about. The kind/id tiebreak
    // keeps the cut stable between runs.
    .orderBy(sql`${policyArtefacts.confidence} DESC NULLS LAST`, asc(policyArtefacts.kind), asc(policyArtefacts.id))
    .limit(NEIGHBOUR_ARTEFACTS)));
  const rows = perAnalysis.flat();
  return shortlist.map((o) => ({
    id: o.id, title: o.title, policyArea: o.policyArea, jurisdiction: o.jurisdiction,
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    artefacts: rows.filter((r) => r.analysisId === o.id)
      // Actors carry their type and aliases so identity can be judged on more
      // than a matching label - see `crossIdentityHints`.
      .map((r) => ({ id: r.id, kind: r.kind, label: r.label, statement: r.statement.slice(0, 600), entityType: r.kind === 'actor' ? String(r.data.entityType ?? '') : undefined, aliases: r.kind === 'actor' && Array.isArray(r.data.aliases) ? (r.data.aliases as string[]).slice(0, 12) : undefined })),
  }));
}

/** True only for a sealed analysis whose key file is still present. */
async function keyStillLives(owner: string, id: string): Promise<boolean> {
  const analysis = await ownedAnalysis(owner, id);
  if (!analysis?.sealed) return false;
  return (await readKey(id)) !== null;
}

/**
 * Delete an analysis, its document bytes, artefacts, provenance, executions and
 * model-call audit. Any queue envelope still pointing at it is cancelled first,
 * so a worker cannot resurrect rows behind the delete.
 */
export async function remove(owner: string, id: string): Promise<boolean> {
  // A SEALED RUN'S ROWS MAY NOT BE DELETED WHILE ITS KEY IS ALIVE, and that is
  // enforced here rather than trusted to whoever calls this next.
  //
  // Deleting first and shredding second is the failure this feature cannot have:
  // it leaves ciphertext in fourteen nightly dumps and every restic snapshot,
  // with a live key on the same disk, and nothing left in the database to say
  // which key belongs to it. `purge()` shreds before it calls this, so by the
  // time control reaches here the key is already gone and the check passes. Any
  // other caller gets told to use `purge`.
  if (await keyStillLives(owner, id)) {
    throw new PolicyError('state', 'This assessment is sealed and its key still exists. Purge it instead: the key must be destroyed before the rows are, or the copies in backups stay readable.');
  }
  return db.transaction(async (tx) => {
    const analysis = await ownedAnalysis(owner, id, tx);
    if (!analysis) return false;
    const stages = await tx.select({ runId: policyStages.runId }).from(policyStages).where(eq(policyStages.analysisId, id));
    const runIds = stages.map((s) => s.runId).filter((r): r is string => !!r);
    if (runIds.length) await tx.update(workflowRuns).set({ status: 'cancelled', claimedBy: null, leaseExpiresAt: null, completedAt: new Date() }).where(inArray(workflowRuns.id, runIds));
    // Which personas this assessment contributed to, read BEFORE the delete
    // cascades its observations away. `sightings` is a count of assessments and
    // must fall when one is removed; the row itself survives, because a dossier
    // built from four papers is not wrong because one of them was withdrawn.
    const contributed = [...new Set((await tx.select({ personaId: policyPersonaObservations.personaId }).from(policyPersonaObservations).where(eq(policyPersonaObservations.analysisId, id))).map((r) => r.personaId))];
    // A CROSS-POLICY FINDING ON SOMEBODY ELSE'S ASSESSMENT IS PROSE ABOUT THIS
    // ONE. `otherAnalysisTitle`, `interaction` and `consequence` describe the
    // paper being deleted, and they live on the analysis that FOUND them, which no
    // cascade from here reaches. `detail()` reads them back, so leaving them made
    // a deleted assessment still legible from its neighbour's page.
    const inbound = await tx.select({ analysisId: policyArtefacts.analysisId, id: policyArtefacts.id })
      .from(policyArtefacts)
      .where(and(eq(policyArtefacts.kind, 'cross_policy'), sql`${policyArtefacts.data} ->> 'otherAnalysisId' = ${id}`));
    for (const row of inbound) {
      await tx.delete(policyProvenance).where(and(eq(policyProvenance.analysisId, row.analysisId), eq(policyProvenance.toId, row.id)));
      await tx.delete(policyProvenance).where(and(eq(policyProvenance.analysisId, row.analysisId), eq(policyProvenance.fromId, row.id)));
      await tx.delete(policyArtefacts).where(and(eq(policyArtefacts.analysisId, row.analysisId), eq(policyArtefacts.id, row.id)));
    }
    await tx.update(policyAnalyses).set({ cancelledAt: new Date(), status: 'cancelled' }).where(eq(policyAnalyses.id, id));
    await tx.delete(policyAnalyses).where(eq(policyAnalyses.id, id));
    // The queue envelopes were only CANCELLED above so the cascade could not race
    // a worker; with the analysis gone they are orphans naming a run that no
    // longer exists. `policy_stages.run_id` has no cascade, which is why they
    // survived every delete this feature has ever done.
    if (runIds.length) await tx.delete(workflowRuns).where(inArray(workflowRuns.id, runIds));
    await recountSightings(tx, contributed);
    return true;
  });
}

/**
 * PURGE A SEALED RUN: destroy the key, then delete the rows.
 *
 * THE ORDER IS THE WHOLE POINT AND IT IS NOT SYMMETRIC. Shredding first and
 * failing to delete leaves rows nobody can read — recoverable by retrying, and
 * the guarantee already holds. Deleting first and failing to shred leaves
 * ciphertext in fourteen nightly dumps and every restic snapshot beside them,
 * with a live key sitting on the same disk. One of those is an inconvenience and
 * the other is the failure this feature exists to prevent.
 *
 * Returns the analysis's identity for the receipt, because after this it cannot
 * be looked up again.
 */
export async function purge(owner: string, id: string): Promise<{ id: string; sealed: boolean; keyDestroyed: boolean } | null> {
  const analysis = await ownedAnalysis(owner, id);
  if (!analysis) return null;
  const keyDestroyed = analysis.sealed ? await shredKey(id) : false;
  const removed = await remove(owner, id);
  if (!removed) return null;
  return { id, sealed: !!analysis.sealed, keyDestroyed };
}
