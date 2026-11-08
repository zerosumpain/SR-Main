import { describe, expect, it } from 'vitest';
import type { PlannedDay, PlannedStop } from './model';
import { changedStops, dayBrief, groupDay, stageOf } from './stages';

const s = (id: string, kind: PlannedStop['kind'], arriveMin: number, departMin: number, stage?: PlannedStop['stage']): PlannedStop => ({
  id, kind, wishId: kind === 'wish' ? id : null, title: id, location: null, arriveMin, departMin, waitSec: 0, locked: false, bookingId: null, warnings: [], ...(stage ? { stage } : {}),
});
const day = (stops: PlannedStop[]): PlannedDay => ({
  date: '2026-10-28', stayId: 's', stops,
  legs: stops.slice(1).map((x, i) => ({ fromStopId: stops[i].id, toStopId: x.id, mode: 'walk', durationSec: 600, distanceM: null, estimated: true, line: null })),
  warnings: [],
});

describe('stages', () => {
  const d = day([
    s('stay:2026-10-28:start', 'stay', 540, 540),
    s('meal:2026-10-28:breakfast', 'meal', 540, 570),
    s('Colosseum', 'wish', 580, 750),
    s('meal:2026-10-28:lunch', 'meal', 760, 820),
    s('Capitoline', 'wish', 830, 950),
    s('meal:2026-10-28:dinner', 'meal', 1170, 1245),
    s('Trastevere walk', 'wish', 1250, 1320),
    s('stay:2026-10-28:end', 'stay', 1335, 1335),
  ]);

  it('applies the solver’s stage rule to an old plan with no stages', () => {
    expect(d.stops.map((x) => stageOf(x, d))).toEqual(['morning', 'morning', 'morning', 'lunch', 'afternoon', 'evening', 'evening', 'evening']);
  });

  it('prefers the solver’s stage', () => {
    expect(stageOf(s('x', 'wish', 600, 660, 'afternoon'), d)).toBe('afternoon');
  });

  it('groups into all four stages with the leg into each stop, never running backwards', () => {
    const g = groupDay(d);
    expect(g.map((x) => [x.stage, x.items.map((i) => i.stop.id)])).toEqual([
      ['morning', ['stay:2026-10-28:start', 'meal:2026-10-28:breakfast', 'Colosseum']],
      ['lunch', ['meal:2026-10-28:lunch']],
      ['afternoon', ['Capitoline']],
      ['evening', ['meal:2026-10-28:dinner', 'Trastevere walk', 'stay:2026-10-28:end']],
    ]);
    expect(g[0].items[0].legIn).toBeNull();
    expect(g[1].items[0].legIn?.fromStopId).toBe('Colosseum');
    const odd = day([s('a', 'wish', 600, 700, 'afternoon'), s('b', 'wish', 710, 760, 'morning')]);
    expect(groupDay(odd).map((x) => x.items.length)).toEqual([0, 0, 2, 0]);
  });

  it('briefs a day and finds what changed', () => {
    expect(dayBrief(d)).toEqual({ morning: ['meal:2026-10-28:breakfast', 'Colosseum'], lunch: ['meal:2026-10-28:lunch'], afternoon: ['Capitoline'], evening: ['meal:2026-10-28:dinner', 'Trastevere walk'] });
    const moved = { days: [{ ...d, stops: d.stops.map((x) => (x.id === 'Capitoline' ? { ...x, arriveMin: 840 } : x)) }] };
    expect([...changedStops({ days: [d] }, moved)]).toEqual(['Capitoline']);
    expect(changedStops(null, moved).size).toBe(0);
  });
});
