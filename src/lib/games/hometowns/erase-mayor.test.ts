// Erasing one mayor from a real county (engine-built, three towns): their
// town is archived and scrubbed, the county keeps running, and nothing in it
// names them any more. No balance numbers are asserted — only that erasure
// moves no money, keeps every other town byte-for-byte, and leaves the
// county valid and steppable.

import { describe, expect, it } from 'vitest';
import { applyCommand, catchUp, checkCounty, createCounty, foundTown } from './engine';
import { settleLeavers } from './engine/regional-day';
import type { CountyState, RegionalContext } from './engine/types';
import { eraseMayor, FORMER_AVATAR, formerName, formerSeat } from './erase-mayor';
import { mentions } from '../erase-seat';

const EPOCH = Date.UTC(2026, 9, 20, 12, 0);
const DAY = 86_400_000;
// Seats are the games' hashed player ids, as the adapter founds them.
const A = 'p_aaaaaaaaaaa1';
const B = 'p_bbbbbbbbbbb2';
const C = 'p_ccccccccccc3';

function county(): CountyState {
  const c = createCounty({
    seed: 7,
    params: 'v1',
    settings: {
      rivalry: 'friendly',
      mishaps: 'mild',
      youngestOrder: [],
      perSeat: {},
    },
    epoch: EPOCH,
    now: EPOCH,
  });
  c.settings.perSeat[B] = {
    profile: 'kid',
    pushes: false,
    pranks: true,
    answerOnly: false,
    assist: 'gentle',
  };
  c.parents.push(A);
  // Founded through the move, so the log holds each founding (name, avatar and owner included).
  applyCommand(
    c,
    A,
    {
      type: 'found',
      moveId: 'm1',
      site: 0,
      name: 'Harbourside',
      nameAllowed: true,
      avatar: 'fox',
      flag: 0,
      ownerId: A,
    },
    EPOCH,
  );
  applyCommand(
    c,
    B,
    {
      type: 'found',
      moveId: 'm2',
      site: 1,
      name: 'Bramblebury',
      nameAllowed: true,
      avatar: 'owl',
      flag: 1,
      ownerId: B,
    },
    EPOCH,
  );
  foundTown(
    c,
    C,
    {
      site: 2,
      name: 'Millbrook',
      nameAllowed: true,
      avatar: 'hare',
      flag: 2,
      ownerId: C,
    },
    EPOCH,
  );
  return c;
}

const reserves = (c: CountyState) => c.towns.reduce((sum, t) => sum + t.money.reserves, 0);

describe('eraseMayor', () => {
  it('archives the town under its site name and leaves no trace of the mayor', () => {
    const c = county();
    const i = eraseMayor(c, { seat: B, ownerId: B });
    expect(i).toBe(1);
    const t = c.towns[1];
    expect(t.archived).toBe(true);
    expect(t.name).toBe(formerName(t.site));
    expect(t.avatar).toBe(FORMER_AVATAR);
    expect(t.seat).toBe(formerSeat(t.site));
    expect(t.inbox).toEqual([]);
    expect(t.initiatives).toBe(0);
    expect(t.pending).toEqual([]);
    expect(t.undo).toEqual([]);
    expect(mentions(c, B)).toBe(false);
    expect(JSON.stringify(c)).not.toContain('Bramblebury');
    expect(c.settings.perSeat[B]).toBeUndefined();
    expect(c.settings.youngestOrder).not.toContain(B);
  });

  it('keeps the county whole: every other town untouched, no money moved, the site still taken', () => {
    const c = county();
    const before = JSON.parse(JSON.stringify(c)) as CountyState;
    eraseMayor(c, { seat: B, ownerId: B });
    expect(c.towns).toHaveLength(3);
    expect(c.towns[0]).toEqual(before.towns[0]);
    expect(c.towns[2]).toEqual(before.towns[2]);
    expect(reserves(c)).toBe(reserves(before));
    expect(c.fund).toBe(before.fund);
    expect(c.sites[1].owner).toBe(formerSeat(1));
    expect(c.sites[0].owner).toBe(A);
    expect(c.parents).toEqual([A]);
    expect(c.log.map((r) => r.seat)).toEqual(before.log.filter((r) => r.seat !== B).map((r) => r.seat));
    expect(checkCounty(c)).toEqual(checkCounty(before));
    // A33: an archived site is never freed in v1.
    expect(() => foundTown(c, 'p_ddddddddddd4', { site: 1, name: 'Newtown', nameAllowed: true, avatar: 'fox', flag: 0 }, EPOCH)).toThrow();
  });

  it('is idempotent, and the same however the mayor is named (seat or owner)', () => {
    const once = county();
    eraseMayor(once, { seat: B, ownerId: B });
    const twice = JSON.parse(JSON.stringify(once)) as CountyState;
    expect(eraseMayor(twice, { seat: B, ownerId: B })).toBeNull();
    expect(twice).toEqual(once);
    const byOwner = county();
    eraseMayor(byOwner, { seat: 'unknown-seat', ownerId: B });
    expect(byOwner).toEqual(once);
  });

  it('scrubs a parent seat that never founded a town', () => {
    const c = county();
    const P = 'p_eeeeeeeeeee5';
    c.parents.push(P);
    c.settings.youngestOrder.push(P);
    expect(eraseMayor(c, { seat: P })).toBeNull();
    expect(mentions(c, P)).toBe(false);
    expect(c.towns.every((t) => !t.archived)).toBe(true);
  });

  it('renames only the town: a name that is also one of the engine’s words changes nothing else', () => {
    const c = county();
    // A town called "road" (or "adult") must not rewrite every road link or every grown-up's profile.
    c.towns[1].name = 'road';
    c.settings.perSeat[A] = {
      profile: 'adult',
      pushes: false,
      pranks: true,
      answerOnly: false,
      assist: 'gentle',
    };
    c.links.push({
      id: 'L',
      kind: 'road',
      a: 0,
      b: 2,
      state: 'open',
      proposedDay: 0,
      openedDay: 0,
      closeDay: null,
      paid: [0, 0],
      minutes: 50,
    });
    const before = JSON.parse(JSON.stringify(c)) as CountyState;
    eraseMayor(c, { seat: B, ownerId: B });
    expect(c.towns[1].name).toBe(formerName(c.towns[1].site));
    expect(c.links).toEqual(before.links);
    expect(c.settings.perSeat[A]).toEqual(before.settings.perSeat[A]);
    // Recorded as an erasure, for the M3 plaque.
    expect(c.region?.erased).toEqual([1]);
  });

  it('renames a town whose mayor left before being erased', () => {
    const c = county();
    c.towns[1].archived = true;
    settleLeavers(c, { dayIndex: c.dayIndex } as RegionalContext);
    expect(c.towns[1].name).toBe('Old Bramblebury');
    eraseMayor(c, { seat: B, ownerId: B });
    expect(c.towns[1].name).toBe(formerName(c.towns[1].site));
    expect(JSON.stringify(c)).not.toContain('Bramblebury');
  });

  it('keeps running after the erasure: the others step on, the archived town stays frozen', () => {
    const c = county();
    eraseMayor(c, { seat: B, ownerId: B });
    const frozen = c.towns[1].tick;
    const r = catchUp(c, EPOCH + DAY, 1e9);
    expect(r.done).toBe(true);
    expect(c.towns[1].tick).toBe(frozen);
    expect(checkCounty(c)).toEqual([]);
    expect(mentions(c, B)).toBe(false);
  });
});
