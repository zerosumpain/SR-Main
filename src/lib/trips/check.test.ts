import { describe, expect, it } from 'vitest';
import { daySnapshot, diffText, readCheck, turnDiff } from './check';
import type { PlannedDay } from './model';

const s = (id: string, kind: 'wish' | 'meal' | 'stay', arriveMin: number, departMin: number, waitSec = 0) => ({ id, kind, wishId: kind === 'wish' ? id : null, title: id, location: null, arriveMin, departMin, waitSec, locked: false, bookingId: null, warnings: [] });
const leg = (min: number) => ({ fromStopId: 'x', toStopId: 'y', mode: 'walk' as const, durationSec: min * 60, distanceM: null, estimated: true, line: null });
const day = (date: string, stops: ReturnType<typeof s>[], legs: ReturnType<typeof leg>[] = []): PlannedDay => ({ date, stayId: 'st', stops, legs, warnings: [] });

describe('check', () => {
  it('measures active time without waits, and the end of the day', () => {
    const d = day('2026-10-28', [s('start', 'stay', 540, 540), s('Colosseum', 'wish', 560, 740, 600), s('lunch', 'meal', 750, 810), s('end', 'stay', 840, 840)], [leg(20), leg(10), leg(30)]);
    expect(daySnapshot(d)).toEqual({ activeMin: 170 + 60 + 60, endMin: 840, stops: ['Colosseum', 'lunch'] });
  });

  it('lists only the days that changed, and the dropped list', () => {
    const before = { days: [day('2026-10-27', [s('A', 'wish', 600, 660)]), day('2026-10-28', [s('B', 'wish', 600, 700), s('C', 'wish', 720, 900)])], dropped: [{ wishId: 'Z', reason: 'r' }], warnings: [], score: 0 };
    const after = { days: [before.days[0], day('2026-10-28', [s('B', 'wish', 600, 700), s('D', 'wish', 720, 780)])], dropped: [{ wishId: 'C', reason: 'no time' }], warnings: [], score: 0 };
    const diff = turnDiff(before, after, { C: 'Castel' });
    expect(diff.days.map((d) => d.date)).toEqual(['2026-10-28']);
    expect(diff.days[0]).toMatchObject({ added: ['D'], removed: ['C'] });
    expect(diffText(diff)).toBe(
      'Wed 28 Oct (2026-10-28): active 4h40 → 2h40, ends 15:00 → 13:00; added D; removed C\nNewly not planned: Castel (no time)\nPlanned again: Z',
    );
    expect(diffText(turnDiff(before, before))).toBe('The schedule did not change.');
  });

  it('names wishes that moved to another day, with their ids, so the check can pin them back', () => {
    const before = { days: [day('2026-10-27', [s('lunch', 'meal', 750, 810)]), day('2026-10-29', [s('stpeters', 'wish', 600, 675)])], dropped: [], warnings: [], score: 0 };
    const after = { days: [day('2026-10-27', [s('lunch', 'meal', 750, 810), s('stpeters', 'wish', 900, 975)]), day('2026-10-29', [s('long-lunch', 'wish', 750, 870)])], dropped: [], warnings: [], score: 0 };
    const diff = turnDiff(before, after, { stpeters: "St Peter's Basilica" });
    expect(diff.moved).toEqual([{ wishId: 'stpeters', title: "St Peter's Basilica", from: '2026-10-29', to: '2026-10-27' }]);
    expect(diffText(diff)).toContain("Moved to another day: St Peter's Basilica [stpeters] Thu 29 Oct (2026-10-29) → Tue 27 Oct (2026-10-27)");
  });

  it('reads the verdict: ops make it a correction', () => {
    expect(readCheck({ ok: true, reply: ' Fine. ', ops: [] })).toEqual({ ok: true, reply: 'Fine.', ops: [] });
    expect(readCheck({ ok: true, reply: 'x', ops: [{ op: 'research' }] }).ok).toBe(false);
    expect(readCheck(null)).toEqual({ ok: false, reply: null, ops: [] });
  });
});
