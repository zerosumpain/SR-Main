import { describe, expect, it } from 'vitest';
import { connectionCoverage, overallCoverage, STALE_AFTER_MS } from './coverage';

const now = new Date('2026-09-05T12:00:00Z');
const base = {
  status: 'active',
  mode: 'openid',
  evidenceModes: ['provider_event', 'provider_snapshot', 'inferred_delta'],
  lastSyncSucceededAt: new Date(now.getTime() - 60_000),
  readable: true,
};

describe('connectionCoverage', () => {
  it('is complete for a fresh, readable, live source', () => {
    expect(connectionCoverage(base, now)).toBe('complete');
  });

  it('is unavailable when the consumer has no grant, whatever the data says', () => {
    expect(connectionCoverage({ ...base, readable: false }, now)).toBe('unavailable');
  });

  it('is unavailable before the first successful sync — missing is not zero', () => {
    expect(connectionCoverage({ ...base, lastSyncSucceededAt: null }, now)).toBe('unavailable');
  });

  it('is unavailable when the connection needs attention', () => {
    expect(connectionCoverage({ ...base, status: 'action_required' }, now)).toBe('unavailable');
    expect(connectionCoverage({ ...base, status: 'erasing' }, now)).toBe('unavailable');
  });

  it('goes stale after the window on a live source, never on an archive', () => {
    const old = new Date(now.getTime() - STALE_AFTER_MS - 1);
    expect(connectionCoverage({ ...base, lastSyncSucceededAt: old }, now)).toBe('stale');
    expect(
      connectionCoverage({ ...base, mode: 'import', evidenceModes: ['archive_import'], lastSyncSucceededAt: old }, now),
    ).toBe('complete');
  });

  it('labels a snapshot-only provider so recency is never read as duration', () => {
    expect(connectionCoverage({ ...base, evidenceModes: ['provider_snapshot'] }, now)).toBe('snapshot_only');
  });
});

describe('overallCoverage', () => {
  it('is unavailable with no sources or only unreadable ones', () => {
    expect(overallCoverage([])).toBe('unavailable');
    expect(overallCoverage(['unavailable', 'unavailable'])).toBe('unavailable');
  });

  it('is partial as soon as one source cannot be read', () => {
    expect(overallCoverage(['complete', 'unavailable'])).toBe('partial');
  });

  it('otherwise reports the weakest word present', () => {
    expect(overallCoverage(['complete', 'stale'])).toBe('stale');
    expect(overallCoverage(['complete', 'snapshot_only'])).toBe('snapshot_only');
    expect(overallCoverage(['complete', 'complete'])).toBe('complete');
  });
});
