import { describe, expect, it } from 'vitest';
import * as ir from './iron-roads';
import { CARD_COLOURS, HEART, MAP_H, MAP_W, ROUTES, TICKETS, TOWNS, ROUTE_POINTS, shortestTrains, town } from './iron-roads-map';

const T0 = 1_000_000;
const NAMES = ['Sam', 'Alex', 'Jo', 'Pat', 'Kim'];

function room(n: number, seed = 7) {
  const players = NAMES.slice(0, n).map((name, i) => ({ id: `p_${i}`, name }));
  const r = ir.createRoom({ id: 'r1', host: players[0], invite: players.slice(1), difficulty: 'medium', options: { seed }, now: T0 });
  for (const p of players.slice(1)) ir.join(r, p.id, T0);
  ir.start(r, players[0].id, T0);
  ir.advance(r, T0 + ir.COUNTDOWN_MS, Math.random);
  return r;
}

/** Into play, everybody keeping all their starting tickets. */
function playing(n: number, seed = 7) {
  const r = room(n, seed);
  for (const p of ir.seated(r)) ir.keep(r, p.id, { tickets: p.pending!.ids }, T0 + 10);
  expect(r.phase).toBe('playing');
  return r;
}

const current = (r: ir.Room) => r.players.find((p) => p.id === r.turnId)!;
const idx = (id: string) => ROUTES.findIndex((x) => x.id === id);
const hand = (o: Partial<Record<ir.Card, number>>): Record<ir.Card, number> => ({ red: 0, blue: 0, green: 0, yellow: 0, black: 0, white: 0, engine: 0, ...o });
const errorOf = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e as ir.GameError;
  }
  throw new Error('expected a GameError');
};

describe('the map', () => {
  it('has the towns in the box, Darlington with five routes or more, single routes only', () => {
    expect(TOWNS.length).toBeGreaterThanOrEqual(20);
    for (const t of TOWNS) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(MAP_W);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(MAP_H);
    }
    expect(ROUTES.filter((r) => r.a === HEART || r.b === HEART).length).toBeGreaterThanOrEqual(5);
    const pairs = ROUTES.map((r) => [r.a, r.b].sort().join('|'));
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const r of ROUTES) {
      expect(town(r.a) && town(r.b)).toBeTruthy();
      expect(r.length).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeLessThanOrEqual(5);
    }
  });

  it('is connected', () => {
    for (const t of TOWNS) expect(shortestTrains(HEART, t.id)).toBeLessThan(Infinity);
  });

  it('has 26 tickets worth 4 to 20, each with a line', () => {
    expect(TICKETS.length).toBe(26);
    for (const t of TICKETS) {
      expect(t.points).toBeGreaterThanOrEqual(4);
      expect(t.points).toBeLessThanOrEqual(20);
      expect(t.line.length).toBeGreaterThan(10);
      expect(t.line).not.toMatch(/[!:]/);
    }
  });
});

describe('setup', () => {
  it('deals 4 cards, 25 trains, 3 tickets each, and a market of 5', () => {
    const r = room(3);
    expect(r.phase).toBe('choosing');
    for (const p of ir.seated(r)) {
      expect(Object.values(p.hand).reduce((a, b) => a + b, 0)).toBe(4);
      expect(p.trains).toBe(25);
      expect(p.pending!.ids).toHaveLength(3);
      expect(p.pending!.min).toBe(2);
    }
    expect(r.market.filter(Boolean)).toHaveLength(5);
    expect(r.market.filter((c) => c === 'engine').length).toBeLessThan(3);
    const total = r.deck.length + r.discard.length + r.market.length + ir.seated(r).length * 4;
    expect(total).toBe(CARD_COLOURS.length * 12 + 14);
  });

  it('refuses a keep of fewer than two, and starts once everybody has kept', () => {
    const r = room(2);
    const [a, b] = ir.seated(r);
    expect(errorOf(() => ir.keep(r, a.id, { tickets: [a.pending!.ids[0]] }, T0)).status).toBe(400);
    expect(errorOf(() => ir.keep(r, a.id, { tickets: [999, a.pending!.ids[0]] }, T0)).status).toBe(400);
    const back = a.pending!.ids[2];
    ir.keep(r, a.id, { tickets: a.pending!.ids.slice(0, 2) }, T0);
    expect(a.tickets).toHaveLength(2);
    expect(r.ticketDeck.at(-1)).toBe(back);
    expect(r.phase).toBe('choosing');
    ir.keep(r, b.id, { tickets: b.pending!.ids }, T0);
    expect(r.phase).toBe('playing');
    expect(r.turnId).toBe(a.id);
  });

  it('keeps all three for anybody who runs out of time choosing', () => {
    const r = room(3);
    const [a] = ir.seated(r);
    ir.keep(r, a.id, { tickets: a.pending!.ids.slice(0, 2) }, T0);
    ir.advance(r, r.phaseEndsAt!, Math.random);
    expect(r.phase).toBe('playing');
    expect(a.tickets).toHaveLength(2);
    for (const p of ir.seated(r).slice(1)) expect(p.tickets).toHaveLength(3);
  });

  it('needs two players and allows five', () => {
    const solo = ir.createRoom({ id: 'x', host: { id: 'p_0', name: 'Sam' }, invite: [], difficulty: 'easy', now: T0 });
    expect(errorOf(() => ir.start(solo, 'p_0', T0)).status).toBe(409);
    const six = NAMES.concat('Lee').map((name, i) => ({ id: `p_${i}`, name }));
    expect(errorOf(() => ir.createRoom({ id: 'x', host: six[0], invite: six.slice(1), difficulty: 'easy', now: T0 })).status).toBe(400);
    expect(room(5).players.filter((p) => p.seat !== null)).toHaveLength(5);
    expect(ir.maxPlayers).toBe(5);
    expect(ir.minPlayers).toBe(2);
  });
});

describe('drawing', () => {
  it('two cards end the turn', () => {
    const r = playing(2);
    const a = current(r);
    ir.draw(r, a.id, { source: 'deck' }, T0 + 20);
    expect(r.turnId).toBe(a.id);
    ir.draw(r, a.id, { source: 0 }, T0 + 21);
    expect(r.turnId).not.toBe(a.id);
    expect(Object.values(a.hand).reduce((x, y) => x + y, 0)).toBe(6);
    expect(r.market.filter(Boolean)).toHaveLength(5);
  });

  it('a face-up engine is the whole turn, and never the second card', () => {
    const r = playing(2);
    const a = current(r);
    r.market = ['engine', 'red', 'blue', 'green', 'yellow'];
    ir.draw(r, a.id, { source: 'deck' }, T0 + 20);
    expect(errorOf(() => ir.draw(r, a.id, { source: 0 }, T0 + 21)).status).toBe(400);
    ir.draw(r, a.id, { source: 1 }, T0 + 22);
    const b = current(r);
    expect(b.id).not.toBe(a.id);
    r.market = ['engine', 'red', 'blue', 'green', 'yellow'];
    const engines = b.hand.engine;
    ir.draw(r, b.id, { source: '0' }, T0 + 23);
    expect(b.hand.engine).toBe(engines + 1);
    expect(r.turnId).toBe(a.id);
  });

  it('refuses off-turn and bad sources', () => {
    const r = playing(2);
    const other = ir.seated(r).find((p) => p.id !== r.turnId)!;
    expect(errorOf(() => ir.draw(r, other.id, { source: 'deck' }, T0)).status).toBe(409);
    expect(errorOf(() => ir.draw(r, r.turnId!, { source: 9 }, T0)).status).toBe(400);
  });

  it('re-deals a market showing three engines', () => {
    const r = playing(2);
    const a = current(r);
    r.market = ['engine', 'engine', 'red', 'blue', 'green'];
    r.deck.push('engine'); // the card that refills slot 2
    ir.draw(r, a.id, { source: 2 }, T0 + 20);
    expect(r.market.filter((c) => c === 'engine').length).toBeLessThan(3);
    expect(r.market.filter(Boolean)).toHaveLength(5);
  });

  it('shuffles the discard back in when the deck runs dry', () => {
    const r = playing(2);
    const a = current(r);
    r.discard.push(...r.deck);
    r.deck = [];
    ir.draw(r, a.id, { source: 'deck' }, T0 + 20);
    expect(r.deck.length).toBeGreaterThan(0);
    expect(r.discard).toHaveLength(0);
  });
});

describe('claiming', () => {
  it('pays in the route colour with engines wild, lays trains and scores', () => {
    const r = playing(2);
    const a = current(r);
    a.hand = hand({ yellow: 1, engine: 3 });
    const id = 'darlington-stockton'; // 3 yellow
    ir.claim(r, a.id, { route: id, colour: 'yellow' }, T0 + 20);
    expect(r.owners[idx(id)]).toBe(a.id);
    expect(a.hand.yellow).toBe(0);
    expect(a.hand.engine).toBe(1);
    expect(a.trains).toBe(22);
    expect(a.score).toBe(4);
    expect(r.last).toBe(`${a.name} claimed Darlington – Stockton`);
    expect(r.turnId).not.toBe(a.id);
  });

  it('refuses the wrong colour, too few cards, a taken route, and a claim after drawing', () => {
    const r = playing(2);
    const a = current(r);
    a.hand = hand({ red: 2, engine: 0 });
    expect(errorOf(() => ir.claim(r, a.id, { route: 'darlington-stockton', colour: 'red' }, T0)).status).toBe(400);
    expect(errorOf(() => ir.claim(r, a.id, { route: 'darlington-stockton' }, T0)).status).toBe(400);
    expect(errorOf(() => ir.claim(r, a.id, { route: 'nowhere' }, T0)).status).toBe(400);
    r.owners[idx('shildon-darlington')] = 'p_9';
    expect(errorOf(() => ir.claim(r, a.id, { route: 'shildon-darlington' }, T0)).status).toBe(409);
    ir.draw(r, a.id, { source: 'deck' }, T0);
    a.hand = hand({ green: 5 });
    expect(errorOf(() => ir.claim(r, a.id, { route: 'stockton-yarm' }, T0)).status).toBe(409);
  });

  it('pays a grey route in any one colour, and asks which when there is a choice', () => {
    const r = playing(2);
    const a = current(r);
    a.hand = hand({ red: 2, blue: 2 });
    const id = 'darlington-yarm'; // 2 grey
    expect(ir.payOptions(a.hand, 2, 'grey')).toEqual(['red', 'blue']);
    expect(errorOf(() => ir.claim(r, a.id, { route: id }, T0)).status).toBe(400);
    ir.claim(r, a.id, { route: id, colour: 'blue' }, T0);
    expect(a.hand).toEqual(hand({ red: 2 }));
    expect(a.score).toBe(2);
  });

  it('may pay with engines alone', () => {
    const r = playing(2);
    const a = current(r);
    a.hand = hand({ engine: 2 });
    ir.claim(r, a.id, { route: 'darlington-yarm' }, T0);
    expect(a.hand.engine).toBe(0);
    expect(r.discard.filter((c) => c === 'engine').length).toBeGreaterThanOrEqual(2);
  });

  it('scores 1/2/4/7/10/15 by length', () => {
    expect([...ROUTE_POINTS].slice(1)).toEqual([1, 2, 4, 7, 10, 15]);
    const r = playing(2);
    const a = current(r);
    a.hand = hand({ black: 5 });
    ir.claim(r, a.id, { route: 'hexham-barnard' }, T0); // 5 black
    expect(a.score).toBe(10);
  });

  it('refuses a route longer than the trains left', () => {
    const r = playing(2);
    const a = current(r);
    a.hand = hand({ black: 5 });
    a.trains = 4;
    expect(errorOf(() => ir.claim(r, a.id, { route: 'hexham-barnard' }, T0)).status).toBe(400);
  });
});

describe('tickets mid-game', () => {
  it('draws three, keeps at least one, the rest go back', () => {
    const r = playing(2);
    const a = current(r);
    const before = a.tickets.length;
    ir.tickets(r, a.id, {}, T0 + 20);
    expect(a.pending!.ids).toHaveLength(3);
    expect(a.pending!.min).toBe(1);
    expect(errorOf(() => ir.draw(r, a.id, { source: 'deck' }, T0)).status).toBe(409);
    expect(errorOf(() => ir.keep(r, a.id, { tickets: [] }, T0)).status).toBe(400);
    ir.keep(r, a.id, { tickets: [a.pending!.ids[1]] }, T0 + 21);
    expect(a.tickets).toHaveLength(before + 1);
    expect(r.turnId).not.toBe(a.id);
  });

  it('on the clock running out keeps the cheapest one', () => {
    const r = playing(2);
    const a = current(r);
    ir.tickets(r, a.id, {}, T0 + 20);
    const cheapest = Math.min(...a.pending!.ids.map((id) => TICKETS.find((t) => t.id === id)!.points));
    const before = a.tickets.length;
    ir.advance(r, r.phaseEndsAt!, Math.random);
    expect(a.tickets).toHaveLength(before + 1);
    expect(TICKETS.find((t) => t.id === a.tickets.at(-1))!.points).toBe(cheapest);
    expect(r.turnId).not.toBe(a.id);
  });
});

describe('the clock', () => {
  it('draws two from the deck for somebody out of time, and gives them less time next', () => {
    const r = playing(2);
    const a = current(r);
    const deck = r.deck.length;
    ir.advance(r, r.phaseEndsAt!, Math.random);
    expect(Object.values(a.hand).reduce((x, y) => x + y, 0)).toBe(6);
    expect(r.deck.length).toBe(deck - 2);
    expect(r.turnId).not.toBe(a.id);
    const b = current(r);
    ir.draw(r, b.id, { source: 'deck' }, r.turnStartedAt!);
    ir.draw(r, b.id, { source: 'deck' }, r.turnStartedAt!);
    expect(r.turnId).toBe(a.id);
    expect(r.phaseEndsAt! - r.turnStartedAt!).toBe(ir.AWAY_MS);
  });

  it('finishes the second draw for somebody who drew one', () => {
    const r = playing(2);
    const a = current(r);
    ir.draw(r, a.id, { source: 'deck' }, T0 + 20);
    ir.advance(r, r.phaseEndsAt!, Math.random);
    expect(Object.values(a.hand).reduce((x, y) => x + y, 0)).toBe(6);
    expect(r.turnId).not.toBe(a.id);
  });

  it('does nothing before the deadline', () => {
    const r = playing(2);
    expect(ir.advance(r, r.phaseEndsAt! - 1, Math.random)).toBe(false);
  });
});

describe('scoring', () => {
  it('joins tickets up through claimed routes only', () => {
    const routes = ROUTES.filter((x) => ['shildon-darlington', 'darlington-stockton', 'stockton-middlesbrough'].includes(x.id));
    expect(ir.connects(routes, 'shildon', 'middlesbrough')).toBe(true);
    expect(ir.connects(routes, 'shildon', 'redcar')).toBe(false);
  });

  it('finds the longest line without reusing a route', () => {
    const pick = (ids: string[]) => ROUTES.filter((x) => ids.includes(x.id));
    // A star at Darlington: the best line goes through it once, along its two longest arms.
    expect(ir.longestLine(pick(['darlington-barnard', 'darlington-stockton', 'darlington-yarm']))).toBe(8);
    // A loop and a tail: round the loop and out.
    expect(ir.longestLine(pick(['darlington-stockton', 'stockton-yarm', 'darlington-yarm', 'yarm-northallerton']))).toBe(9);
    expect(ir.longestLine([])).toBe(0);
    // The whole map in one hand still comes back (the search is budgeted), and at least as long as any route.
    expect(ir.longestLine(ROUTES)).toBeGreaterThan(30);
  });

  it('adds completed tickets, takes off the rest, and gives the longest line 10', () => {
    const r = playing(2);
    const [a, b] = ir.seated(r);
    const t1 = TICKETS.find((t) => t.a === 'shildon' && t.b === 'stockton')!;
    const t2 = TICKETS.find((t) => t.a === 'darlington' && t.b === 'whitby')!;
    a.tickets = [t1.id, t2.id];
    b.tickets = [t2.id];
    r.owners[idx('shildon-darlington')] = a.id;
    r.owners[idx('darlington-stockton')] = a.id;
    a.routePoints = 2 + 4;
    r.owners[idx('hexham-barnard')] = b.id;
    b.routePoints = 10;
    a.trains = 4;
    a.hand = hand({ green: 2 });
    r.turnId = a.id;
    ir.claim(r, a.id, { route: 'stockton-yarm' }, T0); // 2 green: down to 2 trains
    expect(r.finalRound).toEqual({ byId: a.id, left: [b.id, a.id] });
    playOut(r);
    expect(r.phase).toBe('finished');
    expect(r.result!.reason).toBe('trains');
    const [first, second] = ir.standings(r);
    expect(first).toMatchObject({ id: a.id, routePoints: 8, ticketPoints: 4 - t2.points, longest: 7, longestBonus: 10, ticketsDone: 1, ticketsFailed: 1 });
    expect(first.score).toBe(8 + 4 - t2.points + 10);
    expect(second).toMatchObject({ id: b.id, routePoints: 10, ticketPoints: -t2.points, longest: 5, longestBonus: 0 });
    expect(first.tickets.find((t) => t.id === t1.id)!.done).toBe(true);
    expect(ir.winners(r)).toEqual([a.id]);
  });

  it('shares the longest-line bonus on a tie', () => {
    const r = playing(2);
    const [a, b] = ir.seated(r);
    a.tickets = [];
    b.tickets = [];
    r.owners[idx('hexham-barnard')] = a.id;
    r.owners[idx('darlington-barnard')] = b.id;
    a.trains = 2;
    playOut(r);
    const s = ir.standings(r);
    expect(s.every((x) => x.longestBonus === 10)).toBe(true);
  });
});

/** Everybody draws two from the deck until the game is over. */
function playOut(r: ir.Room) {
  for (let guard = 0; guard < 50 && r.phase === 'playing'; guard++) {
    const p = current(r);
    ir.draw(r, p.id, { source: 'deck' }, T0 + 100);
    if (r.turnId === p.id && r.phase === 'playing') ir.draw(r, p.id, { source: 'deck' }, T0 + 100);
  }
}

describe('the last round', () => {
  it('gives everybody, the caller too, exactly one more turn', () => {
    const r = playing(3);
    const [a, b, c] = ir.seated(r);
    a.trains = 3;
    a.hand = hand({ white: 1 });
    ir.claim(r, a.id, { route: 'crook-bishop' }, T0); // 1 white: 2 left
    expect(r.finalRound!.left).toEqual([b.id, c.id, a.id]);
    for (const p of [b, c, a]) {
      expect(r.turnId).toBe(p.id);
      ir.draw(r, p.id, { source: 'deck' }, T0);
      ir.draw(r, p.id, { source: 'deck' }, T0);
    }
    expect(r.phase).toBe('finished');
  });

  it('ends at once when the whole map is claimed', () => {
    const r = playing(2);
    const a = current(r);
    r.owners = r.owners.map((_, i) => (ROUTES[i].id === 'crook-bishop' ? null : 'p_9'));
    a.hand = hand({ white: 1 });
    ir.claim(r, a.id, { route: 'crook-bishop' }, T0);
    expect(r.phase).toBe('finished');
    expect(r.result!.reason).toBe('map');
  });
});

describe('the wire', () => {
  it('never shows another hand or another player’s tickets before the finish', () => {
    const r = room(3);
    const [a, b] = ir.seated(r);
    const w = ir.toWire(r, a.id, T0);
    expect(w.me!.pending!.tickets).toHaveLength(3);
    expect(w.me!.hand).toEqual(a.hand);
    const text = JSON.stringify(w);
    for (const id of b.pending!.ids.filter((x) => !a.pending!.ids.includes(x))) {
      const t = TICKETS.find((x) => x.id === id)!;
      expect(text).not.toContain(t.line);
    }
    for (const p of w.players) expect(Object.keys(p)).not.toContain('hand');
    const s = JSON.stringify(ir.toScreen(r, T0));
    expect(s).not.toContain('"hand"');
    expect(s).not.toContain('"pending"');
    for (const t of TICKETS) expect(s).not.toContain(t.line);
    expect(Object.keys(ir.toScreen(r, T0))).not.toContain('me');
  });

  it('shows my tickets with whether they are joined up, and what I can claim on my turn', () => {
    const r = playing(2);
    const a = current(r);
    const t1 = TICKETS.find((t) => t.a === 'shildon' && t.b === 'stockton')!;
    a.tickets = [t1.id];
    r.owners[idx('shildon-darlington')] = a.id;
    r.owners[idx('darlington-stockton')] = a.id;
    a.hand = hand({ red: 2, engine: 1 });
    const w = ir.toWire(r, a.id, T0);
    expect(w.me!.tickets[0]).toMatchObject({ id: t1.id, done: true });
    expect(w.me!.myTurn).toBe(true);
    const ids = w.me!.claimable.map((c) => c.route);
    expect(ids).toContain('newcastle-sunderland'); // 3 red: 2 red + an engine
    expect(ids).not.toContain('shildon-darlington'); // mine already
    const other = ir.toWire(r, ir.seated(r).find((p) => p.id !== a.id)!.id, T0);
    expect(other.me!.claimable).toEqual([]);
    expect(other.me!.myTurn).toBe(false);
  });

  it('shows everybody’s tickets once finished', () => {
    const r = playing(2);
    ir.seated(r)[0].trains = 2;
    playOut(r);
    const s = ir.toScreen(r, T0);
    expect(s.standings!.every((x) => x.tickets.length >= 2)).toBe(true);
  });
});

/** A small seeded generator for the simulations. */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function simulate(n: number, seed: number) {
  const rnd = lcg(seed);
  const r = room(n, seed);
  let now = T0 + ir.COUNTDOWN_MS;
  let steps = 0;
  const pickOf = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  while (r.phase === 'choosing' || r.phase === 'playing') {
    if (++steps > 20_000) throw new Error('the game never ended');
    now += 500;
    if (rnd() < 0.04) {
      // Somebody wanders off: let the clock do it.
      const due = ir.deadline(r);
      if (due !== null) now = Math.max(now, due);
      ir.advance(r, now, rnd);
      continue;
    }
    const deciding = r.phase === 'choosing' ? ir.seated(r).filter((p) => p.pending) : [current(r)];
    const p = pickOf(deciding);
    const w = ir.toWire(r, p.id, now).me!;
    if (w.pending) {
      const ids = w.pending.tickets.map((t) => t.id).filter(() => rnd() < 0.6);
      const keepIds = ids.length >= w.pending.min ? ids : w.pending.tickets.slice(0, w.pending.min).map((t) => t.id);
      ir.keep(r, p.id, { tickets: keepIds }, now);
      continue;
    }
    const options: (() => void)[] = [];
    for (const c of w.claimable) options.push(() => ir.claim(r, p.id, { route: c.route, colour: pickOf(c.colours) }, now), () => ir.claim(r, p.id, { route: c.route, colour: pickOf(c.colours) }, now));
    if (w.canDeck) options.push(() => ir.draw(r, p.id, { source: 'deck' }, now));
    w.canMarket.forEach((ok, i) => ok && options.push(() => ir.draw(r, p.id, { source: i }, now)));
    if (w.canTickets && rnd() < 0.15) options.push(() => ir.tickets(r, p.id, {}, now));
    if (!options.length) {
      const due = ir.deadline(r);
      now = Math.max(now, due ?? now);
      ir.advance(r, now, rnd);
      continue;
    }
    pickOf(options)();
    // Cards are never made or lost.
    const held = ir.seated(r).reduce((a, x) => a + Object.values(x.hand).reduce((u, v) => u + v, 0), 0);
    expect(held + r.deck.length + r.discard.length + r.market.filter(Boolean).length).toBe(86);
    for (const x of ir.seated(r)) expect(x.trains).toBeGreaterThanOrEqual(0);
  }
  return r;
}

describe('a whole game of random legal moves', () => {
  for (const n of [2, 3, 5]) {
    for (const seed of [1, 2, 3]) {
      it(`finishes for ${n} players (seed ${seed})`, () => {
        const r = simulate(n, seed);
        expect(r.phase).toBe('finished');
        const s = ir.standings(r);
        expect(s).toHaveLength(n);
        for (const x of s) expect(Number.isFinite(x.score)).toBe(true);
        expect(ir.winners(r).length).toBeGreaterThan(0);
        const claimed = r.owners.filter(Boolean).length;
        expect(claimed).toBeGreaterThan(0);
      });
    }
  }
});
