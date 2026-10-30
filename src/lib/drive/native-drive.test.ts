import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDriveCaller } from './native-drive';

// Main's half of the SR app's Drive is a relay: SR-Drive decides which rows a
// person reaches (its own tests). What Main must get right is WHO it names to
// Drive, and what of Drive's answer reaches a phone.

const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; path: string; headers: Record<string, string>; body?: Buffer }>,
  answer: { status: 200, headers: {} as Record<string, string>, body: Buffer.from('{}') },
  roster: [] as Array<{ email: string; displayName: string }>,
}));

vi.mock('$lib/server/extracted-app', () => ({
  requestExtracted: async (_app: string, method: string, path: string, o: { headers: Record<string, string>; body?: Buffer }) => {
    h.calls.push({ method, path, headers: o.headers, body: o.body });
    return h.answer;
  },
}));
vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(h.roster) }) }) },
}));

const drive = await import('./native-drive');

const OWNER: AppDriveCaller = { kind: 'owner', email: 'john@example.test' };
const ANN: AppDriveCaller = { kind: 'member', email: 'ann@example.test', principalId: 'u_ann0001' };

const json = (status: number, body: unknown) => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });
const status = async (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);

const file = (over: Record<string, unknown> = {}) => ({
  id: 'f1', name: 'rota.xlsx', path: 'rota.xlsx', mimeType: 'x', sizeBytes: 1,
  createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z',
  mine: false, uploadedBy: 'bob@example.test', canDelete: false, ...over,
});

beforeEach(() => {
  h.calls = [];
  h.roster = [];
  h.answer = json(200, {});
});

describe('who Main names to Drive', () => {
  it("names a member's email, and nobody for the owner's own phone", async () => {
    h.answer = json(200, { space: 'mine', folder: '', folders: [], files: [], usage: { bytes: 0, quotaBytes: 1 }, maxUploadBytes: 1 });
    await drive.listSpace(ANN, 'mine', '');
    await drive.listSpace(OWNER, 'mine', '');
    expect(h.calls[0].headers['x-sr-app-for']).toBe('ann@example.test');
    expect(h.calls[1].headers['x-sr-app-for']).toBeUndefined();
    expect(h.calls[0].path).toBe('/api/files/app?space=mine');
  });

  it('escapes the folder and names into the query', async () => {
    h.answer = json(201, { file: file({ mine: true, uploadedBy: 'ann@example.test' }) });
    await drive.uploadFile(ANN, { space: 'shared', folder: 'Run & ride', filename: 'a b.txt', mimeType: 'text/plain', bytes: Buffer.from('x') });
    expect(h.calls[0].path).toBe('/api/files/app/files?space=shared&folder=Run+%26+ride&filename=a+b.txt&type=text%2Fplain');
    // Never text/plain on the wire: SvelteKit would refuse it as a cross-site form.
    expect(h.calls[0].headers['content-type']).toBe('application/octet-stream');
  });

  it('escapes an id so it cannot become another path', async () => {
    await drive.deleteOne(ANN, '../storage/x');
    expect(h.calls[0].path).toBe('/api/files/app/files/..%2Fstorage%2Fx');
  });
});

describe('what reaches the phone', () => {
  it('turns shared uploaders into first names and never sends an email', async () => {
    h.roster = [{ email: 'bob@example.test', displayName: 'Bob Kelly' }];
    h.answer = json(200, {
      space: 'shared', folder: '', folders: [],
      files: [file(), file({ id: 'f2', uploadedBy: 'zed@example.test' }), file({ id: 'f3', mine: true, uploadedBy: 'ann@example.test' })],
      usage: { bytes: 3, quotaBytes: 9 }, maxUploadBytes: 9,
    });
    const listing = await drive.listSpace(ANN, 'shared', '');
    expect(listing.files.map((f) => f.addedBy)).toEqual(['Bob', 'Family', 'You']);
    expect(JSON.stringify(listing)).not.toMatch(/@example/);
  });

  it("passes Drive's refusals on in its words, but never a 401 that would sign the phone out", async () => {
    h.answer = json(404, { message: 'No such file.' });
    expect(await status(drive.deleteOne(ANN, 'x'))).toBe(404);
    h.answer = json(403, { message: 'Only whoever added it can delete this.' });
    await expect(drive.deleteOne(ANN, 'x')).rejects.toMatchObject({ status: 403, body: { message: 'Only whoever added it can delete this.' } });
    h.answer = json(401, { error: 'Authentication required' });
    expect(await status(drive.listSpace(ANN, 'mine', ''))).toBe(502);
  });

  it('downloads as an attachment under a sandbox CSP, whatever Drive said', async () => {
    h.answer = { status: 200, headers: { 'content-type': 'text/html', 'content-disposition': 'inline' }, body: Buffer.from('<b>') };
    const res = await drive.download(ANN, 'f1');
    expect(res.headers.get('content-disposition')).toBe('attachment');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('refuses an oversize upload before calling Drive', async () => {
    expect(await status(drive.uploadFile(ANN, { space: 'mine', folder: '', filename: 'a', mimeType: 'x', bytes: Buffer.alloc(drive.MAX_UPLOAD_BYTES + 1) }))).toBe(413);
    expect(h.calls).toEqual([]);
  });
});
