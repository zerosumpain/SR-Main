import type { PageServerLoad } from './$types';
import { autoGroomBacklog } from '$lib/workflows/backlog-grooming.server';
import { EMPTY_BOARD } from '$lib/selfimprove/board';
import { errMsg } from '$lib/selfimprove/types';

/**
 * The room reads one thing.
 *
 * `autoGroomBacklog` already builds the board on its way to the epics, and the
 * deck, the burndown and the intake window all come off it — so the alternative
 * is a second full pass over the same 470 rows to recompute what the first one
 * threw away.
 */
export const load: PageServerLoad = async () => {
  try {
    const { epics, board } = await autoGroomBacklog();
    return { epics, board, error: null };
  } catch (error) {
    // EMPTY_BOARD rather than null, for the reason it exists: every consumer
    // can then read `board.totals` without a guard, and the room says out loud
    // that it could not read rather than drawing a deck of measured zeros.
    return { epics: [], board: EMPTY_BOARD, error: errMsg(error) };
  }
};
