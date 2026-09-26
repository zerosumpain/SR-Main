import { describe, it, expect } from 'vitest';
import { describePlaceRhythm, isPlaceKind, localDayHour } from './places';

describe('localDayHour', () => {
  // A place's rhythm is a LOCAL fact. Getting this wrong shifts every
  // "usually Tuesday afternoon" by an hour for half the year, and across a
  // day boundary for anything near midnight.
  it('reads British Summer Time, not UTC', () => {
    // 2026-08-26 is a Wednesday; 23:30 UTC in August is 00:30 local on Thursday.
    const { day, hour } = localDayHour(new Date('2026-08-26T23:30:00Z'));
    expect(day).toBe(3); // Thursday, 0 = Monday
    expect(hour).toBe(0);
  });

  it('reads GMT in winter, when local and UTC agree', () => {
    const { day, hour } = localDayHour(new Date('2026-01-14T23:30:00Z'));
    expect(day).toBe(2); // Wednesday
    expect(hour).toBe(23);
  });

  it('puts Monday at index 0', () => {
    expect(localDayHour(new Date('2026-08-24T12:00:00Z')).day).toBe(0);
    expect(localDayHour(new Date('2026-08-30T12:00:00Z')).day).toBe(6);
  });
});

describe('describePlaceRhythm', () => {
  const base = {
    visitCount: 4,
    medianDwellMins: 20,
    dayHistogram: [0, 0, 0, 0, 0, 0, 0],
    hourHistogram: new Array(24).fill(0),
  };

  it('describes visits and dwell', () => {
    expect(describePlaceRhythm(base)).toBe('4 visits, about 20 minutes each');
  });

  it('names a day only when it is genuinely the pattern', () => {
    const tuesdayish = {
      ...base,
      dayHistogram: [0, 3, 0, 1, 0, 0, 0], // 3 of 4 on Tuesday
    };
    expect(describePlaceRhythm(tuesdayish)).toContain('usually Tuesday');
  });

  it('stays quiet when visits are spread across the week', () => {
    const spread = { ...base, dayHistogram: [1, 1, 1, 1, 0, 0, 0] };
    // A quarter of the visits is not "usually".
    expect(describePlaceRhythm(spread)).not.toContain('usually');
  });

  it('needs more than one visit before calling a day a pattern', () => {
    const single = { ...base, visitCount: 1, dayHistogram: [0, 1, 0, 0, 0, 0, 0] };
    expect(describePlaceRhythm(single)).not.toContain('usually');
  });

  it('bands the time of day when the hours agree', () => {
    const hourHistogram = new Array(24).fill(0);
    hourHistogram[14] = 3;
    hourHistogram[15] = 1;
    expect(describePlaceRhythm({ ...base, hourHistogram })).toContain('in the afternoon');
  });

  it('survives an empty histogram without inventing a day', () => {
    const empty = { visitCount: 3, medianDwellMins: 0, dayHistogram: [], hourHistogram: [] };
    expect(describePlaceRhythm(empty)).toBe('3 visits');
  });

  it('says "1 visit", not "1 visits"', () => {
    expect(describePlaceRhythm({ ...base, visitCount: 1, medianDwellMins: 0 })).toBe('1 visit');
  });
});

describe('isPlaceKind', () => {
  it('accepts the shipped vocabulary and rejects invention', () => {
    expect(isPlaceKind('cafe')).toBe(true);
    expect(isPlaceKind('home')).toBe(true);
    expect(isPlaceKind('coffee shop')).toBe(false);
    expect(isPlaceKind(null)).toBe(false);
  });
});
