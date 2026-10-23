// Homestead rules, part two: Longest Trail, Chief Ranger, trading, winning,
// leaving, the clock, scripted games and the wire. Part one is
// `homestead.test.ts`; the helpers below are the same in both.

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

describe('Longest Trail', () => {
  /** A clear island with roads for `id` along a path of corners. */
  function path(r: Room, id: string, corners: string[]) {
    for (let i = 0; i + 1 < corners.length; i++) {
      const e = geo(r).vertexBoardEdges.get(corners[i])!.find((x) => edgeEnds(x).includes(corners[i + 1]))!;
      r.roads[e] = id;
    }
  }
  /** A walk of `n` corners along the board without revisiting one. */
  function walk(r: Room, from: string, n: number, avoid = new Set<string>()): string[] {
    const out = [from];
    const seen = new Set([from, ...avoid]);
    while (out.length < n) {
      const next = geo(r).vertexBoardNeighbours.get(out.at(-1)!)!.find((v) => !seen.has(v));
      if (!next) break;
      out.push(next);
      seen.add(next);
    }
    return out;
  }

  it('measures the longest run with no road twice, and an opponent\'s cottage breaks it', () => {
    const { r } = setUp(3);
    r.roads = {};
    r.buildings = {};
    const [a, b] = r.seats;
    const corners = walk(r, geo(r).vertices[10], 8);
    path(r, a, corners);
    expect(trailLength(r, a)).toBe(7);
    // A cottage of B's in the middle (corner 3) splits it into 3 and 4.
    r.buildings[corners[3]] = { owner: b, piece: 'cottage' };
    expect(trailLength(r, a)).toBe(4);
    // My own cottage there does not.
    r.buildings[corners[3]] = { owner: a, piece: 'cottage' };
    expect(trailLength(r, a)).toBe(7);
    // A branch: the trail takes the longer arm, not both.
    r.buildings = {};
    const branch = walk(r, corners[3], 3, new Set(corners));
    path(r, a, branch);
    expect(trailLength(r, a)).toBe(7);
  });

  it('counts a loop once round', () => {
    const { r } = setUp(3);
    r.roads = {};
    r.buildings = {};
    const h = r.board!.hexes[9];
    const ring = hexCorners(h.q, h.r);
    path(r, r.seats[0], [...ring, ring[0]]);
    expect(trailLength(r, r.seats[0])).toBe(6);
  });

  it('is claimed at five, taken only by beating it, and nobody holds it when a broken holder leaves a tie', () => {
    const { r, now } = setUp(3);
    r.roads = {};
    r.buildings = {};
    const [a, b, c] = r.seats;
    r.active = r.seats.indexOf(a);
    toMain(r, now);
    const va = walk(r, geo(r).vertices[0], 6);
    // Four roads for A, then the fifth built for real claims the award.
    path(r, a, va.slice(0, 5));
    r.buildings[va[0]] = { owner: a, piece: 'cottage' };
    give(r, a, { timber: 3, clay: 3 });
    const fifth = geo(r).vertexBoardEdges.get(va[4])!.find((e) => edgeEnds(e).includes(va[5]))!;
    build(r, a, { piece: 'road', at: fifth }, now);
    expect(trailLength(r, a)).toBe(5);
    expect(r.longestTrailId).toBe(a);
    // B builds an equal five: A keeps it.
    const used = new Set(va.flatMap((v) => [v, ...geo(r).vertexBoardNeighbours.get(v)!]));
    const startB = geo(r).vertices.find((v) => !used.has(v) && walk(r, v, 6, used).length === 6)!;
    const vb = walk(r, startB, 6, used);
    path(r, b, vb);
    r.buildings[vb[0]] = { owner: b, piece: 'cottage' };
    r.active = r.seats.indexOf(b);
    give(r, b, { timber: 1, clay: 1 });
    // (Recompute through a real build of anything: a road elsewhere for B.)
    r.active = r.seats.indexOf(a);
    build(r, a, { piece: 'road', at: roadSpots(r, P(r, a)).find((e) => !edgeEnds(e).some((v) => va.includes(v) && v !== va[0]))! }, now);
    expect(trailLength(r, b)).toBe(5);
    expect(r.longestTrailId).toBe(a);
    // C's cottage breaks A's trail: B leads alone and takes it.
    delete r.roads[fifth];
    r.buildings[va[2]] = { owner: c, piece: 'cottage' };
    give(r, a, { timber: 1, clay: 1 });
    build(r, a, { piece: 'road', at: roadSpots(r, P(r, a))[0] }, now);
    expect(trailLength(r, a)).toBeLessThan(5);
    expect(r.longestTrailId).toBe(b);
    expect(publicVp(r, b)).toBe(1 + 2);
  });
});

describe('Chief Ranger', () => {
  it('goes to the first to play three rangers, and passes only to somebody who plays more', () => {
    const { r, now } = setUp(3);
    const [a, b] = r.seats;
    const playRanger = (id: string) => {
      r.active = r.seats.indexOf(id);
      r.step = 'roll';
      r.playedCardThisTurn = false;
      r.turn += 1;
      P(r, id).cards.push({ kind: 'ranger', boughtTurn: 0 });
      play(r, id, { card: 'ranger' }, now);
      fox(r, id, { hex: foxHexes(r, id).find((h) => victimsAt(r, id, h).length <= 1)!, victim: undefined }, now);
    };
    playRanger(a);
    playRanger(a);
    expect(r.chiefRangerId).toBeNull();
    playRanger(a);
    expect(r.chiefRangerId).toBe(a);
    for (let i = 0; i < 3; i++) playRanger(b);
    expect(r.chiefRangerId).toBe(a);
    playRanger(b);
    expect(r.chiefRangerId).toBe(b);
    expect(publicVp(r, b)).toBe(4);
  });
});

describe('trading', () => {
  function trading() {
    const { r, now } = setUp(3);
    toMain(r, now);
    emptyHands(r);
    const a = activePlayer(r)!.id;
    const [x, y] = r.seats.filter((id) => id !== a);
    return { r, now, a, x, y };
  }

  it('trades with the bank at 4, 3 with an any-harbour, 2 with a matching one', () => {
    const { r, now, a } = trading();
    give(r, a, { wool: 5 });
    expect(() => bank(r, a, { give: 'wool', get: 'wool' }, now)).toThrow(/different/);
    expect(() => bank(r, a, { give: 'gold', get: 'wool' }, now)).toThrow(/Pick a resource/);
    r.buildings = Object.fromEntries(Object.entries(r.buildings).filter(([, b]) => b.owner !== a));
    expect(rates(r, a)).toEqual({ timber: 4, clay: 4, wool: 4, grain: 4, stone: 4 });
    bank(r, a, { give: 'wool', get: 'stone' }, now);
    expect(P(r, a).hand).toMatchObject({ wool: 1, stone: 1 });
    expect(() => bank(r, a, { give: 'wool', get: 'stone' }, now)).toThrow(/need 4 wool/);
    const any = r.board!.harbours.find((h) => h.kind === 'any')!;
    const two = r.board!.harbours.find((h) => h.kind === 'grain')!;
    r.buildings[edgeEnds(any.edge)[0]] = { owner: a, piece: 'cottage' };
    r.buildings[edgeEnds(two.edge)[1]] = { owner: a, piece: 'cottage' };
    expect(rates(r, a)).toEqual({ timber: 3, clay: 3, wool: 3, grain: 2, stone: 3 });
    give(r, a, { grain: 2 });
    const left = r.bank.clay;
    give(r, r.seats.find((id) => id !== a)!, { clay: left });
    expect(() => bank(r, a, { give: 'grain', get: 'clay' }, now)).toThrow(/no clay left/);
    bank(r, a, { give: 'grain', get: 'timber' }, now);
    expect(P(r, a).hand.timber).toBe(1);
    expect(conserved(r)).toBe(true);
  });

  it('validates offers: two non-empty sides, no overlap, cards held, at most three open, only on my main step', () => {
    const { r, now, a, x } = trading();
    give(r, a, { wool: 3 });
    give(r, x, { stone: 3 });
    expect(() => offer(r, a, { give: {}, want: { stone: 1 } }, now)).toThrow(/which cards to give/);
    expect(() => offer(r, a, { give: { wool: 1 }, want: {} }, now)).toThrow(/ask for/);
    expect(() => offer(r, a, { give: { wool: 1 }, want: { wool: 1, stone: 1 } }, now)).toThrow(/both sides/);
    expect(() => offer(r, a, { give: { wool: 4 }, want: { stone: 1 } }, now)).toThrow(/don't have/);
    expect(() => offer(r, a, { give: { wool: 1 }, want: { stone: 1 }, to: ['p_nobody'] }, now)).toThrow(/players in this game/);
    expect(() => offer(r, a, { give: { wool: 1 }, want: { stone: 1 }, to: 'everyone' }, now)).toThrow(/who the offer/);
    expect(() => offer(r, x, { give: { stone: 1 }, want: { wool: 1 } }, now)).toThrow(/not your turn/);
    for (let i = 0; i < 3; i++) offer(r, a, { give: { wool: 1 }, want: { stone: 1 } }, now);
    expect(() => offer(r, a, { give: { wool: 1 }, want: { stone: 1 } }, now)).toThrow(/3 offers/);
  });

  it('accepting carries the trade out at once; the first accept wins; everyone sees it', () => {
    const { r, now, a, x, y } = trading();
    give(r, a, { wool: 2 });
    give(r, x, { stone: 1 });
    give(r, y, { stone: 1 });
    offer(r, a, { give: { wool: 2 }, want: { stone: 1 } }, now);
    const id = r.offers[0].id;
    expect(toWire(r, y, now).offers[0]).toMatchObject({ id, from: a, to: null, status: 'open', give: { wool: 2 } });
    expect(() => accept(r, a, { offerId: id }, now)).toThrow(/isn't for you/);
    accept(r, x, { offerId: id }, now);
    expect(P(r, a).hand).toMatchObject({ wool: 0, stone: 1 });
    expect(P(r, x).hand).toMatchObject({ wool: 2, stone: 0 });
    expect(r.offers[0]).toMatchObject({ status: 'done', acceptedBy: x });
    expect(() => accept(r, y, { offerId: id }, now)).toThrow(/has gone/);
    expect(conserved(r)).toBe(true);
  });

  it('refuses an accept from somebody without the cards, and voids an offer whose proposer has spent them', () => {
    const { r, now, a, x, y } = trading();
    give(r, a, { timber: 1, clay: 1 });
    give(r, y, { grain: 1 });
    offer(r, a, { give: { timber: 1 }, want: { grain: 1 } }, now);
    const id = r.offers[0].id;
    expect(() => accept(r, x, { offerId: id }, now)).toThrow(/don't have the cards/);
    // A spends the timber on a road: the offer is void.
    build(r, a, { piece: 'road', at: roadSpots(r, P(r, a))[0] }, now);
    expect(r.offers[0].status).toBe('void');
    expect(() => accept(r, y, { offerId: id }, now)).toThrow(/has gone/);
  });

  it('counters go back to the active player only, one per offer each, and the active player may accept them', () => {
    const { r, now, a, x, y } = trading();
    give(r, a, { grain: 2 });
    give(r, x, { stone: 2 });
    offer(r, a, { give: { grain: 1 }, want: { stone: 1 }, to: [x] }, now);
    const id = r.offers[0].id;
    expect(() => counter(r, y, { offerId: id, give: { stone: 1 }, want: { grain: 2 } }, now)).toThrow(/made to you/);
    counter(r, x, { offerId: id, give: { stone: 1 }, want: { grain: 2 } }, now);
    expect(() => counter(r, x, { offerId: id, give: { stone: 2 }, want: { grain: 2 } }, now)).toThrow(/already have a counter/);
    const c = r.offers[1];
    expect(c).toMatchObject({ from: x, to: [a], counterTo: id });
    expect(() => accept(r, y, { offerId: c.id }, now)).toThrow(/isn't for you/);
    // A counter can't be countered.
    expect(() => counter(r, a, { offerId: c.id, give: { grain: 1 }, want: { stone: 1 } }, now)).toThrow(/made to you/);
    accept(r, a, { offerId: c.id }, now);
    expect(P(r, a).hand).toMatchObject({ grain: 0, stone: 1 });
    expect(P(r, x).hand).toMatchObject({ grain: 2, stone: 1 });
    // The original is void now (A has no grain left).
    expect(r.offers[0].status).toBe('void');
  });

  it('refuse and cancel; every offer goes at the end of the turn', () => {
    const { r, now, a, x, y } = trading();
    give(r, a, { grain: 3 });
    offer(r, a, { give: { grain: 1 }, want: { stone: 1 }, to: [x, y] }, now);
    const [o] = r.offers;
    expect(() => refuse(r, a, { offerId: o.id }, now)).toThrow(/isn't for you/);
    refuse(r, x, { offerId: o.id }, now);
    expect(toWire(r, a, now).offers[0].refusedBy).toEqual([x]);
    refuse(r, y, { offerId: o.id }, now);
    expect(o.status).toBe('cancelled');
    offer(r, a, { give: { grain: 1 }, want: { wool: 1 } }, now);
    const second = r.offers[1];
    expect(() => cancel(r, x, { offerId: second.id }, now)).toThrow(/Only the player/);
    cancel(r, a, { offerId: second.id }, now);
    expect(second.status).toBe('cancelled');
    expect(() => cancel(r, a, { offerId: second.id }, now)).toThrow(/has gone/);
    offer(r, a, { give: { grain: 1 }, want: { clay: 1 } }, now);
    end(r, a, now);
    expect(r.offers).toEqual([]);
    expect(() => accept(r, x, { offerId: 'o3' }, now)).toThrow(/Trading happens|has gone/);
  });
});

describe('winning', () => {
  it('wins the moment my total reaches the target on my own turn', () => {
    const { r, now } = setUp(3, 'medium');
    const a = activePlayer(r)!;
    toMain(r, now);
    emptyHands(r);
    for (let i = 0; i < 7; i++) a.cards.push({ kind: 'heirloom', boughtTurn: 0 });
    expect(totalVp(r, a.id)).toBe(9);
    give(r, a.id, { wool: 1, grain: 1, stone: 1 });
    r.deck.push('heirloom');
    buy(r, a.id, now);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ winnerId: a.id, reason: 'points' });
    expect(r.phaseEndsAt).toBe(now + FINISHED_MS);
    const s = standings(r);
    expect(s[0]).toMatchObject({ id: a.id, place: 1, score: 10, vp: 10, heirlooms: 8, result: 'won' });
    expect(s.slice(1).every((x) => x.result === 'lost' && x.place === 2 && x.score === 2)).toBe(true);
    // The finished wire reveals heirlooms to everyone.
    const other = r.seats.find((id) => id !== a.id)!;
    expect(toWire(r, other, now).players.find((p) => p.id === a.id)).toMatchObject({ heirlooms: 8, vp: 10 });
    expect(toWire(r, other, now).winnerIds).toEqual([a.id]);
    expect(() => roll(r, a.id, now)).toThrow(/over/);
  });

  it('easy plays to 8; reaching the target off-turn wins only when my turn starts', () => {
    const { r, now } = setUp(5, 'easy');
    expect(r.vpTarget).toBe(8);
    toMain(r, now);
    emptyHands(r);
    const active = activePlayer(r)!.id;
    const next = r.seats[(r.active + 1) % 5];
    for (let i = 0; i < 5; i++) P(r, next).cards.push({ kind: 'heirloom', boughtTurn: 0 });
    give(r, next, { wool: 1, grain: 1, stone: 1 });
    r.deck.push('heirloom');
    buy(r, next, now); // 2 + 6 = 8, off-turn
    expect(totalVp(r, next)).toBe(8);
    expect(r.phase).toBe('playing');
    end(r, active, now);
    expect(r.phase).toBe('finished');
    expect(r.result!.winnerId).toBe(next);
  });
});

describe('leaving', () => {
  it('returns the leaver\'s cards, skips their turns, and the last one standing wins', () => {
    const { r, now } = setUp(3);
    const a = activePlayer(r)!.id;
    const [x, y] = r.seats.filter((id) => id !== a);
    toMain(r, now);
    give(r, a, { grain: 2 });
    offer(r, a, { give: { grain: 1 }, want: { stone: 1 } }, now);
    leave(r, a, now);
    expect(P(r, a).hand).toEqual({ timber: 0, clay: 0, wool: 0, grain: 0, stone: 0 });
    expect(r.offers).toEqual([]);
    expect(activePlayer(r)!.id).not.toBe(a);
    expect(r.step).toBe('roll');
    expect(conserved(r)).toBe(true);
    // Their buildings stay.
    expect(Object.values(r.buildings).filter((b) => b.owner === a)).toHaveLength(2);
    const before = activePlayer(r)!.id;
    toMain(r, now);
    end(r, before, now);
    expect(activePlayer(r)!.id).not.toBe(a);
    leave(r, x, now);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ winnerId: y, reason: 'left' });
    const s = standings(r);
    expect(s[0].id).toBe(y);
    expect(s.slice(1).every((row) => row.left)).toBe(true);
  });

  it('wins at once when a leaver\'s award carries the active player to the target', () => {
    const { r, now } = setUp(3);
    const a = activePlayer(r)!;
    const b = r.seats.find((id) => id !== a.id)!;
    toMain(r, now);
    emptyHands(r);
    // A: two cottages (2) + six heirlooms = 8, with three rangers played; B holds Chief Ranger on four.
    for (let i = 0; i < 6; i++) a.cards.push({ kind: 'heirloom', boughtTurn: 0 });
    a.rangersPlayed = 3;
    P(r, b).rangersPlayed = 4;
    r.chiefRangerId = b;
    r.longestTrailId = null;
    expect(totalVp(r, a.id)).toBe(8);
    leave(r, b, now);
    expect(r.chiefRangerId).toBe(a.id);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ winnerId: a.id, reason: 'points' });
  });

  it('skips a leaver\'s setup placement', () => {
    const { r, now } = begun(4);
    const later = r.seats[3];
    leave(r, later, now);
    const t = playUntil(r, now, (x) => x.step !== 'setup');
    expect(Object.values(r.buildings).filter((b) => b.owner === later)).toHaveLength(0);
    expect(r.step).toBe('roll');
    void t;
  });
});

describe('the clock', () => {
  it('times each decision by difficulty, and days in an async room', () => {
    const { r, now } = begun(3, 'hard');
    expect(deadline(r)).toBe(now + LIVE_MS.hard.setup);
    const slow = begun(3, 'easy', { pace: 'async', deadlineHours: 12 });
    expect(deadline(slow.r)).toBe(slow.now + 12 * 3_600_000);
  });

  it('auto-moves every timeout legally, marks two auto-ended turns as away, and abandons a game nobody plays', () => {
    const { r, now } = begun(3, 'medium');
    let t = now;
    for (let i = 0; i < 400 && r.phase === 'playing'; i++) {
      t = deadline(r)!;
      expect(advance(r, t, Math.random)).toBe(true);
      expect(conserved(r)).toBe(true);
      // Each placement the clock made was legal: two buildings never adjacent.
      for (const v of Object.keys(r.buildings)) {
        for (const n of geo(r).vertexBoardNeighbours.get(v)!) expect(r.buildings[n]).toBeUndefined();
      }
    }
    expect(r.phase).toBe('closed');
    expect(r.result).toEqual({ winnerId: null, reason: 'abandoned' });
    expect(r.log.some((e) => e.text === "Everyone's away — game abandoned.")).toBe(true);
    expect(r.players.every((p) => p.away)).toBe(true);
    // Setup completed by the clock with a cottage and road each, twice.
    for (const id of r.seats) expect(Object.values(r.buildings).filter((b) => b.owner === id).length).toBeGreaterThanOrEqual(2);
  });

  it('gives an away player short timers until they move again', () => {
    const { r, now } = setUp(3);
    const a = activePlayer(r)!;
    a.away = true;
    r.step = 'main';
    end(r, a.id, now); // their own move: not away any more
    expect(a.away).toBe(false);
    const b = activePlayer(r)!;
    b.away = true;
    b.autoEnds = 2;
    toMain(r, now);
    end(r, b.id, now);
    expect(b.away).toBe(false);
    expect(b.autoEnds).toBe(0);
    const d = setUp(3, 'medium', { pace: 'async' });
    const dp = activePlayer(d.r)!;
    dp.away = true;
    toMain(d.r, d.now);
    const e = activePlayer(d.r)!;
    expect(e).toBe(dp);
    // Pass to an away player: their roll waits an hour, not a day.
    const nextSeat = d.r.seats[(d.r.active + 1) % 3];
    P(d.r, nextSeat).away = true;
    end(d.r, dp.id, d.now);
    expect(deadline(d.r)).toBe(d.now + AWAY_MS.async);
  });

  it('closes a finished room after ten minutes live, three days async', () => {
    const { r, now } = setUp(3, 'medium', { pace: 'async' });
    leave(r, r.seats[0], now);
    leave(r, r.seats[1], now);
    expect(r.phase).toBe('finished');
    expect(deadline(r)).toBe(now + ASYNC_FINISHED_MS);
    advance(r, now + ASYNC_FINISHED_MS, Math.random);
    expect(r.phase).toBe('closed');
  });

  it('one step per advance: a room asleep for days moves once', () => {
    const { r, now } = setUp(3, 'medium', { pace: 'async' });
    const turn = r.turn;
    const step = r.step;
    advance(r, now + 30 * 86_400_000, Math.random);
    expect(r.turn === turn ? r.step !== step : true).toBe(true);
    expect(deadline(r)!).toBeGreaterThan(now + 30 * 86_400_000);
    expect(advance(r, Number.NaN, Math.random)).toBe(false);
  });

  it('resume restarts the running decision at full length', () => {
    const { r, now } = setUp(3, 'hard');
    r.phaseEndsAt = now - 5;
    resume(r, now + 60_000, 120_000);
    expect(deadline(r)).toBe(now + 60_000 + LIVE_MS.hard.roll);
  });
});

describe('waitingOn', () => {
  it('names who the room waits on with a key per decision', () => {
    const { r, now } = begun(3);
    const a = activePlayer(r)!.id;
    expect(waitingOn(r)).toEqual({ ids: [a], key: `${r.turn}:setup:${a}`, line: 'Your turn to place a cottage.' });
    const t = playUntil(r, now, (x) => x.step !== 'setup');
    const b = activePlayer(r)!.id;
    expect(waitingOn(r)).toMatchObject({ ids: [b], key: `${r.turn}:roll:${b}`, line: 'Your turn to roll.' });
    expect(waitingOn(lobby(3))).toBeNull();
    void t;
  });

  it('words the main-step push for the player it goes to, even when the clock rolled for them', () => {
    const { r, now } = setUp(3);
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < 2; i++) {
      const id = activePlayer(r)!.id;
      const auto = i % 2 === 1;
      r.step = 'roll';
      roll(r, id, now + i, auto);
      if ((r.step as Room['step']) !== 'main') continue; // roll() moved it on
      const w = waitingOn(r)!;
      expect(w.ids).toEqual([id]);
      expect(w.line).toBe(auto ? `The dice rolled ${r.dice!.total} for you.` : `You rolled ${r.dice!.total}.`);
      expect(w.line).not.toContain(P(r, id).name);
      seen.add(auto ? 'auto' : 'own');
    }
    expect([...seen].sort()).toEqual(['auto', 'own']);
  });
});

describe('scripted games, played to a win through moves only', () => {
  it.each([
    [3, 'medium', 1],
    [4, 'hard', 2],
    [5, 'easy', 3],
    [5, 'medium', 4],
  ] as const)('%i players, %s (seed %i): the bot plays to a winner; the room survives JSON at every step', (n, difficulty, seed) => {
    const { r, now } = begun(n, difficulty, { seed });
    const rand = seededRand(seed);
    let t = now;
    let checks = 0;
    for (let i = 0; i < 30_000 && r.phase === 'playing'; i++) {
      t += 1_000;
      if (r.log.filter((e) => e.kind === 'turn').length > 2_000) break;
      const turn = r.turn;
      botStep(r, t, rand);
      if (r.turn === turn && r.step === 'main' && r.log.slice(-40).every((e) => e.by === activePlayer(r)?.id)) end(r, activePlayer(r)!.id, t);
      expect(conserved(r)).toBe(true);
      // The durable contract: the room is plain JSON.
      if (i % 7 === 0) {
        expect(JSON.parse(JSON.stringify(r))).toEqual(r);
        checks++;
      }
    }
    expect(checks).toBeGreaterThan(10);
    expect(r.phase).toBe('finished');
    expect(r.result!.reason).toBe('points');
    const winner = r.result!.winnerId!;
    expect(totalVp(r, winner)).toBeGreaterThanOrEqual(r.vpTarget);
    expect(standings(r)[0]).toMatchObject({ id: winner, result: 'won', place: 1 });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    // The leaderboard records it from the standings: score = final points.
    const rows = roundRows(r, GAMES.homestead, 1, t, ['pace', 'deadlineHours', 'island']);
    expect(rows).toHaveLength(n);
    expect(rows[0]).toMatchObject({ playerId: winner, won: true, rank: 1, score: totalVp(r, winner) });
    expect(rows[0].options).toMatchObject({ pace: 'live', deadlineHours: 24, island: n === 5 ? 'large' : 'standard' });
    // Play again: a new island and seat order.
    const oldBoard = JSON.stringify(r.board);
    again(r, r.hostId, t);
    expect(r.phase).toBe('lobby');
    start(r, r.hostId, t);
    advance(r, t + COUNTDOWN_MS, Math.random);
    expect(r.phase).toBe('playing');
    expect(JSON.stringify(r.board)).not.toBe(oldBoard);
    expect(Object.keys(r.buildings)).toHaveLength(0);
  });
});

describe('the wire hides what it should', () => {
  it('a seeded five-player game: after every move, no viewer sees another hand, an unplayed card, the deck or the generator', () => {
    const { r, now } = begun(5, 'easy', { seed: 99 });
    const rand = seededRand(99);
    let t = now;
    let maxBytes = 0;
    for (let i = 0; i < 3_000 && r.phase === 'playing'; i++) {
      t += 1_000;
      botStep(r, t, rand);
      for (const viewer of r.seats) {
        const w = toWire(r, viewer, t);
        const json = JSON.stringify(w);
        maxBytes = Math.max(maxBytes, json.length);
        expect(json).not.toMatch(/"rng"|"deck"|"hand":\{[^}]*\}.*"hand":|boughtTurn|"secret"/);
        // Only my own hand and cards are listed.
        expect(Object.keys(w)).not.toContain('deck');
        for (const p of w.players) {
          expect(p).not.toHaveProperty('hand');
          expect(p).not.toHaveProperty('cards');
          if ((r.phase as string) !== 'finished') expect(p).not.toHaveProperty('heirlooms');
        }
        expect(w.me!.hand).toEqual(P(r, viewer).hand);
        expect(w.me!.cards.length).toBe(P(r, viewer).cards.length);
        // Legal options are only mine: off-turn in my roll/fox steps I get nothing.
        if (r.phase === 'playing' && activePlayer(r)!.id !== viewer && r.step !== 'discard') {
          expect(w.legal.canRoll).toBe(false);
          expect(w.legal.fox).toEqual([]);
          expect(w.legal.canEnd).toBe(false);
        }
        // Steal lines name the resource only for the two involved.
        for (const e of r.log) {
          if (e.kind !== 'steal') continue;
          const seen = w.log.find((x) => x.n === e.n);
          if (!seen) continue;
          const involved = Object.keys(e.secret ?? {}).includes(viewer);
          const named = RESOURCES.some((x) => seen.text.includes(` ${x} `));
          expect(named).toBe(involved);
        }
        // Another player's unplayed almanac cards: never by kind before the end.
        const others = r.players.filter((p) => p.id !== viewer).flatMap((p) => p.cards.map((c) => c.kind));
        const mine = new Set(P(r, viewer).cards.map((c) => c.kind));
        for (const k of others) {
          if (mine.has(k)) continue;
          if (k === 'heirloom' && (r.phase as string) !== 'finished') expect(json).not.toMatch(/heirloom/);
        }
      }
    }
    expect(maxBytes).toBeLessThan(40_000);
  });
});
