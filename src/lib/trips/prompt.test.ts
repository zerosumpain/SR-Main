import { describe, expect, it } from 'vitest';
import type { Stay, Trip, TripMessage, Wish } from './model';
import { contextText, HISTORY_MESSAGES, missingInfo, NEW_TRIP, PLANNER_SYSTEM, plannerMessages, planSummary, type PlannerContext } from './prompt';
import { emptyFacts } from './research';

const trip: Trip = {
  id: 't', ownerEmail: 'o', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-27',
  endDate: '2026-10-30', pace: 'normal', modes: ['walk', 'transit'], status: 'planned', notes: 'Two adults',
};
const stay: Stay = { id: 's1', name: 'Flat', address: 'Via dei Cappellari 10, Rome, Lazio, Italy', location: { lat: 41.9, lng: 12.47 }, fromDate: '2026-10-27', toDate: '2026-10-31', checkInMin: null, checkOutMin: null };
const wish = (over: Partial<Wish>): Wish => ({
  id: 'w1', title: 'Borghese Gallery', place: { name: 'Galleria Borghese', location: { lat: 41.91, lng: 12.49 }, osmId: null, address: null },
  priority: 'must', durationSec: 7200, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false,
  facts: { ...emptyFacts(), bookingRequired: true, bookAheadDays: 21, bookingUrl: 'https://www.galleriaborghese.beniculturali.it/', unknown: ['price'] },
  note: null, sortHint: 0, ...over,
});
const msg = (i: number, role: TripMessage['role'] = 'user'): TripMessage => ({ id: `m${i}`, role, text: `message ${i}`, ops: [], planVersion: null, surface: 'site', createdAt: '2026-10-14T09:00:00Z' });

function ctx(over: Partial<PlannerContext> = {}): PlannerContext {
  return { trip, stays: [stay], wishes: [wish({})], bookings: [], plan: null, planVersion: null, messages: [], nowText: 'Wed 14 Oct, 09:12', surface: 'site', observation: null, position: null, ...over };
}

describe('the planner system prompt', () => {
  it('fixes the job, the output and the rules that matter', () => {
    expect(PLANNER_SYSTEM).toMatch(/Answer ONLY with one JSON object/);
    expect(PLANNER_SYSTEM).toMatch(/"reply": string, "ops": Op\[\], "quickReplies"/);
    expect(PLANNER_SYSTEM).toMatch(/Never invent a booking link/);
    expect(PLANNER_SYSTEM).toMatch(/British English/);
    expect(PLANNER_SYSTEM).toMatch(/ask for it/);
    expect(PLANNER_SYSTEM).toMatch(/explain|Explain/);
    for (const op of ['setTrip', 'addStay', 'updateStay', 'removeStay', 'addWish', 'updateWish', 'removeWish', 'addBooking', 'updateBooking', 'research', 'suggestNearby']) {
      expect(PLANNER_SYSTEM).toContain(`"op":"${op}"`);
    }
  });
});

describe('contextText', () => {
  it('lists the trip, ids, facts and what is missing', () => {
    const text = contextText(ctx());
    expect(text).toContain('Now in the trip\'s zone: Wed 14 Oct, 09:12');
    expect(text).toContain('[s1] Flat (Via dei Cappellari 10, Rome, Lazio)');
    expect(text).toContain('[w1] Borghese Gallery — must; 120 min; at Galleria Borghese; booking required, ~21 days ahead; official tickets https://www.galleriaborghese.beniculturali.it/; unknown: price');
    expect(text).toContain('No plan yet.');
    expect(text).not.toContain('STILL MISSING');
  });

  it('includes what the phone noticed and where it is', () => {
    const text = contextText(ctx({ surface: 'phone', observation: { kind: 'unplanned-stop', place: { name: 'Bar del Fico', location: { lat: 41.9, lng: 12.47 } }, sinceMin: 735, motion: 'stationary', stopId: null }, position: { lat: 41.9, lng: 12.47 } }));
    expect(text).toContain('THE PHONE NOTICED: unplanned-stop since 12:15, stationary, at Bar del Fico.');
    expect(text).toContain('Phone position: 41.90000, 12.47000');
    expect(text).toContain('on the phone');
  });
});

describe('missingInfo', () => {
  it('asks for the destination of a new trip, stays, gaps, wishes and places', () => {
    expect(missingInfo({ ...trip, destination: NEW_TRIP }, [], [])).toEqual([
      'destination, and the first and last day (the dates shown are placeholders)',
      'where they are staying',
      'what they want to do',
    ]);
    const short = { ...stay, toDate: '2026-10-29' };
    expect(missingInfo(trip, [short], [wish({ place: null })])).toEqual(['a stay for the night(s) of Thu 29 Oct', 'a findable place for: Borghese Gallery']);
  });
});

describe('plannerMessages', () => {
  it('is system, context, the last messages, then the new text', () => {
    const history = Array.from({ length: 40 }, (_, i) => msg(i, i % 2 ? 'assistant' : 'user'));
    history.push({ ...msg(99, 'event'), text: 'Pantheon changed (priority).' });
    const out = plannerMessages(ctx({ messages: history }), 'Make Thursday lighter');
    expect(out[0]).toEqual({ role: 'system', content: PLANNER_SYSTEM });
    expect(out[1].content).toMatch(/^TRIP/);
    expect(out).toHaveLength(3 + HISTORY_MESSAGES + 1);
    expect(out.at(-2)).toEqual({ role: 'user', content: '[changed directly on the page] Pantheon changed (priority).' });
    expect(out.at(-1)).toEqual({ role: 'user', content: 'Make Thursday lighter' });
  });
});

describe('planSummary', () => {
  it('summarises each day with times, modes, warnings and drops', () => {
    const plan = {
      days: [
        {
          date: '2026-10-27', stayId: 's1', warnings: ['Long day'],
          stops: [
            { id: 'stay:a', kind: 'stay', wishId: null, title: 'Flat', location: null, arriveMin: 540, departMin: 540, waitSec: 0, locked: true, bookingId: null, warnings: [] },
            { id: 'w1', kind: 'wish', wishId: 'w1', title: 'Borghese Gallery', location: null, arriveMin: 600, departMin: 720, waitSec: 0, locked: false, bookingId: null, warnings: ['Closed on Mondays'] },
          ],
          legs: [{ fromStopId: 'stay:a', toStopId: 'w1', mode: 'transit', durationSec: 1500, distanceM: null, estimated: true, line: null }],
        },
      ],
      dropped: [{ wishId: 'x', reason: 'no time' }],
      warnings: [],
      score: 0,
    } as never;
    expect(planSummary(plan, [wish({ id: 'x', title: 'Trevi' })])).toBe(
      'Tue 27 Oct: 10:00–12:00 Borghese Gallery (transit 25 min) [Closed on Mondays] | warnings: Long day\nNot planned: Trevi (no time)',
    );
  });
});
