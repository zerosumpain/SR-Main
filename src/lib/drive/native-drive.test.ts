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
    // Or Drive's refusals arrive as an HTML page instead of their sentence.
    expect(h.calls[0].headers.accept).toBe('application/json');
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

describe('uploads: the hash, the photo date and a duplicate', () => {
  it('passes sha256 and takenAt through, and reads a 200 duplicate as already stored', async () => {
    const sha = 'A'.repeat(64);
    h.answer = json(200, { file: file({ mine: true, uploadedBy: 'ann@example.test' }), duplicate: true });
    const out = await drive.uploadFile(ANN, { space: 'mine', folder: '', filename: null, mimeType: 'image/heic', bytes: Buffer.from('x'), sha256: sha, takenAt: '2026-10-31T14:05:09+01:00' });
    expect(h.calls[0].path).toBe(`/api/files/app/files?space=mine&type=image%2Fheic&sha256=${'a'.repeat(64)}&takenAt=2026-10-31T14%3A05%3A09%2B01%3A00`);
    expect(out.duplicate).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/@example/);
  });

  it('a 201 is a new file, never a duplicate', async () => {
    h.answer = json(201, { file: file(), duplicate: false });
    expect((await drive.uploadFile(OWNER, { space: 'mine', folder: '', filename: 'a', mimeType: 'x', bytes: Buffer.from('x') })).duplicate).toBe(false);
  });

  it('refuses a malformed hash before calling Drive, and drops a takenAt that is not a date', async () => {
    expect(await status(drive.uploadFile(ANN, { space: 'mine', folder: '', filename: 'a', mimeType: 'x', bytes: Buffer.from('x'), sha256: 'abc' }))).toBe(400);
    expect(h.calls).toEqual([]);
    h.answer = json(201, { file: file() });
    await drive.uploadFile(ANN, { space: 'mine', folder: '', filename: 'a', mimeType: 'x', bytes: Buffer.from('x'), takenAt: 'yesterday' });
    expect(h.calls[0].path).not.toContain('takenAt');
  });
});

describe('maxUploadBytes is held to Main’s own body limit', () => {
  it('reads BODY_SIZE_LIMIT as adapter-node does, defaulting to 12M', () => {
    expect(drive.bodyLimitBytes(undefined)).toBe(12 * 1024 * 1024);
    expect(drive.bodyLimitBytes('12M')).toBe(12 * 1024 * 1024);
    expect(drive.bodyLimitBytes('20971520')).toBe(20971520);
    expect(drive.bodyLimitBytes('512K')).toBe(512 * 1024);
    expect(drive.bodyLimitBytes('1G')).toBe(1024 ** 3);
    expect(drive.bodyLimitBytes('Infinity')).toBe(Number.POSITIVE_INFINITY);
    expect(drive.bodyLimitBytes('lots')).toBe(12 * 1024 * 1024);
  });

  it('clamps to the smallest of Drive, Main’s 30 MB and the body limit', () => {
    expect(drive.clampUploadBytes(30 * 1024 * 1024, 12 * 1024 * 1024)).toBe(12 * 1024 * 1024);
    expect(drive.clampUploadBytes(5, 12 * 1024 * 1024)).toBe(5);
    expect(drive.clampUploadBytes(2 ** 40, Number.POSITIVE_INFINITY)).toBe(drive.MAX_UPLOAD_BYTES);
  });

  it('the listing the phone receives carries the clamped figure', async () => {
    const before = process.env.BODY_SIZE_LIMIT;
    process.env.BODY_SIZE_LIMIT = '12M';
    try {
      h.answer = json(200, { space: 'mine', folder: '', folders: [], files: [], usage: { bytes: 0, quotaBytes: null }, maxUploadBytes: 30 * 1024 * 1024 });
      expect((await drive.listSpace(OWNER, 'mine', '')).maxUploadBytes).toBe(12 * 1024 * 1024);
    } finally {
      if (before === undefined) delete process.env.BODY_SIZE_LIMIT;
      else process.env.BODY_SIZE_LIMIT = before;
    }
  });
});

const analysis = {
  fileId: 'f1', contentHash: 'h', source: 'drive', model: 'm', summary: 'An invoice.', docType: 'invoice',
  keyFacts: [{ label: 'Supplier', value: 'Acme' }], dates: [], amounts: [{ label: 'Total', value: 120.5, currency: 'GBP' }],
  actionNeeded: null, createdAt: '2026-11-01T00:00:00.000Z',
};

describe('meta: the Info screen', () => {
  it('gives the owner the analysis, intel and the sender by name only', async () => {
    h.answer = json(200, {
      file: { ...file({ mine: true, uploadedBy: 'john@example.test' }), folder: 'Mail/important', description: null },
      analysis, intel: { status: 'done', outcome: 'extracted', entityCount: 3 },
      mail: { from: 'billing@acme.example', subject: 'Invoice', receivedAt: '2026-10-31T09:00:00.000Z' },
    });
    const meta = await drive.fileMeta(OWNER, 'f1', 'mine');
    expect(h.calls[0].path).toBe('/api/files/app/files/f1/meta?space=mine');
    expect(meta.file).toMatchObject({ id: 'f1', folder: 'Mail/important', addedBy: null });
    expect(meta.analysis).toEqual(analysis);
    expect(meta.intel).toEqual({ status: 'done', outcome: 'extracted', entityCount: 3 });
    expect(meta.mail).toEqual({ from: 'acme.example', subject: 'Invoice', receivedAt: '2026-10-31T09:00:00.000Z' });
    expect(JSON.stringify(meta)).not.toMatch(/@/);
  });

  it('never passes jkai fields to a member, whatever Drive sent', async () => {
    h.answer = json(200, { file: { ...file(), folder: '', description: null }, analysis, intel: { status: 'done', outcome: null, entityCount: 1 }, mail: { from: 'Bob', subject: 's', receivedAt: 'x' } });
    const meta = await drive.fileMeta(ANN, 'f1', 'shared');
    expect(meta).toMatchObject({ analysis: null, intel: null, mail: null });
    expect(h.calls[0].headers['x-sr-app-for']).toBe('ann@example.test');
  });

  it('shows a sender name, or the domain of an address', () => {
    expect(drive.senderForPhone('HMRC')).toBe('HMRC');
    expect(drive.senderForPhone('Name <a@b.example>')).toBe('b.example');
    expect(drive.senderForPhone('')).toBe('Unknown sender');
  });
});

describe('rename and move', () => {
  it('PATCHes JSON with only what changes, and maps the file for the phone', async () => {
    h.answer = json(200, { file: file({ name: 'b.txt' }) });
    const out = await drive.renameOrMove(ANN, 'f1', { space: 'shared', name: ' b.txt ', folder: null });
    expect(h.calls[0]).toMatchObject({ method: 'PATCH', path: '/api/files/app/files/f1' });
    expect(h.calls[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(h.calls[0].body!.toString())).toEqual({ space: 'shared', name: 'b.txt' });
    expect(JSON.stringify(out)).not.toMatch(/@example/);
  });

  it('moves to the root with folder "" and refuses a request that changes nothing', async () => {
    h.answer = json(200, { file: file() });
    await drive.renameOrMove(OWNER, 'f1', { space: 'mine', folder: '' });
    expect(JSON.parse(h.calls[0].body!.toString())).toEqual({ space: 'mine', folder: '' });
    expect(await status(drive.renameOrMove(OWNER, 'f1', { space: 'mine', name: '  ' }))).toBe(400);
  });

  it("passes Drive's 409 on in its words", async () => {
    h.answer = json(409, { message: 'That name is taken here.' });
    await expect(drive.renameOrMove(OWNER, 'f1', { space: 'mine', name: 'x' })).rejects.toMatchObject({ status: 409, body: { message: 'That name is taken here.' } });
  });
});

describe('search', () => {
  const results = { files: [file({ uploadedBy: 'bob@example.test' })], semantic: [{ file: file({ id: 'f9' }), score: 0.7, passage: 'p'.repeat(500) }] };

  it('gives the owner contents hits in his own space, passages clipped to 300', async () => {
    h.answer = json(200, results);
    const out = await drive.searchSpace(OWNER, 'mine', ' invoice ');
    expect(h.calls[0].path).toBe('/api/files/app/search?space=mine&q=invoice');
    expect(out.semantic?.[0]).toMatchObject({ score: 0.7 });
    expect(out.semantic?.[0].passage).toHaveLength(300);
  });

  it('never gives contents hits to a member or in the shared folder, and drops emails', async () => {
    h.roster = [{ email: 'bob@example.test', displayName: 'Bob Kelly' }];
    h.answer = json(200, results);
    const member = await drive.searchSpace(ANN, 'shared', 'rota');
    expect(member.semantic).toBeUndefined();
    expect(member.files[0].addedBy).toBe('Bob');
    expect(JSON.stringify(member)).not.toMatch(/@example/);
    h.answer = json(200, results);
    expect((await drive.searchSpace(OWNER, 'shared', 'rota')).semantic).toBeUndefined();
  });

  it('refuses an empty or overlong query before calling Drive', async () => {
    expect(await status(drive.searchSpace(OWNER, 'mine', '  '))).toBe(400);
    expect(await status(drive.searchSpace(OWNER, 'mine', 'x'.repeat(201)))).toBe(400);
    expect(h.calls).toEqual([]);
  });
});

describe('jkai on files is the owner’s alone', () => {
  it('refuses a member with 403 before Drive is asked', async () => {
    for (const p of [drive.analyseFile(ANN, 'f1', false), drive.intelFile(ANN, 'f1'), drive.intelStatus(ANN, 'f1', 1)]) {
      await expect(p).rejects.toMatchObject({ status: 403, body: { message: 'Only the owner can use jkai on files.' } });
    }
    expect(h.calls).toEqual([]);
  });

  it('analyses with refresh, and queues and polls extraction without the note id', async () => {
    h.answer = json(200, analysis);
    expect(await drive.analyseFile(OWNER, 'f1', true)).toEqual(analysis);
    expect(h.calls[0]).toMatchObject({ method: 'POST', path: '/api/files/app/files/f1/analyse' });
    expect(JSON.parse(h.calls[0].body!.toString())).toEqual({ refresh: true });

    h.answer = json(202, { jobId: 42, status: 'queued' });
    expect(await drive.intelFile(OWNER, 'f1')).toEqual({ jobId: 42, status: 'queued' });

    h.answer = json(200, { status: 'done', outcome: 'extracted', noteId: 'note-1', entityCount: 3, attempts: 1, error: null });
    const st = await drive.intelStatus(OWNER, 'f1', 42);
    expect(h.calls[2].path).toBe('/api/files/app/files/f1/intel?job=42');
    expect(st).toEqual({ status: 'done', outcome: 'extracted', entityCount: 3, attempts: 1, error: null });
  });

  it("passes Drive's 422 for a file with no text", async () => {
    h.answer = json(422, { message: 'There is no readable text in this file yet.', reason: 'no-text' });
    expect(await status(drive.analyseFile(OWNER, 'f1', false))).toBe(422);
  });
});

describe('the listing advertises the chunked lane only when Drive does', () => {
  const listing = (over: Record<string, unknown> = {}) =>
    json(200, { space: 'mine', folder: '', folders: [], files: [], usage: { bytes: 0, quotaBytes: null }, maxUploadBytes: 30 * 1024 * 1024, ...over });

  it('passes maxLargeUploadBytes and chunkBytes through', async () => {
    h.answer = listing({ maxLargeUploadBytes: 4 * 1024 ** 3, chunkBytes: 8388608 });
    const out = await drive.listSpace(OWNER, 'mine', '');
    expect(out).toMatchObject({ maxLargeUploadBytes: 4 * 1024 ** 3, chunkBytes: 8388608 });
  });

  it('omits both when an older Drive sends neither, or only one', async () => {
    h.answer = listing();
    const old = await drive.listSpace(OWNER, 'mine', '');
    expect('maxLargeUploadBytes' in old).toBe(false);
    expect('chunkBytes' in old).toBe(false);
    h.answer = listing({ maxLargeUploadBytes: 4 * 1024 ** 3 });
    const half = await drive.listSpace(OWNER, 'mine', '');
    expect('maxLargeUploadBytes' in half).toBe(false);
  });

  it('omits them when Main could not relay a piece that size', () => {
    expect(drive.chunkedLimits(10, 16 * 1024 * 1024, Number.POSITIVE_INFINITY)).toEqual({});
    expect(drive.chunkedLimits(10, 8388608, 4 * 1024 * 1024)).toEqual({});
    expect(drive.chunkedLimits(10, 8388608, 100 * 1024 * 1024)).toEqual({ maxLargeUploadBytes: 10, chunkBytes: 8388608 });
  });
});

describe('resumable uploads', () => {
  const ID = 'ab'.repeat(16);
  const SHA = 'c'.repeat(64);
  const session = { uploadId: ID, chunkBytes: 8388608, received: 0, size: 20_000_000, expiresAt: '2026-11-02T00:00:00.000Z' };
  const read = async (res: Response) => ({ status: res.status, body: await res.json() });
  const start = (caller: AppDriveCaller, over: Record<string, unknown> = {}) =>
    drive.startUpload(caller, { space: 'shared', folder: 'Videos', filename: 'IMG_1.MOV', type: 'video/quicktime', size: 20_000_000, sha256: SHA.toUpperCase(), ...over });

  it('relays each step to its path and method, naming a member and nobody for the owner', async () => {
    h.answer = json(201, session);
    await start(ANN, { takenAt: '2026-10-31T14:05:09Z' });
    await start(OWNER);
    h.answer = json(200, session);
    await drive.uploadStatus(ANN, ID, 'shared');
    h.answer = json(200, { received: 8388608 });
    await drive.putChunk(ANN, ID, { space: 'shared', offset: '0', bytes: Buffer.from([0, 1, 255]) });
    h.answer = json(200, { ok: true });
    await drive.cancelUpload(ANN, ID, 'shared');
    h.answer = json(201, { file: file(), duplicate: false });
    await drive.completeUpload(ANN, ID, 'shared');

    expect(h.calls.map((c) => [c.method, c.path])).toEqual([
      ['POST', '/api/files/app/uploads?space=shared'],
      ['POST', '/api/files/app/uploads?space=shared'],
      ['GET', `/api/files/app/uploads/${ID}?space=shared`],
      ['PUT', `/api/files/app/uploads/${ID}?space=shared&offset=0`],
      ['DELETE', `/api/files/app/uploads/${ID}?space=shared`],
      ['POST', `/api/files/app/uploads/${ID}/complete?space=shared`],
    ]);
    expect(h.calls[0].headers['x-sr-app-for']).toBe('ann@example.test');
    expect(h.calls[1].headers['x-sr-app-for']).toBeUndefined();
    for (const c of h.calls) expect(c.headers.accept).toBe('application/json');
    expect(JSON.parse(h.calls[0].body!.toString())).toEqual({
      folder: 'Videos', filename: 'IMG_1.MOV', type: 'video/quicktime', size: 20_000_000, sha256: SHA, takenAt: '2026-10-31T14:05:09Z',
    });
    expect(h.calls[0].headers['content-type']).toBe('application/json');
  });

  it('relays a chunk as the raw bytes, as octet-stream', async () => {
    h.answer = json(200, { received: 3 });
    const bytes = Buffer.from([0, 1, 255]);
    const res = await read(await drive.putChunk(OWNER, ID, { space: 'mine', offset: '0', bytes }));
    expect(res).toEqual({ status: 200, body: { received: 3 } });
    expect(h.calls[0].body!.equals(bytes)).toBe(true);
    expect(h.calls[0].headers['content-type']).toBe('application/octet-stream');
  });

  it('answers the session as Drive opened it, 201', async () => {
    h.answer = json(201, { ...session, extra: 'x' });
    expect(await read(await start(ANN))).toEqual({ status: 201, body: session });
  });

  it('refuses a bad id, offset, piece or hash before Drive is asked', async () => {
    expect(await status(drive.uploadStatus(ANN, '../x', 'mine'))).toBe(404);
    expect(await status(drive.completeUpload(ANN, 'a'.repeat(31), 'mine'))).toBe(404);
    expect(await status(drive.putChunk(ANN, ID, { space: 'mine', offset: '-1', bytes: Buffer.from('x') }))).toBe(400);
    expect(await status(drive.putChunk(ANN, ID, { space: 'mine', offset: null, bytes: Buffer.from('x') }))).toBe(400);
    expect(await status(drive.putChunk(ANN, ID, { space: 'mine', offset: '1.5', bytes: Buffer.from('x') }))).toBe(400);
    expect(await status(drive.putChunk(ANN, ID, { space: 'mine', offset: '0', bytes: Buffer.alloc(0) }))).toBe(400);
    expect(await status(drive.putChunk(ANN, ID, { space: 'mine', offset: '0', bytes: Buffer.alloc(drive.MAX_CHUNK_BYTES + 1) }))).toBe(413);
    expect(await status(start(ANN, { sha256: 'abc' }))).toBe(400);
    expect(await status(start(ANN, { sha256: undefined }))).toBe(400);
    expect(await status(start(ANN, { size: 0 }))).toBe(400);
    expect(await status(start(ANN, { size: '5' }))).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it.each([409, 413, 422, 429, 507])("passes Drive's %i on in its words, with received where Drive sent it", async (code) => {
    h.answer = json(code, { message: `Drive said ${code}.`, received: 16777216 });
    expect(await read(await drive.putChunk(ANN, ID, { space: 'mine', offset: '0', bytes: Buffer.from('x') }))).toEqual({
      status: code, body: { error: `Drive said ${code}.`, received: 16777216 },
    });
    h.answer = json(code, { message: `Drive said ${code}.` });
    expect(await read(await start(ANN))).toEqual({ status: code, body: { error: `Drive said ${code}.` } });
  });

  it('passes the 409 of an early complete with received', async () => {
    h.answer = json(409, { message: 'Not all of it has arrived yet.', error: 'incomplete', received: 8388608 });
    expect(await read(await drive.completeUpload(OWNER, ID, 'mine'))).toEqual({
      status: 409, body: { error: 'Not all of it has arrived yet.', received: 8388608 },
    });
  });

  it('never passes a 401 that would sign the phone out; an unreadable refusal is a plain sentence', async () => {
    h.answer = json(401, { error: 'Authentication required' });
    for (const p of [start(ANN), drive.uploadStatus(ANN, ID, 'mine'), drive.putChunk(ANN, ID, { space: 'mine', offset: '0', bytes: Buffer.from('x') }), drive.cancelUpload(ANN, ID, 'mine'), drive.completeUpload(ANN, ID, 'mine')]) {
      expect((await p).status).toBe(502);
    }
    h.answer = { status: 404, headers: {}, body: Buffer.from('<html>') };
    expect(await read(await drive.uploadStatus(ANN, ID, 'mine'))).toEqual({ status: 404, body: { error: 'Drive is not answering. Try again.' } });
  });

  it('maps the stored file through forPhone on complete: no emails, uploadedBy becomes addedBy', async () => {
    h.answer = json(201, { file: file({ uploadedBy: 'bob@example.test' }), duplicate: false });
    const made = await read(await drive.completeUpload(ANN, ID, 'shared'));
    expect(made.status).toBe(201);
    expect(made.body.duplicate).toBe(false);
    expect(made.body.file.addedBy).toBe('Family');
    expect('uploadedBy' in made.body.file).toBe(false);
    expect(JSON.stringify(made.body)).not.toMatch(/@/);

    h.answer = json(200, { file: file({ mine: true, uploadedBy: 'ann@example.test' }), duplicate: true });
    const again = await read(await drive.completeUpload(ANN, ID, 'mine'));
    expect(again).toMatchObject({ status: 200, body: { duplicate: true, file: { addedBy: null } } });
    expect(JSON.stringify(again.body)).not.toMatch(/@/);
  });

  it('a 200 duplicate on start is already stored, mapped the same way', async () => {
    h.answer = json(200, { file: file({ uploadedBy: 'bob@example.test' }), duplicate: true });
    const res = await read(await start(ANN));
    expect(res).toMatchObject({ status: 200, body: { duplicate: true, file: { id: 'f1', addedBy: 'Family' } } });
    expect(JSON.stringify(res.body)).not.toMatch(/@/);
  });

  it('only a 200 with duplicate:true is a duplicate; a 201 is new whatever it says', async () => {
    h.answer = json(201, { file: file(), duplicate: true });
    expect(await read(await drive.completeUpload(OWNER, ID, 'mine'))).toMatchObject({ status: 201, body: { duplicate: false } });
  });
});
