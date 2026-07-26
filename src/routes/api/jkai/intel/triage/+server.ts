// Single-decision endpoint for the triage inbox.
//
// Kept apart from the bulk endpoint on purpose: triage is one entity, one
// keystroke, one round-trip, and the client keeps its cursor while the request
// is in flight. Every action is therefore idempotent-ish and returns enough for
// the row to settle without a reload — no redirect, no invalidateAll, because
// re-running the page load is exactly what would throw the reviewer's place
// away mid-queue.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelAlerts, intelEntities, intelEntityTypes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { invalidateGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { mergeEntities } from '$lib/jkai/intel/resolve/merge';

/** Long enough to be a reason, short enough not to be an essay in a text column. */
const MAX_REASON_LENGTH = 500;

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  // Alert triage rides on the same endpoint so the inbox has one client helper.
  if (action === 'dismiss-alert') {
    const alertId = String(body.alertId ?? '');
    if (!alertId) throw error(400, 'alertId is required');
    const reason =
      typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : '';
    // The reason is the point: a dismissal with no stated cause teaches the
    // scoring nothing, so it is stored even when the UI sends the default.
    const [updated] = await db
      .update(intelAlerts)
      .set({ dismissed: true, dismissedReason: reason || null })
      .where(eq(intelAlerts.id, alertId))
      .returning({ id: intelAlerts.id, dismissedReason: intelAlerts.dismissedReason });
    if (!updated) throw error(404, 'alert not found');
    return json({ ok: true, alert: updated });
  }

  const entityId = String(body.entityId ?? '');
  if (!entityId) throw error(400, 'entityId is required');

  if (action === 'confirm' || action === 'unconfirm') {
    const [updated] = await db
      .update(intelEntities)
      .set({ confirmed: action === 'confirm', updatedAt: new Date() })
      .where(eq(intelEntities.id, entityId))
      .returning({ id: intelEntities.id, confirmed: intelEntities.confirmed });
    if (!updated) throw error(404, 'entity not found');
    return json({ ok: true, entity: updated });
  }

  if (action === 'watch' || action === 'unwatch') {
    const [updated] = await db
      .update(intelEntities)
      .set({ watched: action === 'watch', updatedAt: new Date() })
      .where(eq(intelEntities.id, entityId))
      .returning({ id: intelEntities.id, watched: intelEntities.watched });
    if (!updated) throw error(404, 'entity not found');
    return json({ ok: true, entity: updated });
  }

  if (action === 'retype') {
    const typeId = String(body.typeId ?? '');
    if (!typeId) throw error(400, 'typeId is required');
    const [type] = await db
      .select({ id: intelEntityTypes.id, name: intelEntityTypes.name, icon: intelEntityTypes.icon })
      .from(intelEntityTypes)
      .where(eq(intelEntityTypes.id, typeId))
      .limit(1);
    if (!type) throw error(400, `unknown type "${typeId}"`);

    const [updated] = await db
      .update(intelEntities)
      .set({ typeId, updatedAt: new Date() })
      .where(eq(intelEntities.id, entityId))
      .returning({ id: intelEntities.id, typeId: intelEntities.typeId });
    if (!updated) throw error(404, 'entity not found');
    invalidateGraphAnalysis();
    return json({ ok: true, entity: updated, type });
  }

  if (action === 'merge') {
    const keepId = String(body.keepId ?? '');
    if (!keepId) throw error(400, 'keepId is required');
    try {
      // The entity under review is always the loser: the survivor is the one
      // already in the graph with its edges and evidence attached.
      return json({ ok: true, result: await mergeEntities(keepId, entityId, { method: 'manual' }) });
    } catch (err) {
      throw error(400, err instanceof Error ? err.message : 'merge failed');
    }
  }

  if (action === 'reject') {
    const deleted = await db
      .delete(intelEntities)
      .where(eq(intelEntities.id, entityId))
      .returning({ id: intelEntities.id });
    if (!deleted.length) throw error(404, 'entity not found');
    invalidateGraphAnalysis();
    return json({ ok: true, deleted: true });
  }

  throw error(400, `unknown action "${action}"`);
};
