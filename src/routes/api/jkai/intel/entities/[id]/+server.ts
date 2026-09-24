import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntityDetail } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelEntities, intelAssertions } from '$lib/db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { canonicalName } from '$lib/jkai/intel/resolve/match';
import { spaceIn } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const GET: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const detail = await getEntityDetail(event.params.id, scope);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const PUT: RequestHandler = async (event) => {
  const { params, request } = event;
  const scope = await resolveRequestScope(event);
  const body = await request.json();
  if (body.properties !== undefined && body.properties !== null && (typeof body.properties !== 'object' || Array.isArray(body.properties))) return json({ error: 'Properties must be an object or null' }, { status: 400 });
  if (body.summary !== undefined && body.summary !== null && typeof body.summary !== 'string') return json({ error: 'Summary must be text or null' }, { status: 400 });
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
  const updated = await db.transaction(async tx => {
    // Scoped on the UPDATE: an entity outside the reader's scope matches no row,
    // so it is a 404 and none of the owner-edit claims below are written for it.
    const [row] = await tx.update(intelEntities).set(updates).where(and(eq(intelEntities.id, params.id), spaceIn(intelEntities.spaceId, scope))).returning();
    if (!row) return null;
    // Retain explicit owner edits independently of source-derived claims.
    const claims: Array<[string, unknown]> = [];
    if (body.summary !== undefined) claims.push(['$owner-summary', body.summary]);
    if (body.name !== undefined) claims.push(['$owner-name', body.name]);
    if (body.properties !== undefined) {
      await tx.delete(intelAssertions).where(and(eq(intelAssertions.entityId, params.id), isNull(intelAssertions.noteId), sql`${intelAssertions.predicate} NOT IN ('$owner-summary','$owner-name')`));
      for (const [key, value] of Object.entries(body.properties ?? {})) {
        if (!key.startsWith('$owner-') && !['__proto__', 'constructor', 'prototype'].includes(key)) claims.push([key, value]);
      }
      // An empty property set is also a deliberate owner edit.
      claims.push(['$owner-properties', body.properties ?? {}]);
    }
    for (const [predicate, value] of claims) {
      await tx.delete(intelAssertions).where(and(eq(intelAssertions.entityId, params.id), isNull(intelAssertions.noteId), eq(intelAssertions.predicate, predicate)));
      await tx.insert(intelAssertions).values({ entityId: params.id, predicate, value: sql`${JSON.stringify(value)}::jsonb`, status: 'accepted' });
    }
    return row;
  });
  if (!updated) return json({ error: 'Not found' }, { status: 404 });
  return json(updated);
};

export const DELETE: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const deleted = await db
    .delete(intelEntities)
    .where(and(eq(intelEntities.id, event.params.id), spaceIn(intelEntities.spaceId, scope)))
    .returning({ id: intelEntities.id });
  if (deleted.length === 0) return json({ error: 'Not found' }, { status: 404 });
  return json({ deleted: true });
};
