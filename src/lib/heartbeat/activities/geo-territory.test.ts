// The retention watch (spec risk 6), tested where it is pure.
//
// `pruneTrail` hard-deletes daydream_trail past TRAIL_RETENTION_DAYS. Captured
// ground survives in the ledger, the evidence does not, and the only visible
// symptom of an ingest that has quietly stopped is a watermark that stopped
// moving. The arithmetic and the boundary are the parts that go wrong, so they
// are the parts pinned here — no clock, no database.

import { describe, it, expect } from 'vitest';
import { TRAIL_RETENTION_DAYS } from '$lib/daydream/types';
import { GEO_EPOCH } from '$lib/geo/service';
import { assessRetention, retentionSummary, safeError, geoTerritory } from './geo-territory';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const iso = (n: number) => daysAgo(n).toISOString();

const one = (over: Partial<Parameters<typeof assessRetention>[0][number]> = {}) =>
  assessRetention([{ subject: 'katie', watermark: iso(1), oldestUnreadTs: null, ...over }], NOW)[0];

describe('assessRetention', () => {
  it('a subject the ingest is keeping up with is ok', () => {
    const e = one();
    expect(e.level).toBe('ok');
    expect(e.watermarkAgeDays).toBe(1);
    expect(e.unreadOldestAgeDays).toBeNull();
  });

  it('warns a fortnight before the cliff, not on the day of', () => {
    // The whole point of the warn band: 90-day retention, 14 days of notice.
    expect(one({ watermark: iso(75) }).level).toBe('ok');
    expect(one({ watermark: iso(76) }).level).toBe('stale');
    expect(TRAIL_RETENTION_DAYS - 14).toBe(76);
  });

  it('honours a caller-supplied warn band', () => {
    const [wide] = assessRetention(
      [{ subject: 'katie', watermark: iso(60), oldestUnreadTs: null }],
      NOW,
      { warnDays: 30 },
    );
    expect(wide.level).toBe('stale');
  });

  it('calls unread evidence approaching the pruner LOSING, not merely stale', () => {
    // The distinction that matters: `stale` is history already unrecoverable,
    // `losing` is history about to be deleted that could still be scored.
    const e = one({ watermark: iso(80), oldestUnreadTs: daysAgo(79) });
    expect(e.level).toBe('losing');
    expect(e.unreadOldestAgeDays).toBe(79);
  });

  it('does not cry losing over unread trail that is merely recent', () => {
    // An ingest that fell behind by an hour is not an emergency.
    const e = one({ watermark: iso(0.1), oldestUnreadTs: daysAgo(0.05) });
    expect(e.level).toBe('ok');
    expect(e.unreadOldestAgeDays).toBe(0.1);
  });

  it('reads the epoch as never ingested rather than 20,000 days behind', () => {
    // `setSetting(k, null)` cannot unset, so a reset and a fresh install both
    // read as GEO_EPOCH. Scoring that as an age would put every new subject
    // permanently in the red and train the warning to be ignored.
    const e = one({ watermark: GEO_EPOCH });
    expect(e.level).toBe('never');
    expect(e.watermarkAgeDays).toBeNull();
  });

  it('still raises the alarm for a never-ingested subject with old unread trail', () => {
    // A backfill landed 30 days of history and nothing has scored it. That is
    // the one case where "never ingested" is an emergency rather than a shrug.
    const e = one({ watermark: GEO_EPOCH, oldestUnreadTs: daysAgo(85) });
    expect(e.level).toBe('losing');
  });

  it('treats an unparseable watermark as never, not as NaN', () => {
    const e = one({ watermark: 'not a date' });
    expect(e.level).toBe('never');
    expect(e.watermarkAgeDays).toBeNull();
  });
});

describe('retentionSummary', () => {
  it('is silent when nothing is at risk, including never-ingested subjects', () => {
    const entries = assessRetention(
      [
        { subject: 'john', watermark: iso(0.02), oldestUnreadTs: null },
        { subject: 'rory', watermark: GEO_EPOCH, oldestUnreadTs: null },
      ],
      NOW,
    );
    expect(retentionSummary(entries)).toBeNull();
  });

  it('names the subject and the number of days, so the pulse line is actionable', () => {
    const entries = assessRetention(
      [
        { subject: 'katie', watermark: iso(80), oldestUnreadTs: daysAgo(79) },
        { subject: 'fintan', watermark: iso(88), oldestUnreadTs: null },
      ],
      NOW,
    );
    const s = retentionSummary(entries) ?? '';
    expect(s).toContain('LOSING katie 79d of 90d unread');
    expect(s).toContain('no replay left for fintan 88d');
  });
});

describe('the handler contract', () => {
  it('is hourly and has NO active-hours window', () => {
    // Load-bearing, not a preference. `runOne` reschedules an out-of-window
    // skip to the next opening, but the failure this repo actually had was a
    // DAILY action whose phase sat outside its window skipping forever
    // (daydream-bank: 3/3 pulses skipped, never run once). The snapshot roll is
    // therefore a step inside this hourly, window-less action rather than a
    // daily job of its own, and this test is what stops someone adding a
    // tidy-looking overnight window later.
    expect(geoTerritory.defaultCadenceSeconds).toBe(3600);
    expect(geoTerritory.defaultActiveHours).toBeUndefined();
    expect(geoTerritory.name).toBe('geo-territory');
    expect(geoTerritory.defaultEnabled).toBe(true);
  });

  it('rolls snapshots by default — the guarded in-run step, not an opt-in', () => {
    expect(geoTerritory.defaultConfig?.snapshots).toBe(true);
  });
});

describe('safeError', () => {
  it('keeps the driver complaint and drops the bound parameters', () => {
    // The shape a Drizzle failure actually has. The line below the statement is
    // every bound parameter, which for this ingest is thousands of real GPS
    // coordinates — and a pulse summary is stored in the database and rendered
    // on the pulse board. Same rule /api/geo/rebuild follows.
    const err = new Error(
      'Failed query: insert into "geo_capture_events" ... \nparams: 54.5236,-1.5536,54.5237,-1.5535',
    );
    const out = safeError(err);
    expect(out).toContain('Failed query');
    expect(out).not.toContain('54.5236');
    expect(out).not.toContain('params:');
  });

  it('truncates a single very long line rather than trusting it', () => {
    const out = safeError(new Error('x'.repeat(500)));
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith('\u2026')).toBe(true);
  });

  it('survives a thrown non-Error', () => {
    expect(safeError('boom')).toBe('boom');
  });
});
