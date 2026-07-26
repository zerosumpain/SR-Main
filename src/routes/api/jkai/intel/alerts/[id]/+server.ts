import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Dismiss an alert, optionally with a reason.
 *
 * The reason matters: dismissals used to vanish, so nothing could learn that a
 * whole class of alert is unwanted. Accepting it here keeps the alerts page and
 * the triage inbox writing the same column rather than two half-features.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

  const [updated] = await db
    .update(intelAlerts)
    .set({ dismissed: true, ...(reason ? { dismissedReason: reason } : {}) })
    .where(eq(intelAlerts.id, params.id))
    .returning();

  if (!updated) return json({ error: 'Not found' }, { status: 404 });
  return json(updated);
};
