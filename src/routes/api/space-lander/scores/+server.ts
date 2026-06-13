import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { spaceLanderScores, spaceLanderSessions } from '$lib/db/schema';
import { and, eq, gt, desc, asc, sql } from 'drizzle-orm';
import { computeScore, validateTelemetry, isDifficulty, type Difficulty, type Telemetry } from '$lib/space-lander/score';
import { hashIp, rateLimit, maybeSweep, clientIp } from '$lib/space-lander/guard';

// ── GET /api/space-lander/scores?difficulty=pilot&limit=12 ─────────────────
export const GET: RequestHandler = async ({ url }) => {
  const difficulty = String(url.searchParams.get('difficulty') || 'pilot');
  if (!isDifficulty(difficulty)) throw error(400, 'Unknown difficulty.');
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12));

  const rows = await db
    .select({
      name: spaceLanderScores.name,
      score: spaceLanderScores.score,
      tier: spaceLanderScores.tier,
      difficulty: spaceLanderScores.difficulty,
      impactVert: spaceLanderScores.vy,
      vx: spaceLanderScores.vx,
      createdAt: spaceLanderScores.createdAt,
    })
    .from(spaceLanderScores)
    .where(and(eq(spaceLanderScores.difficulty, difficulty), eq(spaceLanderScores.flagged, false)))
    .orderBy(desc(spaceLanderScores.score), asc(spaceLanderScores.createdAt))
    .limit(limit);

  return json({
    difficulty,
    scores: rows.map((r, i) => ({ rank: i + 1, ...r })),
  });
};

function sanitizeName(raw: unknown): string {
  return (
    String(raw ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9 ._-]/g, '')
      .slice(0, 6) || 'PILOT'
  );
}

// ── POST /api/space-lander/scores ──────────────────────────────────────────
// Body = telemetry + session (NOT a score). Server recomputes + validates.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  maybeSweep();
  const ipHash = hashIp(clientIp(request, getClientAddress));
  if (!rateLimit('submit', ipHash, 8, 60_000)) throw error(429, 'Too many submissions — slow down.');
  if (!rateLimit('submit-hour', ipHash, 60, 60 * 60_000)) throw error(429, 'Hourly submission limit reached.');

  const b = await request.json().catch(() => ({}));
  const difficulty = String(b?.difficulty || '');
  if (!isDifficulty(difficulty)) throw error(400, 'Unknown difficulty.');

  const tel: Telemetry = {
    vy: Number(b.vy),
    vx: Number(b.vx),
    tiltRad: Number(b.tiltRad),
    angVelMag: Number(b.angVelMag),
    padOffset: Number(b.padOffset),
    fuelStart: Number(b.fuelStart),
    fuelRemaining: Number(b.fuelRemaining),
    tElapsed: Number(b.tElapsed),
    seed: b.seed != null ? String(b.seed).slice(0, 16) : undefined,
  };
  const invalid = validateTelemetry(tel, difficulty);
  if (invalid) throw error(400, 'Telemetry rejected: ' + invalid);

  // Single-use session/nonce — required for a ranked submission.
  if (!b.sessionId || !b.nonce) throw error(400, 'Missing session.');
  const [sess] = await db
    .select()
    .from(spaceLanderSessions)
    .where(eq(spaceLanderSessions.id, String(b.sessionId)));
  if (!sess || sess.nonce !== String(b.nonce) || sess.difficulty !== difficulty) {
    throw error(400, 'Invalid or spent session.');
  }
  if (sess.expiresAt.getTime() < Date.now()) throw error(400, 'Session expired.');
  // Flight time can't exceed wall-clock since the session opened (+ slack).
  const sessionAgeSec = (Date.now() - sess.issuedAt.getTime()) / 1000;
  if (tel.tElapsed > sessionAgeSec + 30) throw error(400, 'Flight time inconsistent with session.');

  // ATOMIC nonce burn = the gate. The conditional UPDATE (used=false) is the
  // single point of mutual exclusion: under N concurrent replays of one nonce,
  // exactly one UPDATE matches a row and returns it; the rest get zero rows and
  // are rejected. Without this (select-check-then-update) all N would pass the
  // `used` check before any commit and duplicate the score. See review BLOCKER.
  const burned = await db
    .update(spaceLanderSessions)
    .set({ used: true })
    .where(and(eq(spaceLanderSessions.id, sess.id), eq(spaceLanderSessions.used, false)))
    .returning({ id: spaceLanderSessions.id });
  if (burned.length === 0) throw error(400, 'Invalid or spent session.');

  const scored = computeScore(tel, difficulty);
  const name = sanitizeName(b.name);

  try {
    await db.insert(spaceLanderScores).values({
      name,
      score: scored.total,
      tier: scored.tier,
      difficulty,
      seed: tel.seed ?? null,
      vy: tel.vy,
      vx: tel.vx,
      tiltRad: tel.tiltRad,
      angVelMag: tel.angVelMag,
      padOffset: tel.padOffset,
      fuelStart: tel.fuelStart,
      fuelRemaining: tel.fuelRemaining,
      tElapsed: tel.tElapsed,
      sessionId: sess.id,
      ipHash,
      userAgent: request.headers.get('user-agent')?.slice(0, 200) || null,
    });
  } catch (e: unknown) {
    // Belt-and-suspenders: a unique-violation on session_id (one score per
    // session) means a duplicate slipped the burn — reject rather than 500.
    if ((e as { code?: string })?.code === '23505') throw error(409, 'Score already recorded for this run.');
    throw e;
  }

  // Rank within difficulty (strictly-better scores ahead; ties → older wins,
  // so a new equal score ranks behind existing ones).
  const [{ better }] = await db
    .select({ better: sql<number>`count(*)` })
    .from(spaceLanderScores)
    .where(
      and(
        eq(spaceLanderScores.difficulty, difficulty),
        eq(spaceLanderScores.flagged, false),
        gt(spaceLanderScores.score, scored.total),
      ),
    );
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(spaceLanderScores)
    .where(and(eq(spaceLanderScores.difficulty, difficulty), eq(spaceLanderScores.flagged, false)));

  const rank = Number(better) + 1;
  const totalN = Number(total);
  const percentile = totalN > 1 ? Math.round((1 - (rank - 1) / totalN) * 100) : 100;

  return json({ score: scored.total, tier: scored.tier, rank, total: totalN, percentile });
};
