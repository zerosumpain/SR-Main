// Anonymous share-viewer telemetry — which slides a share link actually
// reached. Lives under /decks (public prefix) rather than /api because the
// share cookie is deliberately scoped to path=/decks; an /api endpoint would
// never receive it. The AUTH is the cookie itself: nothing is written unless
// the request carries a live (un-revoked, un-expired) share token for this
// exact deck. The response is always 204 — a beacon leaks nothing either way.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckShares, deckSlides, decks } from '$lib/db/schema';
import { hashShareToken, shareCookieName } from '$lib/decks/shares';
import type { RequestHandler } from './$types';

const ok = () => new Response(null, { status: 204 });

export const POST: RequestHandler = async ({ params, request, cookies }) => {
  let slideId = '';
  try {
    const body = (await request.json()) as { slideId?: unknown };
    if (typeof body.slideId === 'string') slideId = body.slideId;
  } catch {
    return ok();
  }
  if (!slideId || slideId.length > 64) return ok();

  const [deck] = await db
    .select({ id: decks.id, slug: decks.slug })
    .from(decks)
    .where(eq(decks.slug, params.slug))
    .limit(1);
  if (!deck) return ok();

  const token = cookies.get(shareCookieName(deck.slug)) ?? '';
  if (!token || token.length < 20) return ok();
  const hash = hashShareToken(token);

  const [share] = await db
    .select({ id: deckShares.id, expiresAt: deckShares.expiresAt, revokedAt: deckShares.revokedAt })
    .from(deckShares)
    .where(and(eq(deckShares.tokenHash, hash), eq(deckShares.deckId, deck.id)))
    .limit(1);
  if (!share || share.revokedAt) return ok();
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return ok();

  // The slide must belong to this deck — the beacon can't grow arbitrary keys.
  const [slide] = await db
    .select({ id: deckSlides.id })
    .from(deckSlides)
    .where(and(eq(deckSlides.id, slideId), eq(deckSlides.deckId, deck.id)))
    .limit(1);
  if (!slide) return ok();

  await db
    .update(deckShares)
    .set({
      slidesReached: sql`jsonb_set(
        coalesce(${deckShares.slidesReached}, '{}'::jsonb),
        ARRAY[${slideId}]::text[],
        to_jsonb(coalesce((${deckShares.slidesReached}->>${slideId})::int, 0) + 1),
        true
      )`,
      lastUsedAt: new Date(),
    })
    .where(eq(deckShares.id, share.id))
    .catch(() => {});

  return ok();
};
