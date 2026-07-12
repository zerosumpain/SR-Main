// Print rendering of a whole deck — every slide as one fixed 1280×720 page in
// reading order (each main-pathway slide followed depth-first by its journey).
// Reached by: the PDF export's headless browser with a one-shot ptk token,
// the signed-in owner, or anyone for a PUBLIC deck (same content as the
// player). Private decks never render here via share tokens — the export
// pipeline is an owner surface.

import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { consumePrintToken } from '$lib/decks/print-tokens';
import { isOwnerRequest } from '$lib/server/owner';
import { buildPlanes } from '$lib/presentation/navigation';
import type { Block, SlideLayout, SlideNode } from '$lib/presentation/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const [deck] = await db.select().from(decks).where(eq(decks.slug, event.params.slug)).limit(1);
  if (!deck) throw error(404, 'Not found');

  const ptk = event.url.searchParams.get('ptk') ?? '';
  const viaToken = ptk ? consumePrintToken(ptk, deck.id) : false;
  if (!viaToken && !deck.isPublic && !(await isOwnerRequest(event))) throw error(404, 'Not found');

  event.setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });

  const rows = await db
    .select()
    .from(deckSlides)
    .where(eq(deckSlides.deckId, deck.id))
    .orderBy(asc(deckSlides.position));
  const parents = new Set(rows.map((r) => r.parentSlideId).filter(Boolean));
  const byId = new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        parentSlideId: r.parentSlideId,
        position: r.position,
        title: r.title,
        layout: r.layout as SlideLayout,
        blocks: r.blocks as Block[],
        hasChildren: parents.has(r.id),
        journeyLabel: r.journeyLabel,
        geometry: (r.geometry as Record<string, { x: number; y: number; w: number }> | null) ?? null,
      } satisfies SlideNode,
    ]),
  );

  const planes = buildPlanes(
    rows.map((r) => ({ id: r.id, parentSlideId: r.parentSlideId, position: r.position })),
  );
  const flatten = (id: string): string[] => [id, ...(planes.get(id) ?? []).flatMap(flatten)];
  const order = (planes.get(null) ?? []).flatMap(flatten);

  return {
    deck: { id: deck.id, slug: deck.slug, title: deck.title, theme: deck.theme },
    slides: order.map((id) => byId.get(id)!).filter(Boolean),
  };
};
