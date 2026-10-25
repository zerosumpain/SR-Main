// The two framework opt-ins a long-running family game needs (spec §10.12
// F1, F2), through the registry with a test-only game ("towns": a running
// room of up to three seats that takes late joiners and survives an
// erasure) and the in-memory store. Every game registered today opts into
// neither, and the last cases pin that they still behave as before.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));

import {
  _resetRooms,
  _setRecorder,
  _setRoomStore,
  _setTurnPusher,
  act,
  createGame,
  dropRooms,
  flush,
  inviteTo,
  invitesFor,
  reloadRooms,
  roomFor,
  roomsFor,
  subscribe,
  unpushedInvites,
} from './rooms.server';
import { GAMES, type GameId, type GameRules, type RoomBase } from './catalogue';
import { keepSeat, mentions } from './erase-seat';
import { memoryRoomStore } from './room-store';
import { GameError, type PlayerStatus } from './tap-duel';

// ── the fixture game ────────────────────────────────────────────────────────

const DAY = 86_400_000;
const LOBBY_MS = 3 * 60_000;
const SITES = 3;

interface Towns extends RoomBase {
  /** Who holds each site, in founding order; an erased seat is 'former-<n>'. */
  sites: string[];
  log: string[];
}

const find = (room: RoomBase, id: string) => {
  const p = room.players.find((q) => q.id === id);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
};

function townsRules(over: Partial<GameRules> = {}): GameRules {
  return {
    createRoom({ id, host, invite, difficulty, now }) {
      const room: Towns = {
        id,
        game: 'towns' as GameId,
        difficulty,
        hostId: host.id,
        phase: 'lobby',
        players: [
          { id: host.id, name: host.name, status: 'joined' as PlayerStatus },
          ...invite.map((p) => ({ id: p.id, name: p.name, status: 'invited' as PlayerStatus })),
        ],
        phaseEndsAt: now + LOBBY_MS,
        pace: 'async',
        sites: [],
        log: [],
      };
      return room;
    },
    player: (id: string, name: string, status: PlayerStatus) => ({ id, name, status }),
    join(r, playerId) {
      const room = r as Towns;
      find(room, playerId).status = 'joined';
      // A late joiner takes the next free site the moment they say yes.
      if (room.phase === 'running' && !room.sites.includes(playerId)) room.sites.push(playerId);
    },
    decline: (room, playerId) => void (find(room, playerId).status = 'declined'),
    leave: (room, playerId) => void (find(room, playerId).status = 'left'),
    start(r, _p, now) {
      const room = r as Towns;
      room.phase = 'running';
      room.sites = room.players.filter((p) => p.status === 'joined').map((p) => p.id);
      room.phaseEndsAt = now + DAY;
    },
    again() {},
    advance(r, now) {
      const room = r as Towns;
      if (room.phaseEndsAt === null || now < room.phaseEndsAt) return false;
      if (room.phase === 'lobby') {
        room.phase = 'closed';
        room.phaseEndsAt = null;
      } else room.phaseEndsAt += DAY;
      return true;
    },
    deadline: (room) => (room.phase === 'closed' ? null : room.phaseEndsAt),
    toWire(r, meId, now) {
      const room = r as Towns;
      return { id: room.id, phase: room.phase, serverNow: now, meId, players: room.players, sites: room.sites, log: room.log };
    },
    moves: {
      note: (r, playerId, body) => {
        const room = r as Towns;
        if (find(room, playerId).status !== 'joined') throw new GameError(409, 'Join first.');
        room.log.push(`${playerId}:${String(body.text ?? '')}`);
      },
    },
    durable: {
      schema: 1,
      erasePlayer(r, playerId) {
        const room = r as Towns;
        const site = room.sites.indexOf(playerId);
        if (site >= 0) room.sites[site] = `former-${site + 1}`;
        room.players = room.players.filter((p) => p.id !== playerId);
        room.log = room.log.filter((l) => !l.startsWith(`${playerId}:`));
        if (room.hostId === playerId) room.hostId = room.players.find((p) => p.status === 'joined')?.id ?? '';
        return room.hostId ? room : null;
      },
    },
    paces: ['async'],
    joinRunning: true,
    seat(r, player) {
      const room = r as Towns;
      // Sites are never freed (A33): a county that has founded all three is full.
      const pending = room.players.filter((p) => p.status === 'invited' && !room.sites.includes(p.id)).length;
      if (room.sites.length + pending >= SITES) throw new GameError(409, 'The county is full.');
      const known = room.players.find((p) => p.id === player.id);
      if (known) known.status = 'invited';
      else room.players.push({ id: player.id, name: player.name, status: 'invited' });
    },
    ...over,
  };
}

const TOWNS = 'towns' as GameId;
const STRICT = 'towns-strict' as GameId;
const host = { id: 'p_host00000001', name: 'Host' };
const bee = { id: 'p_bee000000002', name: 'Mayor B' };
const cee = { id: 'p_cee000000003', name: 'Mayor C' };
const dee = { id: 'p_dee000000004', name: 'Mayor D' };

type Wire = Record<string, any>;

let store: ReturnType<typeof memoryRoomStore>;

beforeAll(() => {
  (GAMES as Record<string, GameRules>)[TOWNS] = townsRules();
  // The same game without the opt-ins: what every game registered today is.
  (GAMES as Record<string, GameRules>)[STRICT] = townsRules({ joinRunning: undefined, seat: undefined, durable: { schema: 1 } });
});
afterAll(() => {
  delete (GAMES as Record<string, GameRules>)[TOWNS];
  delete (GAMES as Record<string, GameRules>)[STRICT];
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  store = memoryRoomStore();
  _setRoomStore(store);
  _setRecorder(async () => ({}));
  _setTurnPusher(async (_kind, _roomId, ids) => ids);
});
afterEach(() => {
  _resetRooms();
  _setRoomStore(null);
  _setRecorder(null);
  _setTurnPusher(null);
  vi.useRealTimers();
});

/** A running county: the host and B founded, C invited before the start and never answered. */
async function running(game: GameId = TOWNS) {
  const { id } = createGame({ game, host, invite: [bee, cee], difficulty: 'easy', options: { pace: 'async' } }) as unknown as Wire;
  act(id, bee.id, 'join');
  act(id, host.id, 'start');
  await flush(id);
  return id;
}

// ── F2: late joiners ────────────────────────────────────────────────────────

describe('inviting into a running room (joinRunning)', () => {
  it('takes the invite, leaves the game clock alone and lists it for the invitee without an expiry', async () => {
    const id = await running();
    // C still holds the last place with a pre-start invite; free it first.
    act(id, cee.id, 'decline');
    await flush(id);
    const clock = (store.rows.get(id)!.state as unknown as Towns).phaseEndsAt;
    const room = inviteTo(id, host.id, [dee]) as unknown as Wire;
    expect(room.players.map((p: Wire) => [p.id, p.status])).toContainEqual([dee.id, 'invited']);
    await flush(id);
    expect((store.rows.get(id)!.state as unknown as Towns).phaseEndsAt).toBe(clock);
    const [invite] = invitesFor(dee.id);
    expect(invite).toMatchObject({ roomId: id, game: TOWNS, hostName: 'Host', expiresAt: null });
    expect(unpushedInvites(id)).toMatchObject({ invitees: [dee.id], expiresAt: null });
  });

  it("lets the game seat the late joiner on their join, and lists the room as theirs", async () => {
    const id = await running();
    act(id, cee.id, 'decline');
    inviteTo(id, host.id, [dee]);
    const after = act(id, dee.id, 'join') as unknown as Wire;
    expect(after.sites).toEqual([host.id, bee.id, dee.id]);
    expect(roomsFor(dee.id).map((r) => r.id)).toEqual([id]);
    expect(invitesFor(dee.id)).toEqual([]);
  });

  it("the game's seat decides: a full county refuses, all or nothing", async () => {
    const id = await running();
    // Host and B hold sites, C's invite is open: one place left, two asked for.
    const before = JSON.stringify(roomFor(id, host.id));
    expect(() => inviteTo(id, host.id, [dee, { id: 'p_eee000000005', name: 'Mayor E' }])).toThrow(
      expect.objectContaining({ status: 409, message: 'The county is full.' }),
    );
    expect(JSON.stringify(roomFor(id, host.id))).toBe(before);
    expect(invitesFor(dee.id)).toEqual([]);
  });

  it('asks the game again for somebody who left, rather than re-marking their old row', async () => {
    const seat = vi.fn(townsRules().seat!);
    (GAMES as Record<string, GameRules>)[TOWNS] = townsRules({ seat });
    try {
      const id = await running();
      act(id, cee.id, 'decline');
      inviteTo(id, host.id, [cee]);
      expect(seat).toHaveBeenCalledWith(expect.objectContaining({ id }), cee, expect.any(Number));
      expect((roomFor(id, cee.id) as Wire).players.find((p: Wire) => p.id === cee.id).status).toBe('invited');
    } finally {
      (GAMES as Record<string, GameRules>)[TOWNS] = townsRules();
    }
  });

  it('in its lobby the game invites as every game does: no seat call, the lobby held open', () => {
    const seat = vi.fn();
    (GAMES as Record<string, GameRules>)[TOWNS] = townsRules({ seat });
    try {
      const { id, phaseEndsAt } = createGame({ game: TOWNS, host, invite: [], difficulty: 'easy' }) as unknown as Wire;
      vi.advanceTimersByTime(LOBBY_MS - 1_000);
      inviteTo(id, host.id, [dee]);
      expect(seat).not.toHaveBeenCalled();
      const [invite] = invitesFor(dee.id);
      expect(invite.expiresAt).toBeGreaterThan(phaseEndsAt ?? 0);
      expect(invite.expiresAt).toBe(Date.now() + 2 * 60_000);
    } finally {
      (GAMES as Record<string, GameRules>)[TOWNS] = townsRules();
    }
  });

  it('never into a room that has finished or closed', async () => {
    const { id } = createGame({ game: TOWNS, host, invite: [], difficulty: 'easy' }) as unknown as Wire;
    vi.advanceTimersByTime(LOBBY_MS + 1);
    expect(() => inviteTo(id, host.id, [dee])).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe('a game without joinRunning (every game registered today)', () => {
  it('no registered game opts in to late invites or seating', () => {
    for (const [id, rules] of Object.entries(GAMES)) {
      if (id === TOWNS || id === STRICT) continue;
      // Hometowns keeps a county through an erasure (erase-player.test.ts), but seats nobody late.
      const erases = id === 'hometowns' ? undefined : rules.durable?.erasePlayer;
      expect([id, rules.joinRunning, rules.seat, erases]).toEqual([id, undefined, undefined, undefined]);
    }
    expect(typeof GAMES.hometowns.durable?.erasePlayer).toBe('function');
  });

  it('still refuses an invite once started, and lists no invite into its running room', async () => {
    const id = await running(STRICT);
    expect(() => inviteTo(id, host.id, [dee])).toThrow(expect.objectContaining({ status: 409, message: 'That game has already started.' }));
    // C was invited before the start and never answered: the lobby's invite list drops it, as before.
    expect(invitesFor(cee.id)).toEqual([]);
    expect(unpushedInvites(id)).toBeNull();
  });

  it('a quick game (tap duel) is unchanged too', () => {
    const { id } = createGame({ game: 'tap-duel', host, invite: [bee], difficulty: 'easy' }) as unknown as Wire;
    act(id, bee.id, 'join');
    act(id, host.id, 'start');
    expect(() => inviteTo(id, host.id, [dee])).toThrow(expect.objectContaining({ status: 409, message: 'That game has already started.' }));
  });
});

// ── F1: the room in memory after an erasure kept it ─────────────────────────

/** What the erasure's transaction does to the stored row (`keepErasedSeats`), on the memory store. */
function eraseInStore(id: string, who: string[]) {
  const row = store.rows.get(id)!;
  const kept = keepSeat(structuredClone(row), who, Date.now(), GAMES[row.game as GameId]);
  expect(kept).not.toBeNull();
  store.rows.set(id, kept!);
  return kept!;
}

describe('reloadRooms after an erasure kept the room', () => {
  it("ends only the erased player's stream and re-sends everyone else the room without them", async () => {
    const id = await running();
    act(id, bee.id, 'note', { text: 'hello' });
    await flush(id);
    const bGone = vi.fn();
    const hostFrames: Wire[] = [];
    const offB = subscribe(id, bee.id, () => {}, bGone);
    const offHost = subscribe(id, host.id, (r) => hostFrames.push(r as unknown as Wire), () => {
      throw new Error('the host was told the room is gone');
    });
    eraseInStore(id, [bee.id]);
    await reloadRooms([id], [bee.id]);
    expect(bGone).toHaveBeenCalledOnce();
    const last = hostFrames.at(-1)!;
    expect(mentions(last, bee.id)).toBe(false);
    expect(last.sites).toEqual([host.id, 'former-2']);
    expect(() => roomFor(id, bee.id)).toThrow(expect.objectContaining({ status: 403 }));
    expect(roomsFor(bee.id)).toEqual([]);
    offB();
    offHost();
  });

  it('plays on and saves normally afterwards: no write race, no lost room', async () => {
    const id = await running();
    const kept = eraseInStore(id, [bee.id]);
    await reloadRooms([id], [bee.id]);
    act(id, host.id, 'note', { text: 'still here' });
    await flush(id);
    const row = store.rows.get(id)!;
    expect(row.version).toBe(kept.version + 1);
    expect(row.playerIds).toEqual([host.id, cee.id]);
    expect(mentions(row, bee.id)).toBe(false);
  });

  it('drops a change still being written that held the seat, and keeps the stored erasure', async () => {
    const id = await running();
    // A move by B whose write is in flight when the erasure commits.
    act(id, bee.id, 'note', { text: 'last words' });
    const kept = eraseInStore(id, [bee.id]);
    await reloadRooms([id], [bee.id]);
    await flush(id);
    expect(mentions(roomFor(id, host.id), bee.id)).toBe(false);
    expect(store.rows.get(id)!.version).toBeGreaterThanOrEqual(kept.version);
    expect(mentions(store.rows.get(id)!, bee.id)).toBe(false);
  });

  it('ignores rooms not in memory, and dropRooms still closes deleted ones', async () => {
    await expect(reloadRooms(['g_000000000000'], [bee.id])).resolves.toBeUndefined();
    const id = await running(STRICT);
    const gone = vi.fn();
    subscribe(id, bee.id, () => {}, gone);
    dropRooms([id]);
    expect(gone).toHaveBeenCalledOnce();
    expect(() => roomFor(id, host.id)).toThrow(expect.objectContaining({ status: 404 }));
  });
});
