import { describe, expect, it } from 'vitest';
import { optionFit, readOptionDrafts } from './options';
import { readPlannerAnswer } from './ops';
import type { Verdict } from './ideas';

// v7: choices with trade-offs (pure half).
const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  fits: true, arriveMin: 850, departMin: 910, landedStage: 'afternoon', legInMin: 12, legOutMin: 8, legInMode: 'walk', legOutMode: 'walk',
  pushesOut: [], moves: [], reason: null, ...over,
});

describe('reading options', () => {
  it('keeps up to three well-formed options', () => {
    const got = readOptionDrafts([
      { date: '2026-10-28', stage: 'afternoon', title: 'Galleria Spada', placeQuery: 'Galleria Spada, Rome', durationMin: 60, why: 'A small gallery with a trick of perspective.', indoor: true, kidFriendly: true, costText: 'About €5' },
      { date: '2026-10-28', stage: 'afternoon', title: 'Gianicolo walk', durationMin: 500, why: 'Views over the city.', indoor: false },
      { date: 'Wednesday', stage: 'afternoon', title: 'Bad date' },
      { date: '2026-10-28', stage: 'night', title: 'Bad stage' },
      { date: '2026-10-28', stage: 'evening', title: 'Campo market', placeQuery: 'Campo de Fiori, Rome' },
      { date: '2026-10-28', stage: 'evening', title: 'A fourth' },
    ]);
    expect(got.map((o) => o.title)).toEqual(['Galleria Spada', 'Gianicolo walk', 'Campo market']);
    expect(got[1]).toMatchObject({ placeQuery: 'Gianicolo walk', durationMin: 240, indoor: false, kidFriendly: null, costText: null });
    expect(got[2].durationMin).toBe(60);
    expect(readOptionDrafts('nope')).toEqual([]);
  });

  it('come with the planner’s answer', () => {
    const a = readPlannerAnswer({ reply: 'Three ideas:', ops: [], options: [{ date: '2026-10-28', stage: 'lunch', title: 'Roscioli', placeQuery: 'Roscioli, Rome' }] });
    expect(a.options).toHaveLength(1);
    expect(readPlannerAnswer({ reply: 'x' }).options).toEqual([]);
  });
});

describe('what an option does to the day', () => {
  it('says when, the way in and on, and what it costs', () => {
    expect(optionFit(verdict())).toBe('14:10–15:10 · 12 min walk in · 8 min on');
    expect(optionFit(verdict({ legInMode: 'transit', pushesOut: ['Spanish Steps'] }))).toBe('14:10–15:10 · 12 min by public transport in · 8 min on · would push out Spanish Steps');
    expect(optionFit(verdict({ moves: [{ title: 'Pantheon', from: '2026-10-28', to: '2026-10-29' }] }))).toContain('moves Pantheon to 2026-10-29');
    expect(optionFit(verdict({ fits: false, arriveMin: null, departMin: null, legInMin: null, legOutMin: null, reason: 'Closed then' }))).toBe('Closed then');
  });
});
