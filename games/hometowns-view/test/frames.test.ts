// The page's merge of whole and delta frames (spec §10.7): the rule in
// engine/wire.ts, and the gap that makes the page ask for a whole frame.

import { describe, expect, it } from 'vitest';
import { FrameGap, mergeFrame, movesKey, type WireFrame } from '../src/core/frames';
import { HarnessSession } from '../src/harness/session';
import { stateHash, type TownState } from '../src/engine';

function frame(rev: number, base: number | null, extra: Partial<WireFrame> = {}): WireFrame {
  return {
    id: 'room',
    game: 'hometowns',
    phase: 'running',
    serverNow: 1000 + rev,
    rev,
    base,
    hostId: 'h',
    meId: 'h',
    players: [],
    client: { engineHash: 'x', page: '/p', bridge: 1 },
    clock: { gridTick: rev, tickMs: 30000, nextTickAt: 0, nextRegionalDayAt: 0, nextGazetteAt: 0, paused: false, napping: false, season: { n: 1, theme: '', day: 0, daysLeft: 42 } },
    me: null,
    ...extra,
  } as WireFrame;
}

describe('mergeFrame', () => {
  const s = new HarnessSession({ seed: 9 });
  const town0 = JSON.parse(JSON.stringify(s.town)) as TownState;
  s.runDays(1);
  const town1 = JSON.parse(JSON.stringify(s.town)) as TownState;
  const meBase = { seat: 'a', profile: 'adult' as const, isParent: true, townHash: '', derived: { stars: [1], meters: [], wants: [], advisors: [], needs: [], pipeline: { homes: 0, movers: 0 }, townTalk: [] }, inbox: [], moves: [{ id: 'p1', type: 'build', atTick: 3 }] };

  it('takes a whole frame as it is, without a towns patch', () => {
    const f = frame(5, null, { towns: [], townsPatch: [null] });
    const m = mergeFrame(null, f);
    expect(m.base).toBeNull();
    expect('townsPatch' in m).toBe(false);
  });

  it('fills every part a delta leaves out from the held frame, and applies the town delta', () => {
    const held = mergeFrame(null, frame(5, null, { towns: [{ name: 'A', pop: 1 } as never], county: { name: 'K' } as never, me: { ...meBase, town: town0, townHash: stateHash(town0) } as never }));
    // A delta never carries planes (a frame whose planes changed is whole), so this one keeps the old ones.
    const t1 = { ...town1, planes: town0.planes } as TownState;
    const changed: Partial<TownState> = {};
    for (const k of Object.keys(t1) as (keyof TownState)[]) if (JSON.stringify(t1[k]) !== JSON.stringify(town0[k])) (changed as Record<string, unknown>)[k] = t1[k];
    expect('planes' in changed).toBe(false);
    const delta = frame(6, 5, { townsPatch: [{ pop: 2 }], me: { seat: 'a', profile: 'adult', isParent: true, townHash: stateHash(t1), townDelta: { tick: town1.tick, tileEvents: '', changed } } as never });
    const m = mergeFrame(held, delta);
    expect(m.rev).toBe(6);
    expect(m.base).toBeNull();
    expect(m.county).toEqual({ name: 'K' });
    expect(m.towns).toEqual([{ name: 'A', pop: 2 }]);
    expect(m.me?.derived).toEqual(meBase.derived);
    expect(m.me?.moves).toEqual(meBase.moves);
    expect('townDelta' in (m.me ?? {})).toBe(false);
    expect(stateHash(m.me!.town!)).toBe(m.me!.townHash);
    // The held frame is untouched (the next delta merges against the page's copy of it).
    expect(stateHash(held.me!.town!)).toBe(stateHash(town0));
  });

  it('refuses a delta cut against another rev', () => {
    const held = mergeFrame(null, frame(5, null));
    expect(() => mergeFrame(held, frame(8, 7))).toThrow(FrameGap);
    expect(() => mergeFrame(null, frame(8, 7))).toThrow(FrameGap);
    try {
      mergeFrame(held, frame(8, 7));
    } catch (e) {
      expect((e as FrameGap).have).toBe(5);
    }
  });

  it('keys the moves a frame lists', () => {
    expect(movesKey(null)).toBe('');
    expect(movesKey(frame(1, null, { me: meBase as never }))).toBe('p1');
  });
});
