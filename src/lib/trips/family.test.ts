import { describe, expect, it } from 'vitest';
import { dayFullness, fullnessBand, legAlternatives, suggestionWish, tripAccess, wireTravellers } from './family';
import { solverRules } from './solver';
import { activeMealMin } from './solver/rules';
import type { PlannedDay, PlannedStop, TravelMatrix } from './model';

// v5, the pure half: who may do what, how full a day is, the ways of doing a leg.

describe('tripAccess', () => {
  const parent = { email: 'Dad@Example.test', parent: true };
  const kid = { email: 'kid@example.test', parent: false };

  it('the creator edits freely; a parent creator also approves', () => {
    expect(tripAccess('dad@example.test', parent)).toEqual({ canEdit: true, canApprove: true, canSuggest: true, canDelete: true, role: 'creator' });
    expect(tripAccess('kid@example.test', kid)).toEqual({ canEdit: true, canApprove: false, canSuggest: true, canDelete: true, role: 'creator' });
  });

  it('another parent edits and approves; anyone else in the family only suggests', () => {
    expect(tripAccess('mum@example.test', parent)).toEqual({ canEdit: true, canApprove: true, canSuggest: true, canDelete: false, role: 'parent' });
    expect(tripAccess('mum@example.test', kid)).toEqual({ canEdit: false, canApprove: false, canSuggest: true, canDelete: false, role: 'member' });
  });
});

describe('fullness', () => {
  it('bands at 10 / 50 / 85 / 100', () => {
    expect([0, 9, 10, 49, 50, 84, 85, 100, 101].map(fullnessBand)).toEqual(['empty', 'empty', 'light', 'light', 'balanced', 'balanced', 'full', 'full', 'overfull']);
  });

  const stop = (id: string, kind: PlannedStop['kind'], arriveMin: number, departMin: number, extra: Partial<PlannedStop> = {}): PlannedStop =>
    ({ id, kind, wishId: kind === 'wish' ? id : null, title: id, location: null, arriveMin, departMin, waitSec: 0, locked: false, bookingId: null, warnings: [], ...extra }) as PlannedStop;
  const leg = (from: string, to: string, min: number) => ({ fromStopId: from, toStopId: to, mode: 'walk' as const, durationSec: min * 60, distanceM: 1000, estimated: false });

  it('counts time at places and the travel to them against the pace’s capacity; meals and the stay do not count', () => {
    const rules = solverRules('normal');
    const capacity = rules.activeEndMin - rules.dayStartMin - activeMealMin(rules);
    const day: PlannedDay = {
      date: '2026-10-28', stayId: 's', warnings: [],
      stops: [stop('stay', 'stay', 540, 540), stop('museum', 'wish', 560, 680, { waitSec: 600 }), stop('lunch', 'meal', 700, 760)],
      legs: [leg('stay', 'museum', 20), leg('museum', 'lunch', 20)],
    } as unknown as PlannedDay;
    const f = dayFullness(day, 'normal');
    expect(f.capacityMin).toBe(capacity);
    expect(f.activeMin).toBe(120 - 10 + 20);
    expect(f.pct).toBe(Math.round((130 / capacity) * 100));
    // A light day has less room, so the same day is fuller.
    expect(dayFullness(day, 'normal', 'light').pct).toBeGreaterThan(f.pct);
    expect(dayFullness({ ...day, stops: [day.stops[0]], legs: [] }, 'normal').band).toBe('empty');
  });
});

describe('legAlternatives', () => {
  const day = {
    date: '2026-10-28', stayId: 'campo', warnings: [], legs: [],
    stops: [
      { id: 'stay:2026-10-28:start', kind: 'stay', wishId: null, title: 'Flat', location: { lat: 41.8956, lng: 12.4722 } },
      { id: 'pantheon', kind: 'wish', wishId: 'pantheon', title: 'Pantheon', location: { lat: 41.8986, lng: 12.4769 } },
    ],
  } as unknown as PlannedDay;
  const matrix: TravelMatrix = {
    points: ['stay:campo', 'pantheon'],
    seconds: { walk: [[0, 600], [600, 0]], drive: [[0, 300], [300, 0]] },
    metres: {},
    estimated: { walk: false, drive: true },
  };

  it('walk, public transport and taxi from the matrix, estimating what it lacks', () => {
    const alts = legAlternatives('stay:2026-10-28:start', 'pantheon', day, matrix);
    expect(alts.map((a) => a.mode)).toEqual(['walk', 'transit', 'taxi']);
    expect(alts[0]).toEqual({ mode: 'walk', durationSec: 600, estimated: false });
    expect(alts[1].estimated).toBe(true); // no transit row: a distance estimate
    expect(alts[2].durationSec).toBeGreaterThan(300); // taxi = drive + pickup
    expect(alts[2].estimated).toBe(true);
  });

  it('estimates everything without a matrix, and nothing for an unknown stop', () => {
    expect(legAlternatives('stay:2026-10-28:start', 'pantheon', day, null).every((a) => a.estimated)).toBe(true);
    expect(legAlternatives('nope', 'pantheon', day, null)).toEqual([]);
    // Same place: nothing to travel, by any mode.
    expect(legAlternatives('pantheon', 'pantheon', day, matrix).map((a) => a.durationSec)).toEqual([0, 0, 0]);
  });
});

describe('the wire and suggestions', () => {
  it('wireTravellers keeps name, relation, age and id — never notes', () => {
    const w = wireTravellers({ travellers: [{ name: 'Sam', relation: 'son', notes: ['loves gelato'], age: 9, personId: 'f_sam' }], preferences: [], constraints: [], history: [], gatheredAt: 'x' });
    expect(w).toEqual([{ name: 'Sam', relation: 'son', age: 9, personId: 'f_sam' }]);
    expect(wireTravellers(null)).toEqual([]);
  });

  it('an approved suggestion becomes a wish pinned to its day and stage, lunch as the meal', () => {
    const wish = { title: 'Gelato', placeQuery: 'Giolitti' } as never;
    expect(suggestionWish({ date: '2026-10-28', stage: 'afternoon', wish })).toMatchObject({ fixedDate: '2026-10-28', partOfDay: 'afternoon', replacesMeal: null, priority: 'nice' });
    expect(suggestionWish({ date: '2026-10-28', stage: 'lunch', wish })).toMatchObject({ partOfDay: 'any', replacesMeal: 'lunch' });
  });
});
