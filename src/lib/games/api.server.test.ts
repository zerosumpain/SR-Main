import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The roster's sources: one paired phone (Sam's), the owner, and a member who
// has games access but no phone until a test pairs one (Kit). Grants are read
// per email.
const h = vi.hoisted(() => ({
  devices: [] as { ownerEmail: string; revokedAt: Date | null; expiresAt: Date }[],
  grants: new Map<string, string[]>(),
  pushed: [] as string[],
}));

vi.mock('$lib/server/site-devices', () => ({ listAllSiteDevices: async () => h.devices }));
vi.mock('$lib/home/presence/members', () => ({ listMembers: async () => [] }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (email: string) => {
    const g = h.grants.get(email);
    return g ? { principalId: `u_${email.split('@')[0]}`, grants: new Set(g) } : null;
  },
}));
vi.mock('./invite-push.server', () => ({ pushInvites: async (id: string) => void h.pushed.push(id) }));
vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));
vi.mock('$lib/jkai/chat-access.server', () => ({ reserveUsage: async () => {} }));

import { isHttpError } from '@sveltejs/kit';
import { lobbyFor, roomAct, roomStream, roomView, startGame } from './api.server';
import { _resetPlayers, playerId } from './players.server';
import { _resetRooms } from './rooms.server';
import { COUNTDOWN_MS } from './liars-dice';
import type { WireRoom } from './liars-dice';
import { GAME_IDS, GAMES, type GameId, type GameRules, type RoomBase } from './catalogue';
import { GameError, type PlayerStatus } from './tap-duel';

const owner = { email: 'owner@example.test', role: 'owner' as const };
const sam = { email: 'sam@example.test', role: 'member' as const };
const kit = { email: 'kit@example.test', role: 'member' as const };
const event = { locals: {} as App.Locals };

async function refusal(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (err) {
    if (isHttpError(err)) return { status: err.status, message: err.body.message };
    throw err;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  h.devices = [
    { ownerEmail: 'owner@example.test', revokedAt: null, expiresAt: new Date(1_800_000_000_000) },
    { ownerEmail: 'sam@example.test', revokedAt: null, expiresAt: new Date(1_800_000_000_000) },
  ];
  h.grants = new Map([
    ['sam@example.test', ['games:self']],
    ['kit@example.test', ['games:self']],
    ['guest@example.test', ['news:self']],
  ]);
  h.pushed = [];
  _resetPlayers();
});
afterEach(() => {
  _resetRooms();
  vi.useRealTimers();
});

describe('the roster', () => {
  it('offers only people with a live paired phone', async () => {
    expect((await lobbyFor(owner)).players.map((p) => p.name)).toEqual(['Sam']);

    h.devices.push({ ownerEmail: kit.email, revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    _resetPlayers();
    expect((await lobbyFor(owner)).players.map((p) => p.name)).toEqual(['Kit', 'Sam']);
  });

  it('never offers somebody without games access, even with a paired phone', async () => {
    h.devices.push({ ownerEmail: 'guest@example.test', revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    _resetPlayers();
    expect((await lobbyFor(owner)).players.map((p) => p.name)).toEqual(['Sam']);
  });
});

describe("a Liar's Dice table between two paired phones", () => {
  it('derives the player id from the email', async () => {
    const lobby = await lobbyFor(kit);
    expect(lobby.me.id).toBe(playerId(kit.email));
  });

  it('starts, invites, joins and plays a bid', async () => {
    h.devices.push({ ownerEmail: kit.email, revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    const kitId = playerId(kit.email);
    const created = (await startGame(event, owner, { game: 'liars-dice', difficulty: 'medium', dice: 3, invite: [kitId] })) as WireRoom;
    expect(created.dicePerPlayer).toBe(3);
    expect(h.pushed).toEqual([created.id]);

    // Kit's lobby poll carries the invite.
    const invites = (await lobbyFor(kit)).invites;
    expect(invites.map((i) => i.roomId)).toEqual([created.id]);

    await roomAct(kit, created.id, { action: 'join' });
    await roomAct(owner, created.id, { action: 'start' });
    vi.advanceTimersByTime(COUNTDOWN_MS + 10);

    const mine = (await roomView(owner, created.id)) as WireRoom;
    expect(mine.phase).toBe('bidding');
    expect(mine.turnId).toBe(playerId(owner.email));
    // My dice, never Kit's.
    expect(mine.players.find((p) => p.id === kitId)?.dice).toBeNull();
    expect(mine.players.find((p) => p.id === mine.meId)?.dice).toHaveLength(3);

    // Illegal: ones are wild on medium. The rules module's sentence comes back.
    expect(await refusal(roomAct(owner, created.id, { action: 'bid', quantity: 1, face: 1 }))).toEqual({
      status: 400,
      message: 'Ones are wild — bid on 2 to 6.',
    });
    // Off-turn.
    expect((await refusal(roomAct(kit, created.id, { action: 'bid', quantity: 1, face: 3 }))).status).toBe(409);

    const after = (await roomAct(owner, created.id, { action: 'bid', quantity: 2, face: 4 })) as WireRoom;
    expect(after.bid).toMatchObject({ quantity: 2, face: 4 });
    expect(after.turnId).toBe(kitId);
    const called = (await roomAct(kit, created.id, { action: 'liar' })) as WireRoom;
    expect(called.phase).toBe('reveal');
  });

  it('creates a Draw & Guess room with its options', async () => {
    const room = (await startGame(event, owner, {
      game: 'draw-guess',
      difficulty: 'medium',
      turnsEach: 2,
      seconds: 60,
      invite: [playerId(sam.email)],
    })) as unknown as { game: string; turnsEach: number; timeLimitMs: number; players: { id: string; status: string }[] };
    expect(room.game).toBe('draw-guess');
    expect(room.turnsEach).toBe(2);
    expect(room.timeLimitMs).toBe(60_000);
    expect(room.players.find((p) => p.id === playerId(sam.email))?.status).toBe('invited');
    expect(h.pushed).toEqual([(room as unknown as { id: string }).id]);
  });

  it('refuses an invitee who is not on the roster', async () => {
    expect((await refusal(startGame(event, owner, { game: 'liars-dice', difficulty: 'easy', invite: ['p_nobody'] }))).message).toBe(
      'One of those players cannot be invited.',
    );
  });

  it('keeps a room from anyone not in it', async () => {
    const room = await startGame(event, owner, { game: 'liars-dice', difficulty: 'easy' });
    expect((await refusal(roomView(sam, room.id))).status).toBe(403);
    expect((await refusal(roomStream(sam, room.id))).status).toBe(403);
    expect((await refusal(roomView(owner, 'g_missing'))).status).toBe(404);
  });

  it('streams the room as SSE frames', async () => {
    const room = await startGame(event, owner, { game: 'liars-dice', difficulty: 'easy' });
    const res = await roomStream(owner, room.id);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toMatch(/^data: \{"type":"room","room":\{"id":"g_/);
    await reader.cancel();
  });
});

describe('Manhunt is hosted by a parent', () => {
  const area = { lat: 51.5, lng: -0.12, radius: 600, minutes: 20 };

  it('refuses a member who is not a parent, before any room exists', async () => {
    h.grants.set(sam.email, ['games:self', 'family:circle']);
    expect(await refusal(startGame(event, sam, { game: 'manhunt', difficulty: 'easy', ...area }))).toEqual({
      status: 403,
      message: 'Only a parent can host Manhunt.',
    });
    expect((await lobbyFor(sam)).rooms).toEqual([]);
  });

  it('lets the owner and a parent host, with the circle where they stand', async () => {
    const mine = (await startGame(event, owner, { game: 'manhunt', difficulty: 'medium', ...area })) as unknown as {
      area: { lat: number; lng: number; radiusM: number };
      minutes: number;
    };
    expect(mine.area).toEqual({ lat: 51.5, lng: -0.12, radiusM: 600 });
    expect(mine.minutes).toBe(20);

    h.grants.set(kit.email, ['games:self', 'family:circle', 'family:admin']);
    const theirs = await startGame(event, kit, { game: 'manhunt', difficulty: 'hard', ...area });
    expect(theirs.phase).toBe('lobby');
  });

  it('checks the role again for the set-up actions, whoever holds the host seat', async () => {
    const room = await startGame(event, owner, { game: 'manhunt', difficulty: 'easy', invite: [playerId(sam.email)], ...area });
    await roomAct(sam, room.id, { action: 'join' });
    expect(await refusal(roomAct(sam, room.id, { action: 'area', lat: 51.6, lng: -0.1 }))).toEqual({
      status: 403,
      message: 'Only a parent can host Manhunt.',
    });
    // Not a set-up action: a member may still play.
    expect((await refusal(roomAct(sam, room.id, { action: 'catch' }))).status).toBe(403);
    // Another game's start is not a parent's business.
    const dice = await startGame(event, owner, { game: 'liars-dice', difficulty: 'easy', invite: [playerId(sam.email)] });
    await roomAct(sam, dice.id, { action: 'join' });
    expect((await refusal(roomAct(sam, dice.id, { action: 'start' }))).message).toBe('Only the host can start.');
  });

  it('hands the host seat to a parent who joined, never a child first in line', async () => {
    const ana = { email: 'ana@example.test', role: 'member' as const };
    for (const e of [kit.email, ana.email]) {
      h.devices.push({ ownerEmail: e, revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    }
    h.grants.set(kit.email, ['games:self', 'family:circle', 'family:admin']);
    h.grants.set(ana.email, ['games:self', 'family:circle']);
    _resetPlayers();
    const invite = [sam, kit, ana].map((c) => playerId(c.email));
    const room = await startGame(event, owner, { game: 'manhunt', difficulty: 'easy', invite, ...area });
    for (const c of [sam, kit, ana]) await roomAct(c, room.id, { action: 'join' });
    await roomAct(owner, room.id, { action: 'start' });
    await roomAct(owner, room.id, { action: 'leave' });
    const view = (await roomView(kit, room.id)) as unknown as { players: { id: string; isHost: boolean }[] };
    expect(view.players.find((p) => p.isHost)?.id).toBe(playerId(kit.email));
  });
});

// A stand-in for the Hometowns adapter (its own suite plays the real one):
// enough of a county to be created, joined, started solo, paused and set.
// It keeps what the registry handed it, so the tests can see what got through.
describe('a Hometowns county is set up by a parent', () => {
  interface County extends RoomBase {
    county: unknown;
    paused: boolean;
    parents: string[];
  }
  const HOMETOWNS = 'hometowns' as GameId;
  const ids = GAME_IDS as unknown as string[];
  const registered = (GAMES as Record<string, GameRules | undefined>)[HOMETOWNS];
  const listed = ids.includes(HOMETOWNS);
  const county: GameRules = {
    createRoom: ({ id, host, invite, difficulty, options, now }) =>
      ({
        id,
        game: HOMETOWNS,
        difficulty,
        hostId: host.id,
        phase: 'lobby',
        players: [
          { id: host.id, name: host.name, status: 'joined' as PlayerStatus },
          ...invite.map((p) => ({ id: p.id, name: p.name, status: 'invited' as PlayerStatus })),
        ],
        phaseEndsAt: null,
        pace: 'async',
        county: options?.county,
        paused: false,
        parents: [host.id],
        createdAt: now,
      }) as County,
    player: (id: string, name: string, status: PlayerStatus) => ({ id, name, status }),
    join(room, playerId) {
      const p = room.players.find((q) => q.id === playerId);
      if (p) p.status = 'joined';
    },
    decline() {},
    leave() {},
    start(room) {
      room.phase = 'running';
    },
    again() {},
    noteParent(room, playerId) {
      (room as County).parents.push(playerId);
      // Like the real county: being noted changes what the room stores and shows.
      return true;
    },
    advance: () => false,
    deadline: () => null,
    toWire: (r, _meId, now) => {
      const room = r as County;
      // A copy, as a real wire is: the join's answer shows the parent only if it was built after they were noted.
      return { id: room.id, phase: room.phase, serverNow: now, county: room.county, paused: room.paused, parents: [...room.parents] };
    },
    moves: {
      pause: (room, _playerId, body) => {
        if (room.phase !== 'running') throw new GameError(409, 'Not yet.');
        (room as County).paused = body.on === true;
      },
      settings: () => {},
      hello: () => {},
    },
    maxPlayers: 6,
    paces: ['async'],
    durable: { schema: 1 },
  };
  const options = { name: 'Kingsport County', rivalry: 'friendly', regionalHour: 18, mishaps: 'mild', devTickMs: null };
  type CountyWire = { id: string; phase: string; county: unknown; paused: boolean; parents: string[] };

  beforeAll(() => {
    if (!listed) ids.push(HOMETOWNS);
    (GAMES as Record<string, GameRules>)[HOMETOWNS] = county;
  });
  afterAll(() => {
    if (!listed) ids.splice(ids.indexOf(HOMETOWNS), 1);
    if (registered) (GAMES as Record<string, GameRules>)[HOMETOWNS] = registered;
    else delete (GAMES as Record<string, GameRules | undefined>)[HOMETOWNS];
  });

  it('refuses a member who is not a parent, naming the game, before any county exists', async () => {
    h.grants.set(sam.email, ['games:self', 'family:circle']);
    expect(await refusal(startGame(event, sam, { game: 'hometowns', difficulty: 'easy', pace: 'async', county: options }))).toEqual({
      status: 403,
      message: 'Only a parent can host Hometowns.',
    });
    expect((await lobbyFor(sam)).rooms).toEqual([]);
  });

  it('hands the county option to the game as it was sent', async () => {
    const room = (await startGame(event, owner, { game: 'hometowns', difficulty: 'easy', pace: 'async', county: options })) as unknown as CountyWire;
    expect(room.county).toEqual(options);
    // A solo county: the host starts it alone.
    expect(((await roomAct(owner, room.id, { action: 'start' })) as unknown as CountyWire).phase).toBe('running');
  });

  it('checks the role for starting, pausing and the settings, but not for playing', async () => {
    h.devices.push({ ownerEmail: kit.email, revokedAt: null, expiresAt: new Date(1_800_000_000_000) });
    h.grants.set(kit.email, ['games:self', 'family:circle', 'family:admin']);
    _resetPlayers();
    const invite = [sam, kit].map((c) => playerId(c.email));
    const room = (await startGame(event, owner, { game: 'hometowns', difficulty: 'easy', pace: 'async', invite, county: options })) as unknown as CountyWire;
    await roomAct(sam, room.id, { action: 'join' });
    const joined = (await roomAct(kit, room.id, { action: 'join' })) as unknown as CountyWire;
    // The parent who joined is noted, the child is not.
    expect(joined.parents).toEqual([playerId(owner.email), playerId(kit.email)]);

    const parentOnly = { status: 403, message: 'Only a parent can host Hometowns.' };
    expect(await refusal(roomAct(sam, room.id, { action: 'start' }))).toEqual(parentOnly);
    await roomAct(kit, room.id, { action: 'start' });
    expect(await refusal(roomAct(sam, room.id, { action: 'pause', on: true }))).toEqual(parentOnly);
    expect(await refusal(roomAct(sam, room.id, { action: 'settings', county: { rivalry: 'spirited' } }))).toEqual(parentOnly);
    expect(((await roomAct(kit, room.id, { action: 'pause', on: true })) as unknown as CountyWire).paused).toBe(true);
    await roomAct(kit, room.id, { action: 'settings', county: { rivalry: 'spirited' } });
    // An ordinary move is anyone's.
    await roomAct(sam, room.id, { action: 'hello' });
  });

  it("leaves Manhunt's set-up actions as they were: a county's are not Manhunt's", async () => {
    const area = { lat: 51.5, lng: -0.12, radius: 600, minutes: 20 };
    const room = await startGame(event, owner, { game: 'manhunt', difficulty: 'easy', invite: [playerId(sam.email)], ...area });
    await roomAct(sam, room.id, { action: 'join' });
    expect(await refusal(roomAct(sam, room.id, { action: 'pause', on: true }))).toEqual({ status: 400, message: 'Unknown action.' });
  });
});

describe('a parent closes a lobby left open', () => {
  it('lists every open lobby to a parent, and none to anybody else', async () => {
    const room = await startGame(event, owner, { game: 'tap-duel', difficulty: 'easy', invite: [playerId(sam.email)] });
    h.grants.set(kit.email, ['games:self', 'family:circle', 'family:admin']);
    const parentView = await lobbyFor(kit);
    expect(parentView.parent).toBe(true);
    expect(parentView.openLobbies?.map((l) => [l.id, l.hostName, l.invited, l.mine])).toEqual([[room.id, 'Owner', ['Sam'], false]]);

    h.grants.set(sam.email, ['games:self', 'family:circle']);
    const child = await lobbyFor(sam);
    expect(child.parent).toBe(false);
    expect(child.openLobbies).toBeUndefined();
  });

  it('closes somebody else’s lobby for everyone in it, and says who', async () => {
    const room = await startGame(event, owner, { game: 'tap-duel', difficulty: 'easy', invite: [playerId(sam.email)] });
    await roomAct(sam, room.id, { action: 'join' });
    h.grants.set(kit.email, ['games:self', 'family:circle', 'family:admin']);

    // Kit is not in the room: the answer only says it closed.
    expect(await roomAct(kit, room.id, { action: 'close' })).toMatchObject({ id: room.id, phase: 'closed' });
    const seen = (await roomView(sam, room.id)) as unknown as { phase: string; closedBy?: string };
    expect(seen.phase).toBe('closed');
    expect(seen.closedBy).toBe('Kit');
    expect((await lobbyFor(sam)).rooms).toEqual([]);
    expect((await lobbyFor(kit)).openLobbies).toEqual([]);
  });

  it('refuses a child, and a game already under way', async () => {
    const room = await startGame(event, owner, { game: 'tap-duel', difficulty: 'easy', invite: [playerId(sam.email)] });
    await roomAct(sam, room.id, { action: 'join' });
    h.grants.set(sam.email, ['games:self', 'family:circle']);
    expect(await refusal(roomAct(sam, room.id, { action: 'close' }))).toEqual({
      status: 403,
      message: 'Only a parent can close a lobby.',
    });

    await roomAct(owner, room.id, { action: 'start' });
    expect(await refusal(roomAct(owner, room.id, { action: 'close' }))).toEqual({
      status: 409,
      message: 'That game has already started.',
    });
  });

  it('404s a room that is not there', async () => {
    expect((await refusal(roomAct(owner, 'g_nope', { action: 'close' }))).status).toBe(404);
  });
});
