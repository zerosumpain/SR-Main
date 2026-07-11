// Owner-only "compose a slide from raw content" (hook-gated like all
// /api/decks). The art director (LLM via gateway, heuristic fallback) decides
// layout + blocks; the composed slide is inserted like a normal slide POST.

import { json } from '@sveltejs/kit';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { composeSlide } from '$lib/decks/composer.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  let body: { text?: unknown; mediaUrls?: unknown; parentSlideId?: unknown; position?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const [deck] = await db.select().from(decks).where(eq(decks.id, params.id));
  if (!deck) return json({ error: 'Unknown deck' }, { status: 404 });

  const text = typeof body.text === 'string' ? body.text : '';
  const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls.filter((u): u is string => typeof u === 'string') : [];
  if (!text.trim() && mediaUrls.length === 0) {
    return json({ error: 'Provide text and/or mediaUrls' }, { status: 400 });
  }
  if (text.length > 8000) return json({ error: 'Text too long (max 8000 chars) — one slide at a time' }, { status: 400 });

  const parentSlideId = typeof body.parentSlideId === 'string' && body.parentSlideId ? body.parentSlideId : null;
  if (parentSlideId) {
    const [parent] = await db
      .select({ id: deckSlides.id })
      .from(deckSlides)
      .where(and(eq(deckSlides.id, parentSlideId), eq(deckSlides.deckId, params.id)));
    if (!parent) return json({ error: 'parentSlideId is not a slide of this deck' }, { status: 400 });
  }

  // Rhythm context: layouts adjacent in the target plane.
  const planeCond = parentSlideId ? eq(deckSlides.parentSlideId, parentSlideId) : isNull(deckSlides.parentSlideId);
  const plane = await db
    .select({ layout: deckSlides.layout, position: deckSlides.position })
    .from(deckSlides)
    .where(and(eq(deckSlides.deckId, params.id), planeCond));
  const recentLayouts = plane
    .sort((a, b) => a.position - b.position)
    .slice(-3)
    .map((s) => s.layout);

  const { slide, source } = await composeSlide({ text, mediaUrls }, { deckTitle: deck.title, recentLayouts });

  const position =
    typeof body.position === 'number' && Number.isInteger(body.position) && body.position >= 0
      ? body.position
      : plane.length;

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
      title: slide.title,
      layout: slide.layout,
      blocks: slide.blocks,
    })
    .returning();
  await db.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, params.id));
  return json({ ok: true, slide: row, source });
};
