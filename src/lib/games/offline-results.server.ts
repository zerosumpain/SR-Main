// Games played with no internet, filed later — the database half. One
// `game_results` row per result, for the CALLER only, written in one
// statement that does nothing on the table's unique key (room + round +
// player): a retry, a batch the phone never heard the answer to, or the same
// match told twice lands once. No new table, and no new grant: this is the
// insert (and `game_results_id_seq`) the online recorder already uses.

import { db } from '$lib/db';
import { gameResults } from '$lib/db/schema';
import { playerFor } from './players.server';
import { parseOfflineBatch } from './offline-results';
import type { GameCaller } from './api.server';

export interface OfflineReceipt {
  /** Filed now or before: the phone may forget them. */
  recorded: string[];
  /** Never to be filed: the phone may forget them too. */
  rejected: string[];
}

/**
 * File the caller's offline results. Every id in `results` that is not in
 * either list (past the batch cap) is left for the phone's next try. A
 * database that fails throws, so the whole batch is answered 500 and retried.
 */
export async function recordOfflineResults(
  caller: GameCaller,
  results: readonly unknown[],
  now = Date.now(),
): Promise<OfflineReceipt> {
  const { rows, rejected } = parseOfflineBatch(results, now);
  if (!rows.length) return { recorded: [], rejected };
  const me = await playerFor(caller.email);
  await db
    .insert(gameResults)
    .values(
      rows.map((r) => ({
        game: r.game,
        roomId: r.roomId,
        round: 1,
        playerId: me.id,
        playerName: me.name,
        score: r.score,
        rank: r.rank,
        won: r.won,
        players: r.players,
        // Offline games have no difficulty; the board reads '' as nothing to say.
        difficulty: '',
        options: r.options,
        finishedAt: r.finishedAt,
      })),
    )
    .onConflictDoNothing({ target: [gameResults.roomId, gameResults.round, gameResults.playerId] });
  return { recorded: rows.map((r) => r.id), rejected };
}
