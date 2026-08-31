import { describe, expect, it } from 'vitest';
import { PLAUSIBLE } from './features/normalise';
import { MS_PER_MINUTE, checkReading, msToMinutes } from './health-quality';

describe('msToMinutes', () => {
  it('converts the night that started all this', () => {
    // 27,841,092 ms is 7h44m. Assigned straight into a field called
    // durationMins it read as 464,018 hours on the feed.
    expect(msToMinutes(27_841_092)).toBe(464);
    expect(Math.round((464 / 60) * 100) / 100).toBe(7.73);
  });

  it('is null for anything that is not a finite number', () => {
    expect(msToMinutes(null)).toBeNull();
    expect(msToMinutes(undefined)).toBeNull();
    expect(msToMinutes(Number.NaN)).toBeNull();
    expect(msToMinutes(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps zero as zero rather than as missing', () => {
    // A nap of no length is a real reading; null means "we do not know".
    expect(msToMinutes(0)).toBe(0);
  });

  it('uses the same constant the conversion is named for', () => {
    expect(MS_PER_MINUTE).toBe(60_000);
    expect(msToMinutes(MS_PER_MINUTE * 90)).toBe(90);
  });
});

describe('checkReading', () => {
  it('passes an ordinary night through untouched', () => {
    expect(checkReading('sleepMinutes', 464)).toEqual({ value: 464, problem: null });
  });

  it('rejects the impossible one, and says why in words', () => {
    const r = checkReading('sleepMinutes', 27_841_092);
    expect(r.value).toBeNull();
    expect(r.problem).toContain('27,841,092');
    expect(r.problem).toContain('outside the possible range');
    expect(r.problem).toContain('not used');
  });

  it('names the bounds it used, so the message can be argued with', () => {
    const r = checkReading('sleepMinutes', 99_999);
    expect(r.problem).toContain(`${PLAUSIBLE.sleepMinutes.lo}`);
    expect(r.problem).toContain(`${PLAUSIBLE.sleepMinutes.hi}`);
  });

  it('treats absent as absent, not as a fault', () => {
    // Nothing recorded is ordinary; it must not raise a problem or file a fix.
    for (const v of [null, undefined, Number.NaN]) {
      expect(checkReading('sleepMinutes', v)).toEqual({ value: null, problem: null });
    }
  });

  it('guards sleep performance on the same table', () => {
    expect(checkReading('sleepPerformance', 89).value).toBe(89);
    expect(checkReading('sleepPerformance', 4_100).value).toBeNull();
    expect(checkReading('sleepPerformance', -3).value).toBeNull();
  });

  it('passes a key with no bounds straight through, so adoption can be gradual', () => {
    expect(checkReading('somethingNobodyHasBoundedYet', 1e9)).toEqual({
      value: 1e9,
      problem: null,
    });
  });

  it('shares ONE bounds table with the features pipeline', () => {
    // Two tables of what counts as a possible night is how they come to
    // disagree — the whole reason this imports rather than declares.
    expect(PLAUSIBLE.sleepMinutes).toEqual({ lo: 0, hi: 1000 });
    expect(checkReading('sleepMinutes', PLAUSIBLE.sleepMinutes.hi).value).not.toBeNull();
    expect(checkReading('sleepMinutes', PLAUSIBLE.sleepMinutes.hi + 1).value).toBeNull();
  });
});
