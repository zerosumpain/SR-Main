// Who may pause a county (decision 13, 2026-10-25): "Pause is solo only: the
// sole mayor of a county may pause it for as long as they like; a family
// county never pauses (holiday, Away and nap cover breaks)."
//
// A county is solo while it runs with exactly one player who has joined and
// holds a seat. Invitees who have not answered, mayors who left and declined
// invites do not count. The engine's own floor still applies (only a parent's
// seat may pause), so the one who may pause is that mayor, on a parent seat.
// The adapter (hometowns.ts) and the wire's `me.canPause` (wire.ts) both read
// it from here, so the phone's button and the server's refusal never differ.

import type { Room } from './hometowns';

/** The sentence a pause is refused with in a county of more than one mayor. */
export const SOLO_PAUSE_MESSAGE = 'Pausing is only for a county you play on your own.';

/** The joined, seated players of a room. */
export function seatedMayors(room: Pick<Room, 'players'>): Room['players'] {
  return room.players.filter((p) => p.status === 'joined' && !!p.seat);
}

/** The county's only mayor while it runs alone, else null. */
export function soloMayor(room: Pick<Room, 'phase' | 'players'>): Room['players'][number] | null {
  if (room.phase !== 'running') return null;
  const joined = seatedMayors(room);
  return joined.length === 1 ? joined[0] : null;
}

/**
 * The sole mayor who may pause (and so hold an uncapped pause): soloMayor, on a
 * parent's seat, else null. A pause left over from before decision 13 in a
 * county whose only mayor is now a child keeps its season cap, since that
 * child cannot end it.
 */
export function soloPauser(room: Pick<Room, 'phase' | 'players' | 'county'>): Room['players'][number] | null {
  const solo = soloMayor(room);
  return solo && room.county.parents.includes(solo.seat!) ? solo : null;
}

/** Whether `playerId` may pause the county now: its sole mayor, on a parent's seat. */
export function canPause(room: Pick<Room, 'phase' | 'players' | 'county'>, playerId: string): boolean {
  return soloPauser(room)?.id === playerId;
}
