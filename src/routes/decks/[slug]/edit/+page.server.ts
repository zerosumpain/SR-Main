// Deck editor load — owner only (404 to everyone else; /decks is a public
// hook prefix, so this load is the gate). Loads the deck at any visibility.

import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { isOwnerRequest } from '$lib/server/owner';
import { buildMediaCatalogue } from '$lib/presentation/site-media';
import type { Block, SlideLayout } from '$lib/presentation/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(404, 'Not found');

  const [deck] = await db.select().from(decks).where(eq(decks.slug, event.params.slug)).limit(1);
  if (!deck) throw error(404, 'Not found');

  const rows = await db
    .select()
    .from(deckSlides)
    .where(eq(deckSlides.deckId, deck.id))
    .orderBy(asc(deckSlides.position));

  event.setHeaders({ 'cache-control': 'private, no-store' });
  return {
    mediaCatalogue: await buildMediaCatalogue(),
    deck: {
      id: deck.id,
      slug: deck.slug,
      title: deck.title,
      description: deck.description,
      theme: deck.theme,
      isPublic: deck.isPublic,
    },
    slides: rows.map((r) => ({
      id: r.id,
      parentSlideId: r.parentSlideId,
      position: r.position,
      title: r.title,
      layout: r.layout as SlideLayout,
      blocks: r.blocks as Block[],
      notes: r.notes,
      journeyLabel: r.journeyLabel,
      geometry: (r.geometry as Record<string, { x: number; y: number; w: number }> | null) ?? null,
      version: r.version,
    })),
  };
};
