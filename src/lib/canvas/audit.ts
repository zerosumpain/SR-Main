import { db, type DbExecutor } from '$lib/db';
import { workflowAuditLog } from '$lib/db/schema';
import { emitObs } from '$lib/workflows/observability-bus';

export type AuditEntity = 'workflow' | 'node' | 'edge' | 'trigger' | 'schedule';
export type AuditAction = 'create' | 'delete' | 'rename' | 'config' | 'update';

export interface AuditInput {
  workflowId: string;
  entity: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  details?: Record<string, unknown>;
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
 * cannot be recorded should not land.
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
    emitObs('audit.edit', {
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
      emitObs('audit.edit', {
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
