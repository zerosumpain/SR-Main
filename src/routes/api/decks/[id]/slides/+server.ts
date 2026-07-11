// Owner-only slide creation (hook-gated like all /api/*). POST appends a
// slide to a plane (root or a parent slide) at the given position, shifting
// later siblings down.

import { json } from '@sveltejs/kit';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { isLayout } from '$lib/presentation/layouts';
import { validateBlocks } from '$lib/presentation/registry';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  let body: {
    parentSlideId?: unknown;
    position?: unknown;
    title?: unknown;
    layout?: unknown;
    blocks?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const [deck] = await db.select({ id: decks.id }).from(decks).where(eq(decks.id, params.id));
  if (!deck) return json({ error: 'Unknown deck' }, { status: 404 });

  const parentSlideId = typeof body.parentSlideId === 'string' ? body.parentSlideId : null;
  if (parentSlideId) {
    const [parent] = await db
      .select({ id: deckSlides.id })
      .from(deckSlides)
      .where(and(eq(deckSlides.id, parentSlideId), eq(deckSlides.deckId, params.id)));
    if (!parent) return json({ error: 'parentSlideId is not a slide of this deck' }, { status: 400 });
  }

  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  if (blocks.length) {
    const res = validateBlocks(blocks);
    if (!res.ok) return json({ error: 'blocks failed validation', issues: res.issues }, { status: 400 });
  }

  const position = typeof body.position === 'number' && Number.isInteger(body.position) && body.position >= 0 ? body.position : 0;
  const planeCond = parentSlideId ? eq(deckSlides.parentSlideId, parentSlideId) : isNull(deckSlides.parentSlideId);

  // Shift later siblings, then insert into the gap.
  await db
    .update(deckSlides)
    .set({ position: sql`${deckSlides.position} + 1` })
    .where(and(eq(deckSlides.deckId, params.id), planeCond, gte(deckSlides.position, position)));
  const [row] = await db
    .insert(deckSlides)
    .values({
      deckId: params.id,
      parentSlideId,
      position,
      title: typeof body.title === 'string' ? body.title.slice(0, 120) : null,
      layout: isLayout(body.layout) ? body.layout : 'default',
      blocks,
    })
    .returning();
  await db.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, params.id));
  return json({ ok: true, slide: row });
};
