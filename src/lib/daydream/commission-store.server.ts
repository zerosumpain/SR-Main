import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { commissionPath, nextActor, type CommissionView, type ImprovementSpec } from './commissioning';

export class CommissionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export interface CommissionRow {
  id: string; principal_id: string; thought_id: string; backlog_slug: string;
  state: CommissionView['state']; revision: number; spec_hash: string; spec: ImprovementSpec;
  approved_at: Date | null; approved_by: string | null; attempts: number; generation: number;
  workflow_run_id: string | null; result: CommissionView['result']; last_error: string | null;
  lease_token: string | null; lease_until: Date | null; updated_at: Date;
}
export async function rowFor(id: string, principal: string, tx: DbExecutor = db, lock = false): Promise<CommissionRow> {
  if (!/^[\da-f-]{36}$/i.test(id)) throw new CommissionError(404, 'Improvement not found.');
  const result = await tx.execute(sql`SELECT * FROM daydream_commissions WHERE id=${id}::uuid AND principal_id=${principal} ${lock ? sql`FOR UPDATE` : sql``}`);
  const row = result.rows[0] as unknown as CommissionRow | undefined;
  if (!row) throw new CommissionError(404, 'Improvement not found.');
  // Raw SQL bypasses Drizzle's timestamp decoder.
  return { ...row, updated_at: new Date(row.updated_at),
    approved_at: row.approved_at ? new Date(row.approved_at) : null,
    lease_until: row.lease_until ? new Date(row.lease_until) : null };
}
export async function recordEvent(tx: DbExecutor, row: CommissionRow, kind: string, summary: string, actor: string,
  data: Record<string, unknown> = {}, notification = false): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`INSERT INTO daydream_commission_events(id,commission_id,sequence,kind,actor,summary,data)
    SELECT ${id}::uuid,${row.id}::uuid,coalesce(max(sequence),0)+1,${kind},${actor},${summary},${JSON.stringify(data)}::jsonb
    FROM daydream_commission_events WHERE commission_id=${row.id}::uuid`);
  if (notification) await tx.execute(sql`INSERT INTO daydream_commission_outbox(commission_id,event_id,kind,payload)
    VALUES (${row.id}::uuid,${id}::uuid,'notification',${JSON.stringify({ title: summary, body: row.spec.title, url: commissionPath(row.id), revision: row.revision, milestone: kind, thoughtId: row.thought_id })}::jsonb)`);
  return id;
}
export async function loadCommission(id: string, principal = 'owner'): Promise<CommissionView> {
  const row = await rowFor(id, principal);
  const events = await db.execute(sql`SELECT id,sequence,kind,summary,data,created_at FROM daydream_commission_events
    WHERE commission_id=${row.id}::uuid ORDER BY sequence`);
  return {
    id: row.id, thoughtId: row.thought_id, backlogSlug: row.backlog_slug, state: row.state, revision: row.revision,
    specHash: row.spec_hash, spec: row.spec, approvedAt: row.approved_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(), nextActor: nextActor(row.state), workflowRunId: row.workflow_run_id,
    result: row.result, error: row.last_error, url: commissionPath(row.id),
    events: events.rows.map(e => ({ id: String(e.id), sequence: Number(e.sequence), kind: String(e.kind),
      summary: String(e.summary), data: e.data as Record<string, unknown>, at: new Date(e.created_at as string).toISOString() })),
  };
}
export async function listCommissions(principal = 'owner'): Promise<CommissionView[]> {
  const result = await db.execute(sql`SELECT id FROM daydream_commissions WHERE principal_id=${principal} ORDER BY updated_at DESC LIMIT 100`);
  // Bounded reads; keep pool space for the workflow callbacks and decisions.
  const output: CommissionView[] = [];
  for (const row of result.rows) output.push(await loadCommission(String(row.id), principal));
  return output;
}
