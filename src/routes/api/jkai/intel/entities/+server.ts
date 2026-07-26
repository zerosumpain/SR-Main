// The entities index API: one filtered/sorted/paginated read, plus the bulk
// writes the index needs to be more than a viewer.
//
// GET still honours the old `typeId` / `limit` / `offset` params — jkai's
// toolchain calls this endpoint — and `parseEntityQuery` folds them into the
// richer query rather than keeping two code paths.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEntityTypes } from '$lib/jkai/intel/queries';
import { parseEntityQuery, queryEntityPage } from '$lib/jkai/intel/entity-query';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { invalidateGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { mergeEntities } from '$lib/jkai/intel/resolve/merge';

export const GET: RequestHandler = async ({ url }) => {
  const query = parseEntityQuery(url.searchParams);
  const [result, types] = await Promise.all([queryEntityPage(query), listEntityTypes()]);
  return json({ ...result, types, query });
};

/** Bounds one request's blast radius; the UI can only select a page at a time. */
const MAX_BULK_IDS = 500;

function readIds(body: Record<string, unknown>): string[] {
  const raw = Array.isArray(body.entityIds) ? body.entityIds : [];
  const ids = [...new Set(raw.map(String).filter(Boolean))];
  if (!ids.length) throw error(400, 'entityIds is required');
  if (ids.length > MAX_BULK_IDS) throw error(400, `at most ${MAX_BULK_IDS} entities per request`);
  return ids;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  // Merge takes an ordered pair rather than a set — which entity survives is
  // the whole decision, so it cannot be inferred from a selection.
  if (action === 'merge') {
    const keepId = String(body.keepId ?? '');
    const mergeId = String(body.mergeId ?? '');
    if (!keepId || !mergeId) throw error(400, 'keepId and mergeId are required');
    try {
      return json({ ok: true, result: await mergeEntities(keepId, mergeId, { method: 'manual' }) });
    } catch (err) {
      throw error(400, err instanceof Error ? err.message : 'merge failed');
    }
  }

  const ids = readIds(body);

  if (action === 'confirm' || action === 'unconfirm') {
    const updated = await db
      .update(intelEntities)
      .set({ confirmed: action === 'confirm', updatedAt: new Date() })
      .where(inArray(intelEntities.id, ids))
      .returning({ id: intelEntities.id });
    return json({ ok: true, affected: updated.length });
  }

  if (action === 'watch' || action === 'unwatch') {
    const updated = await db
      .update(intelEntities)
      .set({ watched: action === 'watch', updatedAt: new Date() })
      .where(inArray(intelEntities.id, ids))
      .returning({ id: intelEntities.id });
    return json({ ok: true, affected: updated.length });
  }

  if (action === 'lens') {
    // Empty string clears the lens rather than being rejected — "no lens" has
    // to be reachable from the same control that sets one.
    const raw = typeof body.lens === 'string' ? body.lens.trim() : '';
    const updated = await db
      .update(intelEntities)
      .set({ lens: raw || null, updatedAt: new Date() })
      .where(inArray(intelEntities.id, ids))
      .returning({ id: intelEntities.id });
    return json({ ok: true, affected: updated.length });
  }

  if (action === 'retype') {
    const typeId = String(body.typeId ?? '');
    if (!typeId) throw error(400, 'typeId is required');
    const [type] = await db
      .select({ id: intelEntityTypes.id })
      .from(intelEntityTypes)
      .where(eq(intelEntityTypes.id, typeId))
      .limit(1);
    if (!type) throw error(400, `unknown type "${typeId}"`);

    const updated = await db
      .update(intelEntities)
      .set({ typeId, updatedAt: new Date() })
      .where(inArray(intelEntities.id, ids))
      .returning({ id: intelEntities.id });
    // Type drives the analytics colouring and the type-outlier insight.
    invalidateGraphAnalysis();
    return json({ ok: true, affected: updated.length });
  }

  if (action === 'delete') {
    const deleted = await db
      .delete(intelEntities)
      .where(inArray(intelEntities.id, ids))
      .returning({ id: intelEntities.id });
    invalidateGraphAnalysis();
    return json({ ok: true, affected: deleted.length });
  }

  throw error(400, `unknown action "${action}"`);
};
