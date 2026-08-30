import { describe, it, expect, vi, beforeEach } from 'vitest';

// Isolate the pipeline + settings so the seed path is all that runs here. The
// nightly SCHEDULE is no longer this file's job — it lives on the heartbeat as
// `daydream-improve`, and is covered by that activity's own test.
vi.mock('./run', () => ({
  runImprovementNow: vi.fn(),
  isUserActive: vi.fn().mockResolvedValue(false),
}));
vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn().mockResolvedValue(null) }));

// slugifyName without pulling the site-tool registry.
vi.mock('$lib/workflows/site-tools/tools/apis', () => ({
  slugifyName: (n: string) =>
    String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80),
}));

// Datastore access layer — real seed logic runs against these mocks.
vi.mock('$lib/datastore', () => {
  class DatastoreError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = 'DatastoreError';
    }
  }
  return {
    DatastoreError,
    ensureCollection: vi.fn().mockResolvedValue({ id: 'c1' }),
    getRecordByKey: vi.fn(),
    upsertRecord: vi.fn().mockResolvedValue({ id: 'r1' }),
  };
});

import { DatastoreError, ensureCollection, getRecordByKey, upsertRecord } from '$lib/datastore';
import { seedApiCatalog, ensureSystemCollections, SEEDED_APIS } from './seed-apis';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRecordByKey).mockReset();
  vi.mocked(ensureCollection).mockResolvedValue({ id: 'c1' } as never);
  vi.mocked(upsertRecord).mockResolvedValue({ id: 'r1' } as never);
});

describe('ensureSystemCollections', () => {
  it('ensures all six system collections (idempotent create-if-absent)', async () => {
    await ensureSystemCollections();
    expect(ensureCollection).toHaveBeenCalledTimes(6);
    const slugs = vi.mocked(ensureCollection).mock.calls.map((c) => c[0]);
    expect(slugs).toEqual(
      expect.arrayContaining([
        'api_catalog',
        'question_insights',
        'improvement_runs',
        'tool_attempts',
        'improvement_backlog',
        // The call-policy overlay the MCP read path depends on.
        'tool_call_policy',
      ]),
    );
  });
});

describe('seedApiCatalog — idempotency', () => {
  it('seeds every API on a fresh catalogue', async () => {
    // Nothing present yet → every getRecordByKey rejects not_found.
    vi.mocked(getRecordByKey).mockRejectedValue(new DatastoreError('not_found', 'absent'));
    const res = await seedApiCatalog();
    expect(res.seeded).toBe(SEEDED_APIS.length);
    expect(res.skipped).toBe(0);
    expect(upsertRecord).toHaveBeenCalledTimes(SEEDED_APIS.length);
  });

  it('adds no records on a second run when all keys already exist', async () => {
    // Everything present → getRecordByKey resolves; nothing upserted.
    vi.mocked(getRecordByKey).mockResolvedValue({ id: 'existing' } as never);
    const res = await seedApiCatalog();
    expect(res.seeded).toBe(0);
    expect(res.skipped).toBe(SEEDED_APIS.length);
    expect(upsertRecord).not.toHaveBeenCalled();
  });

  it('never clobbers a self-registered entry (skips present keys, seeds absent ones)', async () => {
    // First entry already exists; the rest are absent.
    let call = 0;
    vi.mocked(getRecordByKey).mockImplementation(async () => {
      call++;
      if (call === 1) return { id: 'existing' } as never;
      throw new DatastoreError('not_found', 'absent');
    });
    const res = await seedApiCatalog();
    expect(res.skipped).toBe(1);
    expect(res.seeded).toBe(SEEDED_APIS.length - 1);
    expect(upsertRecord).toHaveBeenCalledTimes(SEEDED_APIS.length - 1);
  });
});
