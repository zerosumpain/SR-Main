import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The Drive → Intel contract. Both halves still live in Main, so this drains
 * nothing in production today; it is what keeps working once Drive is routed
 * and its writes stop being function calls.
 */

const rows: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
let deleted = 0;

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({ values: async (v: unknown) => void rows.push(v as Record<string, unknown>) }),
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => rows.filter((r) => !r.processedAt) }) }),
      }),
    }),
    update: () => ({ set: (v: unknown) => ({ where: async () => void updates.push(v as Record<string, unknown>) }) }),
    delete: () => ({ where: async () => void (deleted += 1) }),
  },
}));
vi.mock('$lib/db/schema', () => ({ driveIntelOutbox: { attempts: 'attempts', processedAt: 'processed_at', id: 'id' } }));

const queueIntelExtraction = vi.fn();
const queueDerivedIntelDelete = vi.fn();
const syncSourcePolicy = vi.fn(async () => ({ scanned: 0 }));
vi.mock('../../../../src/lib/jkai/intel/auto-extract', () => ({ queueIntelExtraction, queueDerivedIntelDelete }));
vi.mock('../../../../src/lib/jkai/intel/source-policy.server', () => ({ syncSourcePolicy }));

const mod = () => import('../../../../src/lib/jkai/intel/drive-outbox');

beforeEach(() => {
  rows.length = 0;
  updates.length = 0;
  deleted = 0;
  vi.clearAllMocks();
});

describe('drive → intel outbox', () => {
  it('carries the three operations whose result Drive never used', async () => {
    const { enqueueDriveIntel } = await mod();
    await enqueueDriveIntel('file-deleted', 'file-1');
    await enqueueDriveIntel('policy-resync', 'Notes/', { ids: ['a', 'b'] });
    await enqueueDriveIntel('file-changed', 'file-2', { kind: 'file', refId: 'file-2' });
    expect(rows.map((r) => r.kind)).toEqual(['file-deleted', 'policy-resync', 'file-changed']);
  });

  it('routes each kind to the function Drive used to call directly', async () => {
    const { enqueueDriveIntel, drainDriveIntelOutbox } = await mod();
    await enqueueDriveIntel('file-deleted', 'file-1');
    await enqueueDriveIntel('policy-resync', 'Notes/', { ids: ['a'] });
    await enqueueDriveIntel('file-changed', 'file-2', { kind: 'file', refId: 'file-2' });

    const result = await drainDriveIntelOutbox();

    expect(queueDerivedIntelDelete).toHaveBeenCalledWith('file', 'file-1');
    expect(syncSourcePolicy).toHaveBeenCalledWith('Notes/', ['a']);
    expect(queueIntelExtraction).toHaveBeenCalledWith({ kind: 'file', refId: 'file-2' });
    expect(result).toEqual({ processed: 3, failed: 0 });
  });

  it('counts a failing row instead of letting it block the batch', async () => {
    const { enqueueDriveIntel, drainDriveIntelOutbox } = await mod();
    syncSourcePolicy.mockRejectedValueOnce(new Error('boom'));
    await enqueueDriveIntel('policy-resync', 'Bad/');
    await enqueueDriveIntel('file-deleted', 'file-9');

    const result = await drainDriveIntelOutbox();

    // The good row still went through — one poisonous row must not stop the rest.
    expect(queueDerivedIntelDelete).toHaveBeenCalledWith('file', 'file-9');
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(updates.some((u) => typeof u.lastError === 'string' && u.lastError.includes('boom'))).toBe(true);
  });

  it('refuses a kind it does not know rather than dropping it silently', async () => {
    const { enqueueDriveIntel, drainDriveIntelOutbox } = await mod();
    await enqueueDriveIntel('file-moved' as never, 'file-3');
    const result = await drainDriveIntelOutbox();
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(updates.some((u) => String(u.lastError).includes('unknown drive-intel kind'))).toBe(true);
  });
});
