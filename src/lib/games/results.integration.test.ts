/**
 * The games leaderboard against the disposable integration database: the
 * recorder is idempotent per room + round + player, and a record is judged
 * against every OTHER round. Rows are identified by a room-id prefix and
 * removed after every case; run only in the hermetic integration lane.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { like, or } from 'drizzle-orm';
import { db } from '$lib/db';
import { gameResults } from '$lib/db/schema';
import { leaderboard, recordRound } from './results.server';
import type { RoundRow } from './results';
import { recordOfflineResults } from './offline-results.server';

const PREFIX = 'itest_game_results:';
const NOW = Date.parse('2026-09-29T15:00:00Z');
/** Offline matches are filed under `offline-<id>`; these ids start `itest-`. */
const OFFLINE_PREFIX = 'offline-itest-';

async function cleanup(): Promise<void> {
  await db
    .delete(gameResults)
    .where(or(like(gameResults.roomId, `${PREFIX}%`), like(gameResults.roomId, `${OFFLINE_PREFIX}%`)));
}

beforeEach(cleanup);
afterEach(cleanup);

function row(over: Partial<RoundRow>): RoundRow {
  return {
    game: 'boggle',
    roomId: `${PREFIX}a`,
    round: 1,
    playerId: 'p_itest_john',
    playerName: 'John',
    score: 10,
    rank: 1,
    won: false,
    players: 1,
    difficulty: 'easy',
    options: { size: 4, label: '4×4 · 90 seconds' },
    finishedAt: new Date(NOW),
    ...over,
  };
}

describe('game results', () => {
  it('records a round once, however often it is handed over', async () => {
    const rows = [row({}), row({ playerId: 'p_itest_sam', playerName: 'Sam', score: 4, rank: 2 })];
    await recordRound(rows, NOW);
    await recordRound(rows, NOW);
    const stored = await db.select().from(gameResults).where(like(gameResults.roomId, `${PREFIX}%`));
    expect(stored).toHaveLength(2);
    // "Play again" is the next round in the same room: a new row.
    await recordRound([row({ round: 2 })], NOW);
    expect(await db.select().from(gameResults).where(like(gameResults.roomId, `${PREFIX}%`))).toHaveLength(3);
  });

  it('names a new high score against every other round, not this one', async () => {
    await recordRound([row({ roomId: `${PREFIX}old`, score: 50, finishedAt: new Date(NOW - 30 * 86_400_000) })], NOW);
    await recordRound([row({ roomId: `${PREFIX}yday`, score: 20, finishedAt: new Date(NOW - 86_400_000) })], NOW);
    await recordRound([row({ roomId: `${PREFIX}am`, score: 10, finishedAt: new Date(NOW - 3_600_000) })], NOW);
    // Beats this morning's 10 and yesterday's 20 (same week), not the 50 from last month.
    const records = await recordRound([row({ roomId: `${PREFIX}now`, score: 25 })], NOW);
    expect(records).toEqual({ p_itest_john: 'week' });
    // Replaying the same round does not beat itself.
    expect(await recordRound([row({ roomId: `${PREFIX}now`, score: 25 })], NOW)).toEqual({ p_itest_john: 'week' });
  });

  it('reads a window back as boards', async () => {
    await recordRound([row({ score: 12, won: true, players: 2 }), row({ playerId: 'p_itest_sam', playerName: 'Sam', score: 3, rank: 2, players: 2 })], NOW);
    const board = await leaderboard('day', NOW);
    const boggle = board.games.find((g) => g.game === 'boggle')!;
    const mine = boggle.rows.find((r) => r.playerId === 'p_itest_john')!;
    expect(mine).toMatchObject({ best: 12, wins: 1, played: 1, bestLabel: '4×4 · 90 seconds · easy' });
  });

  it('files an offline result once per caller, however often the phone sends it', async () => {
    const result = {
      id: 'itest-0a1b2c3d-1',
      game: 'offline:maths-sprint',
      source: 'offline',
      title: 'Maths Sprint',
      mode: 'nearby',
      finishedAt: NOW - 60_000,
      players: 2,
      bots: 0,
      rank: 1,
      score: 140,
      won: true,
      detail: 'streak 7',
      opponents: ['Sam'],
    };
    const caller = { email: 'itest-kid@example.test', role: 'member' as const };
    expect(await recordOfflineResults(caller, [result], NOW)).toEqual({ recorded: [result.id], rejected: [] });
    expect(await recordOfflineResults(caller, [result, { ...result, score: 999 }], NOW)).toEqual({
      recorded: [result.id],
      rejected: [],
    });
    const stored = await db.select().from(gameResults).where(like(gameResults.roomId, `${OFFLINE_PREFIX}%`));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ game: 'offline:maths-sprint', round: 1, score: 140, won: true, difficulty: '' });

    const board = await leaderboard('day', NOW);
    const offline = board.games.find((g) => g.game === 'offline:maths-sprint')!;
    expect(offline.title).toBe('Maths Sprint (offline)');
    expect(offline.rows[0]).toMatchObject({ best: 140, bestLabel: 'streak 7', wins: 1, played: 1 });
  });
});
