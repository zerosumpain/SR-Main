import { describe, expect, it } from 'vitest';
import { datesIn, eventDayOf, keptUntil, parseUntil, shelfOf, stalenessOf, sweepDue } from './shelf';

const at = (s: string) => new Date(s);
const open = { stage: 'spotted' };

describe('datesIn', () => {
  it('reads day-month, month-day and ISO dates', () => {
    expect(datesIn('a walk on Sat 16th October, then Nov 1, 2026 and 2026-12-03', '2026-10-03')).toEqual([
      '2026-12-03',
      '2026-10-16',
      '2026-11-01',
    ]);
  });

  it('puts a yearless January in a December note into next year', () => {
    expect(datesIn('back on 5 January', '2026-12-20')).toEqual(['2027-01-05']);
  });

  it('keeps a yearless date shortly before the note in the same year', () => {
    expect(datesIn('you spent £40 on 3 October', '2026-10-05')).toEqual(['2026-10-03']);
  });

  it('rejects dates that do not exist', () => {
    expect(datesIn('31 November', '2026-10-01')).toEqual([]);
  });
});

describe('eventDayOf', () => {
  it('takes the latest date still ahead when the note was written', () => {
    expect(eventDayOf('Book by 10 October for the walk on 1 November', '2026-10-03')).toBe('2026-11-01');
  });

  it('ignores dates the note read from the past', () => {
    expect(eventDayOf('Canva charged you twice on 28 September and 2 October', '2026-10-05')).toBeNull();
  });
});

describe('shelfOf', () => {
  const base = { kind: 'think_research', title: 'Barns Ness geology walk', narrative: 'A guided walk on 16 October.', createdAt: at('2026-10-05T09:00:00Z') };

  it('prefers a stored until over the text', () => {
    expect(shelfOf({ ...base, relevantUntil: at('2026-10-20T12:00:00Z') })).toEqual({ until: '2026-10-20', basis: 'stated' });
  });

  it('uses the date the note is about', () => {
    expect(shelfOf(base)).toEqual({ until: '2026-10-16', basis: 'date' });
  });

  it('falls back to three days for any kind', () => {
    expect(shelfOf({ ...base, narrative: 'Nothing dated here.' })).toEqual({ until: '2026-10-08', basis: 'age' });
    expect(shelfOf({ ...base, kind: 'think_build', narrative: 'x' })).toEqual({ until: '2026-10-08', basis: 'age' });
  });
});

describe('stalenessOf', () => {
  const walk = { kind: 'think_research', title: 'Barns Ness walk', narrative: 'A guided walk on 16 October.', createdAt: at('2026-10-05T09:00:00Z') };

  it('is quiet on the day itself and flags the day after', () => {
    expect(stalenessOf(walk, { ...open, now: at('2026-10-16T22:30:00Z') })).toBeNull(); // 23:30 BST, still the 16th
    expect(stalenessOf(walk, { ...open, now: at('2026-10-17T08:00:00Z') })).toEqual({
      until: '2026-10-16',
      basis: 'date',
      why: 'The date it is about, 16 Oct, has passed.',
    });
  });

  it('never flags a note past Spotted', () => {
    const now = at('2026-10-25T08:00:00Z');
    for (const stage of ['decide', 'motion', 'result']) expect(stalenessOf(walk, { stage, now })).toBeNull();
  });

  it('flags an undated note on its fourth day, not its third', () => {
    const idea = { kind: 'think_build', title: 'A tidier backlog', narrative: 'Group the open items.', createdAt: at('2026-10-05T09:00:00Z') };
    expect(stalenessOf(idea, { ...open, now: at('2026-10-08T20:00:00Z') })).toBeNull();
    expect(stalenessOf(idea, { ...open, now: at('2026-10-09T08:00:00Z') })?.basis).toBe('age');
  });

  it('says how old an undated note is', () => {
    const plan = { kind: 'think_health_plan', title: 'A lighter week', narrative: 'Swap Thursday for a walk.', createdAt: at('2026-10-01T09:00:00Z') };
    expect(stalenessOf(plan, { ...open, now: at('2026-10-12T09:00:00Z') })?.why).toBe('11 days old and unanswered — it has probably moved on.');
    expect(stalenessOf(plan, { ...open, now: at('2026-10-20T09:00:00Z') })?.why).toBe('3 weeks old and unanswered — it has probably moved on.');
  });
});

describe('parseUntil', () => {
  it('accepts a real day from today to a year on', () => {
    expect(parseUntil('2026-10-16', '2026-10-11')).toBe('2026-10-16');
    expect(parseUntil('2026-10-11', '2026-10-11')).toBe('2026-10-11');
  });

  it('drops anything else', () => {
    for (const v of ['2026-10-10', '2027-12-01', '2026-02-30', '16 October', null, 5]) expect(parseUntil(v, '2026-10-11')).toBeNull();
  });
});

it('keptUntil is a fortnight on', () => {
  expect(keptUntil(at('2026-10-11T20:00:00Z'))).toBe('2026-10-25');
});

describe('sweepDue', () => {
  const stale = { until: '2026-10-09' };
  it('waits out a week of grace after the last day, in London days', () => {
    expect(sweepDue(stale, at('2026-10-16T12:00:00Z'))).toBe(false); // 7 days on
    expect(sweepDue(stale, at('2026-10-16T23:30:00Z'))).toBe(true); // 00:30 BST on the 17th
    expect(sweepDue(stale, at('2026-10-17T08:00:00Z'))).toBe(true);
  });
  it('never sweeps an unflagged note', () => {
    expect(sweepDue(null, at('2027-01-01T08:00:00Z'))).toBe(false);
  });
});
