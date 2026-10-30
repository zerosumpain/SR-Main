import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AppDriveCaller } from '$lib/drive/app-lane';

// The phone's drive below the route: whatever the table holds, a caller gets
// their own space and the shared folder, and every other row is a 404 — the
// same answer as no file — for reads AND deletes.

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  inserted: [] as Array<Record<string, unknown>>,
  jobs: [] as Array<[string, string]>,
  reindexed: [] as string[],
  taken: new Set<string>(),
}));

function chain(result: () => unknown) {
  const p: Record<string, unknown> = {};
  for (const k of ['from', 'where', 'limit', 'select']) p[k] = () => p;
  p.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
  return p;
}

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/db', () => ({
  db: {
    // Every select answers with the whole table: the module under test must
    // do its own scoping, so a test that handed it pre-filtered rows would
    // prove nothing.
    select: () => chain(() => h.rows),
    delete: () => ({ where: async () => { h.deleted.push('row'); } }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        const run = async () => {
          if (h.taken.has(v.name as string)) throw new Error('duplicate key value violates unique constraint "workflow_files_name_idx"');
          h.inserted.push(v);
          return [{ id: `new-${h.inserted.length}`, createdAt: new Date(0), updatedAt: new Date(0), ...v }];
        };
        return { returning: run, then: (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => run().then(a, b) };
      },
    }),
  },
}));
vi.mock('$lib/file-store/storage', () => ({
  allocateDiskPath: async () => '/store/uuid/x',
  saveBuffer: async () => {},
  readBuffer: async () => Buffer.from('bytes'),
  deleteFile: async () => {},
}));
vi.mock('$lib/intel-client/outbox', () => ({
  enqueueIntelJob: async (kind: string, ref: string) => { h.jobs.push([kind, ref]); return 1; },
}));
vi.mock('$lib/file-index/store', () => ({ reindexFileInBackground: (id: string) => h.reindexed.push(id) }));

const drive = await import('./native-drive');

const OWNER: AppDriveCaller = { kind: 'owner', email: 'john@example.test' };
const ANN: AppDriveCaller = { kind: 'member', email: 'ann@example.test', principalId: 'u_ann0001' };
const BOB: AppDriveCaller = { kind: 'member', email: 'bob@example.test', principalId: 'u_bob0002' };

function file(id: string, name: string, principalId: string, uploadedBy: string | null = null) {
  return { id, name, principalId, uploadedBy, mimeType: 'image/jpeg', sizeBytes: 10, diskPath: `/store/${id}`, createdAt: new Date(0), updatedAt: new Date(0) };
}

beforeEach(() => {
  h.rows = [
    file('owner-1', 'Architecture/plan.md', 'owner', 'john@example.test'),
    file('ann-1', 'members/u_ann0001/diary.pdf', 'u_ann0001', 'ann@example.test'),
    file('bob-1', 'members/u_bob0002/photo.jpg', 'u_bob0002', 'bob@example.test'),
    file('shared-bob', 'members/household/rota.xlsx', 'household', 'bob@example.test'),
  ];
  h.deleted = [];
  h.inserted = [];
  h.jobs = [];
  h.reindexed = [];
  h.taken = new Set();
});

const status = async (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);

describe('reading by id', () => {
  it("is a 404 for the owner's files and another member's, from a member's phone", async () => {
    for (const id of ['owner-1', 'bob-1']) {
      h.rows = h.rows.filter((r) => r.id === id);
      expect(await status(drive.readDriveFile(ANN, id))).toBe(404);
      beforeEachReset();
    }
  });

  it("is a 404 for a member's private file, from the owner's phone", async () => {
    h.rows = h.rows.filter((r) => r.id === 'ann-1');
    expect(await status(drive.readDriveFile(OWNER, 'ann-1'))).toBe(404);
  });

  it('serves your own and the shared folder', async () => {
    h.rows = h.rows.filter((r) => r.id === 'ann-1');
    expect(await status(drive.readDriveFile(ANN, 'ann-1'))).toBe(200);
    beforeEachReset();
    h.rows = h.rows.filter((r) => r.id === 'shared-bob');
    expect(await status(drive.readDriveFile(ANN, 'shared-bob'))).toBe(200);
    expect(await status(drive.readDriveFile(OWNER, 'shared-bob'))).toBe(200);
  });
});

describe('listing', () => {
  it("shows a member only their own files, never anyone else's, whatever the table returns", async () => {
    const mine = await drive.listSpace(ANN, 'mine', '');
    expect(mine.files.map((f) => f.id)).toEqual(['ann-1']);
    expect(mine.usage.quotaBytes).toBe(2 * 1024 ** 3);
    const shared = await drive.listSpace(ANN, 'shared', '');
    expect(shared.files.map((f) => f.id)).toEqual(['shared-bob']);
    expect(shared.files[0]).toMatchObject({ mine: false, canDelete: false, addedBy: 'Family', path: 'rota.xlsx' });
  });

  it("shows the owner his own drive, not the members' folders", async () => {
    const mine = await drive.listSpace(OWNER, 'mine', '');
    expect(mine.folders.map((f) => f.name)).toEqual(['Architecture']);
    expect(mine.files).toEqual([]);
    expect(mine.usage.quotaBytes).toBeNull();
  });

  it('never sends a disk path or an email', async () => {
    const shared = await drive.listSpace(BOB, 'shared', '');
    expect(JSON.stringify(shared)).not.toMatch(/store\/|@example/);
  });
});

describe('deleting', () => {
  it('refuses a member deleting what someone else put in the shared folder', async () => {
    h.rows = h.rows.filter((r) => r.id === 'shared-bob');
    expect(await status(drive.deleteOne(ANN, 'shared-bob'))).toBe(403);
    expect(h.deleted).toEqual([]);
    expect(await status(drive.deleteOne(BOB, 'shared-bob'))).toBe(200);
    expect(h.jobs).toEqual([]);
  });

  it("is a 404 for another member's file, and deletes nothing", async () => {
    h.rows = h.rows.filter((r) => r.id === 'bob-1');
    expect(await status(drive.deleteOne(ANN, 'bob-1'))).toBe(404);
    expect(await status(drive.deleteOne(OWNER, 'bob-1'))).toBe(404);
    expect(h.deleted).toEqual([]);
  });

  it("queues the intel cleanup for an owner file, as Drive's delete does", async () => {
    h.rows = h.rows.filter((r) => r.id === 'owner-1');
    expect(await status(drive.deleteOne(OWNER, 'owner-1'))).toBe(200);
    expect(h.jobs).toEqual([['file-deleted', 'owner-1']]);
  });

  it('keeps a shared folder somebody else has files in', async () => {
    h.rows = [file('s1', 'members/household/Trip/a.jpg', 'household', 'bob@example.test')];
    expect(await status(drive.deleteFolder(ANN, 'shared', 'Trip'))).toBe(409);
    expect(h.deleted).toEqual([]);
  });
});

describe('uploading', () => {
  it("stores a member's file under their own principal and never indexes it", async () => {
    const out = await drive.uploadFile(ANN, { space: 'mine', folder: 'Holiday', filename: 'a.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('x') });
    expect(h.inserted[0]).toMatchObject({ name: 'members/u_ann0001/Holiday/a.jpg', principalId: 'u_ann0001', uploadedBy: 'ann@example.test' });
    expect(out.path).toBe('Holiday/a.jpg');
    expect(h.reindexed).toEqual([]);
  });

  it('puts a shared upload in the household folder', async () => {
    await drive.uploadFile(BOB, { space: 'shared', folder: '', filename: 'b.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('x') });
    expect(h.inserted[0]).toMatchObject({ name: 'members/household/b.jpg', principalId: 'household' });
  });

  it('numbers a taken name instead of failing', async () => {
    h.taken.add('members/u_ann0001/a.jpg');
    const out = await drive.uploadFile(ANN, { space: 'mine', folder: '', filename: 'a.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('x') });
    expect(out.name).toBe('a (2).jpg');
  });

  it("indexes the owner's own uploads, as Drive does", async () => {
    await drive.uploadFile(OWNER, { space: 'mine', folder: 'Phone', filename: 'a.jpg', mimeType: 'image/jpeg', bytes: Buffer.from('x') });
    expect(h.inserted[0]).toMatchObject({ name: 'Phone/a.jpg', principalId: 'owner' });
    expect(h.reindexed).toHaveLength(1);
  });

  it('refuses a traversal in the folder or the name', async () => {
    expect(await status(drive.uploadFile(ANN, { space: 'mine', folder: '../u_bob0002', filename: 'a.jpg', mimeType: 'x', bytes: Buffer.from('x') }))).toBe(400);
    expect(await status(drive.uploadFile(ANN, { space: 'mine', folder: '', filename: '../a.jpg', mimeType: 'x', bytes: Buffer.from('x') }))).toBe(400);
    expect(await status(drive.uploadFile(OWNER, { space: 'mine', folder: 'members/u_ann0001', filename: 'a.jpg', mimeType: 'x', bytes: Buffer.from('x') }))).toBe(400);
    expect(h.inserted).toEqual([]);
  });

  it('refuses a member past the quota', async () => {
    h.rows = [{ n: String(2 * 1024 ** 3) }];
    expect(await status(drive.uploadFile(ANN, { space: 'mine', folder: '', filename: 'a.jpg', mimeType: 'x', bytes: Buffer.from('x') }))).toBe(413);
  });
});

function beforeEachReset() {
  h.rows = [
    file('owner-1', 'Architecture/plan.md', 'owner', 'john@example.test'),
    file('ann-1', 'members/u_ann0001/diary.pdf', 'u_ann0001', 'ann@example.test'),
    file('bob-1', 'members/u_bob0002/photo.jpg', 'u_bob0002', 'bob@example.test'),
    file('shared-bob', 'members/household/rota.xlsx', 'household', 'bob@example.test'),
  ];
}
