// A TV board for a game room — the pure half: the pairing code a waiting
// screen shows, and the ticket that lets a paired screen (which has no login)
// follow its room. The registry and the stream are ./screens.server.
//
// The flow: `/games/<game>` opens a stream and is given a code to show. A
// player in a room of that game types the code on their phone; the room's
// screen is then sent a ticket and the table, on the same stream. The ticket
// is the only thing the screen keeps: a reload, or a deploy that empties the
// registry, picks the same room straight back up from it. The shape copies
// the backlog's `/cast` ticket (`$lib/family/backlog-cast`).

import { createHmac, randomBytes } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';

/** How long a paired screen may follow its room: an evening, and then some. */
export const SCREEN_TICKET_TTL_SECONDS = 12 * 60 * 60;
/** How long a code waits to be typed before the screen is shown a fresh one. */
export const SCREEN_CODE_TTL_MS = 20 * 60_000;

/** Consonants only: no vowel means no word, and nothing that reads as 0/O or 1/I. */
export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 4;

/** A fresh code; `taken` is asked so a code is never on two screens at once. */
export function newCode(taken: (code: string) => boolean, random = () => randomBytes(1)[0] / 256): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    if (!taken(code)) return code;
  }
  throw new Error('No free screen code');
}

/** What a phone typed, as a code: upper case, spaces and dashes dropped; null if it cannot be one. */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((ch) => CODE_ALPHABET.includes(ch)) ? code : null;
}

const ROOM_ID = /^g_[0-9a-f]{12}$/u;

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`games-screen.${payload}`, 'utf8').digest('hex');
}

/**
 * A screen's ticket: `<room id>.<expires>.<nonce>.<hmac>`. The room id is in
 * the signed material, so a ticket follows one room only, and only while that
 * room is there to follow.
 */
export function issueScreenTicket(roomId: string, secret: string, nowMs = Date.now()): { ticket: string; expiresAt: number } {
  if (!secret) throw new Error('AUTH_SECRET is required to issue a screen ticket');
  if (!ROOM_ID.test(roomId)) throw new Error('A screen ticket needs a room id');
  const expires = Math.floor(nowMs / 1000) + SCREEN_TICKET_TTL_SECONDS;
  const payload = `${roomId}.${expires}.${randomBytes(12).toString('hex')}`;
  return { ticket: `${payload}.${signature(secret, payload)}`, expiresAt: expires * 1000 };
}

/** The room a ticket follows, or null for anything malformed, forged or expired. */
export function verifyScreenTicket(ticket: string | null | undefined, secret: string | undefined, nowMs = Date.now()): string | null {
  if (!ticket || !secret) return null;
  const m = /^(g_[0-9a-f]{12})\.(\d{10})\.([a-f0-9]{24})\.([a-f0-9]{64})$/u.exec(ticket);
  if (!m) return null;
  const expires = Number(m[2]);
  const now = Math.floor(nowMs / 1000);
  if (expires < now || expires > now + SCREEN_TICKET_TTL_SECONDS) return null;
  return secretsMatch(signature(secret, `${m[1]}.${m[2]}.${m[3]}`), m[4]) ? m[1] : null;
}
