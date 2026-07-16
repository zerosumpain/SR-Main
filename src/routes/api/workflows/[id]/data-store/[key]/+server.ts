import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Clear a single key from a workflow's data store — the per-key "Clear" action
 * in the canvas Memory panel (E3). Scoped to `(workflowId, key)` so it can only
 * touch this workflow's memory.
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
  await db
    .delete(workflowDataStore)
    .where(and(eq(workflowDataStore.workflowId, workflowId), eq(workflowDataStore.key, key)));
  return json({ success: true });
};
