import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { summarizeStoreValue } from '$lib/workflows/data-store-summary';

/**
 * List the keys currently held in the workflow-scoped data store, each with a
 * bounded value preview + metadata. Two consumers:
 *   - the data-store / dedupe node panels' `<StoreKeyPicker>` (reads `key` +
 *     `meta` — preserved for backwards compatibility);
 *   - the canvas Memory panel (E3) — reads `value`/`truncated`/`itemCount`/
 *     `updatedAt` to render remembered state at a glance.
 *
 * Auth: owner-only, enforced by the API owner-gate in hooks.server.ts (the same
 * gate the sibling `[id]` routes rely on) — no in-handler ownership check.
 */
export const GET: RequestHandler = async ({ params }) => {
  const workflowId = params.id;
  if (!workflowId) return json({ error: 'workflowId required' }, { status: 400 });
  const rows = await db
    .select({
      key: workflowDataStore.key,
      value: workflowDataStore.value,
      updatedAt: workflowDataStore.updatedAt,
    })
    .from(workflowDataStore)
    .where(eq(workflowDataStore.workflowId, workflowId));
  return json({
    keys: rows.map((r) => {
      const summary = summarizeStoreValue(r.value);
      const updatedAt = r.updatedAt ? new Date(r.updatedAt).toISOString() : null;
      return {
        key: r.key,
        value: summary.value,
        truncated: summary.truncated,
        itemCount: summary.itemCount,
        updatedAt,
        // Backwards-compat: <StoreKeyPicker> renders `meta` as a per-key hint.
        meta: updatedAt ? `updated ${updatedAt.slice(0, 10)}` : undefined,
      };
    }),
  });
};
