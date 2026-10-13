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
      expect(after.departMin - startOf(after)).toBe(before.departMin - startOf(before));
      expect(after.arriveMin).toBeGreaterThan(before.arriveMin);
    }
    expect(out.stops[fromIndex].arriveMin).toBe(
      startMin + Math.ceil(out.legs[fromIndex - 1].durationSec / 60),
    );
  });

  it('re-times from the stay when fromIndex is 0, warning about a missed slot without moving it', () => {
    const { day, fromIndex, startMin, ...rest } = retimeCase('retime-late-start-booked-slot');
    const out = retimeDay(day, fromIndex, startMin, rest);
    expect(out.stops[0].departMin).toBe(startMin);
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
    expect(options.map((o) => o.label)).toEqual([
      "Drop Jewish Ghetto and Portico d'Ottavia (nice-to-have)",
      'Push everything back 150 min',
    ]);
    expect(options[0].dropped).toEqual(['ghetto']);
    expect(options[0].day.warnings).toEqual([]);
    expect(options[1].day.warnings).toEqual(['Back at the stay 19:30 — later than 19:00']);
  });

  it('a closed stop: drop it first', () => {
    const options = replanDay(replanCase('replan-closed-today'));
    expect(options[0]).toMatchObject({ kind: 'drop', dropped: ['capitoline'] });
    expect(stopOf(options[0].day, 'capitoline')).toBeUndefined();
  });

  it('skipped stops leave the plan and the first leg starts from the phone', () => {
    const input = replanCase('replan-skipped-stop');
    const options = replanDay(input);
    for (const o of options) {
      expect(stopOf(o.day, 'spanish-steps')).toBeUndefined();
      const firstNew = o.day.legs.find((l) => l.fromStopId === 'navona')!;
      expect(firstNew.estimated).toBe(true);
      expect(o.day.stops.find((s) => s.id === firstNew.toStopId)!.arriveMin).toBeGreaterThanOrEqual(
        input.nowMin,
      );
    }
  });

  it('never moves a locked booked slot', () => {
    const options = replanDay(replanCase('replan-locked-slot'));
    expect(options.length).toBe(3);
    for (const o of options) {
      const b = stopOf(o.day, 'borghese')!;
      expect(b.locked).toBe(true);
      const onTime = startOf(b) === 15 * 60 && b.warnings.length === 0;
      const lateWarned = b.warnings.some((w) => w.startsWith('Booked for 15:00 — you arrive'));
      expect(onTime || lateWarned).toBe(true);
    }
    expect(options[0].kind).toBe('drop');
    expect(startOf(stopOf(options[0].day, 'borghese')!)).toBe(15 * 60);
  });

  it('offers "Swap the next two" when the next two are the wrong way round', () => {
    const input = replanCase('replan-on-time');
    const stops = [...input.day.stops];
    const a = stops.findIndex((s) => s.id === 'spanish-steps');
    const b = stops.findIndex((s) => s.id === 'trevi');
    [stops[a], stops[b]] = [stops[b], stops[a]];
    const { day: _day, nowMin: _n, position: _p, atStopId: _a, doneStopIds: _d, ...rest } = input;
    const muddled = retimeDay({ ...input.day, stops, legs: input.day.legs.slice(0, 1) }, 1, 9 * 60, rest);
    const options = replanDay({
      ...input,
      day: muddled,
      nowMin: muddled.stops[2].departMin + 10,
      atStopId: 'pantheon',
      doneStopIds: ['navona'],
    });
    const swap = options.find((o) => o.kind === 'swap');
    expect(swap?.label).toBe('Swap the next two');
    const order = swap!.day.stops.map((s) => s.id).filter((id) => id === 'trevi' || id === 'spanish-steps');
    expect(order).toEqual(['spanish-steps', 'trevi']);
  });

  it('is deterministic', () => {
    for (const c of cases.filter((x) => x.fn === 'replanDay')) {
      expect(replanDay(replanCase(c.name))).toEqual(replanDay(replanCase(c.name)));
    }
  });
});
