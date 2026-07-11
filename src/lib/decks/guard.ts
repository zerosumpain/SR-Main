// Visibility guard for /decks routes — the deck twin of $lib/projects/guard.ts.
// Unlike the project guard, the caller has already loaded the deck row (it had
// to resolve the slug anyway), so the guard takes the row instead of re-querying.

import { error } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { isOwnerRequest } from '$lib/server/owner';
import { shareCookieName, validateDeckShare } from './shares';

/** The bits of a SvelteKit request the guard needs (load events and +server
 *  handlers both satisfy this). */
export interface DeckGuardCtx {
  locals: App.Locals;
  url: URL;
  cookies: Cookies;
  getClientAddress?: () => string;
}

export interface GuardedDeck {
  id: string;
  slug: string;
  isPublic: boolean;
}

/**
 * Guard a deck route. 404s the public when the deck is private, UNLESS the
 * request carries a valid share token (in `?t=` or the per-deck `dsh_<slug>`
 * cookie set on first valid hit, so navigation inside the player keeps access).
 *
 * Returns flags so the caller can suppress shared (CDN) caching:
 *  - `authedPrivate`: the signed-in owner is viewing a private deck.
 *  - `viaShare`: an unauthenticated recipient opened it via a valid share link.
 * Either flag means the response must be `private, no-store` (never edge-cached).
 */
export async function requireDeckVisible(
  deck: GuardedDeck,
  ctx: DeckGuardCtx,
): Promise<{ authedPrivate: boolean; viaShare: boolean }> {
  if (deck.isPublic) return { authedPrivate: false, viaShare: false };

  // Private from here. The site OWNER can always view (session on prod, LAN
  // bypass on dev/homeserv); signed-in guests are treated like the public
  // (owner-only, matching private projects). A valid share token grants
  // access without sign-in.
  if (await isOwnerRequest(ctx)) return { authedPrivate: true, viaShare: false };

  if (await resolveShareToken(deck, ctx)) return { authedPrivate: false, viaShare: true };

  throw error(404, 'Not found');
}

/**
 * Read a share token from `?t=` (then the deck cookie), validate it, and on a
 * fresh URL token persist a deck-scoped httpOnly cookie so in-player
 * navigation keeps working.
 */
export async function resolveShareToken(deck: GuardedDeck, ctx: DeckGuardCtx): Promise<boolean> {
  const cookieName = shareCookieName(deck.slug);
  const fromUrl = ctx.url.searchParams.get('t');
  const token = fromUrl || ctx.cookies.get(cookieName) || '';
  if (!token || !(await validateDeckShare(deck.id, token))) return false;
  if (fromUrl) {
    // Scope to /decks so it is never sent to other parts of the site; the
    // cookie NAME is per-deck and the token is validated against this deck id.
    ctx.cookies.set(cookieName, token, {
      path: '/decks',
      httpOnly: true,
      secure: ctx.url.protocol === 'https:',
      sameSite: 'lax',
      maxAge: 60 * 60 * 12, // 12h; re-opening the link refreshes it
    });
  }
  return true;
}
