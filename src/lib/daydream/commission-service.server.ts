import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db, type DbExecutor } from '$lib/db';
import { DEFAULT_SUBJECT } from './types';
import { PRIVATE_TOOLS } from './think/tools';
import { decisionAllowed, sourceReads, type CommissionDecision, type ImprovementSpec } from './commissioning';
import { CommissionError, hash, loadCommission, recordEvent, rowFor, type CommissionRow } from './commission-store.server';

export function commissioningEnabled(): boolean { return env.DAYDREAM_COMMISSIONING === '1'; }
export function requireCommissioning(): void {
  if (!commissioningEnabled()) throw new CommissionError(503, 'Daydream commissioning is not enabled here yet.');
}
export async function thoughtSource(id: string, tx: DbExecutor = db) {
  const result = await tx.execute(sql`SELECT id,title,explanation,narrative,evidence,note,review_verdict,review_reasoning,status
    FROM daydream_thoughts WHERE id=${id} AND subject=${DEFAULT_SUBJECT}`);
  const row = result.rows[0];
  if (!row) throw new CommissionError(404, 'Suggestion not found.');
  return row;
}
export function sourceHash(row: Record<string, unknown>): string {
  return hash([row.id, row.title, row.explanation, row.narrative, row.evidence, row.note, row.review_verdict, row.review_reasoning]);
}

/** Bounded preparation: no model spend, reads or effects beyond proposal intake. */
export async function prepareCommission(thoughtId: string, principal = 'owner') {
  requireCommissioning();
  const thought = await thoughtSource(thoughtId);
  if (['archived', 'expired'].includes(String(thought.status))) throw new CommissionError(409, 'This suggestion is no longer current.');
  const reads = sourceReads(thought.evidence, PRIVATE_TOOLS);
  if (!reads.length) throw new CommissionError(422, 'This note has no private sources that can be re-read, so there is nothing to double-check.');
  // Plain words, because this IS the sign-off sheet: every field below is read
  // by the owner before he approves, on the web and on the phone.
  const spec: ImprovementSpec = {
    version: 1, route: 'evidence_refresh', title: `Double-check: ${String(thought.title).slice(0, 160)}`,
    outcome: 'jkai re-reads the sources this note was based on and gives you a dated report of what they say today.',
    currentBehaviour: String(thought.narrative || thought.explanation).slice(0, 8000),
    improvedBehaviour: 'You get the current figures side by side with the note, so you can decide whether it still holds before doing anything about it. It checks the sources again; it does not prove the claim or change anything.',
    reuseAssessment: ['Uses the same read-only look-ups the note used.', 'Runs on the existing workflow runner, so it carries on if you close the page.', 'Progress arrives in your usual notifications.'],
    acceptance: ['Every source comes back with today’s answer, or is clearly marked as unavailable.', 'The report keeps the original note and anything you added to it.', 'Nothing is sent, booked, paid, cancelled or changed.'],
    effects: ['Read the sources listed below again.', 'Save a private report here and notify you when it is ready.'],
    exclusions: ['It will not treat a receipt and a bank line as two separate payments.', 'No refunds, disputes, cancellations, account changes, new automations or builds.', 'Mail is read as extracted facts only — not as the original invoice.'],
    reads, sourceHash: sourceHash(thought), ownerCorrection: typeof thought.note === 'string' ? thought.note : null,
    budget: { maxReads: reads.length, maxAttempts: 3, maxWallSeconds: 180 },
  };
  const specHash = hash(spec);
  const id = await db.transaction(async tx => {
    // The same thought on web and phone resolves to one immutable proposal.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`commission:${principal}:${thoughtId}`}))`);
    const existing = await tx.execute(sql`SELECT id FROM daydream_commissions WHERE principal_id=${principal} AND thought_id=${thoughtId} AND spec_hash=${specHash}`);
    if (existing.rows[0]) return String(existing.rows[0].id);
    const active = await tx.execute(sql`SELECT id FROM daydream_commissions WHERE principal_id=${principal} AND thought_id=${thoughtId} AND state IN ('queued','running') LIMIT 1`);
    if (active.rows.length) throw new CommissionError(409, 'This suggestion already has approved work in progress.');
    const collection = await tx.execute(sql`SELECT id FROM datastore_collections WHERE slug='improvement_backlog'`);
    if (!collection.rows[0]) throw new CommissionError(503, 'The improvement backlog is not ready.');
    const commissionId = randomUUID();
    const backlogSlug = `daydream-${thoughtId}-${specHash.slice(0, 12)}`;
    const now = new Date().toISOString();
    const data = { slug: backlogSlug, title: spec.title, detail: `${spec.outcome}\n\n${spec.improvedBehaviour}`, kind: 'feature', status: 'open', priority: 3,
      attempts: 0, createdAt: now, updatedAt: now, source: 'think', commissionId, commissioningState: 'awaiting_approval',
      improvementSpec: spec, citations: [{ source: 'think', ref: `thought:${thoughtId}`, title: thought.title, at: now }] };
    // This owner-domain write composes intake with the envelope and its outbox.
    const record = await tx.execute(sql`INSERT INTO datastore_records(collection_id,key,data,created_by,updated_by)
      VALUES (${collection.rows[0].id}::uuid,${backlogSlug},${JSON.stringify(data)}::jsonb,'system','system') RETURNING id`);
    await tx.execute(sql`INSERT INTO datastore_audit_log(collection_id,record_id,actor,action,after)
      VALUES (${collection.rows[0].id}::uuid,${record.rows[0].id}::uuid,'system','insert',${JSON.stringify(data)}::jsonb)`);
    const inserted = await tx.execute(sql`INSERT INTO daydream_commissions(id,principal_id,thought_id,backlog_slug,spec_hash,spec)
      VALUES (${commissionId}::uuid,${principal},${thoughtId},${backlogSlug},${specHash},${JSON.stringify(spec)}::jsonb) RETURNING *`);
    const row = inserted.rows[0] as unknown as CommissionRow;
    const older = await tx.execute(sql`SELECT * FROM daydream_commissions WHERE principal_id=${principal}
      AND thought_id=${thoughtId} AND id<>${commissionId}::uuid AND state IN ('awaiting_approval','deferred','needs_attention') FOR UPDATE`);
    for (const raw of older.rows) {
      const previous = raw as unknown as CommissionRow;
      await tx.execute(sql`UPDATE daydream_commissions SET state='cancelled',revision=revision+1,generation=generation+1,
        updated_at=now() WHERE id=${previous.id}::uuid`);
      await recordEvent(tx, previous, 'proposal.superseded', 'Replaced by a new double-check that includes your note', principal, { replacementId: commissionId });
      await tx.execute(sql`UPDATE datastore_records SET data=data || ${JSON.stringify({ commissioningState: 'cancelled', supersededBy: commissionId })}::jsonb,
        version=version+1,updated_at=now() WHERE key=${previous.backlog_slug} AND collection_id=${collection.rows[0].id}::uuid`);
    }
    await recordEvent(tx, row, 'proposal.prepared', 'Double-check prepared', principal, { sourceHash: spec.sourceHash, backlogSlug });
    await recordEvent(tx, row, 'approval.requested', 'A double-check is waiting for your OK', 'planner', { specHash }, true);
    return commissionId;
  });
  return loadCommission(id, principal);
}

export async function decideCommission(id: string, input: { decision: CommissionDecision; revision: number; specHash: string; operationKey: string }, principal = 'owner') {
  requireCommissioning();
  const inputHash = hash({ id, ...input });
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`commission-command:${principal}:${input.operationKey}`}))`);
    const receipt = await tx.execute(sql`SELECT input_hash FROM daydream_commission_commands WHERE principal_id=${principal} AND operation_key=${input.operationKey}`);
    if (receipt.rows[0]) {
      if (receipt.rows[0].input_hash !== inputHash) throw new CommissionError(409, 'This request key was used for a different decision.');
      return;
    }
    const row = await rowFor(id, principal, tx, true);
    if (row.revision !== input.revision || row.spec_hash !== input.specHash) throw new CommissionError(409, 'This proposal changed. Review the latest version.');
    if (!decisionAllowed(row.state, input.decision)) throw new CommissionError(409, 'That decision no longer applies.');
    const execute = input.decision === 'approve' || input.decision === 'retry';
    if (execute) {
      const thought = await thoughtSource(row.thought_id, tx);
      if (sourceHash(thought) !== row.spec.sourceHash) throw new CommissionError(409, 'The evidence or your correction changed. Prepare and review a fresh proposal.');
      if (row.attempts >= row.spec.budget.maxAttempts) throw new CommissionError(409, 'This proposal has exhausted its approved attempts. A revised proposal is required.');
    }
    const state = execute ? 'queued' : input.decision === 'defer' ? 'deferred' : input.decision === 'decline' ? 'declined' : 'cancelled';
    const revision = row.revision + 1;
    const generation = row.generation + 1;
    await tx.execute(sql`UPDATE daydream_commissions SET state=${state},revision=${revision},generation=${generation},
      approved_at=CASE WHEN ${execute} THEN coalesce(approved_at,now()) ELSE approved_at END,
      approved_by=CASE WHEN ${execute} THEN coalesce(approved_by,${principal}) ELSE approved_by END,
      deferred_until=CASE WHEN ${state === 'deferred'} THEN now()+interval '7 days' ELSE NULL END,
      lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=${id}::uuid`);
    const event = await recordEvent(tx, { ...row, revision }, `proposal.${input.decision}`, execute ? 'Approved — the double-check is queued' : state === 'deferred' ? 'Put off for seven days' : state === 'declined' ? 'Declined' : 'Cancelled', principal, { specHash: row.spec_hash, generation }, execute);
    if (execute) await tx.execute(sql`INSERT INTO daydream_commission_outbox(commission_id,event_id,kind,payload)
      VALUES (${id}::uuid,${event}::uuid,'dispatch',${JSON.stringify({ commissionId: id, generation, specHash: row.spec_hash })}::jsonb)`);
    await tx.execute(sql`UPDATE datastore_records SET data=data || ${JSON.stringify({ commissioningState: state, updatedAt: new Date().toISOString() })}::jsonb,
      version=version+1,updated_at=now() WHERE key=${row.backlog_slug} AND collection_id=(SELECT id FROM datastore_collections WHERE slug='improvement_backlog')`);
    await tx.execute(sql`INSERT INTO daydream_commission_commands(principal_id,operation_key,commission_id,input_hash)
      VALUES (${principal},${input.operationKey},${id}::uuid,${inputHash})`);
  });
  return loadCommission(id, principal);
}
