import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real gate (`withNativeAccess('games', …)`) in front of the route: only
// a phone whose person holds games access sees the boards.

const OWNER = 'owner@example.test';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
  windows: [] as string[],
}));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: OWNER } }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('$lib/server/grants', () => ({ loadMember: async (e: string) => h.members.get(e) ?? null }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null }));
vi.mock('$lib/jkai/chat/job-store', () => ({ getJob: () => null }));
vi.mock('$lib/games/players.server', () => ({
  playerFor: async (email: string) => ({ id: `p_${email.split('@')[0]}`, email, name: email }),
  playerId: (email: string) => `p_${email.split('@')[0]}`,
  gamePlayers: async () => [],
}));
vi.mock('$lib/games/results.server', () => ({
  leaderboard: async (window: string) => {
    h.windows.push(window);
    return { window, from: null, overall: [{ rank: 1, playerId: 'p_ann', name: 'Ann', wins: 2, played: 3 }], games: [] };
  },
}));

const { GET } = await import('./+server');

function call(query = '') {
  const url = new URL(`https://site.test/api/native/games/leaderboard${query}`);
  const request = new Request(url, { headers: { authorization: `Bearer ${'x'.repeat(43)}` } });
  return (GET as unknown as (e: unknown) => Promise<Response>)({ request, url, locals: { auth: async () => null } });
}

function device(email: string) {
  return { id: `dev-${email}`, ownerEmail: email, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
}

beforeEach(() => {
  h.identity = null;
  h.members.clear();
  h.windows.length = 0;
});

describe('GET /api/native/games/leaderboard', () => {
  it('401s an unpaired phone', async () => {
    expect((await call()).status).toBe(401);
  });

  it('403s a member without games access, before reading anything', async () => {
    h.identity = device('ann@example.test');
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self']) });
    const res = await call('?window=day');
    expect(res.status).toBe(403);
    expect(h.windows).toEqual([]);
  });

  it('answers a member holding games, with their own player id and names only', async () => {
    h.identity = device('ann@example.test');
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['games:self']) });
    const res = await call('?window=day');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ me: { id: 'p_ann' }, window: 'day', overall: [{ name: 'Ann', wins: 2 }] });
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('defaults to this week for the owner, and refuses a window it does not know', async () => {
    h.identity = device(OWNER);
    expect((await call()).status).toBe(200);
    expect(h.windows).toEqual(['week']);
    const bad = await call('?window=year');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Pick day, week or all.' });
  });
});
