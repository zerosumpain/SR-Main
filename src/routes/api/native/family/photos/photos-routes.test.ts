import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'member'; principalId: string; email: string; grants: Set<string> },
  stored: new Map<string, Buffer>(),
  put: [] as string[],
  deleted: [] as string[],
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));

vi.mock('$lib/family/roster.server', () => ({ familyId: (e: string) => `f_${e.split('@')[0]}` }));

vi.mock('$lib/family/photos.server', () => ({
  familyPhotos: async () => [...h.stored.keys()].map((id) => ({ id, subject: id === 'f_kid' ? 'kid' : null, version: 'abc123def456' })),
  photoById: async (id: string) => (h.stored.has(id) ? { image: h.stored.get(id)!, version: 'abc123def456' } : null),
  putPhoto: async (email: string) => {
    h.put.push(email);
    return 'abc123def456';
  },
  deletePhoto: async (email: string) => {
    h.deleted.push(email);
  },
}));

const list = await import('./+server');
const one = await import('./[id]/+server');
const mine = await import('../photo/+server');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

type Handler = (e: unknown) => Promise<Response>;
function call(handler: unknown, opts: { method?: string; body?: unknown; id?: string } = {}) {
  const request = new Request('https://strangeramblings.com/api/native/family/photo', {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { 'content-type': 'application/json' },
  });
  const locals = { viewer: h.viewer ? Promise.resolve(h.viewer) : undefined };
  return (handler as Handler)({ request, locals, url: new URL(request.url), params: { id: opts.id ?? '' } });
}

function asMember(email: string, grants: string[]) {
  h.role = 'member';
  h.viewer = { kind: 'member', principalId: 'p', email, grants: new Set(grants) };
}

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.stored = new Map([['f_kid', JPEG]]);
  h.put = [];
  h.deleted = [];
});

describe('family photos — who gets in', () => {
  it('refuses a member with no family grant, on every route', async () => {
    asMember('guest@example.test', ['games:self']);
    expect((await call(list.GET)).status).toBe(403);
    expect((await call(one.GET, { id: 'f_kid' })).status).toBe(403);
    expect((await call(mine.PUT, { method: 'PUT', body: { jpeg: JPEG.toString('base64') } })).status).toBe(403);
    expect((await call(mine.DELETE, { method: 'DELETE' })).status).toBe(403);
    expect(h.put).toEqual([]);
    expect(h.deleted).toEqual([]);
  });
});

describe('GET /api/native/family/photos', () => {
  it('lists ids, subjects and versions', async () => {
    asMember('kid@example.test', ['family:circle']);
    expect(await (await call(list.GET)).json()).toEqual({ photos: [{ id: 'f_kid', subject: 'kid', version: 'abc123def456' }] });
  });
});

describe('GET /api/native/family/photos/:id', () => {
  it('answers the JPEG itself, privately cacheable', async () => {
    const res = await call(one.GET, { id: 'f_kid' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(Buffer.from(await res.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  it('is 404 with a sentence for someone with no photo', async () => {
    const res = await call(one.GET, { id: 'f_nobody' });
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty('error');
  });
});

describe('PUT and DELETE /api/native/family/photo', () => {
  it('stores the caller’s photo and answers their id and version', async () => {
    asMember('kid@example.test', ['family:admin']);
    const res = await call(mine.PUT, { method: 'PUT', body: { jpeg: JPEG.toString('base64') } });
    expect(await res.json()).toEqual({ id: 'f_kid', version: 'abc123def456' });
    expect(h.put).toEqual(['kid@example.test']);
  });

  it('is 400 with a sentence for something that is not a JPEG', async () => {
    const res = await call(mine.PUT, { method: 'PUT', body: { jpeg: Buffer.from('hello').toString('base64') } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'The photo must be a JPEG.' });
    expect(h.put).toEqual([]);
  });

  it('deletes, idempotently', async () => {
    expect(await (await call(mine.DELETE, { method: 'DELETE' })).json()).toEqual({ ok: true });
    expect(await (await call(mine.DELETE, { method: 'DELETE' })).json()).toEqual({ ok: true });
    expect(h.deleted).toEqual(['owner@example.test', 'owner@example.test']);
  });
});
