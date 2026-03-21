import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { narrativeItems } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const items = await db
    .select()
    .from(narrativeItems)
    .where(eq(narrativeItems.sessionId, params.id))
    .orderBy(asc(narrativeItems.sortOrder));

  return json(items);
};

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const items = body.items as { factId: string | null; annotation: string | null; sortOrder: number }[];

  if (!Array.isArray(items)) {
    return json({ error: 'items array required' }, { status: 400 });
  }

  // Full replace: delete existing, insert new
  await db.delete(narrativeItems).where(eq(narrativeItems.sessionId, params.id));

  if (items.length > 0) {
    await db.insert(narrativeItems).values(
      items.map((item, i) => ({
        sessionId: params.id,
        factId: item.factId || null,
        sortOrder: item.sortOrder ?? i,
        annotation: item.annotation || null,
      })),
    );
  }

  return json({ ok: true });
};
