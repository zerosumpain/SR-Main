// Stability: given the current plan, a re-plan changes as little as possible.
import { describe, expect, it } from 'vitest';
import type { SolvedPlan } from '../model';
import { GELATO_IDEA, buildCaseInputs, romeWith, type CaseInput } from './fixtures/cases/build';
import { makeWish } from './fixtures/build';
import { romeInput } from './fixtures/rome';
import { replanTrip, solveTrip, type SolverInput, type TripReplanInput } from './index';
import { previousDays } from './plan';

/** Wishes of the previous plan that are on a different day (or gone) now. */
function moved(previous: SolvedPlan, plan: SolvedPlan): string[] {
  const before = previousDays(previous);
  const after = previousDays(plan);
  return [...before].filter(([id, d]) => after.get(id) !== d).map(([id]) => id);
}

const caseInput = (name: string) =>
  (buildCaseInputs().find((c) => c.name === name) as Extract<CaseInput, { fn: 'solveTrip' }>)
    .input as SolverInput;

describe('stable re-plans', () => {
  const previous = solveTrip(romeInput());

  it('without a previous plan, nothing changes from planning from scratch', () => {
    const input = romeWith(GELATO_IDEA());
    expect(solveTrip({ ...input, previous: undefined })).toEqual(solveTrip(input));
  });

  it('a small idea pinned to Wednesday moves no other wish', () => {
    const plan = solveTrip(caseInput('solve-stable-small-idea'));
    expect(moved(previous, plan)).toEqual([]);
    expect(previousDays(plan).get('gelato')).toBe('2026-10-28');
  });

  it("the long Thursday lunch keeps St Peter's with the Vatican", () => {
    const plan = solveTrip(caseInput('solve-stable-long-lunch'));
    const days = previousDays(plan);
    expect(days.get('st-peters')).toBe(days.get('vatican'));
    expect(moved(previous, plan)).toEqual([]);
  });

  it('an overloaded day moves only its least valuable unpinned nice', () => {
    const input = caseInput('solve-stable-overloaded-day');
    const plan = solveTrip(input);
    const changed = moved(previous, plan);
    expect(changed).toHaveLength(1);
    const tue = previous.days.find((d) => d.date === '2026-10-27')!;
    const byId = new Map(input.wishes.map((w) => [w.id, w]));
    const unpinnedNices = tue.stops
      .filter(
        (s) =>
          s.kind === 'wish' && byId.get(s.wishId!)?.priority === 'nice' && !byId.get(s.wishId!)?.fixedDate,
      )
      .map((s) => byId.get(s.wishId!)!)
      .sort((a, b) => b.sortHint - a.sortHint);
    expect(changed[0]).toBe(unpinnedNices[0].id);
  });

  it('PROPERTY: one small addition moves at most one other wish, on any day, pinned or not', () => {
    const dates = previous.days.map((d) => d.date);
    for (const date of [...dates, null]) {
      for (const partOfDay of ['morning', 'afternoon', 'any'] as const) {
        const idea = makeWish(
          'idea',
          'A small idea',
          { lat: 41.8986, lng: 12.4769 },
          {
            priority: 'nice',
            minutes: 40,
            partOfDay,
            fixedDate: date,
            sortHint: 30,
          },
        );
        const plan = solveTrip({ ...romeWith(idea), previous });
        expect(moved(previous, plan).length, `${date} ${partOfDay}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('re-planning the rest of the trip with the current plan moves no more than without it', () => {
    for (const c of buildCaseInputs().filter((x) => x.fn === 'replanTrip')) {
      const input = c.input as TripReplanInput;
      const prev = { days: input.plannedDays!, dropped: [], warnings: [], score: 0 };
      const fresh = replanTrip(input).find((o) => o.kind === 'resolve-rest');
      const stable = replanTrip({ ...input, previous: prev }).find((o) => o.kind === 'resolve-rest');
      if (!fresh || !stable) continue;
      expect(stable.moved.length, c.name).toBeLessThanOrEqual(fresh.moved.length);
    }
  });
});
