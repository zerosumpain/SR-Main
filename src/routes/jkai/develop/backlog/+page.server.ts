import type { PageServerLoad } from './$types';
import { EMPTY_BOARD } from '$lib/selfimprove/board';
import { errMsg } from '$lib/selfimprove/types';
import { readBacklogRoom } from '$lib/selfimprove/backlog-room.server';
import { isOwnerRequest } from '$lib/server/owner';
import { memberBacklog } from '$lib/member-view';

/**
 * The room reads one thing, and writes nothing.
 *
 * `readBacklogRoom` builds the board on its way to the epics, and the deck, the
 * burndown and the intake window all come off it. The automatic grooming that
 * used to run here on every owner view — saving epic memberships and applying
 * merges inside a GET — is the heartbeat's `backlog-grooming` activity now.
 */
export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) {
    // jkai · develop, read-only, and redacted: no grooming lane.
    try {
      const { epics, board } = await readBacklogRoom();
      return { ...memberBacklog(epics, board), error: null, member: true };
    } catch (error) {
      console.error('[backlog] member read failed:', errMsg(error));
      return { epics: [], board: EMPTY_BOARD, error: 'The backlog could not be read.', member: true };
    }
  }
  try {
    const { epics, board } = await readBacklogRoom({ grooming: true });
    return { epics, board, error: null, member: false };
  } catch (error) {
    // EMPTY_BOARD rather than null, for the reason it exists: every consumer
    // can then read `board.totals` without a guard, and the room says out loud
    // that it could not read rather than drawing a deck of measured zeros.
    return { epics: [], board: EMPTY_BOARD, error: errMsg(error), member: false };
  }
};
