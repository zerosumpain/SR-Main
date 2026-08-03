import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { recordAudit } from '$lib/canvas/audit';

/**
 * Clear a single key from a workflow's data store — the per-key "Clear" action
 * in the canvas Memory panel (E3) and in each stateful node's inspector
 * (`<NodeMemoryBlock>`). Scoped to `(workflowId, key)` so it can only touch
 * this workflow's memory.
 *
 * Reports how many rows went, so the UI can say "nothing to clear" instead of
 * falsely reporting success, and writes an audit entry — which means the
 * pre-existing canvas Memory panel's Clear is now audited too.
 *
 * Auth: owner-only, enforced by the API owner-gate in hooks.server.ts (same as
 * the sibling `[id]` routes) — no in-handler ownership check.
 */
export const DELETE: RequestHandler = async ({ params }) => {
  const workflowId = params.id;
  const key = params.key;
  if (!workflowId || !key) {
    return json({ error: 'workflowId and key required' }, { status: 400 });
  }
  const deleted = await db
    .delete(workflowDataStore)
    .where(and(eq(workflowDataStore.workflowId, workflowId), eq(workflowDataStore.key, key)))
    .returning({ key: workflowDataStore.key });
  await recordAudit({
    workflowId,
    entity: 'workflow',
    action: 'update',
    details: { clearedMemoryKey: key, deleted: deleted.length },
  });
  return json({ success: true, deleted: deleted.length });
};
