import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The web door: a browser session, resolved through the `games` area's seam.
// The viewer is handed in on `locals` (as the hook's `viewerOf` caches it), so
// these run the real `areaAccess` → `withGamesSession` → shared bodies path.
vi.mock('$lib/server/site-devices', () => ({ listAllSiteDevices: async () => [] }));
vi.mock('$lib/home/presence/members', () => ({ listMembers: async () => [] }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) =>
    email === 'kid@example.test' ? { principalId: 'u_kid', grants: new Set(['games:self']) } : null,
}));
vi.mock('$lib/games/invite-push.server', () => ({ pushInvites: async () => {} }));
vi.mock('$lib/games/quiz-night.server', () => ({ writeQuiz: async () => {} }));
vi.mock('$lib/jkai/chat-access.server', () => ({ reserveUsage: async () => {} }));

import { _resetRooms } from '$lib/games/rooms.server';
import { _resetPlayers, playerId } from '$lib/games/players.server';

const lobby = await import('./+server');
const one = await import('./[id]/+server');
const stream = await import('./[id]/stream/+server');

type Viewer =
  | { kind: 'owner' }
  | { kind: 'member'; principalId: string; email: string; grants: Set<string> }
  | { kind: 'guest'; email: string }
  | { kind: 'anonymous' };

const OWNER: Viewer = { kind: 'owner' };
const KID: Viewer = { kind: 'member', principalId: 'u_kid', email: 'kid@example.test', grants: new Set(['games:self']) };
const NEWS_ONLY: Viewer = { kind: 'member', principalId: 'u_n', email: 'news@example.test', grants: new Set(['news:self']) };
const GUEST: Viewer = { kind: 'guest', email: 'guest@example.test' };

function emailOf(v: Viewer): string | null {
  if (v.kind === 'owner') return 'owner@example.test';
  if (v.kind === 'member' || v.kind === 'guest') return v.email;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ev(viewer: Viewer, method = 'GET', body?: unknown, params: Record<string, string> = {}): any {
  const url = new URL('https://strangeramblings.com/api/games' + (params.id ? `/${params.id}` : ''));
  const email = emailOf(viewer);
  return {
    url,
    params,
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    locals: {
      viewer: Promise.resolve(viewer),
      auth: async () => (email ? { user: { email } } : null),
    },
  };
}

beforeEach(() => _resetPlayers());
afterEach(() => _resetRooms());

describe('/api/games — who may use the web door', () => {
  it('refuses a signed-in guest and a member without games access with 403', async () => {
    for (const v of [GUEST, NEWS_ONLY]) {
      const res = await lobby.GET(ev(v));
      expect(res.status, v.kind).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden' });
    }
    const res = await lobby.POST(ev(GUEST, 'POST', { game: 'liars-dice', difficulty: 'easy' }));
    expect(res.status).toBe(403);
  });

  it('answers a member holding games:self as themselves', async () => {
    const res = await lobby.GET(ev(KID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.me.id).toBe(playerId('kid@example.test'));
  });

  it('answers the owner, and makes a web lobby visitor invitable', async () => {
    // Kid has no paired phone: invitable only once their web lobby has polled.
    expect((await (await lobby.GET(ev(OWNER))).json()).players).toEqual([]);
    await lobby.GET(ev(KID));
    const players = (await (await lobby.GET(ev(OWNER))).json()).players;
    expect(players).toEqual([{ id: playerId('kid@example.test'), name: 'Kid' }]);
  });

  it("starts Liar's Dice, refuses other games, and plays through the room routes", async () => {
    await lobby.GET(ev(KID));
    const kidId = playerId('kid@example.test');

    const boggle = await lobby.POST(ev(OWNER, 'POST', { game: 'boggle', difficulty: 'easy' }));
    expect(boggle.status).toBe(400);
    expect(await boggle.json()).toEqual({ error: 'Start that game from the app.' });

    const made = await lobby.POST(ev(OWNER, 'POST', { game: 'liars-dice', difficulty: 'easy', dice: 5, invite: [kidId] }));
    expect(made.status).toBe(201);
    const { room } = await made.json();

    // Not seated or invited: the room is not theirs.
    const peek = await one.GET(ev(NEWS_ONLY, 'GET', undefined, { id: room.id }));
    expect(peek.status).toBe(403);

    const joined = await one.POST(ev(KID, 'POST', { action: 'join' }, { id: room.id }));
    expect(joined.status).toBe(200);
    expect((await joined.json()).room.players.find((p: { id: string }) => p.id === kidId).status).toBe('joined');

    const bad = await one.POST(ev(KID, 'POST', { action: 'start' }, { id: room.id }));
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: 'Only the host can start.' });

    const notJson = await one.POST({ ...ev(OWNER, 'POST', undefined, { id: room.id }), request: new Request('https://x/', { method: 'POST', body: 'nope' }) });
    expect(notJson.status).toBe(400);

    const sse = await stream.GET(ev(KID, 'GET', undefined, { id: room.id }));
    expect(sse.headers.get('content-type')).toBe('text/event-stream');
    await sse.body?.cancel();

    const refused = await stream.GET(ev(GUEST, 'GET', undefined, { id: room.id }));
    expect(refused.status).toBe(403);
  });
});
