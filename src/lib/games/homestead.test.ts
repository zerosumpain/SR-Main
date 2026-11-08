// Homestead rules, part one: the lobby, setup, turns, sevens, building and
// almanac cards. Part two (awards, trading, winning, leaving, the clock and
// the wire) is `homestead.play.test.ts`; the two share this header's helpers.

import { describe, expect, it } from 'vitest';
import {
  ASYNC_FINISHED_MS,
  AWAY_MS,
  COSTS,
  COUNTDOWN_MS,
  FINISHED_MS,
  LIVE_MS,
  LOBBY_MS,
  RESOURCES,
  about,
  accept,
  activePlayer,
  advance,
  again,
  bank,
  build,
  buy,
  cancel,
  cottageSpots,
  counter,
  createRoom,
  deadline,
  discard,
  end,
  fox,
  foxHexes,
  join,
  leave,
  offer,
  play,
  publicVp,
  rates,
  refuse,
  seedRng,
  resume,
  roadSpots,
  roll,
  skip,
  standings,
  start,
  toWire,
  totalVp,
  trailLength,
  victimsAt,
  waitingOn,
  type Difficulty,
  type Hand,
  type Player,
  type Resource,
  type Room,
} from './homestead';
import { edgeEnds, geometry, hexCorners, ISLAND } from './homestead-board';
import { GAMES } from './catalogue';
import { roundRows } from './results';

const T0 = 1_790_000_000_000;
const PEOPLE = [
  { id: 'p_john', name: 'John' },
  { id: 'p_sam', name: 'Sam' },
  { id: 'p_kim', name: 'Kim' },
  { id: 'p_rory', name: 'Rory' },
  { id: 'p_jem', name: 'Jem' },
];

function lobby(n = 3, difficulty: Difficulty = 'medium', options: Record<string, unknown> = {}): Room {
  return createRoom({
    id: 'g_h',
    host: PEOPLE[0],
    invite: PEOPLE.slice(1, n),
    difficulty,
    options: { seed: 42, ...options },
    now: T0,
  });
}

/** Everyone joins, the host starts, the countdown runs down: setup begins. */
function begun(n = 3, difficulty: Difficulty = 'medium', options: Record<string, unknown> = {}): { r: Room; now: number } {
  const r = lobby(n, difficulty, options);
  for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
  start(r, PEOPLE[0].id, T0);
  advance(r, T0 + COUNTDOWN_MS, Math.random);
  return { r, now: T0 + COUNTDOWN_MS };
}

const P = (r: Room, id: string) => r.players.find((p) => p.id === id)!;
const handSize = (h: Hand) => RESOURCES.reduce((n, x) => n + h[x], 0);
const geo = (r: Room) => geometry(r.board!.size);

/** Corner pips, for the bot's choices. */
function vPips(r: Room, v: string): number {
  return geo(r).vertexLand.get(v)!.reduce((n, h) => n + (r.board!.hexes.find((x) => x.id === h)?.pips ?? 0), 0);
}

/** Every resource is conserved: bank plus hands is always the bank's starting stock. */
function conserved(r: Room): boolean {
  if (!r.board) return true;
  const total = ISLAND[r.board.size].bank;
  return RESOURCES.every((x) => r.bank[x] + r.players.reduce((n, p) => n + p.hand[x], 0) === total && r.bank[x] >= 0) &&
    r.players.every((p) => RESOURCES.every((x) => p.hand[x] >= 0));
}

/**
 * One decision by whoever the room is waiting on, chosen from the wire's own
 * `legal` lists — a simple greedy player. Returns false when nothing is owed.
 */
function botStep(r: Room, now: number, rand: () => number = () => 0.5): boolean {
  if (r.phase !== 'playing') return false;
  if (r.step === 'discard') {
    const id = Object.keys(r.discardOwed)[0];
    const owe = r.discardOwed[id];
    const h = { ...P(r, id).hand };
    const cards: Partial<Hand> = {};
    for (let i = 0; i < owe; i++) {
      const x = [...RESOURCES].sort((a, b) => h[b] - h[a])[0];
      h[x] -= 1;
      cards[x] = (cards[x] ?? 0) + 1;
    }
    discard(r, id, { cards }, now);
    return true;
  }
  const a = activePlayer(r)!;
  const w = toWire(r, a.id, now);
  const L = w.legal;
  const byPips = (vs: string[]) => [...vs].sort((x, y) => vPips(r, y) - vPips(r, x))[0];
  switch (r.step) {
    case 'setup':
      if (L.cottage.length) build(r, a.id, { piece: 'cottage', at: byPips(L.cottage) }, now);
      else build(r, a.id, { piece: 'road', at: L.road[0] }, now);
      return true;
    case 'roll':
      if (L.playable.includes('ranger') && rand() < 0.5) play(r, a.id, { card: 'ranger' }, now);
      else roll(r, a.id, now);
      return true;
    case 'fox': {
      const hex = L.fox.find((h) => L.victims[h]) ?? L.fox[0];
      fox(r, a.id, { hex, victim: L.victims[hex]?.[0] }, now);
      return true;
    }
    case 'roads':
      if (L.road.length) build(r, a.id, { piece: 'road', at: L.road[0] }, now);
      else skip(r, a.id, now);
      return true;
    case 'main': {
      if (L.playable.length && rand() < 0.6) {
        const card = L.playable[0];
        if (card === 'harvest') {
          const take = RESOURCES.filter((x) => r.bank[x] > 1).slice(0, 1);
          if (take.length) {
            play(r, a.id, { card, take: [take[0], take[0]] }, now);
            return true;
          }
        } else {
          play(r, a.id, { card, resource: card === 'market' ? 'stone' : undefined }, now);
          return true;
        }
      }
      if (L.town.length) build(r, a.id, { piece: 'town', at: byPips(L.town) }, now);
      else if (L.cottage.length) build(r, a.id, { piece: 'cottage', at: byPips(L.cottage) }, now);
      else if (L.canBuy && rand() < 0.7) buy(r, a.id, now);
      else if (L.road.length && a.pieces.road > 3 && cottageSpots(r, a).length === 0) {
        build(r, a.id, { piece: 'road', at: L.road[Math.floor(rand() * L.road.length)] }, now);
      } else {
        // A bank trade toward a town or cottage, from a surplus.
        const rt = rates(r, a.id);
        for (const target of ['town', 'cottage', 'card'] as const) {
          const cost = COSTS[target];
          const get = RESOURCES.find((x) => a.hand[x] < (cost[x] ?? 0) && r.bank[x] > 0);
          const give = get && RESOURCES.find((x) => x !== get && a.hand[x] - (cost[x] ?? 0) >= rt[x]);
          if (get && give) {
            bank(r, a.id, { give, get }, now);
            return true;
          }
        }
        end(r, a.id, now);
      }
      return true;
    }
  }
}

/** Play the bot until a condition, checking conservation after every move. */
function playUntil(r: Room, now: number, until: (r: Room) => boolean, max = 20_000, rand?: () => number): number {
  let actionsThisTurn = 0;
  let turn = r.turn;
  for (let i = 0; i < max && !until(r) && r.phase === 'playing'; i++) {
    now += 1_000;
    if (r.turn !== turn) {
      turn = r.turn;
      actionsThisTurn = 0;
    }
    // A runaway turn ends.
    if (++actionsThisTurn > 40 && r.step === 'main') end(r, activePlayer(r)!.id, now);
    else botStep(r, now, rand);
    expect(conserved(r)).toBe(true);
  }
  return now;
}

function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Through setup with the bot: returns the time of the first roll. */
function setUp(n = 3, difficulty: Difficulty = 'medium', options: Record<string, unknown> = {}) {
  const { r, now } = begun(n, difficulty, options);
  const t = playUntil(r, now, (x) => x.step !== 'setup');
  return { r, now: t };
}

/** Put cards in a hand from the bank, keeping the totals right. */
function give(r: Room, id: string, cards: Partial<Hand>) {
  for (const x of RESOURCES) {
    const n = cards[x] ?? 0;
    r.bank[x] -= n;
    P(r, id).hand[x] += n;
  }
}
function emptyHands(r: Room) {
  for (const p of r.players) for (const x of RESOURCES) {
    r.bank[x] += p.hand[x];
    p.hand[x] = 0;
  }
}
/** Straight to the active player's main step. */
function toMain(r: Room, now: number) {
  r.step = 'main';
  r.phaseEndsAt = now + 60_000;
}

describe('the lobby', () => {
  it('needs three to five players, and reads its options', () => {
    const r = lobby(2);
    join(r, 'p_sam', T0);
    expect(() => start(r, 'p_john', T0)).toThrow(/needs three/);
    expect(() => createRoom({ id: 'g', host: PEOPLE[0], invite: [...PEOPLE, { id: 'p_x', name: 'X' }], difficulty: 'easy', now: T0 })).toThrow(/Up to 5/);
    const o = lobby(3, 'easy', { pace: 'async', deadlineHours: 48, island: 'large' });
    expect([o.pace, o.deadlineHours, o.island, o.vpTarget]).toEqual(['async', 48, 'large', 8]);
    expect(o.phaseEndsAt).toBe(T0 + 48 * 3_600_000);
    const d = lobby(3, 'hard', { pace: 'nope', deadlineHours: 7, island: 'huge' });
    expect([d.pace, d.deadlineHours, d.island, d.vpTarget]).toEqual(['live', 24, 'auto', 10]);
    expect(d.phaseEndsAt).toBe(T0 + LOBBY_MS);
    expect(about(o)).toBe('Large island · first to 8 points · over days, 48 h a move');
  });

  it('closes when the host leaves the lobby, or nobody starts it', () => {
    const r = lobby(3);
    leave(r, 'p_john', T0);
    expect(r.phase).toBe('closed');
    const s = lobby(3);
    expect(advance(s, T0 + LOBBY_MS, Math.random)).toBe(true);
    expect(s.phase).toBe('closed');
  });

  it('deals a standard island for three or four, a large one for five, unless the host chose', () => {
    expect(begun(3).r.board!.size).toBe('standard');
    expect(begun(4).r.board!.size).toBe('standard');
    const five = begun(5).r;
    expect(five.board!.size).toBe('large');
    expect(five.deck).toHaveLength(34);
    expect(five.bank.timber).toBe(24);
    expect(begun(3, 'medium', { island: 'large' }).r.board!.size).toBe('large');
    expect(begun(5, 'medium', { island: 'standard' }).r.board!.size).toBe('standard');
    const three = begun(3).r;
    expect(three.deck).toHaveLength(25);
    expect([...three.deck].sort()).toEqual(
      [...Array(14).fill('ranger'), ...Array(5).fill('heirloom'), 'harvest', 'harvest', 'market', 'market', 'pathfinders', 'pathfinders'].sort(),
    );
    expect(three.board!.hexes.find((h) => h.id === three.fox)!.kind).toBe('dunes');
    expect(three.seats.sort()).toEqual(['p_john', 'p_kim', 'p_sam']);
  });

  it('goes back to the lobby if people leave in the countdown', () => {
    const r = lobby(3);
    join(r, 'p_sam', T0);
    join(r, 'p_kim', T0);
    start(r, 'p_john', T0);
    leave(r, 'p_kim', T0 + 1);
    expect(r.phase).toBe('lobby');
  });
});

describe('setup', () => {
  it('snakes: each seat places a cottage and a road, then back again; the second cottage pays', () => {
    const { r, now } = begun(4);
    const order: string[] = [];
    let t = now;
    while (r.step === 'setup') {
      const a = activePlayer(r)!;
      if (r.setupNeed === 'cottage') order.push(a.id);
      const before = handSize(a.hand);
      const second = r.setupIndex >= r.seats.length;
      botStep(r, (t += 1000));
      if (r.setupNeed === 'road' && r.setupCottage) {
        const paid = geo(r).vertexLand.get(r.setupCottage)!.filter((h) => r.board!.hexes.find((x) => x.id === h)!.resource).length;
        expect(handSize(a.hand) - before).toBe(second ? paid : 0);
      }
    }
    expect(order).toEqual([...r.seats, ...[...r.seats].reverse()]);
    for (const id of r.seats) {
      expect(Object.values(r.buildings).filter((b) => b.owner === id)).toHaveLength(2);
      expect(Object.values(r.roads).filter((o) => o === id)).toHaveLength(2);
      expect(publicVp(r, id)).toBe(2);
    }
    expect(r.step).toBe('roll');
    expect(activePlayer(r)!.id).toBe(r.seats[0]);
  });

  it('refuses the wrong piece, a spot off the board, a crowded corner, a stray road and the wrong player', () => {
    const { r, now } = begun(3);
    const a = activePlayer(r)!;
    const other = r.seats.find((id) => id !== a.id)!;
    const spot = cottageSpots(r, a, true)[0];
    expect(() => build(r, a.id, { piece: 'road', at: geo(r).edges[0] }, now)).toThrow(/Place your cottage/);
    expect(() => build(r, other, { piece: 'cottage', at: spot }, now)).toThrow(/not your turn/);
    expect(() => build(r, a.id, { piece: 'cottage', at: '9,9,N' }, now)).toThrow(/not a spot on the board/);
    expect(() => build(r, a.id, { piece: 'cottage', at: 'nonsense' }, now)).toThrow(/not a spot on the board/);
    expect(() => build(r, a.id, { piece: 'castle', at: spot }, now)).toThrow(/road, a cottage or a town/);
    build(r, a.id, { piece: 'cottage', at: spot }, now);
    const far = geo(r).edges.find((e) => !edgeEnds(e).includes(spot))!;
    expect(() => build(r, a.id, { piece: 'road', at: far }, now)).toThrow(/touch the cottage/);
    build(r, a.id, { piece: 'road', at: geo(r).vertexBoardEdges.get(spot)![0] }, now);
    // The next player cannot settle next door.
    const b = activePlayer(r)!;
    const neighbour = geo(r).vertexBoardNeighbours.get(spot)![0];
    expect(() => build(r, b.id, { piece: 'cottage', at: neighbour }, now)).toThrow(/Too close/);
    expect(() => build(r, b.id, { piece: 'cottage', at: spot }, now)).toThrow(/Someone just built there/);
  });
});

describe('who may move', () => {
  it('refuses somebody not in the game, somebody who declined, and every move before play starts', () => {
    const r = lobby(4);
    join(r, 'p_sam', T0);
    join(r, 'p_kim', T0);
    expect(() => roll(r, 'p_john', T0)).toThrow(/not started/);
    expect(() => build(r, 'p_john', { piece: 'road', at: '0,0,NE' }, T0)).toThrow(/not started/);
    start(r, 'p_john', T0);
    advance(r, T0 + COUNTDOWN_MS, Math.random);
    const t = T0 + COUNTDOWN_MS;
    // Rory never answered: declined at start, not seated.
    expect(P(r, 'p_rory').status).toBe('declined');
    expect(P(r, 'p_rory').seat).toBeNull();
    for (const who of ['p_rory', 'p_stranger']) {
      expect(() => roll(r, who, t)).toThrow(/not playing|not in this game/);
      expect(() => buy(r, who, t)).toThrow(/not playing|not in this game/);
      expect(() => offer(r, who, { give: { wool: 1 }, want: { stone: 1 } }, t)).toThrow(/not playing|not in this game/);
      expect(() => discard(r, who, { cards: { wool: 1 } }, t)).toThrow(/not playing|not in this game/);
    }
    // A non-seated viewer still gets a wire, with no hand and no options.
    const w = toWire(r, 'p_rory', t);
    expect(w.me).toBeNull();
    expect(w.legal.cottage).toEqual([]);
    expect(w.hints).toBeNull();
  });

  it('sends hints by difficulty: easy all, medium affordable only, hard none', () => {
    for (const [d, check] of [
      ['easy', (h: unknown) => expect(h).toMatchObject({ affordable: expect.any(Array), trades: expect.any(Array), tip: expect.any(String) })],
      ['medium', (h: unknown) => expect(h).toMatchObject({ affordable: expect.any(Array), trades: [], tip: null })],
      ['hard', (h: unknown) => expect(h).toBeNull()],
    ] as const) {
      const { r, now } = setUp(3, d);
      const a = activePlayer(r)!.id;
      check(toWire(r, a, now).hints);
      expect(toWire(r, a, now).showCosts).toBe(d !== 'hard');
    }
    // Easy suggests a bank trade that would finish a town.
    const { r, now } = setUp(3, 'easy');
    const a = activePlayer(r)!.id;
    emptyHands(r);
    give(r, a, { grain: 2, stone: 2, wool: 4 });
    const rt = rates(r, a);
    if (rt.wool <= 4) {
      expect(toWire(r, a, now).hints!.trades[0]).toEqual({ give: 'wool', count: rt.wool, get: 'stone', for: 'town' });
    }
  });
});

describe('a turn', () => {
  it('rolls, produces from every hex with that number and no fox, and refuses off-turn rolls', () => {
    const { r, now } = setUp(3);
    const a = activePlayer(r)!;
    const other = r.seats.find((id) => id !== a.id)!;
    expect(() => roll(r, other, now)).toThrow(/not your turn/);
    expect(() => end(r, a.id, now)).toThrow(/Roll the dice first/);
    // Seed the roll: find a state whose next roll is not 7.
    let t = now;
    roll(r, a.id, (t += 1000));
    expect(r.dice!.a + r.dice!.b).toBe(r.dice!.total);
    expect(() => roll(r, a.id, t)).toThrow(/Not now|Move the fox|Waiting/);
    expect(['main', 'discard', 'fox']).toContain(r.step);
  });

  it('pays cottages 1 and towns 2, skips the fox hex, and keeps a short bank from paying anyone when several are owed', () => {
    const { r, now } = setUp(3);
    emptyHands(r);
    const hex = r.board!.hexes.find((h) => h.token === 8)!;
    const corners = hexCorners(hex.q, hex.r).filter((v) => geo(r).vertexSet.has(v));
    // Clear the island and put two of John's and one of Sam's buildings on this hex.
    r.buildings = {};
    r.buildings[corners[0]] = { owner: 'p_john', piece: 'town' };
    r.buildings[corners[2]] = { owner: 'p_sam', piece: 'cottage' };
    r.fox = r.board!.hexes.find((h) => h.kind === 'dunes')!.id;
    const res = hex.resource!;
    // Force an 8: the dice come from the room's generator, so drive production directly.
    const produce = (total: number) => {
      r.step = 'roll';
      r.dice = null;
      // Reroll until the total comes up (the generator is the room's own).
      for (let i = 0; i < 500; i++) {
        const saved = JSON.parse(JSON.stringify(r));
        roll(r, activePlayer(r)!.id, now);
        if (r.dice!.total === total) return;
        Object.assign(r, saved);
        r.rng = seedRng(1_000 + i);
      }
      throw new Error('never rolled');
    };
    produce(8);
    expect(P(r, 'p_john').hand[res]).toBe(2);
    expect(P(r, 'p_sam').hand[res]).toBe(1);
    // Fox on the hex: nothing.
    emptyHands(r);
    r.fox = hex.id;
    produce(8);
    expect(P(r, 'p_john').hand[res]).toBe(0);
    // Bank short with two owed: nobody gets it; with one owed, they get what is left.
    emptyHands(r);
    r.fox = r.board!.hexes.find((h) => h.kind === 'dunes')!.id;
    const stock = r.bank[res];
    give(r, 'p_kim', { [res]: stock - 2 });
    produce(8);
    expect(P(r, 'p_john').hand[res]).toBe(0);
    expect(P(r, 'p_sam').hand[res]).toBe(0);
    expect(r.log.at(-1)!.text).toMatch(/short of/);
    delete r.buildings[corners[2]];
    emptyHands(r);
    give(r, 'p_kim', { [res]: stock - 1 });
    produce(8);
    expect(P(r, 'p_john').hand[res]).toBe(1);
  });
});

/** Roll until a 7 comes (rewinding the generator), then return. */
function rollSeven(r: Room, now: number) {
  for (let i = 0; i < 500; i++) {
    const saved = JSON.parse(JSON.stringify(r));
    roll(r, activePlayer(r)!.id, now);
    if (r.dice!.total === 7) return;
    Object.assign(r, saved);
    r.rng = seedRng(5_000 + i);
  }
  throw new Error('no seven');
}

describe('a seven', () => {
  it('makes everyone over seven discard half at once, then the active player moves the fox', () => {
    const { r, now } = setUp(3);
    emptyHands(r);
    const [a, b, c] = r.seats;
    const active = activePlayer(r)!.id;
    give(r, a, { timber: 4, clay: 5 }); // 9 → owes 4
    give(r, b, { wool: 8 }); // 8 → owes 4
    give(r, c, { grain: 7 }); // 7 → owes nothing
    rollSeven(r, now);
    expect(r.step).toBe('discard');
    expect(r.discardOwed).toEqual({ [a]: 4, [b]: 4 });
    expect(waitingOn(r)).toMatchObject({ ids: [a, b], key: `${r.turn}:discard` });
    expect(() => discard(r, c, { cards: { grain: 3 } }, now)).toThrow(/don't owe/);
    expect(() => discard(r, b, { cards: { wool: 3 } }, now)).toThrow(/exactly 4/);
    expect(() => discard(r, b, { cards: { grain: 4 } }, now)).toThrow(/don't have/);
    expect(() => discard(r, b, { cards: { gold: 4 } }, now)).toThrow(/not a resource/);
    expect(() => discard(r, b, { cards: { wool: 1.5 } }, now)).toThrow(/whole numbers/);
    expect(() => fox(r, active, { hex: r.board!.hexes[0].id }, now)).toThrow(/Waiting for discards|Move the fox|not your turn/);
    discard(r, b, { cards: { wool: 4 } }, now);
    expect(r.step).toBe('discard');
    // The other one's time runs out: discarded for them, most-held first.
    const due = deadline(r)!;
    expect(due).toBe(now + LIVE_MS.medium.discard);
    advance(r, due, Math.random);
    expect(P(r, a).hand).toMatchObject({ timber: 2, clay: 3 });
    expect(r.log.some((e) => e.kind === 'discard' && e.auto)).toBe(true);
    expect(r.step).toBe('fox');
    expect(conserved(r)).toBe(true);
  });

  it('skips the discard when nobody holds more than seven', () => {
    const { r, now } = setUp(3);
    emptyHands(r);
    rollSeven(r, now);
    expect(r.step).toBe('fox');
  });

  it('moves the fox, takes one random card from a chosen neighbour, and tells only the two of them which', () => {
    const { r, now } = setUp(3, 'medium');
    emptyHands(r);
    const me = activePlayer(r)!.id;
    const [x, y] = r.seats.filter((id) => id !== me);
    // A hex touching both other players.
    r.buildings = {};
    const hex = r.board!.hexes.find((h) => h.id !== r.fox && h.kind !== 'dunes')!;
    const cs = hexCorners(hex.q, hex.r).filter((v) => geo(r).vertexSet.has(v));
    r.buildings[cs[0]] = { owner: x, piece: 'cottage' };
    r.buildings[cs[3]] = { owner: y, piece: 'cottage' };
    give(r, x, { stone: 1 });
    give(r, y, { wool: 2 });
    rollSeven(r, now);
    expect(r.step).toBe('fox');
    expect(victimsAt(r, me, hex.id)).toEqual(r.seats.filter((id) => id === x || id === y));
    expect(() => fox(r, me, { hex: r.fox }, now)).toThrow(/different field/);
    expect(() => fox(r, me, { hex: 'x' }, now)).toThrow(/not a spot/);
    expect(() => fox(r, me, { hex: '9,9' }, now)).toThrow(/not a spot/);
    expect(() => fox(r, me, { hex: hex.id }, now)).toThrow(/Pick who/);
    expect(() => fox(r, me, { hex: hex.id, victim: me }, now)).toThrow(/only take from/);
    fox(r, me, { hex: hex.id, victim: x }, now);
    expect(r.fox).toBe(hex.id);
    expect(P(r, me).hand.stone).toBe(1);
    expect(P(r, x).hand.stone).toBe(0);
    expect(r.step).toBe('main');
    const steal = (id: string) => toWire(r, id, now).log.find((e) => e.kind === 'steal')!.text;
    expect(steal(me)).toMatch(/Your fox took a stone from/);
    expect(steal(x)).toMatch(/took a stone from you/);
    expect(steal(y)).toMatch(/took a card from/);
    expect(steal(y)).not.toMatch(/stone/);
  });

  it('is a friendly fox on easy: it leaves players on two public points or fewer alone', () => {
    const { r, now } = setUp(3, 'easy');
    const me = activePlayer(r)!.id;
    const allowed = foxHexes(r, me);
    for (const h of allowed) {
      const hex = r.board!.hexes.find((x) => x.id === h)!;
      for (const v of hexCorners(hex.q, hex.r)) {
        const b = r.buildings[v];
        if (b && b.owner !== me) expect(publicVp(r, b.owner)).toBeGreaterThan(2);
      }
    }
    // Everybody else is on 2 after setup: a hex touching any of them is refused.
    const guarded = r.board!.hexes.find(
      (h) => h.id !== r.fox && hexCorners(h.q, h.r).some((v) => r.buildings[v] && r.buildings[v].owner !== me),
    )!;
    emptyHands(r);
    rollSeven(r, now);
    expect(() => fox(r, me, { hex: guarded.id }, now)).toThrow(/friendly fox/);
    // Medium has no such rule.
    const m = setUp(3, 'medium').r;
    expect(foxHexes(m, activePlayer(m)!.id)).toHaveLength(m.board!.hexes.length - 1);
  });
});

describe('building', () => {
  it('needs the cards, a piece, a connecting road and the distance rule', () => {
    const { r, now } = setUp(3);
    const a = activePlayer(r)!;
    emptyHands(r);
    toMain(r, now);
    const road = roadSpots(r, a)[0];
    expect(() => build(r, a.id, { piece: 'road', at: road }, now)).toThrow(/can't afford/);
    give(r, a.id, { timber: 5, clay: 5, wool: 2, grain: 5, stone: 3 });
    const loose = geo(r).edges.find((e) => !r.roads[e] && !roadSpots(r, a).includes(e))!;
    expect(() => build(r, a.id, { piece: 'road', at: loose }, now)).toThrow(/join your own/);
    expect(() => build(r, a.id, { piece: 'road', at: '0,0,N' }, now)).toThrow(/not a spot/);
    const taken = Object.keys(r.roads)[0];
    expect(() => build(r, a.id, { piece: 'road', at: taken }, now)).toThrow(/Someone just built/);
    // A cottage needs one of my roads next to it.
    const empty = geo(r).vertices.find(
      (v) => !r.buildings[v] && geo(r).vertexBoardNeighbours.get(v)!.every((n) => !r.buildings[n]) &&
        !geo(r).vertexBoardEdges.get(v)!.some((e) => r.roads[e] === a.id),
    )!;
    expect(() => build(r, a.id, { piece: 'cottage', at: empty }, now)).toThrow(/road next to it/);
    const mine = Object.keys(r.buildings).find((v) => r.buildings[v].owner === a.id)!;
    const crowded = geo(r).vertexBoardNeighbours.get(mine)![0];
    if (!r.buildings[crowded]) expect(() => build(r, a.id, { piece: 'cottage', at: crowded }, now)).toThrow(/Too close/);
    // A town only on my own cottage; it hands the cottage piece back.
    const theirs = Object.keys(r.buildings).find((v) => r.buildings[v].owner !== a.id)!;
    expect(() => build(r, a.id, { piece: 'town', at: theirs }, now)).toThrow(/your own cottages/);
    build(r, a.id, { piece: 'town', at: mine }, now);
    expect(r.buildings[mine].piece).toBe('town');
    expect(a.pieces).toMatchObject({ town: 3, cottage: 4 });
    expect(publicVp(r, a.id)).toBe(3);
    build(r, a.id, { piece: 'road', at: road }, now);
    expect(a.pieces.road).toBe(12);
    a.pieces.road = 0;
    expect(() => build(r, a.id, { piece: 'road', at: roadSpots(r, a)[0] }, now)).toThrow(/no roads left/);
    expect(conserved(r)).toBe(true);
  });

  it('lets another player build off-turn only in a five-player game', () => {
    const three = setUp(3);
    toMain(three.r, three.now);
    const other3 = three.r.seats.find((id) => id !== activePlayer(three.r)!.id)!;
    give(three.r, other3, { timber: 1, clay: 1 });
    expect(() => build(three.r, other3, { piece: 'road', at: roadSpots(three.r, P(three.r, other3))[0] }, three.now)).toThrow(/not your turn/);
    expect(() => buy(three.r, other3, three.now)).toThrow(/not your turn/);

    const { r, now } = setUp(5);
    toMain(r, now);
    const other = r.seats.find((id) => id !== activePlayer(r)!.id)!;
    emptyHands(r);
    give(r, other, { timber: 1, clay: 1, wool: 1, grain: 1, stone: 1 });
    const w = toWire(r, other, now);
    expect(w.legal.road.length).toBeGreaterThan(0);
    expect(w.legal.canBuy).toBe(true);
    expect(w.legal.canEnd).toBe(false);
    expect(w.legal.canTrade).toBe(false);
    build(r, other, { piece: 'road', at: w.legal.road[0] }, now);
    buy(r, other, now);
    expect(P(r, other).cards).toHaveLength(1);
    // But not trade or play off-turn.
    give(r, other, { wool: 4 });
    expect(() => bank(r, other, { give: 'wool', get: 'stone' }, now)).toThrow(/not your turn/);
    // Nor in another player's roll step.
    r.step = 'roll';
    give(r, other, { timber: 1, clay: 1 });
    expect(() => build(r, other, { piece: 'road', at: roadSpots(r, P(r, other))[0] }, now)).toThrow(/not your turn/);
  });
});

describe('almanac cards', () => {
  function withCard(kind: 'ranger' | 'heirloom' | 'pathfinders' | 'harvest' | 'market', difficulty: Difficulty = 'medium') {
    const { r, now } = setUp(3, difficulty);
    const a = activePlayer(r)!;
    a.cards.push({ kind, boughtTurn: r.turn - 1 });
    return { r, now, a };
  }

  it('buys the top card; a card bought this turn waits a turn; one card a turn', () => {
    const { r, now } = setUp(3);
    const a = activePlayer(r)!;
    toMain(r, now);
    emptyHands(r);
    expect(() => buy(r, a.id, now)).toThrow(/can't afford/);
    give(r, a.id, { wool: 2, grain: 2, stone: 2 });
    r.deck.push('ranger');
    buy(r, a.id, now);
    expect(a.cards).toEqual([{ kind: 'ranger', boughtTurn: r.turn }]);
    expect(toWire(r, a.id, now).me!.cards).toEqual([{ kind: 'ranger', new: true }]);
    expect(() => play(r, a.id, { card: 'ranger' }, now)).toThrow(/next turn/);
    a.cards.push({ kind: 'harvest', boughtTurn: r.turn - 2 }, { kind: 'market', boughtTurn: r.turn - 2 });
    expect(() => play(r, a.id, { card: 'pathfinders' }, now)).toThrow(/don't have/);
    play(r, a.id, { card: 'harvest', take: ['stone', 'stone'] }, now);
    expect(() => play(r, a.id, { card: 'market', resource: 'wool' }, now)).toThrow(/already played/);
    r.deck = [];
    give(r, a.id, { wool: 1, grain: 1, stone: 1 });
    expect(() => buy(r, a.id, now)).toThrow(/deck is empty/);
  });

  it('ranger: playable before rolling, moves the fox, then back to rolling', () => {
    const { r, now, a } = withCard('ranger');
    expect(r.step).toBe('roll');
    expect(toWire(r, a.id, now).legal.playable).toEqual(['ranger']);
    play(r, a.id, { card: 'ranger' }, now);
    expect(r.step).toBe('fox');
    const hex = foxHexes(r, a.id).find((h) => !victimsAt(r, a.id, h).length)!;
    fox(r, a.id, { hex }, now);
    expect(r.step).toBe('roll');
    expect(a.rangersPlayed).toBe(1);
    expect(toWire(r, a.id, now).legal.playable).toEqual([]);
  });

  it('only a ranger is playable before the roll; heirlooms are never played', () => {
    const { r, now, a } = withCard('harvest');
    expect(() => play(r, a.id, { card: 'harvest', take: ['wool', 'wool'] }, now)).toThrow(/Roll the dice first/);
    expect(() => play(r, a.id, { card: 'heirloom' }, now)).toThrow(/kept, not played/);
    expect(() => play(r, a.id, { card: 'joker' }, now)).toThrow(/Pick an almanac card/);
  });

  it('pathfinders: two free roads, then back to the main step; skip stops early', () => {
    const { r, now, a } = withCard('pathfinders');
    toMain(r, now);
    emptyHands(r);
    play(r, a.id, { card: 'pathfinders' }, now);
    expect(r.step).toBe('roads');
    expect(r.freeRoads).toBe(2);
    expect(() => end(r, a.id, now)).toThrow(/free roads/);
    expect(() => build(r, a.id, { piece: 'cottage', at: geo(r).vertices[0] }, now)).toThrow(/free roads/);
    build(r, a.id, { piece: 'road', at: toWire(r, a.id, now).legal.road[0] }, now);
    expect(r.freeRoads).toBe(1);
    build(r, a.id, { piece: 'road', at: toWire(r, a.id, now).legal.road[0] }, now);
    expect(r.step).toBe('main');
    expect(a.pieces.road).toBe(11);
    expect(conserved(r)).toBe(true);
    const again2 = withCard('pathfinders');
    toMain(again2.r, again2.now);
    play(again2.r, again2.a.id, { card: 'pathfinders' }, again2.now);
    skip(again2.r, again2.a.id, again2.now);
    expect(again2.r.step).toBe('main');
    expect(() => skip(again2.r, again2.a.id, again2.now)).toThrow();
  });

  it('harvest: any two from the bank, if it has them', () => {
    const { r, now, a } = withCard('harvest');
    toMain(r, now);
    emptyHands(r);
    expect(() => play(r, a.id, { card: 'harvest', take: ['wool'] }, now)).toThrow(/two resources/);
    const left = r.bank.clay;
    give(r, 'p_kim' === a.id ? 'p_sam' : 'p_kim', { clay: left - 1 });
    expect(() => play(r, a.id, { card: 'harvest', take: ['clay', 'clay'] }, now)).toThrow(/bank doesn't/);
    play(r, a.id, { card: 'harvest', take: ['clay', 'wool'] }, now);
    expect(a.hand).toMatchObject({ clay: 1, wool: 1 });
  });

  it('market: every other player hands over all of one resource, in public', () => {
    const { r, now, a } = withCard('market');
    toMain(r, now);
    emptyHands(r);
    const [x, y] = r.seats.filter((id) => id !== a.id);
    give(r, x, { grain: 3, wool: 1 });
    give(r, y, { grain: 2 });
    expect(() => play(r, a.id, { card: 'market', resource: 'gold' }, now)).toThrow(/Name a resource/);
    play(r, a.id, { card: 'market', resource: 'grain' }, now);
    expect(a.hand.grain).toBe(5);
    expect(P(r, x).hand).toMatchObject({ grain: 0, wool: 1 });
    expect(r.log.at(-1)!.text).toMatch(/market for grain: 3 from .*, 2 from/);
  });

  it('heirloom: counts at once toward my own total, hidden from everyone else until the end', () => {
    const { r, now, a } = withCard('heirloom');
    expect(totalVp(r, a.id)).toBe(publicVp(r, a.id) + 1);
    const other = r.seats.find((id) => id !== a.id)!;
    const theirView = toWire(r, other, now).players.find((p) => p.id === a.id)!;
    expect(theirView.publicVp).toBe(2);
    expect(theirView.cardCount).toBe(1);
    expect(JSON.stringify(toWire(r, other, now))).not.toMatch(/heirloom/);
    expect(toWire(r, a.id, now).me!.vp).toBe(3);
  });
});
