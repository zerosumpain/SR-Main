// What an account erasure does to a stored durable room (`erase-seat.ts`).
// Every game registered today has no `erasePlayer`, so its rooms are still
// deleted exactly as before; a game that opts in (here a county fixture
// holding a real Hometowns county) keeps the row with only that seat gone.

import { describe, expect, it, vi } from 'vitest';

vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));
vi.mock('$lib/db', () => ({ db: {} }));

import { GAMES, type GameId, type GameRules, type RoomBase } from './catalogue';
import { keepSeat, mentions, scrubMeta } from './erase-seat';
import { keepErasedSeats, keepingGames } from './erase-seat.server';
import type { StoredRoom } from './room-store';
import type { PlayerStatus } from './tap-duel';
import { createCounty, foundTown } from './hometowns/engine';
import type { CountyState } from './hometowns/engine/types';
import { eraseMayor } from './hometowns/erase-mayor';

const NOW = Date.UTC(2026, 9, 24, 9, 0);
const A = 'p_aaaaaaaaaaa1';
const B = 'p_bbbbbbbbbbb2';
const C = 'p_ccccccccccc3';
// The erased person's other address: a second hashed id that is in no room.
const B2 = 'p_bbbbbbbbbbb9';

// ── a county-shaped fixture game ────────────────────────────────────────────

interface County extends RoomBase {
  county: CountyState;
  notes: string[];
}

const COUNTY = 'county-fixture' as GameId;

/** The adapter's side of an erasure: archive the town, take the person off the table, pass the host on. */
function eraseCountySeat(r: RoomBase, playerId: string): RoomBase | null {
  const room = r as County;
  eraseMayor(room.county, { seat: playerId, ownerId: playerId });
  room.players = room.players.filter((p) => p.id !== playerId);
  room.notes = room.notes.filter((n) => !n.includes(playerId));
  if (room.hostId === playerId) {
    const next = room.players.find((p) => p.status === 'joined');
    if (!next) return null;
    room.hostId = next.id;
  }
  // A33: the last active mayor gone, the county closes.
  if (!room.players.some((p) => p.status === 'joined')) room.phase = 'closed';
  return room;
}

function countyRules(over: Partial<NonNullable<GameRules['durable']>> = {}): GameRules {
  return {
    ...(GAMES['tap-duel'] as GameRules),
    deadline: (room) => (room.phase === 'closed' ? null : NOW + 3_600_000),
    durable: {
      schema: 3,
      erasePlayer: (room, id) => eraseCountySeat(room, id),
      ...over,
    },
  };
}

function countyRoom(): County {
  const county = createCounty({
    seed: 11,
    params: 'v1',
    settings: {
      rivalry: 'friendly',
      mishaps: 'mild',
      youngestOrder: [],
      perSeat: {},
    },
    epoch: NOW,
    now: NOW,
  });
  const names = ['Harbourside', 'Bramblebury', 'Millbrook'];
  [A, B, C].forEach((id, site) =>
    foundTown(
      county,
      id,
      {
        site,
        name: names[site],
        nameAllowed: true,
        avatar: 'fox',
        flag: 0,
        ownerId: id,
      },
      NOW,
    ),
  );
  return {
    id: 'g_000000000001',
    game: COUNTY,
    difficulty: 'easy',
    hostId: B,
    phase: 'playing',
    players: [A, B, C].map((id, i) => ({
      id,
      name: `Mayor ${'ABC'[i]}`,
      status: 'joined' as PlayerStatus,
    })),
    phaseEndsAt: NOW + 3_600_000,
    county,
    notes: [`${B}:welcome`, 'county founded'],
  };
}

function row(room: RoomBase, over: Partial<StoredRoom> = {}): StoredRoom {
  return {
    id: room.id,
    game: room.game,
    stateSchema: 3,
    pace: 'async',
    phase: room.phase,
    hostId: room.hostId,
    playerIds: room.players.map((p) => p.id),
    state: JSON.parse(JSON.stringify(room)),
    meta: {
      optionKeys: ['pace'],
      round: 0,
      recorded: false,
      sawInvite: [A, B],
      pushed: [B, C],
      turnPushed: { key: `4:${B}`, ids: [B] },
      finishPushed: false,
    },
    version: 7,
    dueAt: null,
    updatedAt: new Date(NOW - 60_000),
    finishedAt: null,
    closedAt: null,
    ...over,
  };
}

// ── today's games ───────────────────────────────────────────────────────────

describe('games that do not opt in', () => {
  it('none of the registered games keeps a room through an erasure', () => {
    expect(keepingGames(GAMES)).toEqual([]);
  });

  it.each(Object.keys(GAMES))('%s: the room is left for the delete, as before', (id) => {
    const room = { ...countyRoom(), game: id as GameId };
    expect(keepSeat(row(room, { game: id }), [B], NOW, (GAMES as Record<string, GameRules>)[id])).toBeNull();
  });

  it('an unknown game (not registered here) is deleted too', () => {
    expect(keepSeat(row(countyRoom()), [B], NOW, undefined)).toBeNull();
  });

  it('with no game opting in, the transaction reads nothing', async () => {
    const tx = { select: vi.fn(), update: vi.fn() };
    expect(await keepErasedSeats(tx as never, [B], NOW, GAMES as Record<string, GameRules>)).toEqual([]);
    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
});

// ── a game that keeps its rooms ─────────────────────────────────────────────

describe('a county that keeps its room', () => {
  it('keeps the row with only that seat gone, and no trace of the person', () => {
    const before = row(countyRoom());
    const kept = keepSeat(before, [B, B2], NOW, countyRules())!;
    expect(kept).not.toBeNull();
    expect(kept.id).toBe(before.id);
    expect(kept.playerIds).toEqual([A, C]);
    expect(kept.hostId).toBe(A);
    expect(kept.version).toBe(before.version + 1);
    expect(kept.updatedAt.getTime()).toBe(NOW);
    expect(kept.phase).toBe('playing');
    expect(kept.closedAt).toBeNull();
    expect(kept.dueAt?.getTime()).toBe(NOW + 3_600_000);
    for (const id of [B, B2]) {
      expect(mentions(kept.state, id)).toBe(false);
      expect(mentions(kept.meta, id)).toBe(false);
    }
    expect(JSON.stringify(kept)).not.toContain('Bramblebury');
    expect(JSON.stringify(kept)).not.toContain('Mayor B');
    expect(kept.meta).toMatchObject({
      sawInvite: [A],
      pushed: [C],
      turnPushed: null,
      optionKeys: ['pace'],
    });
  });

  it('leaves every other mayor and their town exactly as they were', () => {
    const before = row(countyRoom());
    const kept = keepSeat(before, [B], NOW, countyRules())!;
    const was = before.state as unknown as County;
    const now = kept.state as unknown as County;
    expect(now.county.towns).toHaveLength(3);
    expect(now.county.towns[0]).toEqual(was.county.towns[0]);
    expect(now.county.towns[2]).toEqual(was.county.towns[2]);
    expect(now.county.towns[1].archived).toBe(true);
    expect(now.players.map((p) => p.name)).toEqual(['Mayor A', 'Mayor C']);
    // The stored row it came from is not touched (the hook works on a copy).
    expect(mentions(before.state, B)).toBe(true);
  });

  it('is the same whichever order a person’s ids are erased in', () => {
    const a = keepSeat(row(countyRoom()), [B, B2], NOW, countyRules())!;
    const b = keepSeat(row(countyRoom()), [B2, B], NOW, countyRules())!;
    expect(b).toEqual(a);
  });

  it('calls the game only for ids that are in the room', () => {
    const erasePlayer = vi.fn((room: RoomBase, id: string, _now: number) => eraseCountySeat(room, id));
    keepSeat(row(countyRoom()), [B2, B], NOW, countyRules({ erasePlayer }));
    expect(erasePlayer.mock.calls.map((c) => c[1])).toEqual([B]);
    expect(erasePlayer.mock.calls[0][2]).toBe(NOW);
  });

  it('closes the room when the last mayor goes, under the closed-room retention', () => {
    const room = countyRoom();
    room.players = room.players.map((p) => (p.id === B ? p : { ...p, status: 'left' as PlayerStatus }));
    const kept = keepSeat(row(room), [B], NOW, countyRules())!;
    // Nobody joined is left to host: the game refuses, so the delete has it.
    expect(kept).toBeNull();
    // Hosted by a mayor who has left (the host role stays theirs): B was the last one playing.
    const hosted = countyRoom();
    hosted.hostId = A;
    hosted.players = hosted.players.map((p) => (p.id === B ? p : { ...p, status: 'left' as PlayerStatus }));
    const closed = keepSeat(row(hosted), [B], NOW, countyRules())!;
    expect(closed.phase).toBe('closed');
    expect(closed.closedAt?.getTime()).toBe(NOW);
    expect(closed.dueAt).toBeNull();
  });

  it('keeps the room when somebody still in it has the same name', () => {
    const room = countyRoom();
    room.players = room.players.map((p) => (p.id === C ? { ...p, name: 'Mayor B' } : p));
    const kept = keepSeat(row(room), [B], NOW, countyRules())!;
    expect(kept.playerIds).toEqual([A, C]);
  });

  it('keeps a host who was not the one erased, even one who has stepped away', () => {
    const room = countyRoom();
    room.hostId = A;
    room.players = room.players.map((p) => (p.id === A ? { ...p, status: 'left' as PlayerStatus } : p));
    expect(keepSeat(row(room), [B], NOW, countyRules())?.hostId).toBe(A);
  });

  it('revives a row written under an older schema before erasing', () => {
    const revive = vi.fn((state: Record<string, unknown>) => ({ ...state, notes: ['revived'] }) as unknown as RoomBase);
    const kept = keepSeat(row(countyRoom(), { stateSchema: 2 }), [B], NOW, countyRules({ revive }))!;
    expect(revive).toHaveBeenCalledOnce();
    expect(kept.stateSchema).toBe(3);
    expect((kept.state as unknown as County).notes).toEqual(['revived']);
  });
});

describe('falling back to the delete', () => {
  const cases: [string, Partial<NonNullable<GameRules['durable']>>][] = [
    ['the game refuses (null)', { erasePlayer: () => null }],
    [
      'the game throws',
      {
        erasePlayer: () => {
          throw new Error('cannot');
        },
      },
    ],
    [
      'the game leaves the id somewhere',
      {
        erasePlayer: (room, id) => ({ ...eraseCountySeat(room, id)!, notes: [`x${id}y`] }) as RoomBase,
      },
    ],
    ['the game keeps the erased host', { erasePlayer: (room) => room }],
    ['the game empties the table', { erasePlayer: (room) => ({ ...room, players: [] }) }],
    [
      'the game leaves their name as a value',
      {
        erasePlayer: (room, id) => ({ ...eraseCountySeat(room, id)!, notes: ['Mayor B'] }) as RoomBase,
      },
    ],
    [
      'the game leaves only placeholders',
      {
        erasePlayer: (room, id) => ({
          ...eraseCountySeat(room, id)!,
          hostId: 'former-1',
          players: [
            {
              id: 'former-1',
              name: 'Old Town 1',
              status: 'joined' as PlayerStatus,
            },
          ],
        }),
      },
    ],
    [
      'the game hands the host to a placeholder',
      {
        erasePlayer: (room, id) => {
          const r = eraseCountySeat(room, id)!;
          return {
            ...r,
            hostId: 'former-2',
            players: [
              ...r.players,
              {
                id: 'former-2',
                name: 'Old Town 2',
                status: 'joined' as PlayerStatus,
              },
            ],
          };
        },
      },
    ],
    [
      'the game hands the host to nobody in the room',
      {
        erasePlayer: (room, id) => ({
          ...eraseCountySeat(room, id)!,
          hostId: 'p_zzzzzzzzzzzz',
        }),
      },
    ],
    [
      'the game hands the host to somebody only invited',
      {
        erasePlayer: (room, id) => {
          const r = eraseCountySeat(room, id)!;
          return {
            ...r,
            hostId: C,
            players: r.players.map((p) => (p.id === C ? { ...p, status: 'invited' as PlayerStatus } : p)),
          };
        },
      },
    ],
    ['the row cannot be read (old schema, no revive)', {}],
  ];
  it.each(cases)('%s: the row is deleted as before', (label, over) => {
    const old = label.startsWith('the row cannot');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(keepSeat(row(countyRoom(), old ? { stateSchema: 1 } : {}), [B], NOW, countyRules(over))).toBeNull();
    // A log line never carries the person's id.
    for (const call of spy.mock.calls) expect(mentions(call, B)).toBe(false);
    spy.mockRestore();
  });
});

describe('scrubMeta', () => {
  it('takes the ids off every list and drops a push key that names them', () => {
    const meta = scrubMeta(
      {
        optionKeys: [],
        round: 2,
        recorded: true,
        sawInvite: [A, B],
        pushed: [B],
        turnPushed: { key: `1:${A}`, ids: [A, B] },
        finishPushed: true,
      },
      [B],
    );
    expect(meta).toEqual({
      optionKeys: [],
      round: 2,
      recorded: true,
      sawInvite: [A],
      pushed: [],
      turnPushed: { key: `1:${A}`, ids: [A] },
      finishPushed: true,
    });
  });

  it('fills a missing or partial meta with the registry defaults', () => {
    expect(scrubMeta(null, [B])).toEqual({
      optionKeys: [],
      round: 0,
      recorded: false,
      sawInvite: [],
      pushed: [],
      turnPushed: null,
      finishPushed: false,
    });
  });
});

describe('keepErasedSeats in the transaction', () => {
  /** Just enough of a Drizzle transaction: the locked select returns `rows`; each update is recorded. */
  function fakeTx(rows: StoredRoom[]) {
    const updates: Record<string, unknown>[] = [];
    const locks: string[] = [];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async (mode: string) => {
              locks.push(mode);
              return rows.map((r) => ({ ...r, createdAt: new Date(NOW) }));
            },
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              updates.push(values);
              return [{ id: 'ok' }];
            },
          }),
        }),
      }),
    };
    return { tx, updates, locks };
  }

  it('rewrites the rooms it can keep under a row lock and names them; leaves the rest for the delete', async () => {
    const keep = row(countyRoom());
    const refuse = row({ ...countyRoom(), id: 'g_000000000002' });
    const games = {
      [COUNTY]: countyRules(),
      refusing: countyRules({ erasePlayer: () => null }),
    } as Record<string, GameRules>;
    refuse.game = 'refusing';
    const { tx, updates, locks } = fakeTx([keep, refuse]);
    const kept = await keepErasedSeats(tx as never, [B], NOW, games);
    expect(kept).toEqual([keep.id]);
    expect(locks).toEqual(['update']);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      playerIds: [A, C],
      hostId: A,
      version: keep.version + 1,
    });
    expect(mentions(updates[0], B)).toBe(false);
  });
});
