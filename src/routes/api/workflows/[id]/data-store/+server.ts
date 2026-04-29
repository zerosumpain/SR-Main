import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * List the keys currently held in the workflow-scoped data store.
 * Used by the data-store node panel's `<StoreKeyPicker>` to populate
 * the dropdown of existing keys.
 */
export const GET: RequestHandler = async ({ params }) => {
  const workflowId = params.id;
  if (!workflowId) return json({ error: 'workflowId required' }, { status: 400 });
  const rows = await db
    .select({ key: workflowDataStore.key, updatedAt: workflowDataStore.updatedAt })
    .from(workflowDataStore)
    .where(eq(workflowDataStore.workflowId, workflowId));
  return json({
    keys: rows.map((r) => ({
      key: r.key,
      meta: r.updatedAt ? `updated ${new Date(r.updatedAt).toISOString().slice(0, 10)}` : undefined,
    })),
  });
};
