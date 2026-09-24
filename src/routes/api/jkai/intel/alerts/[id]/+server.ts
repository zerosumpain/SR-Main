import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { spaceIn } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

/**
 * Dismiss an alert, optionally with a reason.
 *
 * The reason matters: dismissals used to vanish, so nothing could learn that a
 * whole class of alert is unwanted. Accepting it here keeps the alerts page and
 * the triage inbox writing the same column rather than two half-features.
 *
 * An alert outside the reader's scope is not found: the space predicate is on
 * the UPDATE itself, so there is no read-then-write window to slip through.
 */
export const PUT: RequestHandler = async (event) => {
  const { params, request } = event;
  const scope = await resolveRequestScope(event);
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

  const [updated] = await db
    .update(intelAlerts)
    .set({ dismissed: true, ...(reason ? { dismissedReason: reason } : {}) })
    .where(and(eq(intelAlerts.id, params.id), spaceIn(intelAlerts.spaceId, scope)))
    .returning();

  if (!updated) return json({ error: 'Not found' }, { status: 404 });
  return json(updated);
};
