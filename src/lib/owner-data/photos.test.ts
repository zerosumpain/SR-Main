import { beforeEach, describe, expect, it, vi } from 'vitest';

// The photo tools relay SR-Drive's owner-only photo lane. The relay is mocked:
// these check what Main asks Drive for, what it never sends (a member's name),
// the compact shape the model reads, and that nothing reaches chat as a throw.
// Fixtures are synthetic.

const h = vi.hoisted(() => ({
  calls: [] as Array<{ app: string; method: string; path: string; headers: Record<string, string> }>,
  reply: (_path: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> => Promise.reject(new Error('unset')),
}));

vi.mock('$lib/server/extracted-app', () => ({
  requestExtracted: (app: string, method: string, path: string, opts: { headers?: Record<string, string> } = {}) => {
    h.calls.push({ app, method, path, headers: opts.headers ?? {} });
    return h.reply(path);
  },
}));

const json = (status: number, body: unknown) => async () => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });

const ID = '0b9a2f6e-1c3d-4e5f-8a7b-9c0d1e2f3a4b';
const ASSET = {
  id: ID,
  type: 'photo',
  takenAt: '2026-07-14T18:32:05+01:00',
  timeZone: 'Europe/Lisbon',
  durationSec: null,
  width: 4032,
  height: 3024,
  location: { lat: 38.7223456789, lon: -9.1393366, city: 'Lisbon', state: 'Lisbon', country: 'Portugal' },
  camera: { make: 'Apple', model: 'Apple iPhone 15 Pro', lens: 'Main camera' },
  people: [{ id: 'p-sam', name: 'Sam' }, { id: 'abcdef1234567890', name: null }],
  driveFile: { id: 'f1', name: 'Incoming photos/IMG_1.HEIC', url: '/drive?file=f1' },
  thumbnailPath: `/api/photos/thumb/${ID}`,
};

const { peoplePath, searchPath, detailPath, compactAsset, placeName, summarise } = await import('./photos');
const { photoPeopleTool, photoSearchTool, photoDetailTool, photoStatsTool } = await import('./photos.server');
const { tools } = await import('$lib/tools/registry-internal');
await import('./chat-tools');

beforeEach(() => {
  h.calls = [];
  h.reply = json(200, { connected: true, people: [], assets: [] });
});

describe('what Main asks Drive for', () => {
  it('builds the people query with a filter, a name and a clamped limit', () => {
    expect(peoplePath({ filter: 'unnamed', name: ' sam ', limit: 999 })).toBe('/api/photos/people?filter=unnamed&q=sam&limit=200');
    expect(peoplePath({ filter: 'nonsense' })).toBe('/api/photos/people?filter=all&limit=50');
  });

  it('repeats person, keeps dates as given and refuses a date that is not one', () => {
    const path = searchPath({ people: ['Sam', 'Alex', 'Sam'], place: 'Lisbon', from: '2026-06-01', to: '2026-08-31', type: 'photo', limit: 10, page: 2 });
    expect(path).toBe('/api/photos/search?person=Sam&person=Alex&place=Lisbon&from=2026-06-01&to=2026-08-31&type=photo&limit=10&page=2');
    expect(searchPath({ people: 'Sam, Alex', text: 'receipt', text_in_image: 'TOTAL' })).toBe('/api/photos/search?person=Sam&person=Alex&text=receipt&ocr=TOTAL&limit=25');
    expect(() => searchPath({ from: 'last summer' })).toThrow(/YYYY-MM-DD/);
    expect(() => searchPath({ from: '2026-09-01', to: '2026-08-01' })).toThrow(/after/);
  });

  it('takes only a UUID as a photo id, so nothing else reaches the path', () => {
    expect(detailPath({ id: ID.toUpperCase() })).toBe(`/api/photos/assets/${ID}`);
    expect(() => detailPath({ id: '../files/app/x' })).toThrow(/UUID/);
  });
});

describe('the shape the model reads', () => {
  it('gives the place as "City, Country" with lat/lon, people by name and the Drive link', () => {
    expect(compactAsset(ASSET)).toEqual({
      id: ID,
      type: 'photo',
      takenAt: '2026-07-14T18:32:05+01:00',
      timeZone: 'Europe/Lisbon',
      place: 'Lisbon, Portugal',
      lat: 38.72235,
      lon: -9.13934,
      people: ['Sam', 'unnamed:abcdef1234567890'],
      camera: 'Apple iPhone 15 Pro',
      file: 'Incoming photos/IMG_1.HEIC',
      link: '/drive?file=f1',
    });
    expect(placeName({ state: 'Cornwall', country: 'United Kingdom' })).toBe('Cornwall, United Kingdom');
    expect(placeName(null)).toBeNull();
    expect(compactAsset({ id: 'x', type: 'video', takenAt: null, durationSec: 12.6, location: null, people: [], driveFile: null })).toEqual({ id: 'x', type: 'video', takenAt: null, durationSec: 13 });
  });

  it('sums a page into where and who, most frequent first, and its span', () => {
    const a = compactAsset(ASSET);
    const b = { ...a, takenAt: '2026-07-12T09:00:00+01:00', place: 'Sintra, Portugal', people: ['Sam'] };
    expect(summarise([a, b, a])).toEqual({
      span: { from: '2026-07-12T09:00:00+01:00', to: '2026-07-14T18:32:05+01:00' },
      places: [{ name: 'Lisbon, Portugal', count: 2 }, { name: 'Sintra, Portugal', count: 1 }],
      people: [{ name: 'Sam', count: 3 }, { name: 'unnamed:abcdef1234567890', count: 2 }],
    });
  });
});

describe('the relay', () => {
  it("calls Drive's photo lane as the owner: GET, JSON, never naming a member", async () => {
    h.reply = json(200, { connected: true, total: 1, page: 1, assets: [ASSET] });
    const r = await photoSearchTool({ people: ['Sam'], place: 'Lisbon' });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ app: 'drive', method: 'GET', path: '/api/photos/search?person=Sam&place=Lisbon&limit=25' });
    expect(h.calls[0]!.headers).toEqual({ accept: 'application/json' });
    expect(r).toMatchObject({ success: true, data: { connected: true, total: 1, returned: 1, places: [{ name: 'Lisbon, Portugal', count: 1 }], assets: [{ id: ID, place: 'Lisbon, Portugal' }] } });
  });

  it('lists people compactly, unnamed counted', async () => {
    h.reply = json(200, { connected: true, people: [
      { id: 'p-sam', name: 'Sam', isHidden: false, assetCount: 120, firstSeen: '2019-05-01T10:00:00+01:00', lastSeen: '2026-10-30T12:00:00Z', thumbnailPath: '/api/photos/face/p-sam' },
      { id: 'p-2', name: null, isHidden: false, assetCount: 40, firstSeen: null, lastSeen: null },
    ] });
    const r = await photoPeopleTool({ filter: 'all' });
    expect(r).toEqual({ success: true, data: { connected: true, count: 2, unnamed: 1, url: '/drive?tab=people', people: [
      { id: 'p-sam', name: 'Sam', photos: 120, firstSeen: '2019-05-01T10:00:00+01:00', lastSeen: '2026-10-30T12:00:00Z' },
      { id: 'p-2', name: null, photos: 40 },
    ] } });
  });

  it('reads one photo with the words in it and its faces', async () => {
    h.reply = json(200, { connected: true, asset: { ...ASSET, ocrText: 'TOTAL £12.40', faces: [{ personId: 'p-sam', name: 'Sam', box: { x1: 1, y1: 1, x2: 2, y2: 2, imageWidth: 4, imageHeight: 4 } }] } });
    const r = await photoDetailTool({ id: ID });
    expect(r).toMatchObject({ success: true, data: { asset: { id: ID, region: 'Lisbon', lens: 'Main camera', size: '4032x3024', textInImage: 'TOTAL £12.40', faces: [{ personId: 'p-sam', name: 'Sam' }], thumbnail: `/api/photos/thumb/${ID}` } } });
  });

  it('keeps only the jobs with work left, and says the counts are incomplete while Immich works', async () => {
    h.reply = json(200, { connected: true, totals: { photos: 1990, videos: 20 }, people: { named: 2, unnamed: 30 }, dateRange: { from: '2012-01-01T00:00:00Z', to: '2026-10-31T00:00:00Z' },
      topPlaces: [{ place: 'London, United Kingdom', count: 900 }, { place: 'Lisbon, Portugal', count: 40 }], processing: { faceDetection: { active: 1, waiting: 200 }, smartSearch: { active: 0, waiting: 0 } } });
    const r = await photoStatsTool({ top_places: 1 });
    expect(r).toMatchObject({ success: true, data: { totals: { photos: 1990, videos: 20 }, topPlaces: [{ place: 'London, United Kingdom', count: 900 }], processing: { faceDetection: { active: 1, waiting: 200 } }, note: expect.stringMatching(/still processing/) } });
    expect((r as unknown as { data: { processing: Record<string, unknown> } }).data.processing).not.toHaveProperty('smartSearch');
  });

  it('answers "not connected" plainly when Drive says so, is unreachable, refuses the lane or fails', async () => {
    for (const reply of [
      json(200, { connected: false, people: [] }),
      () => Promise.reject(new Error('DRIVE_SERVICE_TOKEN is not set, so the drive service lane is closed')),
      json(403, { message: 'Members cannot read photos' }),
      json(502, { message: 'Immich is not answering' }),
      async () => ({ status: 200, headers: {}, body: Buffer.from('<html>') }),
    ]) {
      h.reply = reply;
      const r = await photoStatsTool({});
      expect(r.success).toBe(true);
      expect(r).toMatchObject({ data: { connected: false, answer: expect.stringMatching(/not connected/) } });
    }
  });

  it('fails a bad argument without calling Drive, and passes on an unknown photo in Drive\'s words', async () => {
    expect(await photoSearchTool({ from: 'yesterday-ish' })).toMatchObject({ success: false, error: expect.stringMatching(/^photo_search: from must be a date/) });
    expect(h.calls).toHaveLength(0);
    h.reply = json(404, { message: 'No such photo' });
    expect(await photoDetailTool({ id: ID })).toEqual({ success: false, error: 'photo_detail: No such photo' });
  });
});

describe('the registered tools', () => {
  const NAMES = ['photo_people', 'photo_search', 'photo_detail', 'photo_stats'];
  const tool = (name: string) => tools.find((t) => t.name === name)!;

  it('are owner reads in the people toolset with real parameters', () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(t, name).toBeTruthy();
      expect(t.toolset).toBe('people');
      expect(t.effect).toBe('read');
      expect(Object.keys(t.parameters.properties).length, name).toBeGreaterThan(0);
    }
    expect(tool('photo_detail').parameters.required).toEqual(['id']);
  });

  it('refuse a member before anything reaches Drive', async () => {
    for (const name of NAMES) {
      const r = await tool(name).handler({ id: ID }, { emit: () => {}, principalId: 'u_member' });
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
    }
    expect(h.calls).toHaveLength(0);
  });

  it('answer the owner through the relay', async () => {
    h.reply = json(200, { connected: true, total: 0, page: 1, assets: [] });
    const r = await tool('photo_search').handler({ from: '2026-07-14', to: '2026-07-14' }, { emit: () => {} });
    expect(r).toMatchObject({ success: true, data: { connected: true, returned: 0, places: [], people: [] } });
    expect(h.calls[0]!.path).toBe('/api/photos/search?from=2026-07-14&to=2026-07-14&limit=25');
  });
});

describe('the capability row', () => {
  it("routes the owner's photo asks to the people toolset, and leaves \"family photos\" to the planned row", async () => {
    const { CAPABILITIES, rankCapabilities } = await import('$lib/capabilities/manifest');
    const row = CAPABILITIES.find((c) => c.toolsets.includes('people'))!;
    expect(row.tools).toEqual(expect.arrayContaining(['photo_people', 'photo_search', 'photo_detail', 'photo_stats']));
    const hits = (q: string) => (row.keywords ?? []).some((k) => new RegExp(k, 'i').test(q));
    for (const q of ['who is in my photos', 'photos of Sam in Lisbon last summer', 'where was I on 14 July', 'find the photo of the receipt', 'how many pictures from 2019']) {
      expect(hits(q), q).toBe(true);
    }
    expect(rankCapabilities('can you show me the family photos')[0]?.entry.id).toBe('family');
  });
});
