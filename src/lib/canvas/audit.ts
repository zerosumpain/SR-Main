import { db, type DbExecutor } from '$lib/db';
import { workflowAuditLog } from '$lib/db/schema';
import { emitObs } from '$lib/workflows/observability-bus';

export type AuditEntity = 'workflow' | 'node' | 'edge' | 'trigger' | 'schedule';
export type AuditAction = 'create' | 'delete' | 'rename' | 'config' | 'update';

/**
 * `details.actor` for a "clear this workflow's remembered state" audit row.
 *
 * The Workflow Doctor reads this table to decide whether a human has touched a
 * canvas recently, and holds off its auto-fix if so. Clearing a memory key edits
 * no config — and someone clearing a dedupe key to debug a canvas is exactly who
 * wants the doctor to keep working — so the doctor excludes this actor from that
 * check (see `humanEditedRecently` in `$lib/workflowdoctor/fix`).
 */
export const MEMORY_CLEAR_ACTOR = 'memory-clear';

export interface AuditInput {
  workflowId: string;
  entity: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  details?: Record<string, unknown>;
}

interface AuditObsEvent {
  workflowId: string;
  entity: AuditEntity;
  action: AuditAction;
  at: string;
}

/**
 * Observability events raised inside somebody else's transaction, held until it
 * commits.
 *
 * `emitObs` pushes straight out to every open SSE listener, so emitting it from
 * inside a transaction tells the world an edit happened before it has landed —
 * and if a later op fails, the rows roll back but the announcement cannot be
 * taken back. This is the same hazard `applyAmendOps` already guards against
 * for `publishWorkflowUpdate`, applied to the observability bus.
 *
 * Keyed on the transaction handle and held weakly, so a transaction that throws
 * and is never flushed drops its queue with the handle rather than leaking it.
 */
const pendingObs = new WeakMap<object, AuditObsEvent[]>();

function queueObs(tx: DbExecutor | undefined, event: AuditObsEvent): void {
  if (!tx) {
    emitObs('audit.edit', event);
    return;
  }
  const queued = pendingObs.get(tx as object);
  if (queued) queued.push(event);
  else pendingObs.set(tx as object, [event]);
}

/** Emit everything recorded on `tx`. Call only once its transaction has COMMITTED. */
export function flushAuditObs(tx: DbExecutor): void {
  const queued = pendingObs.get(tx as object);
  if (!queued) return;
  pendingObs.delete(tx as object);
  for (const event of queued) emitObs('audit.edit', event);
}

/** Drop everything recorded on `tx` — its transaction rolled back, so nothing happened. */
export function discardAuditObs(tx: DbExecutor): void {
  pendingObs.delete(tx as object);
}

/**
 * Record a workflow audit event. Never throws when writing on the pool —
 * audit-log write failures are logged and swallowed so mutation paths never
 * break.
 *
 * Pass `tx` to write inside a caller's transaction. Then the failure DOES
 * propagate, and deliberately: a failed INSERT aborts the whole Postgres
 * transaction, so swallowing it would only defer the error to COMMIT, where it
 * surfaces as "current transaction is aborted" with nothing pointing at the
 * audit row. Rolling the caller back is the honest outcome — an edit that
 * cannot be recorded should not land. With `tx` the observability event is also
 * held back until the caller calls `flushAuditObs(tx)` after committing.
 */
export async function recordAudit(input: AuditInput, tx?: DbExecutor): Promise<void> {
  const conn = tx ?? db;
  try {
    await conn.insert(workflowAuditLog).values({
      workflowId: input.workflowId,
      entity: input.entity,
      entityId: input.entityId ?? null,
      action: input.action,
      details: input.details ?? {},
    });
    queueObs(tx, {
      workflowId: input.workflowId,
      entity: input.entity,
      action: input.action,
      at: new Date().toISOString(),
    });
  } catch (err) {
    if (tx) throw err;
    console.error('[audit] failed to record', input, err);
  }
}

/** Convenience wrapper: record many in one insert. `tx` behaves as above. */
export async function recordAuditBatch(entries: AuditInput[], tx?: DbExecutor): Promise<void> {
  if (entries.length === 0) return;
  const conn = tx ?? db;
  try {
    await conn.insert(workflowAuditLog).values(
      entries.map((e) => ({
        workflowId: e.workflowId,
        entity: e.entity,
        entityId: e.entityId ?? null,
        action: e.action,
        details: e.details ?? {},
      })),
    );
    const at = new Date().toISOString();
    for (const e of entries) {
      queueObs(tx, {
        workflowId: e.workflowId,
        entity: e.entity,
        action: e.action,
        at,
      });
    }
  } catch (err) {
    if (tx) throw err;
    console.error('[audit] failed to record batch', entries, err);
  }
}
