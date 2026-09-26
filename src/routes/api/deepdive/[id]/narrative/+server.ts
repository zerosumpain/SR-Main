import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { facts, narrativeItems } from '$lib/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireResearchSession } from '$lib/deepdive/session-access.server';

export const GET: RequestHandler = async (event) => {
  const { params } = event;
  await requireResearchSession(event, params.id, 'read');
  const items = await db
    .select()
    .from(narrativeItems)
    .where(eq(narrativeItems.sessionId, params.id))
    .orderBy(asc(narrativeItems.sortOrder));

  return json(items);
};

export const POST: RequestHandler = async (event) => {
  const { params, request } = event;
  await requireResearchSession(event, params.id, 'write');
  const body = await request.json();
  const items = body.items as { factId: string | null; annotation: string | null; sortOrder: number }[];

  if (!Array.isArray(items)) {
    return json({ error: 'items array required' }, { status: 400 });
  }

  // A narrative item may cite only this run's facts: an id from another run
  // would print that run's fact in this one's export.
  const cited = [...new Set(items.map((i) => i.factId).filter((f): f is string => typeof f === 'string' && !!f))];
  const own = cited.length
    ? new Set(
        (await db.select({ id: facts.id }).from(facts).where(and(eq(facts.sessionId, params.id), inArray(facts.id, cited)))).map(
          (r) => r.id,
        ),
      )
    : new Set<string>();

  // Full replace: delete existing, insert new
  await db.delete(narrativeItems).where(eq(narrativeItems.sessionId, params.id));

  if (items.length > 0) {
    await db.insert(narrativeItems).values(
      items.map((item, i) => ({
        sessionId: params.id,
        factId: item.factId && own.has(item.factId) ? item.factId : null,
        sortOrder: item.sortOrder ?? i,
        annotation: item.annotation || null,
      })),
    );
  }

  return json({ ok: true });
};
