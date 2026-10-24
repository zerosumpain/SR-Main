// The determinism contract (spec §10.4 item 7) on the REAL step table, with
// bot mayors making moves between chunks: catch-up gives the same county for
// any budget, after a revive (JSON round trip) after every chunk, and with
// the towns stepped in a shuffled order. determinism.test.ts proves the same
// against a toy economy; this file is what catches a real step that keeps
// hidden state between ticks or reads the clock.
//
// GOLDEN_HASH pins the result. It is the fixture the page project's WebKit
// run must reproduce (Node and JavaScriptCore agree, §10.4 item 7), and it
// changes whenever the engine or params.v1.json changes the simulation: then
// rerun this file and copy the new hash from the failure, after checking that
// the change was meant to move the numbers.

import { describe, expect, it } from 'vitest';
import { newCounty } from '../../../../../scripts/hometowns/fixture';
import { BOTS, brambleCommands, viewOf } from './bots/index';
import { stylePolicy } from './bots/mayors';
import { gridTickAt, nextRegionalDayAt } from './clock';
import { applyCommand } from './commands';
import { catchUp } from './county';
import { countyHash } from './index';
import { catchUpTown } from './tick';
import type { CountyState } from './types';

const DAY = 86_400_000;
const PLAYERS = ['balanced', 'industrial', 'tourist'] as const;
const DAYS = 2;

const GOLDEN_HASH = 'c7cd4324fd0d4214';

/** Three bot towns founded on the real engine, Bramble's steps taken and the fortnight tapped through. */
function founded(seed = 3): { c: CountyState; now: number } {
  const c = newCounty(seed);
  PLAYERS.forEach((b, i) => (c.settings.perSeat[`s${i}`] = { profile: BOTS[b].profile, pushes: false, pranks: false, answerOnly: false, assist: 'none' } as never));
  let now = nextRegionalDayAt(c) + 3_600_000;
  catchUp(c, now, Infinity);
  PLAYERS.forEach((_, i) => {
    applyCommand(c, `s${i}`, { type: 'found', site: i, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: i }, now);
    for (const cmd of brambleCommands(viewOf(c, `s${i}`, now)!)) applyCommand(c, `s${i}`, cmd, now + 500);
  });
  for (let k = 0; k < 12; k++) {
    now += 10_000;
    PLAYERS.forEach((_, i) => applyCommand(c, `s${i}`, { type: 'sprint', moveId: `t${k}` }, now + i));
  }
  return { c, now: now + 60_000 };
}

/** A fixed LCG for the bots' choices: the same session always makes the same moves. */
const lcg = (s: number) => {
  let a = s >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
};

interface Way {
  budget: number;
  /** JSON round trip after every chunk. */
  revive?: boolean;
  /** Step the towns one by one in this order up to each session before the county catch-up. */
  order?: number[];
}

/** Bot sessions at fixed instants; between them the county is caught up `way`'s way. */
function play(way: Way): { h: string; pops: number[]; day: number } {
  const start = founded();
  let c = start.c;
  const sessions: [number, number][] = [];
  for (let d = 0; d < DAYS; d++) for (let i = 0; i < PLAYERS.length; i++) sessions.push([start.now + d * DAY + (i + 1) * 4_000_000, i]);
  const drain = (to: number) => {
    for (;;) {
      const r = catchUp(c, to, way.budget);
      if (way.revive) c = JSON.parse(JSON.stringify(c)) as CountyState;
      if (r.done) return;
    }
  };
  for (const [at, i] of sessions) {
    if (way.order) {
      const g = gridTickAt(c, Math.min(at, nextRegionalDayAt(c)) - 1);
      for (const k of way.order) catchUpTown(c, k, g);
    }
    drain(at);
    const v = viewOf(c, `s${i}`, at);
    if (!v) continue;
    const bot = PLAYERS[i];
    const cmds = stylePolicy(bot, BOTS[bot].style)(v, lcg(at + i) as never);
    cmds.slice(0, 6).forEach((cmd, k) => {
      try {
        applyCommand(c, `s${i}`, cmd, at + 1000 + k);
      } catch {
        // A refused move is part of the scenario: it must be refused the same way every time.
      }
    });
  }
  drain(start.now + DAYS * DAY + 7_200_000);
  return { h: countyHash(c), pops: c.towns.map((t) => t.people.reduce((a, b) => a + b, 0)), day: c.dayIndex };
}

describe('determinism on the real engine (§10.4 item 7)', () => {
  const reference = play({ budget: Infinity });

  it('the county actually grows (otherwise the checks below prove nothing)', () => {
    expect(reference.day).toBeGreaterThanOrEqual(DAYS);
    for (const n of reference.pops) expect(n).toBeGreaterThan(100);
  });

  it('matches the golden hash', () => {
    expect(reference.h).toBe(GOLDEN_HASH);
  });

  it('small chunks with a revive after every one give the same county', () => {
    expect(play({ budget: 96, revive: true })).toEqual(reference);
  });

  it('towns stepped in a shuffled order, in tiny chunks, give the same county', () => {
    expect(play({ budget: 7, order: [2, 0, 1] })).toEqual(reference);
  });
});
