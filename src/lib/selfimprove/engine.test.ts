import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable host name for the prod-gate test.
const h = vi.hoisted(() => ({ host: 'vps-prod' }));

vi.mock('os', () => ({ default: { hostname: () => h.host } }));

// Croner: capture whether a cron was scheduled (must be `new`-able).
const cronCtor = vi.hoisted(() =>
  vi.fn(function MockCron() {
    return { stop: () => {} };
  }),
);
vi.mock('croner', () => ({ Cron: cronCtor }));

// Isolate the pipeline + settings so startSelfImprovement only exercises seeds
// + scheduling.
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
import { startSelfImprovement, stopSelfImprovement, isScheduled } from './engine';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRecordByKey).mockReset();
  vi.mocked(ensureCollection).mockResolvedValue({ id: 'c1' } as never);
  vi.mocked(upsertRecord).mockResolvedValue({ id: 'r1' } as never);
  cronCtor.mockImplementation(function MockCron() {
    return { stop: () => {} };
  });
  h.host = 'vps-prod';
  stopSelfImprovement();
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

describe('startSelfImprovement — prod host gate', () => {
  it('does NOT schedule the cron on homeserv without the dev override', () => {
    h.host = 'homeserv';
    delete process.env.SELF_IMPROVE_ALLOW_DEV;
    startSelfImprovement();
    expect(cronCtor).not.toHaveBeenCalled();
    expect(isScheduled()).toBe(false);
  });

  it('schedules the nightly cron on a production (non-homeserv) host', () => {
    h.host = 'vps-prod';
    startSelfImprovement();
    expect(cronCtor).toHaveBeenCalledTimes(1);
    expect(isScheduled()).toBe(true);
    stopSelfImprovement();
  });

  it('schedules on homeserv when SELF_IMPROVE_ALLOW_DEV=1', () => {
    h.host = 'homeserv';
    process.env.SELF_IMPROVE_ALLOW_DEV = '1';
    startSelfImprovement();
    expect(cronCtor).toHaveBeenCalledTimes(1);
    expect(isScheduled()).toBe(true);
    stopSelfImprovement();
    delete process.env.SELF_IMPROVE_ALLOW_DEV;
  });
});
