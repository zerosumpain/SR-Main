// Cron schedules must run in the owner's wall-clock time, not the server's.
//
// The bug: `new Cron(expr)` with no options uses server local time. The VPS is
// Etc/UTC, so `0 20 * * *` fired at 20:00 UTC — 21:00 in British Summer Time —
// while the canvas UI cheerfully labelled it "Europe/London". Every other
// scheduler in the codebase already passed a timezone; the two driven by
// user-created rows did not.

import { describe, it, expect, vi } from 'vitest';
import { Cron } from 'croner';
import { cronTimezone, DEFAULT_CRON_TZ } from './cron-timezone';

describe('cronTimezone', () => {
  it('defaults to Europe/London — what the UI has always claimed', () => {
    expect(cronTimezone(undefined)).toBe(DEFAULT_CRON_TZ);
    expect(cronTimezone(null)).toBe(DEFAULT_CRON_TZ);
    expect(cronTimezone({})).toBe(DEFAULT_CRON_TZ);
    expect(cronTimezone({ timezone: '   ' })).toBe(DEFAULT_CRON_TZ);
    expect(DEFAULT_CRON_TZ).toBe('Europe/London');
  });

  it('honours a schedule that names its own zone', () => {
    expect(cronTimezone({ timezone: 'America/New_York' })).toBe('America/New_York');
    expect(cronTimezone({ timezone: 'UTC' })).toBe('UTC');
  });

  it('falls back rather than throwing on a bad zone', () => {
    // An unknown zone makes `new Cron` throw, which would take down
    // registration of that schedule entirely. Running an hour out beats not
    // running at all.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(cronTimezone({ timezone: 'Mars/Olympus_Mons' })).toBe(DEFAULT_CRON_TZ);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the schedule actually fires at the London time', () => {
  // Anchored inside British Summer Time (UTC+1). This is the exact case that
  // broke: the canvas said 20:00, the owner expected 20:00, the server fired at
  // 20:00 UTC = 21:00 local.
  const duringBST = new Date('2026-08-02T10:00:00Z');

  it('runs 0 20 * * * at 19:00 UTC in summer, not 20:00 UTC', () => {
    const job = new Cron('0 20 * * *', { timezone: 'Europe/London', paused: true });
    const next = job.nextRun(duringBST);
    job.stop();
    expect(next?.toISOString()).toBe('2026-08-02T19:00:00.000Z');
  });

  it('the un-timezoned form is an hour late — the bug, pinned', () => {
    const job = new Cron('0 20 * * *', { timezone: 'UTC', paused: true });
    const next = job.nextRun(duringBST);
    job.stop();
    expect(next?.toISOString()).toBe('2026-08-02T20:00:00.000Z');
  });

  it('tracks the DST boundary instead of drifting', () => {
    // In GMT the two coincide; the London schedule must follow the clock change
    // rather than staying pinned to whatever offset applied when it was written.
    const duringGMT = new Date('2026-12-01T10:00:00Z');
    const job = new Cron('0 20 * * *', { timezone: 'Europe/London', paused: true });
    const next = job.nextRun(duringGMT);
    job.stop();
    expect(next?.toISOString()).toBe('2026-12-01T20:00:00.000Z');
  });
});
