import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params, url }) => {
  const action = url.searchParams.get('action');

  if (action === 'accept') {
    const [updated] = await db
      .update(intelEntities)
      .set({ confirmed: true, updatedAt: new Date() })
      .where(eq(intelEntities.id, params.id))
      .returning();
    if (!updated) return json({ error: 'Not found' }, { status: 404 });
    return json(updated);
  }

  if (action === 'reject') {
    await db.delete(intelEntities).where(eq(intelEntities.id, params.id));
    return json({ deleted: true });
  }

  if (action === 'delete-type') {
    await db.delete(intelEntityTypes).where(eq(intelEntityTypes.id, params.id));
    return json({ deleted: true });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
};
