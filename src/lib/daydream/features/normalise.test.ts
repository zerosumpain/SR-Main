import { describe, it, expect } from 'vitest';
import {
  aggregate,
  appleValue,
  isAmbiguousStrain,
  msToMinutes,
  plausible,
  secondsToMinutes,
  strainValue,
  STRAIN_MAX,
} from './normalise';

// Every number here was read off production. They are pinned because the cost
// of getting them wrong is not a crash — it is a confident, wrong finding about
// someone's own life, which is the one failure this feature must not have.

describe('appleValue', () => {
  it('turns a stored heart rate into a pulse', () => {
    expect(appleValue(8820)).toBeCloseTo(88.2);
    expect(appleValue(3600)).toBeCloseTo(36);
    expect(appleValue(18900)).toBeCloseTo(189);
  });

  // A whole day of samples summed to 302,025 in production. Divided, 3,020
  // steps — a real number. Undivided it is a marathon every day.
  it('turns a day of stored steps into a step count', () => {
    expect(appleValue(302_025)).toBeCloseTo(3020.25);
  });

  it('passes null through rather than inventing a zero', () => {
    expect(appleValue(null)).toBeNull();
    expect(appleValue(undefined)).toBeNull();
    expect(appleValue(Number.NaN)).toBeNull();
  });
});

describe('strainValue', () => {
  // The awkward one: the same column holds both conventions, written by two
  // sources whose date ranges overlap, with nothing on the row to say which.
  it('leaves a raw reading alone', () => {
    expect(strainValue(18.05)).toBeCloseTo(18.05);
    expect(strainValue(1.12)).toBeCloseTo(1.12);
  });

  it('unscales a x100 reading', () => {
    expect(strainValue(2033)).toBeCloseTo(20.33);
    expect(strainValue(145)).toBeCloseTo(1.45);
    expect(strainValue(1103)).toBeCloseTo(11.03);
  });

  // The specific mistake the ceiling guards against. Strain caps at 21, so a
  // raw 21 is legitimate and must not become 0.21.
  it('does not unscale a legitimate maximum', () => {
    expect(strainValue(STRAIN_MAX)).toBeCloseTo(STRAIN_MAX);
  });

  it('refuses a negative', () => {
    expect(strainValue(-3)).toBeNull();
  });
});

describe('isAmbiguousStrain', () => {
  // Always false while the cap holds. It exists to notice the day it stops.
  it('is quiet across the whole observed range', () => {
    for (const v of [0, 1.12, 18.05, 21, 145, 1103, 2033]) {
      expect(isAmbiguousStrain(v)).toBe(false);
    }
  });

  it('flags a value in the gap the rule cannot classify', () => {
    expect(isAmbiguousStrain(21.5)).toBe(true);
  });
});

describe('durations', () => {
  // Named `total_in_bed`, holds milliseconds. 36,858,008 is 10.2 hours; read as
  // seconds it is 426 days.
  it('reads whoop time in bed as milliseconds', () => {
    expect(msToMinutes(36_858_008)).toBeCloseTo(614.3, 0);
    expect(msToMinutes(6_112_190)).toBeCloseTo(101.9, 0);
  });

  it('reads activity duration as honest seconds', () => {
    expect(secondsToMinutes(33_978)).toBeCloseTo(566.3, 0);
  });
});

describe('aggregate', () => {
  // The other documented way these numbers go bad. Summing heart rate gives a
  // five-figure pulse; averaging steps gives a step count of ninety.
  it('sums steps and averages heart rate', () => {
    expect(aggregate([100, 250, 300], 'sum')).toBe(650);
    expect(aggregate([60, 80, 100], 'mean')).toBeCloseTo(80);
  });

  it('takes the day maximum for strain', () => {
    expect(aggregate([4.2, 11.03, 8.1], 'max')).toBeCloseTo(11.03);
  });

  it('returns null for an empty day rather than zero', () => {
    expect(aggregate([], 'sum')).toBeNull();
    expect(aggregate([Number.NaN], 'mean')).toBeNull();
  });
});

describe('plausible', () => {
  // The tripwire. A 100x error must produce silence, not a finding.
  it('drops a heart rate that was never unscaled', () => {
    expect(plausible('meanHeartRate', 8820)).toBeNull();
    expect(plausible('meanHeartRate', 88.2)).toBeCloseTo(88.2);
  });

  it('drops a strain above its definitional ceiling', () => {
    expect(plausible('strain', 2033)).toBeNull();
    expect(plausible('strain', 20.33)).toBeCloseTo(20.33);
  });

  it('lets an unbounded key through untouched', () => {
    expect(plausible('somethingNew', 1234)).toBe(1234);
  });

  it('never turns a missing value into a zero', () => {
    expect(plausible('steps', null)).toBeNull();
  });
});
