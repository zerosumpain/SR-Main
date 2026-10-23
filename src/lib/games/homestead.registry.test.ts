import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./quiz-night.server', () => ({ writeQuiz: async () => {} }));
import { _resetRooms, _setRecorder, act, createGame, invitesFor, roomFor, roomsFor, subscribe } from './rooms.server';
import { GAMES } from './catalogue';
import { COUNTDOWN_MS, LIVE_MS, RESOURCES, type WireRoom } from './homestead';
import type { RoundRow } from './results';

const john = { id: 'p_john', name: 'John' };
const sam = { id: 'p_sam', name: 'Sam' };
const kim = { id: 'p_kim', name: 'Kim' };
const recorded: RoundRow[][] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
  recorded.length = 0;
  _setRecorder(async (rows) => {
    recorded.push(rows);
    return {};
  });
});
afterEach(() => {
  _resetRooms();
  _setRecorder(null);
  vi.useRealTimers();
});

const view = (id: string, who: string) => roomFor(id, who) as unknown as WireRoom;

/** Bank trades made this turn, so the bot never trades in circles. */
const trades = { turn: -1, count: 0 };

/** Who the room waits on now, and one sensible action for them, read off their own wire. */
function next(id: string, ids: string[]): { who: string; action: string; body: Record<string, unknown> } | null {
  const any = view(id, ids[0]);
  if (any.phase !== 'playing') return null;
  if (any.step === 'discard') {
    const who = Object.keys(any.discardOwed)[0];
    const w = view(id, who);
    const h = { ...w.me!.hand };
    const cards: Record<string, number> = {};
    for (let i = 0; i < w.discardOwed[who]; i++) {
      const r = [...RESOURCES].sort((a, b) => h[b] - h[a])[0];
      h[r] -= 1;
      cards[r] = (cards[r] ?? 0) + 1;
    }
    return { who, action: 'discard', body: { cards } };
  }
  const who = any.activeId!;
  const w = view(id, who);
  const L = w.legal;
  const pipsAt = (v: string) =>
    w.board!.hexes.filter((h) => {
      const [q, r] = v.split(',').map(Number);
      const d = v.endsWith('N') ? 'N' : 'S';
      const touching = d === 'N' ? [[q, r], [q, r - 1], [q + 1, r - 1]] : [[q, r], [q, r + 1], [q - 1, r + 1]];
      return touching.some(([a, b]) => h.q === a && h.r === b);
    }).reduce((n, h) => n + h.pips, 0);
  const best = (vs: string[]) => [...vs].sort((a, b) => pipsAt(b) - pipsAt(a))[0];
  switch (w.step) {
    case 'setup':
      return L.cottage.length
        ? { who, action: 'build', body: { piece: 'cottage', at: best(L.cottage) } }
        : { who, action: 'build', body: { piece: 'road', at: L.road[0] } };
    case 'roll':
      return { who, action: 'roll', body: {} };
    case 'fox': {
      const hex = L.fox.find((h) => L.victims[h]) ?? L.fox[0];
      return { who, action: 'fox', body: { hex, victim: L.victims[hex]?.[0] } };
    }
    case 'roads':
      return L.road.length ? { who, action: 'build', body: { piece: 'road', at: L.road[0] } } : { who, action: 'skip', body: {} };
    case 'main': {
      if (L.town.length) return { who, action: 'build', body: { piece: 'town', at: best(L.town) } };
      if (L.cottage.length) return { who, action: 'build', body: { piece: 'cottage', at: best(L.cottage) } };
      if (L.canBuy) return { who, action: 'buy', body: {} };
      // Roads while there are pieces to spare: they open new cottage spots.
      const myRoads = w.roads.filter((r) => r.owner === who).length;
      if (L.road.length && myRoads < 11) return { who, action: 'build', body: { piece: 'road', at: L.road[0] } };
      const me = w.me!;
      if (trades.turn !== w.turn) Object.assign(trades, { turn: w.turn, count: 0 });
      if (trades.count++ >= 3) return { who, action: 'end', body: {} };
      for (const cost of [w.costs.town, w.costs.cottage, w.costs.card] as Record<string, number>[]) {
        const get = RESOURCES.find((r) => me.hand[r] < (cost[r] ?? 0) && w.bank[r] > 0);
        const give = get && RESOURCES.find((r) => r !== get && me.hand[r] - (cost[r] ?? 0) >= me.rates[r]);
        if (get && give) return { who, action: 'bank', body: { give, get } };
      }
      return { who, action: 'end', body: {} };
    }
  }
  return null;
}

describe('Homestead through the registry', () => {
  it('is in the catalogue as a durable game with both paces', () => {
    expect(GAMES.homestead.durable).toEqual({ schema: 1 });
    expect(GAMES.homestead.paces).toEqual(['live', 'async']);
    expect(typeof GAMES.homestead.waitingOn).toBe('function');
    expect(typeof GAMES.homestead.resume).toBe('function');
  });

  it('invites, starts, sets up on its own clock when nobody moves, and plays to a recorded win by phone moves', () => {
    const { id } = createGame({ game: 'homestead', host: john, invite: [sam, kim], difficulty: 'medium', options: { seed: 11, pace: 'live', deadlineHours: 24, island: 'auto' } });
    expect(invitesFor('p_sam')).toEqual([expect.objectContaining({ roomId: id, game: 'homestead', about: 'first to 10 points · play now' })]);
    act(id, 'p_sam', 'join');
    expect(() => act(id, 'p_john', 'start')).toThrow(/needs three/);
    act(id, 'p_kim', 'join');
    act(id, 'p_john', 'start');
    expect(roomsFor('p_kim')).toEqual([expect.objectContaining({ id, game: 'homestead', phase: 'countdown' })]);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const first = view(id, 'p_john');
    expect(first.phase).toBe('playing');
    expect(first.step).toBe('setup');
    expect(first.island).toBe('standard');
    expect(first.board!.hexes).toHaveLength(19);
    // Registry adds sawInvite to each player row.
    expect(first.players.every((p) => 'sawInvite' in p)).toBe(true);

    // The first placer does nothing: the clock places a cottage and road for them.
    const placer = first.activeId!;
    vi.advanceTimersByTime(LIVE_MS.medium.setup);
    const after = view(id, placer);
    expect(after.buildings.filter((b) => b.owner === placer)).toHaveLength(1);
    expect(after.roads.filter((r) => r.owner === placer)).toHaveLength(1);
    expect(after.log.some((e) => e.auto)).toBe(true);

    // A stream sees changes.
    const frames: WireRoom[] = [];
    const off = subscribe(id, 'p_sam', (room) => frames.push(room as unknown as WireRoom), () => {});

    // Unknown actions and refusals come back as errors and change nothing.
    expect(() => act(id, 'p_john', 'teleport')).toThrow(/Unknown action/);
    const ids = ['p_john', 'p_sam', 'p_kim'];
    let moves = 0;
    for (let i = 0; i < 20_000; i++) {
      const n = next(id, ids);
      if (!n) break;
      // A player who is not the one asked is refused.
      if (i % 97 === 0 && n.action === 'roll') {
        const other = ids.find((x) => x !== n.who)!;
        expect(() => act(id, other, 'roll')).toThrow(/not your turn/);
      }
      act(id, n.who, n.action, n.body);
      moves++;
      // The bot never lets a live timer run out: no fake time passes between moves.
    }
    off();
    const done = view(id, 'p_john');
    expect(done.phase).toBe('finished');
    expect(done.result!.reason).toBe('points');
    expect(moves).toBeGreaterThan(50);
    expect(frames.length).toBeGreaterThan(moves / 2);
    // Hidden information stays hidden through the registry too.
    const samView = JSON.stringify(view(id, 'p_sam'));
    expect(samView).not.toMatch(/"rng"|"deck"|boughtTurn/);

    expect(recorded).toHaveLength(1);
    const rows = recorded[0];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ game: 'homestead', won: true, rank: 1, players: 3, difficulty: 'medium', playerId: done.winnerIds[0] });
    expect(rows[0].score).toBeGreaterThanOrEqual(10);
    expect(rows[0].options).toMatchObject({ island: 'standard', pace: 'live', deadlineHours: 24, label: 'Standard island · first to 10 points · play now' });
    expect(() => act(id, 'p_john', 'roll')).toThrow(/over/);
  });
});
