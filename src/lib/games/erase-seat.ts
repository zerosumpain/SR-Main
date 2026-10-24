// Erasing one person from a durable room that outlives them.
//
// `$lib/people/erase` deletes every stored room the erased person sits in.
// For a game that lasts an evening that is right: the table ends. For a game
// that seats a whole family for months (a Hometowns county) it would delete
// everybody else's towns with the one person's. A game opts out by defining
// `durable.erasePlayer`; this file is what the erasure does with such a row,
// before the delete runs. A row this returns null for is left alone, so the
// delete that follows removes it exactly as it always has.
//
// The person's id is a keyed hash of their address (`playerId`), so the check
// that matters is mechanical: after the game's hook it must appear nowhere in
// the room or in the registry's bookkeeping beside it — not as a value, not
// as a key, not inside a longer string ("3:p_…", a push key). Anything left
// means the hook missed a place, and the room is deleted after all: a lost
// county is recoverable from nothing, but a kept id is a kept person. Their
// display name is checked the same way, as a whole value or key (a copied
// `name`, a "hosted by"): a name is a word, and searching inside longer
// strings for "Sam" would find it in somebody else's town name or an encoded
// map and delete a whole family's county over nothing. Free text inside the
// game is the game's to keep out (Hometowns has none: preset stickers and
// phrases, and the erased mayor's typed town name renamed).
//
// The kept room must also still make sense to the registry: somebody real in
// it (a player id, not a placeholder the game left in the seat), and, while
// it runs, a host who is one of those people and is playing. Otherwise it is
// deleted as before.
//
// PURE: no database, no clock, no registry. `erase-seat.server.ts` reads and
// writes the rows; `rooms.server.reloadRooms` brings memory into line.

import type { GameRules, RoomBase } from './catalogue';
import type { RoomMeta, StoredRoom } from './room-store';

/**
 * A real person's id: `playerId` is always 'p_' and a hash. A game that keeps
 * a placeholder for an erased seat gives it any other id ('former-2').
 */
export const isPersonId = (id: unknown): boolean => typeof id === 'string' && id.startsWith('p_') && id.length > 2;

/** Whether `name` is any whole string value or object key in `value` (after trimming). */
export function names(value: unknown, name: string): boolean {
  if (typeof value === 'string') return value.trim() === name;
  if (Array.isArray(value)) return value.some((v) => names(v, name));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k.trim() === name || names(v, name)) return true;
  }
  return false;
}

/** Whether `id` appears anywhere in `value`: a string containing it, or an object key containing it. */
export function mentions(value: unknown, id: string): boolean {
  if (!id) return false;
  if (typeof value === 'string') return value.includes(id);
  if (Array.isArray(value)) return value.some((v) => mentions(v, id));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) if (k.includes(id) || mentions(v, id)) return true;
  }
  return false;
}

/**
 * The registry's bookkeeping without these players: who saw or was pushed an
 * invite, and who a "your move" push reached. A push key that names one of
 * them (it is "turn + who") is dropped with its reach list, so the next
 * decision rings afresh.
 */
export function scrubMeta(meta: Partial<RoomMeta> | null | undefined, ids: readonly string[]): RoomMeta {
  const gone = (s: unknown) => typeof s === 'string' && ids.some((id) => s.includes(id));
  const keep = (list: unknown) => (Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && !gone(s)) : []);
  const turn = meta?.turnPushed;
  return {
    ...(meta ?? {}),
    optionKeys: Array.isArray(meta?.optionKeys) ? meta.optionKeys : [],
    round: typeof meta?.round === 'number' ? meta.round : 0,
    recorded: meta?.recorded === true,
    sawInvite: keep(meta?.sawInvite),
    pushed: keep(meta?.pushed),
    turnPushed: turn && typeof turn.key === 'string' && !gone(turn.key) ? { key: turn.key, ids: keep(turn.ids) } : null,
    finishPushed: meta?.finishPushed === true,
  };
}

/** The stored room as this game plays it now (a row written under an older schema is revived), or null. */
function readable(rules: GameRules, row: StoredRoom): RoomBase | null {
  const durable = rules.durable!;
  const state = structuredClone(row.state);
  if (row.stateSchema === durable.schema) return state as unknown as RoomBase;
  return durable.revive?.(state, row.stateSchema) ?? null;
}

/**
 * The row to write in place of `row` with `erased` taken out of it, or null
 * when the room should be deleted as before: the game has no
 * `erasePlayer`, cannot read the row, refuses (null or a throw), leaves
 * nobody real, leaves a running room without a playing host, or leaves any
 * trace of an erased id or of the name the room knew them by. `erased` is
 * every id the person has (one per address); ids not in this room are
 * skipped.
 *
 * The kept row is a new version (so a stale in-memory copy loses its next
 * write and reloads), with `playerIds`, `hostId`, `phase` and the deadline
 * read off the room the hook returned. A room the hook closes (the last
 * active mayor gone) is stamped closed now and leaves under the closed-room
 * retention rule.
 */
export function keepSeat(row: StoredRoom, erased: readonly string[], now: number, rules: GameRules | undefined): StoredRoom | null {
  const hook = rules?.durable?.erasePlayer;
  if (!rules || !hook) return null;
  const tag = `[account] ${row.id} (${row.game})`;
  let room: RoomBase | null;
  // The names the room shows them under, read before the game takes them out (3+ characters: "Al" is not a check).
  const gone: string[] = [];
  let hostBefore: string | null = null;
  try {
    room = readable(rules, row);
    hostBefore = room?.hostId ?? null;
    for (const p of room?.players ?? []) {
      const name = typeof p?.name === 'string' ? p.name.trim() : '';
      if (erased.includes(p.id) && name.length >= 3 && !gone.includes(name)) gone.push(name);
    }
    for (const id of erased) {
      if (!room) break;
      if (!mentions(room, id)) continue;
      room = hook(structuredClone(room), id, now);
    }
  } catch (err) {
    console.error(`${tag}: the game could not erase a seat; deleting the room`, (err as Error)?.message ?? err);
    return null;
  }
  if (!room) return null;
  if (!Array.isArray(room.players) || !room.players.some((p) => isPersonId(p?.id))) return null;
  // JSON-safe by the durable contract; the round trip is what a restart reads.
  const state = JSON.parse(JSON.stringify(room)) as Record<string, unknown>;
  const meta = scrubMeta(row.meta, erased);
  if (erased.some((id) => mentions(state, id) || mentions(meta, id))) {
    console.error(`${tag}: the game left an erased player's id in the room; deleting the room`);
    return null;
  }
  const kept = state as unknown as RoomBase;
  // Somebody still in the room may share the name ("Mum" twice): then it is theirs, and not checked.
  const shared = (name: string) => kept.players.some((p) => typeof p.name === 'string' && p.name.trim() === name);
  if (gone.some((name) => !shared(name) && (names(state, name) || names(meta, name)))) {
    console.error(`${tag}: the game left an erased player's name in the room; deleting the room`);
    return null;
  }
  // The host must be one of the people in it; one the game passed the role
  // to (the erased person was hosting) must be playing, while the room runs.
  const host = kept.players.find((p) => p.id === kept.hostId);
  const over = kept.phase === 'finished' || kept.phase === 'closed';
  if (!host || !isPersonId(host.id) || (!over && kept.hostId !== hostBefore && host.status !== 'joined')) {
    console.error(`${tag}: the game passed the host to nobody playing; deleting the room`);
    return null;
  }
  let due: number | null = null;
  try {
    due = rules.deadline(kept);
  } catch {
    due = null;
  }
  const at = new Date(now);
  return {
    ...row,
    stateSchema: rules.durable!.schema,
    phase: kept.phase,
    hostId: kept.hostId,
    playerIds: kept.players.map((p) => p.id),
    state,
    meta,
    version: row.version + 1,
    dueAt: due === null || !Number.isFinite(due) ? null : new Date(due),
    updatedAt: at,
    finishedAt: kept.phase === 'finished' ? (row.finishedAt ?? at) : null,
    closedAt: kept.phase === 'closed' ? (row.closedAt ?? at) : null,
  };
}
