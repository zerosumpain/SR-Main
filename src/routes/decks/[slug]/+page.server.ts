// Deck player load — resolve slug, enforce visibility (owner / share token /
// isPublic; otherwise 404), return the slide tree. Private and via-share views
// must never be edge-cached (same contract as private projects).

import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { requireDeckVisible } from '$lib/decks/guard';
import type { Block, SlideLayout, SlideNode } from '$lib/presentation/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const [deck] = await db.select().from(decks).where(eq(decks.slug, event.params.slug)).limit(1);
  if (!deck) throw error(404, 'Not found');

  const { authedPrivate, viaShare } = await requireDeckVisible(deck, event);
  if (authedPrivate || viaShare) {
    event.setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  }

  const rows = await db
    .select()
    .from(deckSlides)
    .where(eq(deckSlides.deckId, deck.id))
    .orderBy(asc(deckSlides.position));
  const parents = new Set(rows.map((r) => r.parentSlideId).filter(Boolean));
  const slides: SlideNode[] = rows.map((r) => ({
    id: r.id,
    parentSlideId: r.parentSlideId,
    position: r.position,
    title: r.title,
    layout: r.layout as SlideLayout,
    blocks: r.blocks as Block[],
    hasChildren: parents.has(r.id),
    journeyLabel: r.journeyLabel,
    geometry: (r.geometry as Record<string, { x: number; y: number; w: number }> | null) ?? null,
  }));

  const roots = slides.filter((s) => s.parentSlideId === null);
  if (roots.length === 0) throw error(404, 'Not found'); // an empty deck is not presentable

  const requested = event.url.searchParams.get('s');
  const startId = requested && slides.some((s) => s.id === requested) ? requested : roots[0].id;

  return {
    deck: {
      id: deck.id,
      slug: deck.slug,
      title: deck.title,
      description: deck.description,
      theme: deck.theme,
    },
    slides,
    startId,
  };
};
