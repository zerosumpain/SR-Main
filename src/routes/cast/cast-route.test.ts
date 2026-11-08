import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  family: true,
  items: new Map<string, { id: string; kind: string; url: string | null; provider: string | null; title: string | null; thumbnailUrl: string | null }>(),
}));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, 'member');
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/family/access.server', () => ({
  familyCaller: async () => (h.family ? { email: 'kid@example.test', parent: false } : null),
}));
vi.mock('$lib/family/backlog.server', () => ({ getItem: async (id: string) => h.items.get(id) ?? null }));

const media = await import('./[ticket]/+server');
const cast = await import('../api/native/family/backlog/[id]/cast/+server');
const { issueCastTicket, castMediaPath } = await import('$lib/family/backlog-cast');

const ID = '0b6f3c1e-8f4a-4c2b-9d7e-1a2b3c4d5e6f';
const SECRET = 'x'.repeat(48);
const BYTES = 'abcdefghijklmnopqrstuvwxyz';
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cast-route-'));
  h.env.CAST_CACHE_DIR = dir;
  h.env.AUTH_SECRET = SECRET;
  h.env.YT_DLP_PATH = join(dir, 'missing');
  h.family = true;
  h.items.clear();
  h.items.set(ID, { id: ID, kind: 'page', url: 'https://example.test/a', provider: 'web', title: 'A page', thumbnailUrl: null });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${ID}.mp4`), BYTES);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function get(ticket: string, range?: string) {
  const segment = castMediaPath(ticket).split('/').pop()!;
  const request = new Request(`https://x.test/cast/${segment}`, { headers: range ? { range } : {} });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return media.GET({ params: { ticket: segment }, request } as any);
}

async function status(p: Response | Promise<Response>) {
  try {
    return (await p).status;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

describe('GET /cast/<ticket>.mp4', () => {
  it('serves the file to a TV holding a good ticket', async () => {
    const res = await get(issueCastTicket(ID, SECRET).ticket);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(await res.text()).toBe(BYTES);
  });

  it('answers a range, which is how a TV seeks', async () => {
    const res = await get(issueCastTicket(ID, SECRET).ticket, 'bytes=2-5');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 2-5/${BYTES.length}`);
    expect(await res.text()).toBe('cdef');
  });

  it('404s a forged ticket', async () => {
    expect(await status(get(issueCastTicket(ID, 'y'.repeat(48)).ticket))).toBe(404);
  });

  it('404s once the item is deleted', async () => {
    const { ticket } = issueCastTicket(ID, SECRET);
    h.items.clear();
    expect(await status(get(ticket))).toBe(404);
  });

  it('404s once the file is evicted', async () => {
    const { ticket } = issueCastTicket(ID, SECRET);
    await rm(join(dir, `${ID}.mp4`));
    expect(await status(get(ticket))).toBe(404);
  });
});

describe('POST /api/native/family/backlog/[id]/cast', () => {
  function post(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return cast.POST({ params: { id }, url: new URL(`https://x.test/api/native/family/backlog/${id}/cast`) } as any);
  }

  it('is for the family only', async () => {
    h.family = false;
    expect((await post(ID)).status).toBe(403);
  });

  it('404s an unknown item', async () => {
    expect((await post('11111111-2222-4333-8444-555555555555')).status).toBe(404);
  });

  it('answers what the phone should do', async () => {
    const body = await (await post(ID)).json();
    expect(body).toMatchObject({ state: 'fallback', fallback: 'mirror', url: 'https://example.test/a' });
  });
});
