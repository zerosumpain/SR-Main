import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { withNativeAccess } from '$lib/server/native-handler';
import { db } from '$lib/db';
import { routeGift } from '$lib/db/schema';

/** DELETE /api/native/route-gifts/[id] — the recipient puts a sent route away. */
export const DELETE: RequestHandler = withNativeAccess('any', async ({ params }, identity) => {
  const rows = await db
    .update(routeGift)
    .set({ dismissedAt: new Date() })
    .where(and(eq(routeGift.id, params.id), eq(routeGift.toEmail, identity.ownerEmail.trim().toLowerCase())))
    .returning({ id: routeGift.id });
  if (!rows.length) return json({ error: 'No such route.' }, { status: 404 });
  return { ok: true };
});
