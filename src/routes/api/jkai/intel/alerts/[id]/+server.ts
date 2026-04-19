import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelAlerts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const PUT: RequestHandler = async ({ params }) => {
  const [updated] = await db
    .update(intelAlerts)
    .set({ dismissed: true })
    .where(eq(intelAlerts.id, params.id))
    .returning();

  if (!updated) return json({ error: 'Not found' }, { status: 404 });
  return json(updated);
};
