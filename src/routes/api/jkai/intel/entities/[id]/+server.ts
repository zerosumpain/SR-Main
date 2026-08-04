import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntityDetail } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelEntities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { canonicalName } from '$lib/jkai/intel/resolve/match';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await getEntityDetail(params.id);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    updates.name = body.name;
    // Derived from the name, so it has to move WITH the name. A stale canonical
    // form is worse than none: write-time resolution would keep binding new
    // mentions of the old name onto this entity.
    updates.canonicalName = canonicalName(String(body.name)) || null;
  }
  if (body.confirmed !== undefined) updates.confirmed = body.confirmed;
  if (body.properties !== undefined) updates.properties = body.properties;
  if (body.summary !== undefined) updates.summary = body.summary;
  const [updated] = await db
    .update(intelEntities)
    .set(updates)
    .where(eq(intelEntities.id, params.id))
    .returning();
  if (!updated) return json({ error: 'Not found' }, { status: 404 });
  return json(updated);
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(intelEntities).where(eq(intelEntities.id, params.id));
  return json({ deleted: true });
};
