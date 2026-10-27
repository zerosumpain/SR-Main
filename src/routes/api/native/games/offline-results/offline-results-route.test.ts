import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real gate (`withNativeAccess('games', …)`) in front of the route, and a
// `game_results` table in memory that keeps the real unique key (room + round
// + player) with ON CONFLICT DO NOTHING — so a retry is seen landing once.

const OWNER = 'owner@example.test';
const NOW = Date.now();

type Stored = Record<string, unknown> & { roomId: string; round: number; playerId: string };

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
  table: [] as Stored[],
  inserts: 0,
  failNext: false,
}));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: OWNER } }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/access', () => ({
  isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER,
}));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (e: string) => h.members.get(e) ?? null,
}));
vi.mock('$lib/jkai/chat/job-store', () => ({ getJob: () => null }));
vi.mock('$lib/games/players.server', () => ({
  playerFor: async (email: string) => ({ id: `p_${email.split('@')[0]}`, email, name: email.split('@')[0] }),
  playerId: (email: string) => `p_${email.split('@')[0]}`,
  gamePlayers: async () => [],
}));
vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: (rows: Stored[]) => ({
        onConflictDoNothing: async () => {
          if (h.failNext) {
            h.failNext = false;
            throw new Error('database down');
          }
          h.inserts += 1;
          for (const r of rows) {
            const clash = h.table.some((t) => t.roomId === r.roomId && t.round === r.round && t.playerId === r.playerId);
            if (!clash) h.table.push(r);
          }
        },
      }),
    }),
  },
}));

const { POST } = await import('./+server');

function call(body: unknown, headers: Record<string, string> = {}) {
  const url = new URL('https://site.test/api/native/games/offline-results');
  const request = new Request(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${'x'.repeat(43)}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return (POST as unknown as (e: unknown) => Promise<Response>)({ request, url, locals: { auth: async () => null } });
}

function device(email: string) {
  return { id: `dev-${email}`, ownerEmail: email, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
}

/** A row exactly as SRAppleApp's `OfflineResultUpload` encodes it. */
function result(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    game: 'offline:four-in-a-row',
    source: 'offline',
    title: 'Four in a Row',
    mode: 'nearby',
    finishedAt: NOW - 120_000,
    players: 2,
    bots: 0,
    rank: 1,
    score: 1,
    won: true,
    detail: null,
    opponents: ['Sam'],
    ...over,
  };
}

beforeEach(() => {
  h.identity = null;
  h.members.clear();
  h.table = [];
  h.inserts = 0;
  h.failNext = false;
});

describe('POST /api/native/games/offline-results', () => {
  it('401s an unpaired phone', async () => {
    expect((await call({ results: [result('a-1')] })).status).toBe(401);
    expect(h.table).toEqual([]);
  });

  it('403s a member without games access', async () => {
    h.identity = device('ann@example.test');
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self']) });
    expect((await call({ results: [result('a-1')] })).status).toBe(403);
    expect(h.table).toEqual([]);
  });

  it('refuses View as: a look cannot file games as somebody', async () => {
    h.identity = device(OWNER);
    h.members.set('kid@example.test', { principalId: 'u_kid', grants: new Set(['games:self']) });
    const res = await call({ results: [result('a-1')] }, { 'x-sr-view-as': 'kid@example.test' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'View as is look-only: exit it to make changes.' });
    expect(h.table).toEqual([]);
  });

  it('400s a body that is not { results: [...] }', async () => {
    h.identity = device(OWNER);
    expect((await call('not json')).status).toBe(400);
    expect((await call({ results: 'a-1' })).status).toBe(400);
    expect((await call([result('a-1')])).status).toBe(400);
  });

  it('files each result once for the caller, however often the phone retries', async () => {
    h.identity = device('kid@example.test');
    h.members.set('kid@example.test', { principalId: 'u_kid', grants: new Set(['games:self']) });
    const batch = { results: [result('0a1b2c3d-1'), result('0a1b2c3d-2', { rank: 2, won: false, score: 0 })] };

    const first = await call(batch);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ recorded: ['0a1b2c3d-1', '0a1b2c3d-2'], rejected: [] });
    // The answer was lost; the phone sends the same batch again.
    const again = await call(batch);
    expect(await again.json()).toEqual({ recorded: ['0a1b2c3d-1', '0a1b2c3d-2'], rejected: [] });

    expect(h.table).toHaveLength(2);
    expect(h.table[0]).toMatchObject({
      game: 'offline:four-in-a-row',
      roomId: 'offline-0a1b2c3d-1',
      round: 1,
      playerId: 'p_kid',
      playerName: 'kid',
      score: 1,
      rank: 1,
      won: true,
      players: 2,
      difficulty: '',
      options: { source: 'offline', bots: 0, mode: 'nearby', title: 'Four in a Row' },
    });
    // No email, and nobody else's name: the caller's own row only.
    expect(JSON.stringify(h.table)).not.toContain('@');
    expect(JSON.stringify(h.table)).not.toContain('Sam');
  });

  it('files the same match once per person: each phone tells only its own result', async () => {
    h.identity = device('kid@example.test');
    h.members.set('kid@example.test', { principalId: 'u_kid', grants: new Set(['games:self']) });
    await call({ results: [result('0a1b2c3d-1')] });
    h.identity = device(OWNER);
    await call({ results: [result('0a1b2c3d-1', { rank: 2, won: false, score: 0 })] });
    expect(h.table.map((r) => [r.roomId, r.playerId, r.rank])).toEqual([
      ['offline-0a1b2c3d-1', 'p_kid', 1],
      ['offline-0a1b2c3d-1', 'p_owner', 2],
    ]);
  });

  it('records the good and rejects the bad in one batch', async () => {
    h.identity = device(OWNER);
    const res = await call({
      results: [
        result('good-1'),
        result('online-1', { game: 'four-in-a-row' }),
        result('bad-1', { rank: 9 }),
        result('physics-1', { game: 'offline:car-race', title: 'Car Race', players: 1, won: false, score: 4210 }),
      ],
    });
    expect(await res.json()).toEqual({ recorded: ['good-1', 'physics-1'], rejected: ['online-1', 'bad-1'] });
    expect(h.table.map((r) => r.game)).toEqual(['offline:four-in-a-row', 'offline:car-race']);
  });

  it('answers an all-bad batch without touching the table', async () => {
    h.identity = device(OWNER);
    const res = await call({ results: [result('bad-1', { score: 'lots' })] });
    expect(await res.json()).toEqual({ recorded: [], rejected: ['bad-1'] });
    expect(h.inserts).toBe(0);
  });

  it('500s when the database fails, so the phone keeps the batch and tries again', async () => {
    h.identity = device(OWNER);
    h.failNext = true;
    const res = await call({ results: [result('a-1')] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong. Try again.' });
    expect(h.table).toEqual([]);
  });
});
