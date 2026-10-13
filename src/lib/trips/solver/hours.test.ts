import { describe, expect, it } from 'vitest';
import { addDays, dayLabel, datesBetween, fmtMin, isoWeekday } from './calendar';
import { closedOn, parseOpeningHours, windowsOn } from './hours';
import { makeFacts } from './fixtures/build';

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('calendar', () => {
  it('computes ISO weekdays arithmetically', () => {
    expect(isoWeekday('2026-10-27')).toBe(2); // Tuesday
    expect(isoWeekday('2026-11-01')).toBe(7); // Sunday
    expect(isoWeekday('2024-02-29')).toBe(4); // leap day, Thursday
    expect(isoWeekday('2000-01-01')).toBe(6);
    expect(isoWeekday('1970-01-01')).toBe(4);
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(datesBetween('2026-10-27', '2026-10-30')).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(datesBetween('2026-10-30', '2026-10-27')).toEqual([]);
  });

  it('formats labels and times', () => {
    expect(dayLabel('2026-10-27')).toBe('Tue 27 Oct');
    expect(fmtMin(h(9, 5))).toBe('09:05');
    expect(fmtMin(h(24, 30))).toBe('00:30');
  });
});

describe('parseOpeningHours', () => {
  it('parses weekday ranges, a single day and off', () => {
    const hours = parseOpeningHours('Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off');
    expect(hours?.[1]).toEqual([{ openMin: h(9), closeMin: h(17) }]);
    expect(hours?.[5]).toEqual([{ openMin: h(9), closeMin: h(17) }]);
    expect(hours?.[6]).toEqual([{ openMin: h(10), closeMin: h(14) }]);
    expect(hours?.[7]).toEqual([]);
  });

  it('treats days no rule mentions as closed', () => {
    const hours = parseOpeningHours('Tu-Su 09:00-19:00');
    expect(hours?.[1]).toEqual([]);
    expect(hours?.[2]).toEqual([{ openMin: h(9), closeMin: h(19) }]);
  });

  it('parses 24/7', () => {
    const hours = parseOpeningHours('24/7');
    for (const d of [1, 2, 3, 4, 5, 6, 7] as const)
      expect(hours?.[d]).toEqual([{ openMin: 0, closeMin: 1440 }]);
  });

  it('parses comma day lists, multiple spans and comma-separated rules', () => {
    const hours = parseOpeningHours('Mo,We,Fr 09:00-12:00,14:00-18:00, Sa 10:00 - 13:00');
    expect(hours?.[1]).toEqual([
      { openMin: h(9), closeMin: h(12) },
      { openMin: h(14), closeMin: h(18) },
    ]);
    expect(hours?.[2]).toEqual([]);
    expect(hours?.[6]).toEqual([{ openMin: h(10), closeMin: h(13) }]);
  });

  it('lets a later rule override an earlier one, wrapping weekday ranges', () => {
    const hours = parseOpeningHours('Mo-Su 09:00-17:00; Fr-Mo 10:00-22:00');
    expect(hours?.[3]).toEqual([{ openMin: h(9), closeMin: h(17) }]);
    expect(hours?.[7]).toEqual([{ openMin: h(10), closeMin: h(22) }]);
    expect(hours?.[1]).toEqual([{ openMin: h(10), closeMin: h(22) }]);
  });

  it('ignores PH rules safely', () => {
    expect(parseOpeningHours('Mo-Sa 08:00-19:00; PH off')?.[3]).toEqual([{ openMin: h(8), closeMin: h(19) }]);
    expect(parseOpeningHours('Sa,PH 10:00-12:00')?.[6]).toEqual([{ openMin: h(10), closeMin: h(12) }]);
    expect(parseOpeningHours('PH off')).toBeNull();
  });

  it('closes overnight spans at midnight', () => {
    expect(parseOpeningHours('Fr 18:00-02:00')?.[5]).toEqual([{ openMin: h(18), closeMin: 1440 }]);
  });

  it('returns null for anything outside the subset', () => {
    for (const text of [
      null,
      '',
      'Apr-Oct Mo-Su 09:00-18:00',
      'Mo-Fr 09:00+',
      'sunrise-sunset',
      'by appointment',
    ]) {
      expect(parseOpeningHours(text)).toBeNull();
    }
  });
});

describe('windowsOn', () => {
  it('honours closed dates and weekday hours', () => {
    const facts = makeFacts('Tu-Su 09:00-19:00; Mo off', { closedDates: ['2026-10-28'] });
    expect(windowsOn(facts, '2026-10-27')).toEqual([{ openMin: h(9), closeMin: h(19) }]);
    expect(windowsOn(facts, '2026-10-28')).toEqual([]);
    expect(windowsOn(facts, '2026-10-26')).toEqual([]);
    expect(closedOn(facts, '2026-10-26')).toBe(true);
  });

  it('returns null (unknown) for missing or unparseable hours', () => {
    expect(windowsOn(null, '2026-10-27')).toBeNull();
    expect(windowsOn(makeFacts('whenever'), '2026-10-27')).toBeNull();
    expect(closedOn(makeFacts('whenever'), '2026-10-27')).toBe(false);
  });

  it('falls back to parsing the text when hours were not stored', () => {
    const facts = { ...makeFacts('Mo-Fr 09:00-17:00'), hours: null };
    expect(windowsOn(facts, '2026-10-27')).toEqual([{ openMin: h(9), closeMin: h(17) }]);
  });
});
