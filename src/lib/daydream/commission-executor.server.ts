import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { notifyOwner } from '$lib/server/notify';
import { invokeWorkflowRuntime } from '$lib/workflows/runtime-client';
import { createToolbox } from './think/tools';
import { DEFAULT_SUBJECT } from './types';
import { commissioningEnabled, sourceHash, thoughtSource } from './commission-service.server';
import { hash, recordEvent, rowFor, type CommissionRow } from './commission-store.server';
import type { EvidenceResult } from './commissioning';
import { describeSource, parseCardRef, sourceText } from './think/explain';
import { STORED_VERDICT, VERDICT_LIKELIHOOD, VERDICT_WORDS, reviewSummary, type RedTeamReview } from './red-team';
import { recordRuling } from './rulings.server';

const EXECUTION_WORKFLOW = 'daydream-commission-execution-v1';
const MAINTENANCE_WORKFLOW = 'daydream-commission-maintenance-v1';

/** Persistent outbox recovery runs from the existing Workflows scheduler. */
export async function flushCommissionOutbox(): Promise<{ delivered: number }> {
  if (!commissioningEnabled()) return { delivered: 0 };
  return db.transaction(async tx => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('daydream-commission-outbox')) AS held`);
    if (!lock.rows[0]?.held) return { delivered: 0 };
    const pending = await tx.execute(sql`SELECT * FROM daydream_commission_outbox
      WHERE delivered_at IS NULL AND available_at<=now() ORDER BY available_at,id LIMIT 12 FOR UPDATE SKIP LOCKED`);
    let delivered = 0;
    for (const item of pending.rows) {
      const payload = item.payload as Record<string, unknown>;
      try {
        const commission = await rowFor(String(item.commission_id), 'owner', tx, true);
        if (item.kind === 'notification') {
          const result = await notifyOwner({ eventId: String(item.event_id), category: 'daydream',
            dedupeKey: `daydream-commission:${item.event_id}`,
            title: String(payload.title), body: String(payload.body), url: String(payload.url),
            data: { schemaVersion: 1, destination: 'daydream_commission', commissionId: commission.id,
              eventId: item.event_id, thoughtId: commission.thought_id, milestone: payload.milestone, revision: payload.revision } });
          if (!result.id) throw new Error('Notification projection unavailable.');
        } else if (commission.state === 'queued' && commission.generation === payload.generation && commission.spec_hash === payload.specHash && commission.approved_at) {
          const run = await invokeWorkflowRuntime<{ runId: string }>({ action: 'commission_enqueue', ...payload });
          await tx.execute(sql`UPDATE daydream_commissions SET workflow_run_id=${run.runId},updated_at=now() WHERE id=${commission.id}::uuid`);
          await recordEvent(tx, commission, 'workflow.queued', 'Handed to the workflow runner', 'dispatcher', { runId: run.runId, generation: commission.generation });
        }
        await tx.execute(sql`UPDATE daydream_commission_outbox SET delivered_at=now(),last_error=NULL WHERE id=${item.id}::uuid`);
        delivered++;
      } catch {
        // Keep secrets/provider errors out of the product ledger.
        await tx.execute(sql`UPDATE daydream_commission_outbox SET attempts=attempts+1,
          available_at=now()+interval '30 seconds'*least(120,power(2,least(attempts,7))),
          last_error='Delivery service unavailable; retry scheduled.' WHERE id=${item.id}::uuid`);
      }
    }
    return { delivered };
  });
}

interface RuntimeContext { commissionId: string; generation: number; specHash: string }
async function trustedRun(runId: string, operation: string): Promise<RuntimeContext | null> {
  const workflow = operation === 'maintenance' ? MAINTENANCE_WORKFLOW : EXECUTION_WORKFLOW;
  const found = await db.execute(sql`SELECT r.input_data,v.definition FROM workflow_runs r
    JOIN workflow_versions v ON v.id=r.version_id AND v.workflow_id=r.workflow_id
    WHERE r.id=${runId} AND r.workflow_id=${workflow} AND r.status='running' AND r.mode='live'
      AND r.lease_expires_at>now()`);
  const run = found.rows[0];
  if (!run) throw new Error('No active, pinned commissioning run.');
  const definition = run.definition as { nodes?: Array<{ type?: string; config?: { operation?: string } }> };
  if (definition.nodes?.length !== 1 || definition.nodes[0].type !== 'daydream-commission' || definition.nodes[0].config?.operation !== operation) {
    throw new Error('The pinned workflow is not the commissioning adapter.');
  }
  if (operation === 'maintenance') return null;
  const envelope = run.input_data as { __srQueuedInputV1?: { context?: { commission?: RuntimeContext } } };
  const context = envelope?.__srQueuedInputV1?.context?.commission;
  if (!context || typeof context.commissionId !== 'string' || !Number.isInteger(context.generation) || typeof context.specHash !== 'string') throw new Error('Commission metadata is missing.');
  return context;
}

interface SecondLook { review: RedTeamReview | null; tokens: { prompt: number; completion: number }; error: string | null }

async function settle(row: CommissionRow, token: string, evidence: EvidenceResult[], failure: string | null, look: SecondLook | null = null) {
  return db.transaction(async tx => {
    const current = await rowFor(row.id, row.principal_id, tx, true);
    if (current.state !== 'running' || current.lease_token !== token || current.generation !== row.generation) return { revoked: true };
    const source = await thoughtSource(row.thought_id, tx);
    if (sourceHash(source) !== row.spec.sourceHash) failure = 'The note or your comment on it changed while this was running. Start a fresh double-check.';
    const missing = evidence.filter(e => e.status === 'unavailable').length;
    const reread = missing ? `Re-read ${evidence.length - missing} of ${evidence.length} sources; ${missing} could not be reached.` : `${evidence.length === 1 ? 'Re-read the source' : `Re-read all ${evidence.length} sources`}.`;
    const review = failure ? null : look?.review ?? null;
    // The verdict leads. Without one (the second look failed) the report says
    // so, and keeps the old honesty: a re-read alone verifies nothing.
    const summary = failure ?? (review
      ? `${reviewSummary(review)} ${reread}`
      : `${reread} The second look${look?.error ? ` did not finish (${look.error})` : ' did not run'}, so this does not confirm or rule out the note.`);
    const state = failure ? 'needs_attention' : 'completed';
    await tx.execute(sql`UPDATE daydream_commissions SET state=${state},revision=revision+1,
      result=${JSON.stringify({ summary, evidence, review })}::jsonb,last_error=${failure},lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${row.id}::uuid`);
    // The verdict onto the note, and a wrong one into memory as a lesson.
    if (review) await recordRuling(tx, {
      thoughtId: row.thought_id, verdict: STORED_VERDICT[review.verdict], likelihood: VERDICT_LIKELIHOOD[review.verdict],
      reasoning: review.reasoning, lesson: review.lesson, reviewer: review.model ?? 'double-check',
      sources: evidence.map(e => e.sourceRef), tokens: look?.tokens,
    });
    await recordEvent(tx, { ...current, revision: current.revision + 1 }, failure ? 'execution.blocked' : 'outcome.recorded',
      failure ? 'A double-check needs your attention' : review ? `Double-check: ${VERDICT_WORDS[review.verdict].toLowerCase()}` : 'Your double-check report is ready', 'workflow',
      { runId: current.workflow_run_id, available: evidence.length - missing, unavailable: missing, verdict: review?.verdict ?? null }, true);
    await tx.execute(sql`UPDATE datastore_records SET data=data || ${JSON.stringify({ commissioningState: state, updatedAt: new Date().toISOString() })}::jsonb,
      version=version+1,updated_at=now() WHERE key=${row.backlog_slug} AND collection_id=(SELECT id FROM datastore_collections WHERE slug='improvement_backlog')`);
    return { state, summary };
  });
}

async function executeCommission(context: RuntimeContext, runId: string) {
  const token = randomUUID();
  const row = await db.transaction(async tx => {
    const current = await rowFor(context.commissionId, 'owner', tx, true);
    if (current.spec_hash !== context.specHash || current.generation !== context.generation || !current.approved_at) return null;
    if (current.state === 'completed' || current.state === 'cancelled' || current.state === 'needs_attention') return null;
    if (current.state === 'running' && current.lease_until && current.lease_until.getTime() > Date.now()) throw new Error('Commission execution already leased.');
    if (!['queued', 'running'].includes(current.state)) return null;
    if (current.attempts >= current.spec.budget.maxAttempts) throw new Error('Approved attempts exhausted.');
    await tx.execute(sql`UPDATE daydream_commissions SET state='running',revision=revision+1,attempts=attempts+1,
      lease_token=${token}::uuid,lease_until=now()+interval '6 minutes',workflow_run_id=${runId},updated_at=now() WHERE id=${current.id}::uuid`);
    await recordEvent(tx, { ...current, revision: current.revision + 1 }, 'execution.started', 'Re-reading the sources', 'workflow', { runId });
    return current;
  });
  if (!row) return { skipped: true };
  const evidence: EvidenceResult[] = [];
  let failure: string | null = null;
  const deadline = Date.now() + row.spec.budget.maxWallSeconds * 1000;
  try {
    if (sourceHash(await thoughtSource(row.thought_id)) !== row.spec.sourceHash) throw new Error('Source changed');
    const now = new Date();
    const toolbox = createToolbox({ set: 'private', now, day: now.toISOString().slice(0, 10), subject: DEFAULT_SUBJECT });
    for (const read of row.spec.reads.slice(0, row.spec.budget.maxReads)) {
      const current = await rowFor(row.id, 'owner');
      if (current.generation !== row.generation || current.state !== 'running' || current.lease_token !== token) return { revoked: true };
      if (Date.now() >= deadline) throw new Error('Time budget exhausted');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        toolbox.call(read.tool, read.args),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Read timeout')), Math.min(45_000, deadline - Date.now())); }),
      ]).finally(() => clearTimeout(timer));
      const text = result.failed ? 'Source unavailable; no evidence was returned.' : result.card?.text ?? '';
      evidence.push({ sourceRef: read.sourceRef, tool: read.tool, retrievedAt: new Date().toISOString(), contentHash: hash(text), text,
        status: result.failed ? 'unavailable' : 'available', provenance: 'query_result' });
    }
  } catch {
    failure = 'The double-check could not finish within the limits you approved. What it did get is kept below; you can try again.';
  }
  // ── The second look: argue against the note (`red-team.ts`) ──
  // Its own failure never fails the check — the re-read stands, and the
  // report says the verdict is missing rather than inventing one.
  let look: SecondLook | null = null;
  if (!failure && evidence.some(e => e.status === 'available')) {
    look = { review: null, tokens: { prompt: 0, completion: 0 }, error: null };
    try {
      const current = await rowFor(row.id, 'owner');
      if (current.generation !== row.generation || current.state !== 'running' || current.lease_token !== token) return { revoked: true };
      const thought = await thoughtSource(row.thought_id);
      const { runRedTeam } = await import('./red-team.server');
      const run = await runRedTeam({
        note: {
          kind: String(thought.kind ?? ''), title: String(thought.title ?? ''),
          body: String(thought.narrative || thought.explanation || ''),
          ownerNote: typeof thought.note === 'string' ? thought.note : null,
          tools: row.spec.reads.map(r => r.tool),
        },
        sources: evidence.filter(e => e.status === 'available').map(e => ({
          label: sourceText(describeSource(e.tool, parseCardRef(e.sourceRef)?.args ?? {})), text: e.text,
        })),
        // Whatever the re-read left of the budget, but never less than enough
        // for one considered answer; the lease covers the overrun.
        timeoutMs: Math.max(45_000, deadline - Date.now()),
      });
      look.review = run.review;
      look.tokens = run.tokens;
    } catch (err) {
      look.error = /abort|timeout/i.test(err instanceof Error ? err.message : '') ? 'it ran out of time' : 'the model could not be reached';
    }
  }
  return settle(row, token, evidence, failure, look);
}

export async function reconcileCommissions(): Promise<void> {
  if (!commissioningEnabled()) return;
  await db.transaction(async tx => {
    const rows = await tx.execute(sql`SELECT c.* FROM daydream_commissions c WHERE
      (state='running' AND lease_until<now()) OR (state='deferred' AND deferred_until<=now()) OR
      (state='queued' AND workflow_run_id IS NOT NULL AND EXISTS
        (SELECT 1 FROM workflow_runs r WHERE r.id=c.workflow_run_id AND r.status IN ('failed','cancelled','completed')))
      ORDER BY updated_at LIMIT 20 FOR UPDATE OF c SKIP LOCKED`);
    for (const raw of rows.rows) {
      const row = raw as unknown as CommissionRow;
      const deferred = row.state === 'deferred';
      // A failure before the callback starts still consumes an attempt. A
      // running callback has already counted its attempt when taking its lease.
      const attempts = row.attempts + (row.state === 'queued' ? 1 : 0);
      const unchanged = deferred || sourceHash(await thoughtSource(row.thought_id, tx)) === row.spec.sourceHash;
      const retry = !deferred && unchanged && row.approved_at && attempts < row.spec.budget.maxAttempts;
      const state = deferred ? 'awaiting_approval' : retry ? 'queued' : 'needs_attention';
      const generation = row.generation + 1;
      await tx.execute(sql`UPDATE daydream_commissions SET state=${state},revision=revision+1,generation=generation+1,
        lease_token=NULL,lease_until=NULL,deferred_until=NULL,workflow_run_id=NULL,attempts=${attempts},updated_at=now(),
        last_error=${state === 'needs_attention' ? 'It stopped retrying: either the note changed since you approved it, or it used all its tries.' : null} WHERE id=${row.id}::uuid`);
      const event = await recordEvent(tx, { ...row, revision: row.revision + 1 }, deferred ? 'approval.requested' : retry ? 'execution.recovery_queued' : 'execution.interrupted',
        deferred ? 'A double-check you put off is back for your OK' : retry ? 'The double-check was interrupted and is retrying on its own' : 'A double-check stopped and needs your attention',
        'reconciler', { previousRunId: row.workflow_run_id, generation, attempts }, true);
      if (retry) await tx.execute(sql`INSERT INTO daydream_commission_outbox(commission_id,event_id,kind,payload)
        VALUES (${row.id}::uuid,${event}::uuid,'dispatch',${JSON.stringify({ commissionId: row.id, generation, specHash: row.spec_hash })}::jsonb)`);
      await tx.execute(sql`UPDATE datastore_records SET data=data || ${JSON.stringify({ commissioningState: state })}::jsonb,
        version=version+1,updated_at=now() WHERE key=${row.backlog_slug} AND collection_id=(SELECT id FROM datastore_collections WHERE slug='improvement_backlog')`);
    }
  });
}

/** Called only through the authenticated internal runtime lane, never a model tool. */
export async function invokeCommissionOperation(args: Record<string, unknown>) {
  if (!commissioningEnabled()) return { success: false, error: 'Daydream commissioning is disabled.' };
  if (!['execute', 'maintenance'].includes(String(args.operation)) || typeof args.runId !== 'string' || args.runId.length > 120) return { success: false, error: 'Invalid commissioning operation.' };
  const context = await trustedRun(args.runId, String(args.operation));
  if (context) {
    const data = await executeCommission(context, args.runId);
    void flushCommissionOutbox().catch(() => {});
    return { success: true, data };
  }
  await reconcileCommissions();
  return { success: true, data: await flushCommissionOutbox() };
}
