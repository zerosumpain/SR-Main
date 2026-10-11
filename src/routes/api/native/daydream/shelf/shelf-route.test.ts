import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone's "past its date" actions behind the real owner gate
// (`withDevice`), with the writers stubbed. Every fixture is synthetic.

const OWNER = 'owner@example.test';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  env: {} as Record<string, string | undefined>,
  fileStale: vi.fn(async (ids: readonly string[] | 'all') => (ids === 'all' ? 12 : 1)),
  keepCurrent: vi.fn(async (_id: string) => '2026-10-25' as string | null),
  thinkNoteKind: vi.fn(async (id: string) => (id === 'missing' ? null : 'think_research')),
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('$lib/server/grants', () => ({ loadMember: async () => null }));
vi.mock('$lib/daydream/think/notes.server', () => ({
  fileStale: h.fileStale,
  keepCurrent: h.keepCurrent,
  thinkNoteKind: h.thinkNoteKind,
}));

const route = await import('./+server');
type Handler = (e: unknown) => Promise<Response>;

async function post(body: unknown) {
  const url = new URL('https://site.test/api/native/daydream/shelf');
  const request = new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${'x'.repeat(43)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await (route.POST as unknown as Handler)({ request, url, locals: { auth: async () => null } });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.env.AUTH_ALLOWED_EMAILS = OWNER;
  h.identity = { id: 'dev-1', ownerEmail: OWNER, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
  h.fileStale.mockClear();
  h.keepCurrent.mockClear();
});

describe('POST /api/native/daydream/shelf', () => {
  it('files one note, and every flagged note', async () => {
    expect(await post({ id: 'n1', op: 'file' })).toEqual({ status: 200, body: { ok: true, filed: 1 } });
    expect(h.fileStale).toHaveBeenLastCalledWith(['n1']);
    expect(await post({ all: true, op: 'file' })).toEqual({ status: 200, body: { ok: true, filed: 12 } });
    expect(h.fileStale).toHaveBeenLastCalledWith('all');
  });

  it('keeps a note current', async () => {
    expect(await post({ id: 'n1', op: 'keep' })).toEqual({ status: 200, body: { ok: true, until: '2026-10-25' } });
  });

  it('refuses a bad op, a missing id, an unknown note, and "keep all"', async () => {
    expect((await post({ id: 'n1', op: 'delete' })).status).toBe(400);
    expect((await post({ op: 'file' })).status).toBe(400);
    expect((await post({ all: true, op: 'keep' })).status).toBe(400);
    expect((await post({ id: 'missing', op: 'file' })).status).toBe(404);
    expect(h.fileStale).not.toHaveBeenCalled();
  });

  it('refuses a device that is not the owner\'s', async () => {
    h.identity = { id: 'dev-2', ownerEmail: 'ann@example.test', label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
    expect((await post({ all: true, op: 'file' })).status).toBe(403);
    expect(h.fileStale).not.toHaveBeenCalled();
  });
});
