// The games leaderboard — the database half. `recordRound` writes a finished
// round once (the unique key makes a replay a no-op) and says who set a new
// family high score; `leaderboard` reads a window's boards.
//
// Prod's `app` role is a superuser (no RLS): who may read this is decided by
// the routes, which answer only people holding `games:self`, and the board
// carries names and the games' hashed player ids — never an email.

import { and, gte, isNotNull, ne, or, sql, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { gameResults } from '$lib/db/schema';
import { GAME_IDS } from './catalogue';
import { TITLES } from './invite-push.server';
import {
  buildLeaderboard,
  newRecords,
  windowStart,
  type Leaderboard,
  type RoundRow,
  type Window,
} from './results';

/**
 * Write a finished round and return who set a new high score in it (player id
 * → the widest window). Idempotent: the same room + round + player lands once.
 */
export async function recordRound(rows: readonly RoundRow[], now = Date.now()): Promise<Record<string, Window>> {
  if (!rows.length) return {};
  await db
    .insert(gameResults)
    .values(
      rows.map((r) => ({
        game: r.game,
        roomId: r.roomId,
        round: r.round,
        playerId: r.playerId,
        playerName: r.playerName,
        score: r.score,
        rank: r.rank,
        won: r.won,
        players: r.players,
        difficulty: r.difficulty,
        options: r.options,
        finishedAt: r.finishedAt,
      })),
    )
    .onConflictDoNothing({ target: [gameResults.roomId, gameResults.round, gameResults.playerId] });

  if (!rows.some((r) => r.score !== null)) return {};
  const { game, roomId, round } = rows[0];
  const day = windowStart('day', now)!;
  const week = windowStart('week', now)!;
  const [best] = await db
    .select({
      day: sql<number | null>`max(${gameResults.score}) filter (where ${gameResults.finishedAt} >= ${day})`,
      week: sql<number | null>`max(${gameResults.score}) filter (where ${gameResults.finishedAt} >= ${week})`,
      all: sql<number | null>`max(${gameResults.score})`,
    })
    .from(gameResults)
    .where(
      and(
        eq(gameResults.game, game),
        isNotNull(gameResults.score),
        or(ne(gameResults.roomId, roomId), ne(gameResults.round, round)),
      ),
    );
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return newRecords(rows, { day: num(best?.day), week: num(best?.week), all: num(best?.all) });
}

/** One window's boards: overall wins, then a board per game played in it. */
export async function leaderboard(window: Window, now = Date.now()): Promise<Leaderboard> {
  const from = windowStart(window, now);
  const rows = await db
    .select({
      game: gameResults.game,
      playerId: gameResults.playerId,
      playerName: gameResults.playerName,
      score: gameResults.score,
      won: gameResults.won,
      difficulty: gameResults.difficulty,
      options: gameResults.options,
      finishedAt: gameResults.finishedAt,
    })
    .from(gameResults)
    .where(from ? gte(gameResults.finishedAt, from) : undefined);
  return buildLeaderboard(
    rows.map((r) => ({ ...r, game: r.game as RoundRow['game'], options: (r.options ?? {}) as RoundRow['options'] })),
    window,
    from,
    GAME_IDS,
    TITLES,
  );
}
