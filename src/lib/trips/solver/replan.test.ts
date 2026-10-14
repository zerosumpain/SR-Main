import { describe, expect, it } from 'vitest';
import type { PlannedDay } from '../model';
import { buildCaseInputs, type CaseInput } from './fixtures/cases/build';
import { replanDay, retimeDay, type ReplanInput } from './index';

const cases = buildCaseInputs();
const replanCase = (name: string) =>
  (cases.find((c) => c.name === name) as Extract<CaseInput, { fn: 'replanDay' }>).input as ReplanInput;
const retimeCase = (name: string) =>
  (cases.find((c) => c.name === name) as Extract<CaseInput, { fn: 'retimeDay' }>).input;
const stopOf = (day: PlannedDay, id: string) => day.stops.find((s) => s.id === id);
const startOf = (s: { arriveMin: number; waitSec: number }) => s.arriveMin + s.waitSec / 60;

describe('retimeDay', () => {
  it('keeps earlier stops, order and visit lengths; slides the rest', () => {
    const { day, fromIndex, startMin, ...rest } = retimeCase('retime-running-late');
    const out = retimeDay(day, fromIndex, startMin, rest);
    expect(out.stops.slice(0, fromIndex)).toEqual(day.stops.slice(0, fromIndex));
    expect(out.legs.slice(0, fromIndex - 1)).toEqual(day.legs.slice(0, fromIndex - 1));
    expect(out.stops.map((s) => s.id)).toEqual(day.stops.map((s) => s.id));
    for (let i = fromIndex; i < day.stops.length - 1; i++) {
      const before = day.stops[i];
      const after = out.stops[i];
      if (before.kind === 'stay') continue; // free time before dinner is recomputed
      expect(after.departMin - startOf(after)).toBe(before.departMin - startOf(before));
      // Sights slide later; dinner never starts before its window.
      if (before.kind === 'wish') expect(after.arriveMin).toBeGreaterThan(before.arriveMin);
      else expect(after.arriveMin).toBeGreaterThanOrEqual(before.arriveMin);
    }
    expect(out.stops[fromIndex].arriveMin).toBe(
      startMin + Math.ceil(out.legs[fromIndex - 1].durationSec / 60),
    );
  });

  it('re-times from the stay when fromIndex is 0, warning about a missed slot without moving it', () => {
    const { day, fromIndex, startMin, ...rest } = retimeCase('retime-late-start-booked-slot');
    const out = retimeDay(day, fromIndex, startMin, rest);
    // Breakfast at the stay just before setting off at startMin.
    expect(out.stops.slice(0, 2).map((s) => [s.id, s.arriveMin, s.departMin])).toEqual([
      ['stay:2026-10-28:start', startMin - 30, startMin - 30],
      ['meal:2026-10-28:breakfast', startMin - 30, startMin],
    ]);
    const colosseum = stopOf(out, 'colosseum')!;
    expect(colosseum.locked).toBe(true);
    expect(colosseum.warnings).toEqual(['Booked for 09:30 — you arrive 09:53']);
  });

  it('lets a locked slot absorb a small delay', () => {
    const { day, fromIndex, startMin, ...rest } = retimeCase('retime-locked-slot-absorbs-delay');
    const out = retimeDay(day, fromIndex, startMin, rest);
    expect(startOf(stopOf(out, 'borghese')!)).toBe(15 * 60);
    expect(stopOf(out, 'borghese')!.waitSec).toBeLessThan(stopOf(day, 'borghese')!.waitSec);
  });
});

describe('replanDay', () => {
  it('returns at most three distinct options for every case', () => {
    for (const c of cases.filter((x) => x.fn === 'replanDay')) {
      const options = replanDay(replanCase(c.name));
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options.length).toBeLessThanOrEqual(3);
      expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
      expect(new Set(options.map((o) => JSON.stringify(o.day.stops))).size).toBe(options.length);
    }
  });

  it('offers only "carry on" when on time', () => {
    const options = replanDay(replanCase('replan-on-time'));
    expect(options.map((o) => [o.kind, o.label, o.endsLaterMin])).toEqual([
      ['shift', 'Keep the plan as it is', 0],
    ]);
    expect(options[0].day.stops).toEqual(replanCase('replan-on-time').day.stops);
  });

  it('running late: dropping the nice comes first, pushing back second', () => {
    const options = replanDay(replanCase('replan-running-late'));
    const drop = options.find((o) => o.kind === 'drop')!;
    const shift = options.find((o) => o.kind === 'shift')!;
    expect(drop.day.warnings).toEqual([]);
    expect(drop.dropped.length).toBeGreaterThan(0);
    expect(shift.label).toBe('Push everything back 150 min');
    expect(shift.day.warnings.some((w) => w.startsWith('Sightseeing runs to'))).toBe(true);
  });

  it('a closed stop: drop it first', () => {
    const input = replanCase('replan-closed-today');
    const shut = input.wishes.find((w) => w.facts?.closedDates.includes(input.day.date))!.id;
    const options = replanDay(input);
    const drop = options.find((o) => o.kind === 'drop' && o.dropped.includes(shut))!;
    expect(drop).toBeDefined();
    expect(stopOf(drop.day, shut)).toBeUndefined();
    expect(options.indexOf(drop)).toBeLessThan(options.findIndex((o) => o.kind === 'shift'));
  });

  it('skipped stops leave the plan and the first leg starts from the phone', () => {
    const input = replanCase('replan-skipped-stop');
    const options = replanDay(input);
    const skipped = input.doneStopIds;
    const breakfast = `meal:${input.day.date}:breakfast`;
    for (const o of options) {
      for (const id of skipped) expect(stopOf(o.day, id)).toBeUndefined();
      const firstNew = o.day.legs.find((l) => l.fromStopId === breakfast)!;
      expect(firstNew.estimated).toBe(true);
      expect(o.day.stops.find((s) => s.id === firstNew.toStopId)!.arriveMin).toBeGreaterThanOrEqual(
        input.nowMin,
      );
    }
  });

  it('never moves a locked booked slot', () => {
    const options = replanDay(replanCase('replan-locked-slot'));
    expect(options.length).toBeGreaterThanOrEqual(2);
    for (const o of options) {
      const b = stopOf(o.day, 'borghese')!;
      expect(b.locked).toBe(true);
      expect(startOf(b)).toBe(15 * 60);
      expect(b.departMin).toBe(17 * 60);
      expect(b.warnings).toEqual([]);
    }
  });

  it('a missed slot leaves the plan with a warning and is listed as dropped', () => {
    const input = replanCase('replan-missed-slot');
    const options = replanDay(input);
    expect(options.length).toBeGreaterThanOrEqual(1);
    expect(options[0].label).toBe('Carry on without the missed Colosseum and Roman Forum slot');
    for (const o of options) {
      expect(stopOf(o.day, 'colosseum')).toBeUndefined();
      expect(o.dropped).toContain('colosseum');
      expect(o.day.warnings).toContain('Missed your 09:30 Colosseum and Roman Forum slot');
      const opening = new Set(['stay:2026-10-28:start', 'meal:2026-10-28:breakfast']);
      for (const s of o.day.stops.filter((x) => !opening.has(x.id))) {
        expect(s.arriveMin).toBeGreaterThanOrEqual(input.nowMin);
      }
    }
  });

  it('late inside the grace period: the slot keeps its times and warns', () => {
    const options = replanDay(replanCase('replan-late-for-slot'));
    expect(options[0].label).toBe('Go straight to the Colosseum and Roman Forum — about 13 min late');
    for (const o of options) {
      const c = stopOf(o.day, 'colosseum')!;
      expect(startOf(c)).toBe(9 * 60 + 30);
      expect(c.warnings).toEqual(['Booked for 09:30 — you arrive 09:43']);
      expect(o.dropped).not.toContain('colosseum');
    }
  });

  it('moves what no longer fits before a slot to after it, or drops nices', () => {
    const options = replanDay(replanCase('replan-squeezed-before-slot'));
    for (const o of options) expect(startOf(stopOf(o.day, 'borghese')!)).toBe(15 * 60);
    expect(options.some((o) => o.kind === 'drop')).toBe(true);
    const shift = options.find((o) => o.kind === 'shift')!;
    expect(shift.label).toMatch(/after the Borghese Gallery slot$/);
    expect(shift.dropped).toEqual([]);
  });

  it('PROPERTY: no option of any case moves a locked or booked stop', () => {
    for (const c of cases.filter((x) => x.fn === 'replanDay')) {
      const input = replanCase(c.name);
      const planned = new Map(input.day.stops.filter((s) => s.locked).map((s) => [s.id, s]));
      for (const o of replanDay(input)) {
        for (const s of o.day.stops.filter((x) => x.locked)) {
          const was = planned.get(s.id)!;
          const label = `${c.name} / ${o.id} / ${s.id}`;
          expect(was, label).toBeDefined();
          expect(s.arriveMin, label).toBe(was.arriveMin);
          expect(s.waitSec, label).toBe(was.waitSec);
          if (s.id !== input.atStopId) expect(s.departMin, label).toBe(was.departMin);
        }
        // A locked stop that is gone must be reported.
        for (const id of planned.keys()) {
          if (!stopOf(o.day, id)) expect(o.dropped, `${c.name} / ${o.id}`).toContain(id);
        }
      }
    }
  });

  it('offers "Swap the next two" when the next two are the wrong way round', () => {
    const input = replanCase('replan-on-time');
    const { day: _day, nowMin: _n, position: _p, atStopId: _a, doneStopIds: _d, ...rest } = input;
    // Swap each pair of neighbouring sights in turn; at least one swap must be
    // worth undoing, and an undo is labelled "Swap the next two".
    let swaps = 0;
    const base = input.day.stops;
    for (let i = 0; i + 1 < base.length; i++) {
      if (base[i].kind !== 'wish' || base[i + 1].kind !== 'wish') continue;
      const before = base.slice(0, i).filter((s) => s.kind === 'wish');
      if (!before.length) continue;
      const stops = [...base];
      [stops[i], stops[i + 1]] = [stops[i + 1], stops[i]];
      const muddled = retimeDay({ ...input.day, stops }, 0, base[1].departMin, rest);
      const at = muddled.stops[i - 1];
      const options = replanDay({
        ...input,
        day: muddled,
        nowMin: at.departMin,
        atStopId: at.id,
        doneStopIds: [],
      });
      const swap = options.find((o) => o.kind === 'swap');
      if (!swap) continue;
      swaps++;
      expect(swap.label).toBe('Swap the next two');
      const order = swap.day.stops
        .map((s) => s.id)
        .filter((id) => id === base[i].id || id === base[i + 1].id);
      expect(order).toEqual([base[i].id, base[i + 1].id]);
    }
    expect(swaps).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    for (const c of cases.filter((x) => x.fn === 'replanDay')) {
      expect(replanDay(replanCase(c.name))).toEqual(replanDay(replanCase(c.name)));
    }
  });
});
