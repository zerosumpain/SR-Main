// The doors into a party: who a request is — a linked TV (the `sr_tv`
// cookie), a seated player (the party's seat cookie), or a family member
// signed in on this browser — and the one way every party route answers a
// refusal (`{ error }` with its status; the sentences are for the person).
//
// Every route under /api/games/tv and /api/games/party is PUBLIC to the hook
// (a TV and a guest have no login), so each one decides here, before doing
// anything, who is asking.

import { json, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { satisfies } from '$lib/access/catalogue';
import { isOwnerEmail } from '$lib/server/access';
import { loadMember } from '$lib/server/grants';
import { clientIp, hashIp, rateLimit } from '$lib/server/public-request-rate-limit';
import { playerFor, playerId } from './players.server';
import { GameError } from './tap-duel';
import { TV_COOKIE, seatCookie, verifySeat } from './party';
import { partyIdFor } from './party.server';
import { tvFromToken, type TvRow } from './tv-devices.server';

/** Guest joins a browser may make in ten minutes (one per person, with room for a typo). */
export const JOINS_PER_WINDOW = 10;
const JOIN_WINDOW_MS = 10 * 60_000;

/** Run a party call; a rules refusal becomes `{ error }` with its status. */
export async function partyJson(fn: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    return out instanceof Response ? out : json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof GameError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** The linked TV this request comes from, or a 401 sentence. */
export async function requireTv(cookies: Cookies): Promise<TvRow> {
  const tv = await tvFromToken(cookies.get(TV_COOKIE));
  if (!tv) throw new GameError(401, 'This TV is not linked. Open /games/tv on it to link it.');
  return tv;
}

/** Keep a TV's token as its cookie: a long while, this site only, never readable by script. */
export function setTvCookie(cookies: Cookies, url: URL, token: string, expiresAt: number): void {
  cookies.set(TV_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: Math.max(60, Math.floor((expiresAt - Date.now()) / 1000)),
  });
}

/** A signed-in family member with games access, as a player; null for anybody else. */
export async function familyPlayer(event: Pick<RequestEvent, 'locals'>): Promise<{ id: string; name: string } | null> {
  const session = await event.locals.auth?.().catch(() => null);
  const email = (session?.user?.email ?? '').trim().toLowerCase();
  if (!email) return null;
  if (!isOwnerEmail(email)) {
    const member = await loadMember(email).catch(() => null);
    if (!member || !satisfies(member.grants, 'games:self')) return null;
  }
  // The roster read can fail (a database hiccup); the person is still who their session says.
  const p = await playerFor(email).catch(() => ({ id: playerId(email), name: email.split('@')[0] }));
  return { id: p.id, name: p.name };
}

/** Keep a seat at one party as its own cookie, for the evening. */
export function setSeatCookie(cookies: Cookies, url: URL, partyId: string, seat: string): void {
  cookies.set(seatCookie(partyId), seat, {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60,
  });
}

/**
 * Who is playing at the party behind `code`: the seat this browser holds
 * there, else the signed-in family member. The party then says whether they
 * are still in it. A 403 sentence for somebody who never joined.
 */
export async function seatedMember(event: Pick<RequestEvent, 'locals' | 'cookies'>, code: string): Promise<string> {
  const partyId = partyIdFor(code);
  const fromSeat = verifySeat(event.cookies.get(seatCookie(partyId)), partyId, env.AUTH_SECRET);
  if (fromSeat) return fromSeat;
  const family = await familyPlayer(event);
  if (family) return family.id;
  throw new GameError(403, 'Join the game on the TV first.');
}

/** A guest join from this browser is allowed by the rate limit; false when it has made too many. */
export function guestJoinAllowed(request: Request, getClientAddress: () => string): boolean {
  return rateLimit('games-party-join', hashIp(clientIp(request, getClientAddress)), JOINS_PER_WINDOW, JOIN_WINDOW_MS);
}

/** Read a JSON object body, or a 400 sentence. */
export async function partyBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GameError(400, 'Body must be JSON.');
  return body as Record<string, unknown>;
}

