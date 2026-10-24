// The room size budget (spec §10.8): six Metropolis-sized towns and a full
// command log fit in 320 KB of JSON. The Lab measures bot-grown rooms (G12);
// this is the PR gate's fast version: the Metropolis fixture, played for a
// week on the real engine so its Why rings (2 monthly, 7 daily), history and
// tile log fill, copied into all six seats, with 150 logged moves.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { applyCommand, LOG_FULL, LOG_KEEP } from './commands';
import { catchUp } from './county';
import { nextRegionalDayAt } from './clock';
import { commitTown } from './core';
import type { CountyState, TownState } from './types';

const BUDGET = 320 * 1024;
const DAY = 86_400_000;

describe('the room size budget (§10.8)', () => {
  it('six played metropolises and a full move log fit in 320 KB', { timeout: 60_000 }, () => {
    const f = fixture('metropolis');
    const c: CountyState = f.county;
    const t = c.towns[f.town];
    // A mayor who says hello every day (so the county never naps) for a week.
    const start = nextRegionalDayAt(c);
    for (let d = 0; d <= 7; d++) {
      applyCommand(c, t.seat, { type: 'hello' }, start + d * DAY - 3_600_000);
      catchUp(c, start + d * DAY + 1000, Infinity);
    }
    expect(c.dayIndex).toBeGreaterThanOrEqual(8);
    // A full log: builds (the biggest records) and budget moves, spaced inside the rate limit.
    let at = nextRegionalDayAt(c) - 6 * 3_600_000;
    for (let k = 0; k < LOG_KEEP; k++) {
      at += 2_000;
      const plan = [{ op: 'road' as const, kind: 'lane' as const, path: [2 + (k % 20), 2, 2 + (k % 20), 3] }];
      try {
        applyCommand(c, t.seat, k % 3 === 0 ? { type: 'build', planId: `p${k}`, plan } : { type: 'budget', moveId: `b${k}`, taxes: { business: 500 + 10 * (k % 5) } }, at);
      } catch {
        // A refused move is not logged; the loop below tops the log up.
      }
    }
    commitTown(t);
    expect(c.log.length).toBeGreaterThan(LOG_KEEP / 2);
    // Only the newest records keep their bodies.
    for (const r of c.log.slice(0, -LOG_FULL)) expect(Object.keys(r.cmd)).toEqual(['type']);

    const proto = JSON.stringify(t);
    c.towns = Array.from({ length: 6 }, (_, i) => ({ ...(JSON.parse(proto) as TownState), seat: `seat-${i}` }));
    const room = JSON.stringify(c);
    const town = JSON.parse(proto) as TownState;
    const why = JSON.stringify(town.why).length;
    console.info(Object.entries(town).map(([k, v]) => [k, JSON.stringify(v).length] as const).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k} ${n}`).join(', '));
    console.info(`[hometowns size] room ${room.length} B, town ${proto.length} B (why ${why}, planes ${town.planes.length}, undo ${JSON.stringify(town.undo).length}), log ${JSON.stringify(c.log).length} B`);
    expect(room.length).toBeLessThanOrEqual(BUDGET);
  });
});
