import { describe, it, expect } from 'vitest';
import { sortReports, brokenOf, needsResync, type ConnectorReport } from '$lib/connectors/types';

const r = (over: Partial<ConnectorReport>): ConnectorReport => ({
  key: 'k',
  label: 'Thing',
  group: 'G',
  tier: 'service',
  status: 'ok',
  detail: 'fine',
  live: true,
  checkedAt: '2026-07-29T09:00:00.000Z',
  ms: 10,
  ...over,
});

describe('report ordering', () => {
  it('sorts worst-first so the dashboard leads with what is broken', () => {
    const sorted = sortReports([
      r({ key: '1', label: 'Zed', status: 'ok' }),
      r({ key: '2', label: 'Alpha', status: 'unconfigured' }),
      r({ key: '3', label: 'Beta', status: 'broken' }),
      r({ key: '4', label: 'Gamma', status: 'degraded' }),
    ]);
    expect(sorted.map((x) => x.status)).toEqual(['broken', 'degraded', 'unconfigured', 'ok']);
  });

  it('brokenOf excludes unconfigured — absent is not the same as failing', () => {
    const reports = [r({ key: '1', status: 'unconfigured' }), r({ key: '2', status: 'broken' })];
    expect(brokenOf(reports).map((x) => x.key)).toEqual(['2']);
  });
});

describe('what the landing banner counts', () => {
  it('counts accounts that are broken or stalled', () => {
    const reports = [
      r({ key: 'gmail:1', tier: 'account', status: 'broken' }),
      r({ key: 'strava', tier: 'account', status: 'degraded' }),
      r({ key: 'whoop', tier: 'account', status: 'ok' }),
    ];
    expect(needsResync(reports).map((x) => x.key)).toEqual(['gmail:1', 'strava']);
  });

  it('ignores infrastructure — a dead LLM key is not an account to resync', () => {
    const reports = [
      r({ key: 'openrouter', tier: 'service', status: 'broken' }),
      r({ key: 'whatsapp', tier: 'service', status: 'broken' }),
    ];
    expect(needsResync(reports)).toEqual([]);
  });

  it('ignores integrations that were never connected — daily nagging trains you to ignore it', () => {
    const reports = [r({ key: 'integration:apple-calendar', tier: 'account', status: 'unconfigured' })];
    expect(needsResync(reports)).toEqual([]);
  });

  it('ignores dormant accounts — parked on purpose is not waiting to be resynced', () => {
    const reports = [r({ key: 'strava', tier: 'account', status: 'dormant' })];
    expect(needsResync(reports)).toEqual([]);
  });
});

describe('dormant connectors', () => {
  it('is not counted as broken', () => {
    expect(brokenOf([r({ key: 'strava', status: 'dormant' })])).toEqual([]);
  });

  it('sorts below everything else — there is nothing to act on', () => {
    const sorted = sortReports([
      r({ key: 'strava', label: 'Strava', status: 'dormant' }),
      r({ key: 'whoop', label: 'Whoop', status: 'ok' }),
      r({ key: 'gmail', label: 'Gmail', status: 'broken' }),
    ]);
    expect(sorted.map((x) => x.key)).toEqual(['gmail', 'whoop', 'strava']);
  });
});
