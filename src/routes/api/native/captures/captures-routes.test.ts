import { beforeEach, describe, expect, it, vi } from 'vitest';

// The captures routes behind the real owner gate (`withDevice`), with the
// captures library stubbed. Every route refuses an unpaired phone (401) and a
// phone that is not the owner's (403) before it touches anything. Every
// fixture is synthetic.

const OWNER = 'owner@example.test';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  env: {} as Record<string, string | undefined>,
  touched: [] as string[],
  createCapture: vi.fn(),
  listCaptures: vi.fn(),
  getCapture: vi.fn(),
  listActions: vi.fn(async () => []),
  attachMedia: vi.fn(async () => null),
  decideAction: vi.fn(),
  deleteCapture: vi.fn(async () => null),
  patchCapture: vi.fn(),
  captureWithActions: vi.fn(),
  searchCaptures: vi.fn(async () => ({ captures: [], entities: [] })),
  captureEntityPage: vi.fn(async () => null),
  startIfComplete: vi.fn(),
}));

const touch = (name: string, fn: (...a: never[]) => unknown) =>
  (...a: never[]) => {
    h.touched.push(name);
    return fn(...a);
  };

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/grants', () => ({ loadMember: async () => null }));
vi.mock('$lib/captures/store.server', () => ({
  createCapture: touch('createCapture', (...a) => (h.createCapture as (...x: unknown[]) => unknown)(...a)),
  listCaptures: touch('listCaptures', (...a) => (h.listCaptures as (...x: unknown[]) => unknown)(...a)),
  getCapture: touch('getCapture', (...a) => (h.getCapture as (...x: unknown[]) => unknown)(...a)),
  listActions: touch('listActions', () => h.listActions()),
  recorderSpace: () => 'owner',
}));
vi.mock('$lib/captures/service.server', () => ({
  attachMedia: touch('attachMedia', () => h.attachMedia()),
  decideAction: touch('decideAction', (...a) => (h.decideAction as (...x: unknown[]) => unknown)(...a)),
  deleteCapture: touch('deleteCapture', () => h.deleteCapture()),
  patchCapture: touch('patchCapture', (...a) => (h.patchCapture as (...x: unknown[]) => unknown)(...a)),
  captureWithActions: touch('captureWithActions', (...a) => (h.captureWithActions as (...x: unknown[]) => unknown)(...a)),
  startIfComplete: (...a: unknown[]) => (h.startIfComplete as (...x: unknown[]) => unknown)(...a),
  isRefusal: (v: unknown) => !!v && typeof v === 'object' && (v as { refused?: unknown }).refused === true,
  CaptureMediaError: class extends Error {},
}));
vi.mock('$lib/captures/search.server', () => ({
  searchCaptures: touch('searchCaptures', () => h.searchCaptures()),
  captureEntityPage: touch('captureEntityPage', () => h.captureEntityPage()),
}));
vi.mock('$lib/captures/analyse.server', () => ({ healStuckCapture: () => false }));
vi.mock('$lib/captures/media.server', () => ({ readCaptureMedia: touch('readCaptureMedia', async () => null) }));

const list = await import('./+server');
const one = await import('./[id]/+server');
const audio = await import('./[id]/audio/+server');
const screen = await import('./[id]/screen/+server');
const decide = await import('./[id]/actions/[actionId]/+server');
const search = await import('./search/+server');
const entity = await import('./entities/[entityId]/+server');

type Handler = (e: unknown) => Promise<Response>;

async function call(
  handler: unknown,
  method: string,
  path: string,
  params: Record<string, string> = {},
  body?: unknown,
  raw?: BodyInit,
) {
  const url = new URL(`https://site.test${path}`);
  const request = new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${'x'.repeat(43)}`,
      ...(raw ? { 'content-type': 'audio/mp4' } : body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await (handler as Handler)({ request, url, params, locals: { auth: async () => null } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ROUTES: Array<[string, unknown, string, string, Record<string, string>, unknown?, BodyInit?]> = [
  ['POST captures', list.POST, 'POST', '/api/native/captures', {}, { startedAt: '2026-10-26T10:00:00Z', transcript: 'hi' }],
  ['GET captures', list.GET, 'GET', '/api/native/captures', {}],
  ['GET capture', one.GET, 'GET', '/api/native/captures/cap_1', { id: 'cap_1' }],
  ['PATCH capture', one.PATCH, 'PATCH', '/api/native/captures/cap_1', { id: 'cap_1' }, { title: 'New' }],
  ['DELETE capture', one.DELETE, 'DELETE', '/api/native/captures/cap_1', { id: 'cap_1' }],
  ['PUT audio', audio.PUT, 'PUT', '/api/native/captures/cap_1/audio', { id: 'cap_1' }, undefined, new Uint8Array([1, 2, 3])],
  ['GET audio', audio.GET, 'GET', '/api/native/captures/cap_1/audio', { id: 'cap_1' }],
  ['PUT screen', screen.PUT, 'PUT', '/api/native/captures/cap_1/screen', { id: 'cap_1' }, undefined, new Uint8Array([1, 2, 3])],
  ['GET screen', screen.GET, 'GET', '/api/native/captures/cap_1/screen', { id: 'cap_1' }],
  ['POST decision', decide.POST, 'POST', '/api/native/captures/cap_1/actions/cact_1', { id: 'cap_1', actionId: 'cact_1' }, { decision: 'approve' }],
  ['GET search', search.GET, 'GET', '/api/native/captures/search?q=sarah', {}],
  ['GET entity', entity.GET, 'GET', '/api/native/captures/entities/ent_1', { entityId: 'ent_1' }],
];

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.env.AUTH_ALLOWED_EMAILS = OWNER;
  h.identity = { id: 'dev-1', ownerEmail: OWNER, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
  h.touched.length = 0;
  vi.clearAllMocks();
});

describe('the captures routes refuse anyone but the owner', () => {
  it.each(ROUTES)('%s: 401 for an unpaired phone, touching nothing', async (_n, handler, method, path, params, body, raw) => {
    h.identity = null;
    const res = await call(handler, method, path, params, body, raw);
    expect(res.status).toBe(401);
    expect(h.touched).toEqual([]);
  });

  it.each(ROUTES)('%s: 403 for a member, touching nothing', async (_n, handler, method, path, params, body, raw) => {
    h.identity = { id: 'dev-2', ownerEmail: 'ann@example.test', label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
    const res = await call(handler, method, path, params, body, raw);
    expect(res.status).toBe(403);
    expect(h.touched).toEqual([]);
  });
});

const ROW = {
  id: 'cap_1',
  spaceId: 'owner',
  principal: OWNER,
  startedAt: new Date('2026-10-26T10:00:00Z'),
  endedAt: null,
  durationS: null,
  audioUploadId: 'att_1',
  transcript: 'hello there',
  transcriptSource: 'phone',
  turns: [],
  speakers: [{ label: 'S1', guess: null, confirmed: null, isOwner: true }],
  screenUploadId: null,
  screen: null,
  place: null,
  title: 'Hello',
  summary: null,
  flow: [],
  entities: [],
  intake: {},
  status: 'ready',
  error: null,
  analysisCostUsd: null,
  createdAt: new Date('2026-10-26T10:00:00Z'),
  updatedAt: new Date('2026-10-26T10:00:00Z'),
};

describe('for the owner', () => {
  it('POST creates in the owner space and hands back the upload URLs', async () => {
    h.createCapture.mockResolvedValueOnce({ ...ROW, status: 'received' });
    const res = await call(list.POST, 'POST', '/api/native/captures', {}, { startedAt: '2026-10-26T10:00:00Z', transcript: 'hi', screenshot: true });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 'cap_1',
      uploadAudio: 'https://site.test/api/native/captures/cap_1/audio',
      uploadScreen: 'https://site.test/api/native/captures/cap_1/screen',
    });
    expect(h.createCapture).toHaveBeenCalledWith(OWNER, 'owner', expect.objectContaining({ transcript: 'hi' }));
  });

  it('POST refuses a bad body with the reason', async () => {
    const res = await call(list.POST, 'POST', '/api/native/captures', {}, { startedAt: 'soon' });
    expect(res.status).toBe(400);
    expect(h.createCapture).not.toHaveBeenCalled();
  });

  it('GET pages newest first with a `next` cursor', async () => {
    const rows = [0, 1, 2].map((i) => ({ ...ROW, id: `cap_${i}`, startedAt: new Date(Date.UTC(2026, 9, 26 - i)) }));
    h.listCaptures.mockResolvedValueOnce({ rows, open: new Map([['cap_0', 2]]) });
    const res = await call(list.GET, 'GET', '/api/native/captures?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['cap_0', 'cap_1']);
    expect(res.body.items[0].actionsOpen).toBe(2);
    expect(res.body.next).toBe(rows[1].startedAt.toISOString());
    expect(h.listCaptures).toHaveBeenCalledWith('owner', { before: null, limit: 3 });
  });

  it('GET of a capture outside the space is a 404', async () => {
    h.captureWithActions.mockResolvedValueOnce(null);
    expect((await call(one.GET, 'GET', '/api/native/captures/cap_x', { id: 'cap_x' })).status).toBe(404);
    expect(h.captureWithActions).toHaveBeenCalledWith('owner', 'cap_x');
  });

  it('GET returns the full view with authenticated media URLs', async () => {
    h.captureWithActions.mockResolvedValueOnce({ c: ROW, actions: [] });
    const res = await call(one.GET, 'GET', '/api/native/captures/cap_1', { id: 'cap_1' });
    expect(res.status).toBe(200);
    expect(res.body.audioUrl).toBe('https://site.test/api/native/captures/cap_1/audio');
    expect(res.body.screenUrl).toBeNull();
  });

  it('DELETE is a 204', async () => {
    expect((await call(one.DELETE, 'DELETE', '/api/native/captures/cap_1', { id: 'cap_1' })).status).toBe(204);
  });

  it('PUT audio is a 204, and an empty body is a 400', async () => {
    expect((await call(audio.PUT, 'PUT', '/api/native/captures/cap_1/audio', { id: 'cap_1' }, undefined, new Uint8Array([1]))).status).toBe(204);
    expect((await call(audio.PUT, 'PUT', '/api/native/captures/cap_1/audio', { id: 'cap_1' })).status).toBe(400);
  });

  it('a decision passes the refusal status through', async () => {
    h.decideAction.mockResolvedValueOnce({ refused: true, status: 409, error: 'That follow-up is already done.' });
    const res = await call(decide.POST, 'POST', '/api/native/captures/cap_1/actions/cact_1', { id: 'cap_1', actionId: 'cact_1' }, { decision: 'approve' });
    expect(res).toEqual({ status: 409, body: { error: 'That follow-up is already done.' } });
    expect((await call(decide.POST, 'POST', '/x', { id: 'cap_1', actionId: 'cact_1' }, { decision: 'perhaps' })).status).toBe(400);
  });

  it('search refuses a bad date and an entity outside the space is a 404', async () => {
    expect((await call(search.GET, 'GET', '/api/native/captures/search?from=whenever')).status).toBe(400);
    expect((await call(entity.GET, 'GET', '/api/native/captures/entities/ent_1', { entityId: 'ent_1' })).status).toBe(404);
  });
});
