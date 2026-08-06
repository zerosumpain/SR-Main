import { describe, it, expect } from 'vitest';
import { buildAlert } from '$lib/connectors/monitor';
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

describe('connector alerting', () => {
  it('says nothing when everything works', () => {
    expect(buildAlert([r({}), r({ key: 'b', status: 'unconfigured' })])).toBeNull();
  });

  it('does not alert on degraded — only broken is worth waking someone', () => {
    const alert = buildAlert([
      r({ key: 'sensors', label: 'Home sensors', status: 'degraded', detail: '1 of 4 reporting' }),
    ]);
    expect(alert).toBeNull();
  });

  it('names the connector, what was seen, and how to fix it', () => {
    const alert = buildAlert([
      r({
        key: 'gmail:2',
        label: 'Gmail · johnkelly.main@gmail.com',
        status: 'broken',
        detail: 'Gmail token refresh failed: invalid_grant',
        fixHint: 'Re-authorise the account',
      }),
      r({ key: 'ok', status: 'ok' }),
    ]);
    expect(alert).toContain('1 connector down');
    expect(alert).toContain('johnkelly.main@gmail.com');
    expect(alert).toContain('invalid_grant');
    expect(alert).toContain('Re-authorise the account');
    expect(alert).toContain('/admin/connections');
    // Healthy connectors must not pad the message.
    expect(alert).not.toContain('Thing');
  });

  it('pluralises and lists every broken connector', () => {
    const alert = buildAlert([
      r({ key: 'a', label: 'Gmail', status: 'broken', detail: 'expired' }),
      r({ key: 'b', label: 'OpenRouter', status: 'broken', detail: 'no credit' }),
    ]);
    expect(alert).toContain('2 connectors down');
    expect(alert).toContain('Gmail');
    expect(alert).toContain('OpenRouter');
  });
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
});
