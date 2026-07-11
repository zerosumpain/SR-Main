// Owner-only deck index. Anonymous/guest visitors get a 404 (decks are
// reached by direct share URL); the owner sees every deck with its state.

import { error } from '@sveltejs/kit';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { isOwnerEmail } from '$lib/server/access';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const session = await event.locals.auth();
  if (!isOwnerEmail(session?.user?.email)) throw error(404, 'Not found');

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
    .orderBy(desc(decks.updatedAt));

  event.setHeaders({ 'cache-control': 'private, no-store' });
  return { decks: rows };
};
