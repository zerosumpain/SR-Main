import { db } from '$lib/db';
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

/**
 * Record a workflow audit event. Never throws — audit-log write failures
 * are logged and swallowed so mutation paths never break.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(workflowAuditLog).values({
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
    console.error('[audit] failed to record', input, err);
  }
}

/** Convenience wrapper: record many in one insert. */
export async function recordAuditBatch(entries: AuditInput[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.insert(workflowAuditLog).values(
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
    console.error('[audit] failed to record batch', entries, err);
  }
}
