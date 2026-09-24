import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { isOwnerScope, spaceIn } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const POST: RequestHandler = async (event) => {
  const { params, url } = event;
  const action = url.searchParams.get('action');
  const scope = await resolveRequestScope(event);
  // The space predicate sits on the write itself: an entity outside the
  // reader's scope matches nothing and is a 404, never confirmed or deleted.
  const inScope = and(eq(intelEntities.id, params.id), spaceIn(intelEntities.spaceId, scope));

  if (action === 'accept') {
    const [updated] = await db
      .update(intelEntities)
      .set({ confirmed: true, updatedAt: new Date() })
      .where(inScope)
      .returning();
    if (!updated) return json({ error: 'Not found' }, { status: 404 });
    return json(updated);
  }

  if (action === 'reject') {
    const deleted = await db.delete(intelEntities).where(inScope).returning({ id: intelEntities.id });
    if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });
    return json({ deleted: true });
  }

  if (action === 'delete-type') {
    // The type vocabulary is shared by every space (spec §2), so deleting a
    // type changes everyone's graph. Only the owner's scope may do it; a
    // member's request must never remove a type the owner's entities use.
    if (!isOwnerScope(scope)) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }
    await db.delete(intelEntityTypes).where(eq(intelEntityTypes.id, params.id));
    return json({ deleted: true });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
};
