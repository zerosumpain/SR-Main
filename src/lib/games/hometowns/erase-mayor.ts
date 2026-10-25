// Erasing a mayor from a county (spec §10.14, §20 A33): their town is
// archived and everything that names them is scrubbed, while every other
// town, link and ledger in the county carries on. The adapter's
// `durable.erasePlayer` (hometowns.ts `erasePlayer`) calls this on the room's
// county with the mayor's seat and player id, then scrubs the room around it
// (players, visits, the push window, the host) and closes a county left with
// nobody; the registry then checks that the player id and name appear
// nowhere (`erase-seat.ts` keepSeat) and deletes the room if either does.
//
// What archiving does to the economy — links closing at the next Regional
// Day, contracts ending without penalty, intents dropped — is the engine's,
// keyed on `archived` (A33). This file only does what must happen at the
// instant of erasure: the town is frozen, renamed "Old Town <site number>",
// given the generic avatar, and loses what was theirs to read or undo (inbox,
// Initiatives, pending moves, the undo window). Their seat id becomes a
// placeholder everywhere it appears, so the engine's lookups by seat still
// work and the site stays occupied (A33: sites are never freed in v1).
//
// PURE and in place, like every engine move: the caller passes the room's
// own copy.

import { regionOf } from './engine/region-state';
import type { CountyState, SeatId } from './engine/types';

/** An erased mayor's seat: never a player id, one per site, the same however often it runs. */
export const formerSeat = (site: number): SeatId => `former-${site + 1}`;
/** The name an erased mayor's town is shown under (§8.1). */
export const formerName = (site: number): string => `Old Town ${site + 1}`;
/** The avatar key an erased mayor's town shows: the app's generic one. */
export const FORMER_AVATAR = 'former';

/**
 * Ids this long are keyed hashes (`playerId` is 'p_' + 12 hex) and are
 * replaced inside longer strings too ("3:p_…"); a shorter seat label ('s1')
 * could occur by chance inside an encoded plane, so it is replaced only
 * where it is the whole value or key.
 */
const SUBSTRING_MIN = 8;

/**
 * Replace each id `from` with its `to` throughout `value`, in place: whole
 * string values and keys, and within longer strings for ids long enough to
 * be hashes. Only ever ids the engine or the adapter made (seats, owner
 * ids), never a name a person chose.
 */
function replaceDeep(value: unknown, swaps: readonly [string, string][]): unknown {
  const swap = (s: string): string => {
    for (const [from, to] of swaps) {
      if (s === from) return to;
      if (from.length >= SUBSTRING_MIN && s.includes(from)) s = s.split(from).join(to);
    }
    return s;
  };
  if (typeof value === 'string') return swap(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = replaceDeep(value[i], swaps);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const next = replaceDeep(obj[key], swaps);
      const k = swap(key);
      if (k !== key) {
        delete obj[key];
        obj[k] = next;
      } else obj[key] = next;
    }
    return obj;
  }
  return value;
}

/**
 * Archive and scrub the town of the mayor seated as `seat` (or owned by
 * `ownerId`: the adapter founds a town with its seat as the owner, and passes
 * the player id here too, so either finds it). Returns the town's
 * index, or null when they had no town yet (their seat is still taken out of
 * the county's settings, parents and log). Safe to run twice.
 */
export function eraseMayor(c: CountyState, who: { seat: SeatId; ownerId?: string }): number | null {
  const ids = [who.seat, who.ownerId].filter((s): s is string => typeof s === 'string' && s.length > 0);
  const index = c.towns.findIndex((t) => ids.includes(t.seat) || ids.includes(t.ownerId));
  const t = index >= 0 ? c.towns[index] : null;

  // What only they could see or take back.
  c.log = c.log.filter((r) => !ids.includes(r.seat));
  c.parents = c.parents.filter((s) => !ids.includes(s));
  c.settings.youngestOrder = c.settings.youngestOrder.filter((s) => !ids.includes(s));
  for (const id of ids) delete c.settings.perSeat[id];

  const swaps: [string, string][] = [];
  if (t) {
    const placeholder = formerSeat(t.site);
    for (const id of new Set([...ids, t.seat, t.ownerId])) if (id && id !== placeholder) swaps.push([id, placeholder]);
    t.archived = true;
    t.sprintAuto = false;
    t.inbox = [];
    t.initiatives = 0;
    t.pending = [];
    t.undo = [];
    delete t.deputyUndo;
    delete t.mayorTouched;
    t.avatar = FORMER_AVATAR;
    // The town's name lives in exactly one place: the county refers to towns
    // by index everywhere else (Gazette, letters, stories, offers), and the
    // public card is built from `t.name` when it is sent. So the rename is
    // this one field. Never a search-and-replace on the old name: a name is
    // whatever the mayor chose, and "Road" or "Adult" would rewrite the
    // engine's own words across the county.
    t.name = formerName(t.site);
    // The M3 plaque, and anything else that must know this was an erasure and not a leaving.
    const g = regionOf(c);
    if (!g.erased.includes(index)) g.erased.push(index);
  } else {
    for (const id of ids) swaps.push([id, 'former']);
  }
  if (swaps.length) replaceDeep(c, swaps);
  return t ? index : null;
}
