import { describe, expect, it } from 'vitest';
import { diffPlans, keepRunningDay, replaceDay, SITE_WHILE_OUT } from './changes';
import type { PlannedDay, PlannedStop, SolvedPlan } from './model';

const stop = (id: string, arriveMin: number, kind: PlannedStop['kind'] = 'wish'): PlannedStop => ({
  id,
  kind,
  wishId: kind === 'wish' ? id : null,
  title: id.toUpperCase(),
  location: { lat: 41.9, lng: 12.5 },
  arriveMin,
  departMin: arriveMin + 60,
  waitSec: 0,
  locked: false,
  bookingId: null,
  warnings: [],
});
const day = (date: string, stops: PlannedStop[]): PlannedDay => ({ date, stayId: 's', stops, legs: [], warnings: [] });
const plan = (days: PlannedDay[], dropped: SolvedPlan['dropped'] = []): SolvedPlan => ({ days, dropped, warnings: [], score: 0 });

describe('diffPlans', () => {
  it('says first plan when there is nothing before', () => {
    expect(diffPlans(null, plan([]))).toEqual(['First plan.']);
  });

  it('lists added, moved, retimed and dropped wishes, deterministically', () => {
    const a = plan([day('2026-10-27', [stop('a', 600), stop('b', 700)]), day('2026-10-28', [stop('c', 600)])]);
    const b = plan(
      [day('2026-10-27', [stop('a', 630), stop('d', 800)]), day('2026-10-28', [stop('b', 600)])],
      [{ wishId: 'c', reason: 'closed on Tuesdays' }],
    );
    const out = diffPlans(a, b, { a: 'Pantheon' });
    expect(out).toContain('Pantheon now 10:30 instead of 10:00 on Tue 27 Oct.');
    expect(out).toContain('D added on Tue 27 Oct at 13:20.');
    expect(out).toContain('B moved from Tue 27 Oct to Wed 28 Oct (10:00).');
    expect(out).toContain('C is no longer planned — closed on Tuesdays.');
    expect(diffPlans(a, b, { a: 'Pantheon' })).toEqual(out);
  });

  it('ignores a shift under 15 minutes', () => {
    expect(diffPlans(plan([day('2026-10-27', [stop('a', 600)])]), plan([day('2026-10-27', [stop('a', 610)])]))).toEqual([
      'No change to the schedule.',
    ]);
  });
});

describe('keepRunningDay', () => {
  it('keeps the phone day and lists what the site would have changed', () => {
    const phone = plan([day('2026-10-27', [stop('a', 600), stop('b', 720)]), day('2026-10-28', [])]);
    const site = plan([day('2026-10-27', [stop('a', 660)]), day('2026-10-28', [stop('b', 600)])], [{ wishId: 'x', reason: 'no time' }]);
    const { plan: kept, notes } = keepRunningDay(site, phone, '2026-10-27');
    expect(kept.days[0]).toBe(phone.days[0]);
    expect(kept.days[1]).toBe(site.days[1]);
    expect(notes.every((n) => n.startsWith(SITE_WHILE_OUT))).toBe(true);
    expect(notes.some((n) => n.includes('B is no longer planned'))).toBe(true);
  });
});

describe('replaceDay', () => {
  it('swaps one day and un-drops wishes the phone planned', () => {
    const p = plan([day('2026-10-27', [stop('a', 600)]), day('2026-10-28', [])], [{ wishId: 'z', reason: 'no time' }]);
    const next = replaceDay(p, day('2026-10-28', [stop('z', 600)]));
    expect(next.days[1].stops[0].id).toBe('z');
    expect(next.dropped).toEqual([]);
    expect(next.days[0]).toBe(p.days[0]);
  });
});
