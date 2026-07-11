// Decks landing — public visitors see published decks; the owner (session on
// prod, LAN bypass on homeserv) additionally sees private decks and gets edit
// affordances. Nav-bar destination, so no 404 for anonymous any more.

import { desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { isOwnerRequest } from '$lib/server/owner';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const isOwner = await isOwnerRequest(event);

  const rows = await db
    .select({
      id: decks.id,
      slug: decks.slug,
      title: decks.title,
      description: decks.description,
      isPublic: decks.isPublic,
      updatedAt: decks.updatedAt,
      slideCount: sql<number>`(select count(*) from ${deckSlides} where ${deckSlides.deckId} = ${decks.id})`,
    })
    .from(decks)
    .where(isOwner ? undefined : eq(decks.isPublic, true))
    .orderBy(desc(decks.updatedAt));

  if (isOwner) event.setHeaders({ 'cache-control': 'private, no-store' });
  return { decks: rows, isOwner };
};
