import { describe, expect, it } from 'vitest';
import { solveTrip } from '$lib/trips/solver';
import { romeInput } from './solver/fixtures/rome';
import { computeGap, ideaDraft, ideasPrompt, readIdeas, verifyIdea, withPoint } from './ideas';
import type { Wish } from './model';

const input = romeInput();
const plan = solveTrip(input);

describe('computeGap', () => {
  it('an afternoon left free: from lunch to dinner, open time at the stay ignored', () => {
    const g = computeGap(plan, '2026-10-28', 'afternoon')!;
    expect(g.before).toMatchObject({ stopId: 'meal:2026-10-28:lunch', min: 13 * 60 + 40 });
    expect(g.after).toMatchObject({ stopId: 'meal:2026-10-28:dinner', min: 19 * 60 });
    expect(g).toMatchObject({ freeMin: 320, meal: null, replacesStopId: null, stage: 'afternoon' });
  });

  it('a meal slot: between the stops either side of lunch, replacing it', () => {
    const g = computeGap(plan, '2026-10-27', 'lunch')!;
    expect(g.before.title).toBe('Trevi Fountain');
    expect(g.after.title).toBe('Capitoline Museums');
    expect(g).toMatchObject({ meal: 'lunch', replacesStopId: 'meal:2026-10-27:lunch' });
  });

  it('the end of the day: dinner is the slot and the stay is the stop after', () => {
    const g = computeGap(plan, '2026-10-29', 'evening')!;
    expect(g.before.title).toBe("St Peter's Basilica");
    expect(g.after.stopId).toBe('stay:2026-10-29:end');
    expect(g).toMatchObject({ meal: 'dinner', replacesStopId: 'meal:2026-10-29:dinner' });
  });

  it('the start of the day: an empty morning runs from the stay, and may be breakfast', () => {
    const empty = { ...plan, days: plan.days.map((d) => (d.date === '2026-10-28' ? { ...d, stops: d.stops.filter((s) => s.wishId !== 'colosseum'), legs: d.legs } : d)) };
    const g = computeGap(empty, '2026-10-28', 'morning')!;
    expect(g.before.stopId).toBe('stay:2026-10-28:start');
    expect(g.after.stopId).toBe('meal:2026-10-28:lunch');
    expect(g.meal).toBe('breakfast');
  });

  it('between two named stops', () => {
    const g = computeGap(plan, '2026-10-27', 'morning', { afterStopId: 'pantheon', beforeStopId: 'spanish-steps' })!;
    expect(g).toMatchObject({ before: { title: 'Pantheon' }, after: { title: 'Spanish Steps' }, freeMin: 11 * 60 + 4 - (10 * 60 + 39) });
    expect(computeGap(plan, '2027-01-01', 'morning')).toBeNull();
  });
});

describe('verifyIdea', () => {
  const gap = computeGap(plan, '2026-10-28', 'afternoon')!;
  const idea = (id: string, title: string, minutes: number, lat = 41.8986, lng = 12.4769): Wish => ({
    id, title, place: { name: title, location: { lat, lng }, osmId: null, address: null }, priority: 'nice', durationSec: minutes * 60,
    partOfDay: 'afternoon', fixedDate: '2026-10-28', fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0,
  });

  it('keeps an idea that lands in the slot without moving anything out, with the solver’s real times', () => {
    const v = verifyIdea(input, idea('idea:0', 'Sant’Ignazio', 40, 41.8991, 12.4797), gap, plan);
    expect(v).toMatchObject({ fits: true, landedStage: 'afternoon', pushesOut: [], reason: null });
    expect(v.arriveMin).toBeGreaterThanOrEqual(gap.before.min);
    expect(v.departMin! + (v.legOutMin ?? 0)).toBeLessThanOrEqual(19 * 60 + 30);
    expect(v.legInMin).toBeGreaterThan(0);
  });

  it('v6 lenience: the stage next door counts when it sits inside the gap’s times; a meal idea counts as the meal', () => {
    const w = idea('idea:0', 'Sant’Ignazio', 40, 41.8991, 12.4797);
    // It lands in the afternoon. Asked as the (adjacent) evening, inside the gap → fits.
    expect(verifyIdea(input, w, { ...gap, stage: 'evening' }, plan)).toMatchObject({ fits: true, landedStage: 'afternoon' });
    // Adjacent but not inside the gap's times → turned down.
    expect(verifyIdea(input, w, { ...gap, stage: 'evening', after: { ...gap.after, min: gap.before.min + 10 } }, plan)).toMatchObject({ fits: false, reason: 'It would land in the afternoon instead.' });
    // Two stages away → turned down.
    expect(verifyIdea(input, w, { ...gap, stage: 'morning' }, plan).fits).toBe(false);
    // An idea that replaces the slot's meal lands "in" the meal's stage wherever the clock puts it.
    expect(verifyIdea(input, { ...w, replacesMeal: 'lunch' }, { ...gap, stage: 'morning', meal: 'lunch' }, plan).fits).toBe(true);
  });

  it('turns down an idea that cannot fit, and names what one would push out', () => {
    const tooLong = verifyIdea(input, idea('idea:1', 'A whole-day cooking class', 600), gap, plan);
    expect(tooLong.fits).toBe(false);
    expect(tooLong.reason).toBeTruthy();
    // On a full Tuesday a seven-hour must pushes a nice-to-have out, and says which.
    const tue = computeGap(plan, '2026-10-27', 'afternoon')!;
    const crowd = verifyIdea(input, { ...idea('idea:2', 'Galleria Doria Pamphilj', 420, 41.8977, 12.4815), fixedDate: '2026-10-27', priority: 'must' }, tue, plan);
    expect(crowd).toMatchObject({ fits: false, pushesOut: ["Campo de' Fiori market"], reason: "It would push out Campo de' Fiori market." });
    // A shorter one fits, but the re-solve moves things to other days — named, not hidden.
    const roomy = verifyIdea(input, { ...idea('idea:3', 'Galleria Doria Pamphilj', 240, 41.8977, 12.4815), fixedDate: '2026-10-27', priority: 'must' }, tue, plan);
    expect(roomy.fits).toBe(true);
    expect(Array.isArray(roomy.moves)).toBe(true);
  });

  it('adds the idea’s point to the matrix by estimate', () => {
    const m = withPoint(input.matrix, 'x', { lat: 41.9, lng: 12.48 }, new Map([[input.matrix.points[0], { lat: 41.89, lng: 12.47 }]]));
    expect(m.points.at(-1)).toBe('x');
    expect(m.seconds.walk?.at(-1)?.at(-1)).toBe(0);
    expect(m.seconds.walk?.[0].at(-1)).toBeGreaterThan(0);
  });
});

describe('the ideas prompt and answer', () => {
  it('gives the model the gap, the day and the rest of the trip', () => {
    const gap = computeGap(plan, '2026-10-28', 'afternoon')!;
    const text = ideasPrompt({ gap, day: plan.days[1], destination: 'Rome', otherDays: [{ date: '2026-10-27', titles: ['Pantheon'] }], dropped: ['Trevi'], profileText: '<<<PROFILE x PROFILE>>>', guideText: null, transportText: null });
    expect(text).toContain('Leaving: Lunch at 13:40');
    expect(text).toContain('Next: Dinner by 19:00');
    expect(text).toContain('Free: 320 minutes');
    expect(text).toContain('Not a meal slot.');
    expect(text).toContain('Tue 27 Oct: Pantheon');
    expect(text).toContain('Dropped from the plan: Trevi');
  });

  it('reads at most three ideas and turns one into a pinned wish', () => {
    const r = readIdeas({ ideas: [{ title: 'A', placeQuery: 'A, Rome', durationMin: 40, why: 'w', fit: 'f' }, { title: 'a' }, { title: 'B', durationMin: 5000 }, { title: 'C' }, { title: 'D' }], note: null });
    expect(r.ideas.map((i) => [i.title, i.durationMin])).toEqual([['A', 40], ['B', 360], ['C', 45]]);
    const lunch = computeGap(plan, '2026-10-27', 'lunch')!;
    expect(ideaDraft(r.ideas[0], lunch)).toMatchObject({ fixedDate: '2026-10-27', replacesMeal: 'lunch', partOfDay: 'any', priority: 'nice' });
  });
});

describe('stable verification (previous plan)', () => {
  it('adding a short idea moves nothing else once the solver keeps the stored days', () => {
    const gap = computeGap(plan, '2026-10-28', 'afternoon')!;
    const wish: Wish = {
      id: 'idea:0', title: "Sant'Ignazio", place: { name: "Sant'Ignazio", location: { lat: 41.8991, lng: 12.4797 }, osmId: null, address: null },
      priority: 'nice', durationSec: 2400, partOfDay: 'afternoon', fixedDate: '2026-10-28', fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0,
    };
    // Without the stored plan the solver reshuffles other days; with it, none move.
    expect(verifyIdea(input, wish, gap, plan).moves.length).toBeGreaterThan(0);
    const stable = { ...input, previous: plan };
    expect(verifyIdea(stable, wish, gap, solveTrip(stable))).toMatchObject({ fits: true, moves: [], pushesOut: [], landedStage: 'afternoon' });
  });
});
