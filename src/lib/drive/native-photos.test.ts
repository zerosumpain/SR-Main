import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone's photo search is a relay of Drive's owner-only photo lane plus
// the image hits of Drive's own file index. What Main must get right: the
// query it builds (the jkai tool's builder), that it names nobody to Drive,
// that every image path it hands back is a native one built from a UUID,
// that only images matching the search come back, each once, and that a
// photo library that is not linked is a friendly answer, not a failure.

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';

type Answer = { status: number; headers: Record<string, string>; body: Buffer };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; path: string; headers: Record<string, string> }>,
  answers: {} as Record<string, Answer | Error>,
}));

vi.mock('$lib/server/extracted-app', () => ({
  requestExtracted: async (_app: string, method: string, path: string, o: { headers: Record<string, string> }) => {
    h.calls.push({ method, path, headers: o.headers });
    const key = Object.keys(h.answers).find((k) => path.startsWith(k));
    const a = key ? h.answers[key] : { status: 404, headers: {}, body: Buffer.from('{}') };
    if (a instanceof Error) throw a;
    return a;
  },
}));
vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
}));

const photos = await import('./native-photos');

const json = (status: number, body: unknown): Answer => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });
const status = async (p: Promise<unknown>) => p.then(() => 200, (e: { status?: number }) => e.status ?? 500);
const params = (q: string) => new URLSearchParams(q);

const asset = (over: Record<string, unknown> = {}) => ({
  id: A1,
  type: 'photo',
  takenAt: '2026-07-01T10:00:00+01:00',
  timeZone: 'Europe/London',
  durationSec: null,
  width: 4032,
  height: 3024,
  location: { lat: 38.7, lon: -9.1, city: 'Lisbon', state: 'Lisboa', country: 'Portugal' },
  camera: null,
  people: [{ id: P1, name: 'Sam' }, { id: 'x', name: null }],
  driveFile: { id: 'f-a1', name: 'IMG_1.jpg', url: '/drive?file=f-a1' },
  thumbnailPath: `/api/photos/thumb/${A1}`,
  ...over,
});

const driveFile = (over: Record<string, unknown> = {}) => ({
  id: 'f-d1', name: 'whiteboard.png', path: 'Notes/whiteboard.png', mimeType: 'image/png', sizeBytes: 10,
  createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z',
  mine: true, uploadedBy: 'john@example.test', canDelete: true, ...over,
});

beforeEach(() => {
  h.calls = [];
  h.answers = {};
});

describe('the query', () => {
  it("builds Drive's query with the jkai tool's builder, from the phone's names", async () => {
    h.answers['/api/photos/search'] = json(200, { connected: true, total: 0, page: 1, assets: [] });
    await photos.searchPhotos(params('person=Sam&person=Alex,Jo&ocr=total&place=Lisbon&from=2026-06-01&to=2026-08-31&type=photo&limit=30&page=2'));
    expect(h.calls[0].path).toBe(
      '/api/photos/search?person=Sam&person=Alex&person=Jo&ocr=total&place=Lisbon&from=2026-06-01&to=2026-08-31&type=photo&limit=30&page=2',
    );
    // The photo lane answers the owner only; Main never names anyone.
    expect(h.calls[0].headers['x-sr-app-for']).toBeUndefined();
    expect(h.calls[0].headers.accept).toBe('application/json');
  });

  it('refuses a bad date before Drive is asked', async () => {
    expect(await status(photos.searchPhotos(params('from=yesterday')))).toBe(400);
    expect(await status(photos.searchPhotos(params('from=2026-09-01&to=2026-08-01')))).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it("passes Drive's own refusal on as a 400", async () => {
    h.answers['/api/photos/search'] = json(400, { message: 'Ask for page 1–20; narrow the search to see further.' });
    await expect(photos.searchPhotos(params('page=40'))).rejects.toMatchObject({ status: 400, body: { message: expect.stringMatching(/page 1–20/) } });
  });

  it('asks the file index only what it can answer faithfully', () => {
    const q = (s: string) => photos.driveIndexQuery(photos.searchArgs(params(s)));
    expect(q('text=dog on a beach')).toBe('dog on a beach');
    expect(q('ocr=invoice')).toBe('invoice');
    expect(q('text=receipt&ocr=total&type=photo')).toBe('receipt total');
    // It knows no people, places, dates or videos, and its hits are not paged.
    expect(q('text=dog&person=Sam')).toBeNull();
    expect(q('text=dog&place=Lisbon')).toBeNull();
    expect(q('text=dog&from=2026-01-01')).toBeNull();
    expect(q('text=dog&type=video')).toBeNull();
    expect(q('text=dog&page=2')).toBeNull();
    expect(q('person=Sam')).toBeNull();
  });
});

describe('the answer', () => {
  it('gives each photo native image paths built from its UUID, and its Drive file', async () => {
    h.answers['/api/photos/search'] = json(200, {
      connected: true, total: 2, page: 1,
      assets: [
        asset({ thumbnailPath: 'https://evil.example/x.jpg' }),
        asset({ id: A2.toUpperCase(), type: 'video', durationSec: 12.6, driveFile: null, people: [] }),
        asset({ id: '../../etc' }),
      ],
    });
    const out = await photos.searchPhotos(params('person=Sam'));
    expect(out.connected).toBe(true);
    expect(out.total).toBe(2);
    expect(out.results).toHaveLength(2);
    const [a, b] = out.results;
    expect(a).toMatchObject({
      key: `photos:${A1}`, source: 'photos', assetId: A1, type: 'photo', place: 'Lisbon, Portugal',
      thumbPath: `api/native/drive/photos/thumb/${A1}`,
      previewPath: `api/native/drive/photos/thumb/${A1}?size=preview`,
      driveFile: { id: 'f-a1', name: 'IMG_1.jpg' },
      file: null,
      people: [{ id: P1, name: 'Sam' }, { id: 'x', name: null }],
    });
    expect(b).toMatchObject({ assetId: A2, type: 'video', durationSec: 13, driveFile: null, thumbPath: `api/native/drive/photos/thumb/${A2}` });
    expect(JSON.stringify(out)).not.toContain('evil.example');
    expect(JSON.stringify(out)).not.toContain('/api/photos/');
  });

  it('says whether another page can bring more', async () => {
    h.answers['/api/photos/search'] = json(200, { connected: true, total: 9, page: 1, assets: [asset(), asset({ id: A2 })] });
    expect((await photos.searchPhotos(params('limit=2&person=Sam'))).hasMore).toBe(true);
    expect((await photos.searchPhotos(params('limit=3&person=Sam'))).hasMore).toBe(false);
    // Drive walks no deeper than page 20.
    h.answers['/api/photos/search'] = json(200, { connected: true, total: 99, page: 20, assets: [asset(), asset({ id: A2 })] });
    expect((await photos.searchPhotos(params('limit=2&page=20&person=Sam'))).hasMore).toBe(false);
  });

  it("adds the index's image hits Immich does not have, once each, best first", async () => {
    h.answers['/api/photos/search'] = json(200, { connected: true, total: null, page: 1, assets: [asset()] });
    h.answers['/api/files/app/search'] = json(200, {
      files: [],
      semantic: [
        // Already one of Immich's (the same Drive file): dropped.
        { file: driveFile({ id: 'f-a1', name: 'IMG_1.jpg', mimeType: 'image/jpeg' }), score: 0.9, passage: 'a dog' },
        { file: driveFile({ id: 'f-d2', name: 'dog.heic', mimeType: 'image/heic' }), score: 0.5, passage: 'dog asleep' },
        { file: driveFile(), score: 0.7, passage: 'a dog drawn on a whiteboard' },
        // Not an image: a photo search returns only pictures.
        { file: driveFile({ id: 'f-pdf', name: 'vet.pdf', mimeType: 'application/pdf' }), score: 0.95, passage: 'dog vaccinations' },
        // A guess, not a match.
        { file: driveFile({ id: 'f-weak', name: 'cat.jpg', mimeType: 'image/jpeg' }), score: 0.21, passage: 'a cat' },
      ],
    });
    const out = await photos.searchPhotos(params('text=dog'));
    expect(h.calls.find((c) => c.path.startsWith('/api/files/app/search'))?.path).toBe('/api/files/app/search?space=mine&q=dog');
    expect(out.results.map((r) => r.key)).toEqual([`photos:${A1}`, 'drive:f-d1', 'drive:f-d2']);
    const d = out.results[1];
    expect(d).toMatchObject({
      source: 'drive', assetId: null, type: 'photo',
      thumbPath: 'api/native/drive/files/f-d1', driveFile: { id: 'f-d1', name: 'whiteboard.png' },
      passage: 'a dog drawn on a whiteboard', score: 0.7,
    });
    // The whole file as the phone's DriveFile decodes it, with no email.
    expect(d.file).toMatchObject({ id: 'f-d1', path: 'Notes/whiteboard.png', mimeType: 'image/png', sizeBytes: 10, canDelete: true, addedBy: null });
    expect(JSON.stringify(out)).not.toContain('@example');
  });

  it("keeps Immich's results when the file index fails", async () => {
    h.answers['/api/photos/search'] = json(200, { connected: true, total: null, page: 1, assets: [asset()] });
    h.answers['/api/files/app/search'] = json(500, { message: 'index down' });
    const out = await photos.searchPhotos(params('text=dog'));
    expect(out.results.map((r) => r.source)).toEqual(['photos']);
  });

  it("answers not connected with the reason, and still the index's images", async () => {
    h.answers['/api/photos/search'] = json(200, { connected: false, reason: 'Immich is not linked', total: null, page: 1, assets: [] });
    h.answers['/api/files/app/search'] = json(200, { files: [], semantic: [{ file: driveFile(), score: 0.8, passage: 'x' }] });
    const out = await photos.searchPhotos(params('text=whiteboard'));
    expect(out).toMatchObject({ connected: false, reason: 'Immich is not linked', hasMore: false });
    expect(out.results.map((r) => r.key)).toEqual(['drive:f-d1']);
  });

  it('answers not connected when Drive cannot be reached', async () => {
    h.answers['/api/photos/search'] = new Error('ECONNREFUSED');
    const out = await photos.searchPhotos(params('person=Sam'));
    expect(out).toMatchObject({ connected: false, results: [] });
    expect(out.reason).toMatch(/not answering/);
  });
});

describe('the people picker', () => {
  it('lists the faces with native face paths, never the hidden ones', async () => {
    h.answers['/api/photos/people'] = json(200, {
      connected: true,
      people: [
        { id: P1, name: ' Sam ', isHidden: false, assetCount: 40, thumbnailPath: `/api/photos/face/${P1}` },
        { id: A1, name: null, isHidden: false, assetCount: 3 },
        { id: A2, name: 'Old flame', isHidden: true, assetCount: 9 },
        { id: 'nope', name: 'Bad id' },
      ],
    });
    const out = await photos.photoPeople(params(''));
    expect(h.calls[0].path).toBe('/api/photos/people?filter=all&limit=200');
    expect(out).toEqual({
      connected: true,
      people: [
        { id: P1, name: 'Sam', photos: 40, facePath: `api/native/drive/photos/face/${P1}` },
        { id: A1, name: null, photos: 3, facePath: `api/native/drive/photos/face/${A1}` },
      ],
    });
  });

  it('answers not connected rather than failing', async () => {
    h.answers['/api/photos/people'] = json(200, { connected: false, people: [] });
    expect(await photos.photoPeople(params(''))).toMatchObject({ connected: false, people: [] });
  });
});

describe('the images', () => {
  const image = (status: number, type: string, cache?: string): Answer => ({
    status,
    headers: { 'content-type': type, ...(cache ? { 'cache-control': cache } : {}) },
    body: Buffer.from([0xff, 0xd8, 0xff]),
  });

  it('streams a thumbnail or preview with its cache lifetime', async () => {
    h.answers['/api/photos/thumb/'] = image(200, 'image/jpeg', 'private, max-age=86400');
    const res = await photos.photoImage('thumb', A1.toUpperCase(), 'preview');
    expect(h.calls[0].path).toBe(`/api/photos/thumb/${A1}?size=preview`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    await photos.photoImage('thumb', A1, 'thumb');
    expect(h.calls[1].path).toBe(`/api/photos/thumb/${A1}`);
  });

  it('never makes a cached answer public', async () => {
    h.answers['/api/photos/face/'] = image(200, 'image/webp', 'public, max-age=31536000');
    const res = await photos.photoImage('face', P1, null);
    expect(h.calls[0].path).toBe(`/api/photos/face/${P1}`);
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
  });

  it('refuses anything that is not a UUID before Drive is asked', async () => {
    expect(await status(photos.photoImage('thumb', '../files/app/files/x', null))).toBe(404);
    expect(await status(photos.photoImage('face', '', null))).toBe(404);
    expect(h.calls).toEqual([]);
  });

  it("maps Drive's trouble without ever signing the phone out", async () => {
    h.answers['/api/photos/thumb/'] = image(404, 'application/json');
    expect(await status(photos.photoImage('thumb', A1, null))).toBe(404);
    h.answers['/api/photos/thumb/'] = image(503, 'application/json');
    expect(await status(photos.photoImage('thumb', A1, null))).toBe(503);
    h.answers['/api/photos/thumb/'] = image(401, 'application/json');
    expect(await status(photos.photoImage('thumb', A1, null))).toBe(502);
    // Only an image passes: HTML or SVG from upstream is not relayed.
    h.answers['/api/photos/thumb/'] = image(200, 'text/html');
    expect(await status(photos.photoImage('thumb', A1, null))).toBe(502);
    h.answers['/api/photos/thumb/'] = image(200, 'image/svg+xml');
    expect(await status(photos.photoImage('thumb', A1, null))).toBe(502);
    h.answers['/api/photos/thumb/'] = new Error('ECONNREFUSED');
    expect(await status(photos.photoImage('thumb', A1, null))).toBe(502);
  });
});

describe('who may ask', () => {
  it('lets the owner through and refuses anyone else with a 403', () => {
    expect(() => photos.requirePhotoOwner('owner')).not.toThrow();
    expect(() => photos.requirePhotoOwner('member')).toThrow(expect.objectContaining({ status: 403 }));
  });
});
