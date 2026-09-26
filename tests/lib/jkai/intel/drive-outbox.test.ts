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
const deleteDerivedIntel = vi.fn(async () => ({ notesDeleted: 0, entitiesRemoved: 0, relationshipsRemoved: 0 }));
const syncSourcePolicy = vi.fn(async () => ({ scanned: 0 }));
// A folder can route a file to household; the drain must carry what it resolves.
const spaceForDriveFile = vi.fn(async (): Promise<string | null> => 'household');
vi.mock('../../../../src/lib/jkai/intel/auto-extract', () => ({ queueIntelExtraction, queueDerivedIntelDelete, deleteDerivedIntel }));
vi.mock('../../../../src/lib/jkai/intel/source-policy.server', () => ({ syncSourcePolicy, spaceForDriveFile }));

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

    expect(deleteDerivedIntel).toHaveBeenCalledWith('file', 'file-1');
    expect(syncSourcePolicy).toHaveBeenCalledWith('Notes/', ['a']);
    expect(spaceForDriveFile).toHaveBeenCalledWith('file-2');
    expect(queueIntelExtraction).toHaveBeenCalledWith({ kind: 'file', refId: 'file-2', spaceId: 'household' });
    expect(result).toEqual({ processed: 3, failed: 0 });
  });

  it('counts a failing row instead of letting it block the batch', async () => {
    const { enqueueDriveIntel, drainDriveIntelOutbox } = await mod();
    syncSourcePolicy.mockRejectedValueOnce(new Error('boom'));
    await enqueueDriveIntel('policy-resync', 'Bad/');
    await enqueueDriveIntel('file-deleted', 'file-9');

    const result = await drainDriveIntelOutbox();

    // The good row still went through — one poisonous row must not stop the rest.
    expect(deleteDerivedIntel).toHaveBeenCalledWith('file', 'file-9');
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

describe('the counts a deletion reports', () => {
  it('records what the cleanup did, so Drive can read it back', async () => {
    // Deleting a file used to say what went with it, because the call was
    // awaited in the same process. Drive cannot recompute the numbers — the
    // planner protects owner-kept entities — so the consumer keeps them.
    const { enqueueDriveIntel, drainDriveIntelOutbox } = await mod();
    deleteDerivedIntel.mockResolvedValueOnce({
      notesDeleted: 1,
      entitiesRemoved: 4,
      relationshipsRemoved: 7,
    });
    await enqueueDriveIntel('file-deleted', 'file-42');

    await drainDriveIntelOutbox();

    expect(deleteDerivedIntel).toHaveBeenCalledWith('file', 'file-42');
    const stored = updates.find((u) => u.result);
    expect(stored?.result).toEqual({ notesDeleted: 1, entitiesRemoved: 4, relationshipsRemoved: 7 });
  });

  it('leaves no result for a kind that has nothing to report', async () => {
    const { enqueueDriveIntel, drainDriveIntelOutbox } = await mod();
    await enqueueDriveIntel('file-changed', 'file-7', { kind: 'file', refId: 'file-7' });
    await drainDriveIntelOutbox();
    const stored = updates.find((u) => 'result' in u);
    expect(stored?.result).toBeNull();
  });
});

describe("a member's file", () => {
  it('never reaches the owner\'s graph: no extraction is queued, and the skip is recorded', async () => {
    const { enqueueDriveIntel, drainDriveIntelOutbox } = await mod();
    // spaceForDriveFile answers null for a file whose principal is not the owner.
    spaceForDriveFile.mockResolvedValueOnce(null);
    await enqueueDriveIntel('file-changed', 'file-m', { kind: 'file', refId: 'file-m' });

    const result = await drainDriveIntelOutbox();

    expect(spaceForDriveFile).toHaveBeenCalledWith('file-m');
    expect(queueIntelExtraction).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(updates.find((u) => 'result' in u)?.result).toEqual({ skipped: 'member-file' });
  });
});
