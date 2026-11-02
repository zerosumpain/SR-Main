// A party at the TV — the pure half: the tokens a linked TV and a guest's
// seat carry, the ids they are given, a guest's name made safe, and which
// games a party can play. The registry and the streams are ./party.server.
//
// A party is the people at one TV for an evening. The TV (a linked device,
// `./tv-devices.server`) owns it; a guest joins by name from the QR and is
// handed a seat — an HMAC over the party and their member id, so a cookie
// follows one party only and dies with it. Both token shapes copy the
// screen ticket's (`./screens`).

import { createHmac, randomBytes } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';
import { GAMES, type GameId } from './catalogue';
import { isClean } from './quiz-night';
import { MAX_PLAYERS } from './tap-duel';

/** A linked TV stays linked for a long while; revoking it is the off switch. */
export const TV_TOKEN_TTL_SECONDS = 400 * 24 * 60 * 60;
/** A guest's seat lasts the evening; the party usually ends first. */
export const SEAT_TTL_SECONDS = 12 * 60 * 60;
/** Most people at one TV. */
export const PARTY_MAX = 8;
export const GUEST_NAME_MAX = 16;

/** The games a party can play: a TV board and a web controller each. */
export const PARTY_GAMES: readonly GameId[] = ['boggle'];

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
export const newTvId = () => 'tv_' + hex(6);
export const newPartyId = () => 'pt_' + hex(6);
/** A guest's player id. `v_`, so it is never mistaken for an email hash (`p_`). */
export const newGuestId = () => 'v_' + hex(6);
export const isGuestId = (id: string) => id.startsWith('v_');

function sign(secret: string, context: string, payload: string): string {
  return createHmac('sha256', secret).update(`${context}.${payload}`, 'utf8').digest('hex');
}

function fresh(expires: number, ttl: number, nowMs: number): boolean {
  const now = Math.floor(nowMs / 1000);
  return expires >= now && expires <= now + ttl;
}

/** A linked TV's token: `<tv id>.<expires>.<nonce>.<hmac>`. */
export function issueTvToken(tvId: string, secret: string, nowMs = Date.now()): { token: string; expiresAt: number } {
  if (!secret) throw new Error('AUTH_SECRET is required to link a TV');
  if (!/^tv_[0-9a-f]{12}$/u.test(tvId)) throw new Error('A TV token needs a TV id');
  const expires = Math.floor(nowMs / 1000) + TV_TOKEN_TTL_SECONDS;
  const payload = `${tvId}.${expires}.${hex(12)}`;
  return { token: `${payload}.${sign(secret, 'games-tv', payload)}`, expiresAt: expires * 1000 };
}

/** The TV a token names, or null for anything malformed, forged or expired. Revocation is the registry's. */
export function verifyTvToken(token: string | null | undefined, secret: string | undefined, nowMs = Date.now()): string | null {
  if (!token || !secret) return null;
  const m = /^(tv_[0-9a-f]{12})\.(\d{10})\.([a-f0-9]{24})\.([a-f0-9]{64})$/u.exec(token);
  if (!m || !fresh(Number(m[2]), TV_TOKEN_TTL_SECONDS, nowMs)) return null;
  return secretsMatch(sign(secret, 'games-tv', `${m[1]}.${m[2]}.${m[3]}`), m[4]) ? m[1] : null;
}

/** A seat at one party: `<party id>.<member id>.<expires>.<hmac>`. */
export function issueSeat(partyId: string, memberId: string, secret: string, nowMs = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is required to seat a guest');
  const expires = Math.floor(nowMs / 1000) + SEAT_TTL_SECONDS;
  const payload = `${partyId}.${memberId}.${expires}`;
  return `${payload}.${sign(secret, 'games-seat', payload)}`;
}

/** The member a seat holds at THIS party, or null. */
export function verifySeat(seat: string | null | undefined, partyId: string, secret: string | undefined, nowMs = Date.now()): string | null {
  if (!seat || !secret) return null;
  const m = /^(pt_[0-9a-f]{12})\.([pv]_[0-9a-f]{12})\.(\d{10})\.([a-f0-9]{64})$/u.exec(seat);
  if (!m || m[1] !== partyId || !fresh(Number(m[3]), SEAT_TTL_SECONDS, nowMs)) return null;
  return secretsMatch(sign(secret, 'games-seat', `${m[1]}.${m[2]}.${m[3]}`), m[4]) ? m[2] : null;
}

/** The cookie a guest's seat is kept in: one per party, so two parties never share a seat. */
export const seatCookie = (partyId: string) => `sr_seat_${partyId}`;
export const TV_COOKIE = 'sr_tv';

/**
 * A guest's name as the room will show it, or null when it cannot be one:
 * trimmed, one space between words, letters, digits, spaces, apostrophes and
 * dashes only, at most sixteen characters, and clean under the kids' block
 * list (a child is often at the table). A name already taken gets a number:
 * "Sam", "Sam 2", "Sam 3".
 */
export function cleanGuestName(raw: unknown, taken: readonly string[]): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!name || name.length > GUEST_NAME_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(name)) return null;
  if (!isClean(name, 'kids')) return null;
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let n = 2; n <= PARTY_MAX + 1; n++) {
    const next = `${name.slice(0, GUEST_NAME_MAX - 1 - String(n).length)} ${n}`;
    if (!lower.has(next.toLowerCase())) return next;
  }
  return null;
}

/** How many people a game can be started with at a party. */
export function partyRange(game: GameId): { min: number; max: number } {
  const rules = GAMES[game];
  const max = Math.min(PARTY_MAX, rules.maxPlayers ?? MAX_PLAYERS);
  return { min: Math.min(max, rules.minPlayers ?? 1), max };
}
