import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { withNativeAccess } from '$lib/server/native-handler';
import { isOwnerEmail } from '$lib/server/access';
import { db } from '$lib/db';
import { routeGift } from '$lib/db/schema';
import { listMembers } from '$lib/home/presence/members';
import { isRouteId } from '$lib/server/native-routes';
import { sendRouteGift } from '$lib/home/presence/route-gifts';
import { isUpstreamNotFound } from '$lib/server/native-trails';

/**
 * GET  /api/native/route-gifts — routes sent to THIS phone's person, newest
 *      first; and, for the owner, who they can send to.
 * POST /api/native/route-gifts — `{ routeId, toSubject }`, the owner only.
 *
 * A member walks the owner's route this way: they cannot read the owner's
 * saved routes, so the route travels whole.
 */
export const GET: RequestHandler = withNativeAccess('any', async (_event, identity) => {
  const email = identity.ownerEmail.trim().toLowerCase();
  const rows = await db
    .select()
    .from(routeGift)
    .where(and(eq(routeGift.toEmail, email), isNull(routeGift.dismissedAt)))
    .orderBy(desc(routeGift.createdAt))
    .limit(20);
  const recipients = isOwnerEmail(email)
    ? (await listMembers())
        .filter((m) => m.email && m.email.toLowerCase() !== email)
        .map((m) => ({ subject: m.subject, name: m.displayName }))
    : [];
  return {
    gifts: rows.map((r) => ({ id: r.id, sentAt: r.createdAt.toISOString(), route: r.route })),
    recipients,
  };
});

export const POST: RequestHandler = withNativeAccess('any', async ({ request }, identity, role) => {
  if (role !== 'owner' || !isOwnerEmail(identity.ownerEmail)) {
    return json({ error: 'Only the owner can send a route.' }, { status: 403 });
  }
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (typeof b.routeId !== 'string' || !isRouteId(b.routeId)) return json({ error: 'No such route.' }, { status: 404 });
  if (typeof b.toSubject !== 'string' || !b.toSubject) return json({ error: 'Send it to whom?' }, { status: 400 });
  try {
    const sent = await sendRouteGift(b.routeId, b.toSubject);
    if ('error' in sent) return json({ error: sent.error }, { status: sent.status });
    return json(sent, { status: 201 });
  } catch (error) {
    if (isUpstreamNotFound(error)) return json({ error: 'No such route.' }, { status: 404 });
    console.error('[native] route gift failed', error);
    return json({ error: 'Health is not answering right now.' }, { status: 503 });
  }
});
