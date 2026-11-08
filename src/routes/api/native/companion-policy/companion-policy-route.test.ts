import { beforeEach, describe, expect, it, vi } from 'vitest';

// The pilot's access authority: one person, or a whole household in one call.

const TOKEN = 'p'.repeat(32);

const h = vi.hoisted(() => ({
  versions: new Map<string, string>(),
  roles: new Map<string, { parent: boolean } | null>(),
  queries: 0,
  down: false,
}));

vi.mock('$env/dynamic/private', () => ({ env: { COMPANION_POLICY_TOKEN: 'p'.repeat(32) } }));
vi.mock('$lib/db', () => ({
  db: {
    execute: async () => {
      h.queries++;
      if (h.down) throw new Error('no table');
      return { rows: [...h.versions].map(([email, version]) => ({ email, version })) };
    },
  },
}));
vi.mock('$lib/family/roster.server', () => ({ familyRole: async (e: string) => h.roles.get(e) ?? null }));

const { GET } = await import('./+server');

async function call(query: string, token = TOKEN) {
  const url = new URL(`https://site.test/api/native/companion-policy${query}`);
  const request = new Request(url, { headers: { authorization: `Bearer ${token}` } });
  const res = await (GET as unknown as (e: unknown) => Promise<Response>)({ request, url });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  h.versions = new Map([['ann@example.test', '3']]);
  h.roles = new Map([['ann@example.test', { parent: false }], ['bob@example.test', { parent: true }]]);
  h.queries = 0;
  h.down = false;
});

describe('GET /api/native/companion-policy', () => {
  it('answers one person as it always has', async () => {
    expect(await call('?email=Ann@Example.test')).toEqual({ status: 200, body: { allowed: true, version: '3' } });
    expect((await call('?email=eve@example.test')).body).toEqual({ allowed: false, version: '0' });
  });

  it('answers a household in one query, each person read fresh', async () => {
    const res = await call('?emails=ann@example.test&emails=BOB@example.test&emails=eve@example.test');
    expect(res.status).toBe(200);
    expect(res.body.people).toEqual({
      'ann@example.test': { allowed: true, version: '3' },
      'bob@example.test': { allowed: true, version: '0' },
      'eve@example.test': { allowed: false, version: '0' },
    });
    expect(h.queries).toBe(1);
    h.roles.set('ann@example.test', null);
    expect((await call('?emails=ann@example.test&emails=bob@example.test')).body.people['ann@example.test'].allowed).toBe(false);
  });

  it('refuses a wrong token, a mixed or empty ask, and too many people', async () => {
    expect((await call('?email=ann@example.test', 'q'.repeat(32))).status).toBe(401);
    expect((await call('?email=ann@example.test&emails=bob@example.test')).status).toBe(400);
    expect((await call('?emails=')).status).toBe(400);
    expect((await call('')).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `emails=p${i}@example.test`).join('&');
    expect((await call(`?${many}`)).status).toBe(400);
  });

  it('503s rather than guessing when the database cannot answer', async () => {
    h.down = true;
    expect((await call('?emails=ann@example.test&emails=bob@example.test')).status).toBe(503);
    expect((await call('?email=ann@example.test')).status).toBe(503);
  });
});
