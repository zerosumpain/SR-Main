import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/datastore', () => ({
  ensureCollection: vi.fn().mockResolvedValue({ id: 'c1' }),
  upsertRecord: vi.fn().mockResolvedValue({ id: 'r1' }),
  queryRecords: vi.fn().mockResolvedValue({ records: [] }),
}));

vi.mock('$lib/security/sensitive', () => ({
  redactSensitive: vi.fn((s: string) => s.replace(/sk-[A-Za-z0-9]+/g, '[redacted]')),
}));

import { upsertRecord, queryRecords } from '$lib/datastore';
import {
  statusFrom,
  recordIntelRun,
  hasScheduledRunFor,
  localDayOf,
  type IntelStageResult,
} from './run-log';

const stage = (over: Partial<IntelStageResult>): IntelStageResult => ({
  stage: 'gmail',
  ok: true,
  ms: 5,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('statusFrom', () => {
  it('is ok when every stage succeeded', () => {
    expect(statusFrom([stage({}), stage({ stage: 'lenses' })])).toBe('ok');
  });

  it('is failed when every stage failed', () => {
    expect(statusFrom([stage({ ok: false }), stage({ stage: 'lenses', ok: false })])).toBe('failed');
  });

  // The actual production shape: Gmail dead, everything else fine. Reporting
  // that as either 'ok' or 'failed' is what let it hide for as long as it did.
  it('is partial when some stages failed and some did not', () => {
    expect(statusFrom([stage({ ok: false }), stage({ stage: 'lenses' })])).toBe('partial');
  });

  it('treats a run with no stages at all as failed, not ok', () => {
    expect(statusFrom([])).toBe('failed');
  });
});

describe('recordIntelRun', () => {
  const base = {
    startedAt: '2026-08-04T03:15:00.000Z',
    day: '2026-08-04',
    trigger: 'scheduled' as const,
    status: 'partial' as const,
  };

  it('keeps the error TEXT, which is the entire point', async () => {
    await recordIntelRun({
      ...base,
      stages: [stage({ ok: false, error: 'cannot cast type record to text[]' })],
    });
    const data = vi.mocked(upsertRecord).mock.calls[0][1].data as never as {
      stages: IntelStageResult[];
    };
    expect(data.stages[0].error).toContain('cannot cast type record to text[]');
  });

  it('scrubs a secret out of a failure message before storing it', async () => {
    await recordIntelRun({
      ...base,
      stages: [stage({ ok: false, error: 'refresh failed for sk-abc123XYZ' })],
    });
    const data = vi.mocked(upsertRecord).mock.calls[0][1].data as never as {
      stages: IntelStageResult[];
    };
    expect(data.stages[0].error).toBe('refresh failed for [redacted]');
  });

  it('keys on day+trigger so a restart updates rather than duplicates', async () => {
    await recordIntelRun({ ...base, stages: [stage({})] });
    expect(vi.mocked(upsertRecord).mock.calls[0][1].key).toBe('2026-08-04:scheduled');
  });

  it('gives a manual sweep its own key, so it cannot overwrite the night', async () => {
    await recordIntelRun({ ...base, trigger: 'manual', stages: [stage({})] });
    expect(vi.mocked(upsertRecord).mock.calls[0][1].key).toBe('2026-08-04:manual');
  });
});

describe('hasScheduledRunFor', () => {
  it('is true once a scheduled run exists for the day', async () => {
    vi.mocked(queryRecords).mockResolvedValueOnce({
      records: [{ data: { trigger: 'scheduled' } }],
    } as never);
    expect(await hasScheduledRunFor('2026-08-04')).toBe(true);
    // Manual cleanup runs must not crowd the scheduled run out of the limit.
    expect(vi.mocked(queryRecords).mock.calls[0][1].filters).toContainEqual({ path: 'trigger', op: 'eq', value: 'scheduled' });
  });

  // A hand-run sweep must not convince the engine the night is done.
  it('ignores a manual run for the same day', async () => {
    vi.mocked(queryRecords).mockResolvedValueOnce({
      records: [{ data: { trigger: 'manual' } }],
    } as never);
    expect(await hasScheduledRunFor('2026-08-04')).toBe(false);
  });

  it('falls back to false — never blocks the night — if the store is unreadable', async () => {
    vi.mocked(queryRecords).mockRejectedValueOnce(new Error('datastore down'));
    expect(await hasScheduledRunFor('2026-08-04')).toBe(false);
  });
});

describe('localDayOf', () => {
  // A UTC key rolls over at 01:00 BST, mid-window, and would let the sweep run
  // a second time on the same night.
  it('uses the local date, not the UTC one', () => {
    const justAfterMidnightBST = new Date(2026, 6, 15, 0, 30);
    expect(localDayOf(justAfterMidnightBST)).toBe('2026-07-15');
  });

  it('zero-pads month and day', () => {
    expect(localDayOf(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
