// Decks landing — public visitors see published decks; the owner (session on
// prod, LAN bypass on homeserv) additionally sees private decks and gets edit
// affordances. Nav-bar destination, so no 404 for anonymous any more.

import { fail, redirect } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { slugify } from '$lib/canvas/slug';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { isOwnerRequest } from '$lib/server/owner';
import type { Actions, PageServerLoad } from './$types';

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


export const actions: Actions = {
  create: async (event) => {
    if (!(await isOwnerRequest(event))) return fail(403, { error: 'Owner access required.', title: '' });
    const form = await event.request.formData();
    const title = String(form.get('title') ?? '').trim();
    if (!title || title.length > 160) return fail(400, { error: 'Enter a title of 1–160 characters.', title });
    const slug = `${slugify(title).slice(0, 64) || 'deck'}-${randomUUID().slice(0, 8)}`;
    await db.transaction(async (tx) => {
      const [deck] = await tx.insert(decks).values({ slug, title, theme: 'editorial', isPublic: false }).returning({ id: decks.id });
      await tx.insert(deckSlides).values({
        deckId: deck.id, position: 0, title, layout: 'center',
        blocks: [{ type: 'masthead', title }],
      });
    });
    redirect(303, `/decks/${slug}/edit`);
  },
};
