import { describe, expect, it, vi } from 'vitest';

// The web door onto the boards: the real `withGamesSession` → `areaAccess`
// path, with the viewer handed in on `locals` as the hook caches it.
vi.mock('$lib/server/site-devices', () => ({ listAllSiteDevices: async () => [] }));
vi.mock('$lib/home/presence/members', () => ({ listMembers: async () => [] }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) =>
    email === 'kid@example.test' ? { principalId: 'u_kid', grants: new Set(['games:self']) } : null,
}));
const read = vi.hoisted(() => [] as string[]);
vi.mock('$lib/games/results.server', () => ({
  leaderboard: async (window: string) => {
    read.push(window);
    return { window, from: null, overall: [{ rank: 1, playerId: 'p_x', name: 'Kid', wins: 1, played: 1 }], games: [] };
  },
}));

const { GET } = await import('./+server');
const { playerId } = await import('$lib/games/players.server');

type Viewer =
  | { kind: 'owner' }
  | { kind: 'member'; principalId: string; email: string; grants: Set<string> }
  | { kind: 'guest'; email: string };

function call(viewer: Viewer, email: string, query = '') {
  const url = new URL(`https://strangeramblings.com/api/games/leaderboard${query}`);
  const event = {
    url,
    params: {},
    request: new Request(url),
    locals: { viewer: Promise.resolve(viewer), auth: async () => ({ user: { email } }) },
  };
  return (GET as unknown as (e: unknown) => Promise<Response>)(event);
}

describe('GET /api/games/leaderboard', () => {
  it('403s a member without games access and a guest, before reading anything', async () => {
    read.length = 0;
    const news = { kind: 'member', principalId: 'u_n', email: 'news@example.test', grants: new Set(['news:self']) } as const;
    expect((await call(news, 'news@example.test')).status).toBe(403);
    expect((await call({ kind: 'guest', email: 'g@example.test' }, 'g@example.test')).status).toBe(403);
    expect(read).toEqual([]);
  });

  it('answers a member holding games with their own player id, names only', async () => {
    const kid = { kind: 'member', principalId: 'u_kid', email: 'kid@example.test', grants: new Set(['games:self']) } as const;
    const res = await call(kid, 'kid@example.test', '?window=day');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ me: { id: playerId('kid@example.test') }, window: 'day' });
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('defaults to this week for the owner and refuses an unknown window', async () => {
    read.length = 0;
    expect((await call({ kind: 'owner' }, 'owner@example.test')).status).toBe(200);
    expect(read).toEqual(['week']);
    expect((await call({ kind: 'owner' }, 'owner@example.test', '?window=year')).status).toBe(400);
  });
});
