import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { spaceLanderSessions } from '$lib/db/schema';
import { lt } from 'drizzle-orm';
import { isDifficulty } from '$lib/space-lander/score';
import { hashIp, newNonce, rateLimit, maybeSweep, clientIp, dueForDbSweep } from '$lib/space-lander/guard';

// Opens a single-use session for a Terminal Descent run. The returned nonce is
// presented (once) when the score is submitted, blocking trivial replay/flood.
// Public: whitelisted in src/lib/auth.ts (no Google OAuth) — the abuse surface
// is bounded by rate limiting + server-side score recomputation, not auth.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  maybeSweep();
  const ipHash = hashIp(clientIp(request, getClientAddress));
  if (!rateLimit('session', ipHash, 30, 60_000)) throw error(429, 'Too many sessions — slow down.');
  if (!rateLimit('session-hour', ipHash, 300, 60 * 60_000)) throw error(429, 'Hourly session limit reached.');

  const body = await request.json().catch(() => ({}));
  const difficulty = String(body?.difficulty || 'pilot');
  if (!isDifficulty(difficulty)) throw error(400, 'Unknown difficulty.');

  // Opportunistically reap expired sessions so the table can't grow forever.
  if (dueForDbSweep()) {
    db.delete(spaceLanderSessions).where(lt(spaceLanderSessions.expiresAt, new Date())).catch(() => {});
  }

  const nonce = newNonce();
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const [row] = await db
    .insert(spaceLanderSessions)
    .values({ nonce, difficulty, ipHash, expiresAt })
    .returning({ id: spaceLanderSessions.id, issuedAt: spaceLanderSessions.issuedAt });

  return json({ sessionId: row.id, nonce, issuedAt: row.issuedAt });
};
