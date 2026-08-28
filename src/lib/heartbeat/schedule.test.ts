import { describe, it, expect } from 'vitest';
import {
  wallClock,
  withinActiveHours,
  instantAtLocalTime,
  nextWindowOpening,
  rescheduleAfterWindowSkip,
  MIN_RESCHEDULE_MS,
  type WindowSpec,
} from './schedule';

const LDN = 'Europe/London';

function spec(start: string | null, end: string | null, tz: string | null = LDN): WindowSpec {
  return { activeHoursStart: start, activeHoursEnd: end, activeHoursTz: tz };
}

describe('wallClock', () => {
  it('renders London summer time an hour ahead of UTC', () => {
    expect(wallClock(new Date('2026-08-28T06:50:00Z'), LDN)).toBe('07:50');
  });

  it('renders London winter time as UTC', () => {
    expect(wallClock(new Date('2026-01-15T06:50:00Z'), LDN)).toBe('06:50');
  });

  it('renders midnight as 00:00, never 24:00', () => {
    expect(wallClock(new Date('2026-01-15T00:00:00Z'), LDN)).toBe('00:00');
  });
});

describe('withinActiveHours', () => {
  it('is always open with no window', () => {
    expect(withinActiveHours(spec(null, null), new Date('2026-08-28T03:00:00Z'))).toBe(true);
  });

  it('excludes the end minute so a window is half-open', () => {
    expect(withinActiveHours(spec('05:00', '07:00', 'UTC'), new Date('2026-08-28T07:00:00Z'))).toBe(false);
    expect(withinActiveHours(spec('05:00', '07:00', 'UTC'), new Date('2026-08-28T06:59:00Z'))).toBe(true);
  });

  it('handles a window that wraps midnight', () => {
    const overnight = spec('22:00', '06:00', 'UTC');
    expect(withinActiveHours(overnight, new Date('2026-08-28T23:30:00Z'))).toBe(true);
    expect(withinActiveHours(overnight, new Date('2026-08-28T02:00:00Z'))).toBe(true);
    expect(withinActiveHours(overnight, new Date('2026-08-28T12:00:00Z'))).toBe(false);
  });

  it('reproduces the production lock-out: 06:50 UTC is outside 05:00-07:00 London', () => {
    // This is daydream-bank exactly as it sat on production.
    expect(withinActiveHours(spec('05:00', '07:00'), new Date('2026-08-29T06:50:58Z'))).toBe(false);
  });
});

describe('instantAtLocalTime', () => {
  it('resolves a BST wall clock to the right UTC instant', () => {
    const at = instantAtLocalTime('2026-08-29', '05:00', LDN);
    expect(at?.toISOString()).toBe('2026-08-29T04:00:00.000Z');
  });

  it('resolves a GMT wall clock to the same UTC instant', () => {
    const at = instantAtLocalTime('2026-01-15', '05:00', LDN);
    expect(at?.toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  it('rejects a malformed time rather than guessing', () => {
    expect(instantAtLocalTime('2026-08-29', '5:00', LDN)).toBeNull();
    expect(instantAtLocalTime('2026-08-29', '25:00', LDN)).toBeNull();
  });

  it('reads an unknown zone as UTC instead of throwing', () => {
    expect(instantAtLocalTime('2026-08-29', '05:00', 'Mars/Olympus')?.toISOString()).toBe(
      '2026-08-29T05:00:00.000Z',
    );
  });
});

describe('an unreadable active_hours_tz', () => {
  // `active_hours_tz` is free text. A typo in it used to throw a RangeError
  // out of the engine tick; now both halves of the decision read it as UTC, so
  // the action runs on a window that is merely wrong rather than not at all.
  const bad = spec('05:00', '07:00', 'Mars/Olympus');

  it('does not throw when asked whether the window is open', () => {
    expect(() => withinActiveHours(bad, new Date('2026-08-29T06:00:00Z'))).not.toThrow();
    expect(withinActiveHours(bad, new Date('2026-08-29T06:00:00Z'))).toBe(true);
  });

  it('agrees with itself: the opening it names is inside the window it tests', () => {
    const at = nextWindowOpening(bad, new Date('2026-08-29T09:00:00Z'));
    expect(at).not.toBeNull();
    expect(withinActiveHours(bad, at as Date)).toBe(true);
  });
});

describe('nextWindowOpening', () => {
  it('finds tomorrow morning for an action that has just missed its window', () => {
    // daydream-bank: due 06:50 UTC (07:50 BST), window 05:00-07:00 London.
    const now = new Date('2026-08-29T06:50:58Z');
    const at = nextWindowOpening(spec('05:00', '07:00'), now);
    expect(at?.toISOString()).toBe('2026-08-30T04:00:00.000Z');
  });

  it('finds later the same day when the window has not opened yet', () => {
    const now = new Date('2026-08-29T01:00:00Z'); // 02:00 BST
    const at = nextWindowOpening(spec('05:00', '07:00'), now);
    expect(at?.toISOString()).toBe('2026-08-29T04:00:00.000Z');
  });

  it('finds this evening for daydream-weekly, which had never sent', () => {
    // 21:24 BST against a 17:00-21:00 window: the next opening is 17:00 the
    // following day.
    const now = new Date('2026-08-28T20:24:35Z');
    const at = nextWindowOpening(spec('17:00', '21:00'), now);
    expect(at?.toISOString()).toBe('2026-08-29T16:00:00.000Z');
  });

  it('crosses a DST boundary without drifting an hour', () => {
    // BST ends 2026-10-25 02:00. A Saturday-evening miss must land on 05:00
    // GMT, not 04:00 UTC.
    const now = new Date('2026-10-25T08:00:00Z');
    const at = nextWindowOpening(spec('05:00', '07:00'), now);
    expect(at?.toISOString()).toBe('2026-10-26T05:00:00.000Z');
    expect(wallClock(at as Date, LDN)).toBe('05:00');
  });

  it('returns the opening of a midnight-wrapping window', () => {
    const now = new Date('2026-08-28T12:00:00Z');
    const at = nextWindowOpening(spec('22:00', '06:00', 'UTC'), now);
    expect(at?.toISOString()).toBe('2026-08-28T22:00:00.000Z');
  });

  it('gives up on a zero-width window rather than looping', () => {
    expect(nextWindowOpening(spec('05:00', '05:00'), new Date('2026-08-28T12:00:00Z'))).toBeNull();
  });

  it('has nothing to say about an action with no window', () => {
    expect(nextWindowOpening(spec(null, null), new Date())).toBeNull();
  });

  it('answers "now" when the window is already open', () => {
    const now = new Date('2026-08-29T05:00:00Z'); // 06:00 BST
    expect(nextWindowOpening(spec('05:00', '07:00'), now)).toEqual(now);
  });
});

describe('rescheduleAfterWindowSkip', () => {
  it('replaces the fixed phase that caused the lock-out', () => {
    const now = new Date('2026-08-29T06:50:58Z');
    const fallback = new Date(now.getTime() + 86_400_000); // the old behaviour
    const next = rescheduleAfterWindowSkip(spec('05:00', '07:00'), now, fallback);

    expect(next.toISOString()).toBe('2026-08-30T04:00:00.000Z');
    // The point of the fix: the OLD answer was outside the window again, so it
    // would have skipped forever.
    expect(withinActiveHours(spec('05:00', '07:00'), fallback)).toBe(false);
    expect(withinActiveHours(spec('05:00', '07:00'), next)).toBe(true);
  });

  it('can only ever delay — the cadence stays a floor', () => {
    const now = new Date('2026-08-29T06:50:58Z');
    const fallback = new Date(now.getTime() + 86_400_000);
    const next = rescheduleAfterWindowSkip(spec('05:00', '07:00'), now, fallback);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it('falls back to the old behaviour when the window cannot be read', () => {
    const now = new Date('2026-08-29T06:50:58Z');
    const fallback = new Date(now.getTime() + 86_400_000);
    // Only genuinely uncomputable windows fall back. An unreadable ZONE does
    // not — it resolves to UTC and still gets a real opening, which is the
    // point of resolveZone.
    expect(rescheduleAfterWindowSkip(spec('05:00', '05:00'), now, fallback)).toEqual(fallback);
    expect(rescheduleAfterWindowSkip(spec('bad', '07:00'), now, fallback)).toEqual(fallback);
    expect(rescheduleAfterWindowSkip(spec(null, null), now, fallback)).toEqual(fallback);
  });

  it('never schedules inside the next minute', () => {
    const now = new Date('2026-08-29T03:59:59Z'); // one second before 05:00 BST
    const next = rescheduleAfterWindowSkip(spec('05:00', '07:00'), now, new Date(now.getTime() + 1000));
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime() + MIN_RESCHEDULE_MS);
  });
});
