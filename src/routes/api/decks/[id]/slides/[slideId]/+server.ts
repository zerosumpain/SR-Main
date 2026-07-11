// Owner-only slide mutation (hook-gated like all /api/*).
// PATCH: content edits carry expectedVersion (workflow_nodes optimistic-
// concurrency pattern) — a stale version returns 409 with currentVersion so a
// human edit can't silently clobber an AI edit or vice versa.
// DELETE: removes the slide; its children are re-parented into the deleted
// slide's plane at its position (never orphan an unreachable sub-deck).

import { json } from '@sveltejs/kit';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckSlides, decks } from '$lib/db/schema';
import { isLayout } from '$lib/presentation/layouts';
import { validateBlocks } from '$lib/presentation/registry';
import type { RequestHandler } from './$types';

async function loadSlide(deckId: string, slideId: string) {
  const [row] = await db
    .select()
    .from(deckSlides)
    .where(and(eq(deckSlides.id, slideId), eq(deckSlides.deckId, deckId)));
  return row;
}

/** Would making `slideId` a child of `newParent` create a cycle? */
async function createsCycle(deckId: string, slideId: string, newParent: string): Promise<boolean> {
  let cursor: string | null = newParent;
  let guard = 0;
  while (cursor && guard++ < 100) {
    if (cursor === slideId) return true;
    const parent: { parentSlideId: string | null } | undefined = (
      await db
        .select({ parentSlideId: deckSlides.parentSlideId })
        .from(deckSlides)
        .where(and(eq(deckSlides.id, cursor), eq(deckSlides.deckId, deckId)))
    )[0];
    cursor = parent?.parentSlideId ?? null;
  }
  return false;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  let body: {
    title?: unknown;
    layout?: unknown;
    blocks?: unknown;
    notes?: unknown;
    position?: unknown;
    parentSlideId?: unknown;
    expectedVersion?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const before = await loadSlide(params.id, params.slideId);
  if (!before) return json({ error: 'Unknown slide' }, { status: 404 });

  if (typeof body.expectedVersion === 'number' && body.expectedVersion !== before.version) {
    return json({ error: 'Version conflict — the slide changed since you loaded it.', currentVersion: before.version }, { status: 409 });
  }

  const patch: Record<string, unknown> = { version: before.version + 1, updatedAt: new Date() };

  if (typeof body.title === 'string') patch.title = body.title.slice(0, 120) || null;
  if (typeof body.notes === 'string') patch.notes = body.notes || null;
  if (typeof body.layout === 'string') {
    if (!isLayout(body.layout)) return json({ error: `unknown layout "${body.layout}"` }, { status: 400 });
    patch.layout = body.layout;
  }
  if (body.blocks !== undefined) {
    const res = validateBlocks(body.blocks);
    if (!res.ok) return json({ error: 'blocks failed validation', issues: res.issues }, { status: 400 });
    patch.blocks = body.blocks;
  }
  if (typeof body.position === 'number' && Number.isInteger(body.position) && body.position >= 0) {
    patch.position = body.position;
  }
  if (body.parentSlideId !== undefined) {
    const newParent = typeof body.parentSlideId === 'string' && body.parentSlideId ? body.parentSlideId : null;
    if (newParent) {
      const parent = await loadSlide(params.id, newParent);
      if (!parent) return json({ error: 'parentSlideId is not a slide of this deck' }, { status: 400 });
      if (await createsCycle(params.id, params.slideId, newParent)) {
        return json({ error: 'that move would make a slide its own ancestor' }, { status: 400 });
      }
    }
    patch.parentSlideId = newParent;
  }

  await db.update(deckSlides).set(patch).where(eq(deckSlides.id, params.slideId));
  await db.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, params.id));
  const after = await loadSlide(params.id, params.slideId);
  return json({ ok: true, slide: after });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const before = await loadSlide(params.id, params.slideId);
  if (!before) return json({ error: 'Unknown slide' }, { status: 404 });

  // Re-parent children into the deleted slide's plane, in order, at its
  // position — and shift the later siblings to make room, so the plane stays
  // gap-free and collision-free. (children=0 shifts by -1: closes the gap.)
  const children = await db
    .select({ id: deckSlides.id })
    .from(deckSlides)
    .where(and(eq(deckSlides.deckId, params.id), eq(deckSlides.parentSlideId, params.slideId)))
    .orderBy(asc(deckSlides.position));

  const planeCond = before.parentSlideId
    ? eq(deckSlides.parentSlideId, before.parentSlideId)
    : isNull(deckSlides.parentSlideId);
  await db
    .update(deckSlides)
    .set({ position: sql`${deckSlides.position} + ${children.length - 1}` })
    .where(and(eq(deckSlides.deckId, params.id), planeCond, gt(deckSlides.position, before.position)));

  for (let i = 0; i < children.length; i++) {
    await db
      .update(deckSlides)
      .set({ parentSlideId: before.parentSlideId, position: before.position + i })
      .where(eq(deckSlides.id, children[i].id));
  }

  await db.delete(deckSlides).where(eq(deckSlides.id, params.slideId));
  await db.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, params.id));
  return json({ ok: true });
};
