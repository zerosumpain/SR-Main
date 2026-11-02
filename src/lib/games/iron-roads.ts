// Iron Roads: Darlington Edition — route building on a North-East rail map,
// as pure functions over a room (the Azul shape: every function takes `now`,
// the registry owns timers and fan-out, the room carries its own seeded
// generator so a test can seed a whole game). In memory only — not durable.
//
// The game, for two to five, about half an hour:
//  - Everybody starts with 4 cards, 25 trains and 3 destination tickets, of
//    which they keep at least 2 (60 s; on the clock running out all 3 are kept).
//  - The deck is 12 cards of each of six colours and 14 engines (wild). Five
//    sit face up in the market; three or more engines showing re-deals it. The
//    discard is shuffled back in when the deck runs dry.
//  - A turn (60 s) is ONE of: draw two cards (a face-up engine is the whole
//    turn, and never the second card); claim a route, paying its length in one
//    colour (grey: any one colour) with engines wild, scoring 1/2/4/7/10/15 for
//    lengths 1–6; or draw 3 tickets and keep at least 1. A turn that times out
//    draws two from the deck (or keeps the cheapest ticket if one is waiting).
//  - When somebody ends a turn on 2 trains or fewer, everybody — them too —
//    has one last turn. A full map, a table with nothing left to do, or the
//    turn cap end it as well.
//  - Final scores: routes, plus each completed ticket, minus each one not
//    joined up, plus 10 for the longest continuous line (ties share it).
//
// Hidden: each hand and each player's tickets, until the finish shows them all.
//
// The moves (registered as `{ action, ...fields }` → `move(room, playerId, input, now)`):
//   keep    { tickets: number[] }                     — the tickets to keep from the ones on offer
//   draw    { source: 'deck' | 0 | 1 | 2 | 3 | 4 }     — one card, from the deck or a market slot
//   claim   { route: string, colour?: CardColour | 'engine' }
//                                                     — a route id (`ROUTES[i].id`); `colour` is the
//                                                       colour paid (required on grey unless only one
//                                                       works; 'engine' pays with engines alone)
//   tickets {}                                        — draw three tickets to choose from

import { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES, type Difficulty, type PlayerStatus, type Rng } from './tap-duel';
import { nextFloat, seedRng, type RngState } from './homestead-model';
import { CARD_COLOURS, ROUTES, ROUTE_POINTS, TICKETS, routeName, ticket as ticketById, ticketName, type CardColour } from './iron-roads-map';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng, CardColour };

export type Phase = 'lobby' | 'countdown' | 'choosing' | 'playing' | 'finished' | 'closed';
export type Card = CardColour | 'engine';
export const CARDS: readonly Card[] = [...CARD_COLOURS, 'engine'];

export const maxPlayers = 5;
export const minPlayers = 2;
export const CARDS_PER_COLOUR = 12;
export const ENGINES = 14;
export const MARKET_SIZE = 5;
export const START_CARDS = 4;
export const START_TRAINS = 25;
export const START_TICKETS = 3;
export const START_KEEP = 2;
export const DRAW_TICKETS = 3;
export const LAST_ROUND_TRAINS = 2;
export const LONGEST_BONUS = 10;
export const TURN_MS = 60_000;
export const CHOOSE_MS = 60_000;
/** Somebody whose clock ran out last turn gets this long until they move again. */
export const AWAY_MS = 20_000;
/** Turns per player before the game calls its last round regardless. */
export const TURN_CAP_PER_PLAYER = 40;
const LONGEST_SEARCH_BUDGET = 400_000;

export interface TicketOffer {
  ids: number[];
  /** Fewest to keep. */
  min: number;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Turn order once play starts; also picks the player's colour on the board. Null before, or not seated. */
  seat: number | null;
  hand: Record<Card, number>;
  trains: number;
  tickets: number[];
  pending: TicketOffer | null;
  /** Points from routes so far; the final score once finished. */
  score: number;
  routePoints: number;
  away: number;
}

export interface TicketResult {
  id: number;
  from: string;
  to: string;
  points: number;
  done: boolean;
}

export interface FinalTally {
  routePoints: number;
  ticketPoints: number;
  longest: number;
  longestBonus: number;
  tickets: TicketResult[];
}

export interface LogEntry {
  n: number;
  at: number;
  by: string | null;
  text: string;
  auto: boolean;
}

export interface Room {
  id: string;
  game: 'iron-roads';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  rng: RngState;
  deck: Card[];
  discard: Card[];
  market: (Card | null)[];
  ticketDeck: number[];
  /** Who owns each route, by `ROUTES` index. */
  owners: (string | null)[];
  turnId: string | null;
  turnStartedAt: number | null;
  /** Cards drawn this turn (0 or 1). */
  drawn: number;
  turns: number;
  /** The last round: who called it, and who still has their final turn, in order. */
  finalRound: { byId: string; left: string[] } | null;
  /** Turns in a row in which nobody could do anything. */
  idle: number;
  last: string | null;
  /** The route the last action claimed, for the board's highlight. */
  lastRoute: string | null;
  log: LogEntry[];
  tally: Record<string, FinalTally> | null;
  result: { winnerIds: string[]; reason: 'trains' | 'map' | 'stuck' | 'cap' | 'left' } | null;
  startedAt: number | null;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const emptyHand = (): Record<Card, number> => ({ red: 0, blue: 0, green: 0, yellow: 0, black: 0, white: 0, engine: 0 });

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seat: null, hand: emptyHand(), trains: START_TRAINS, tickets: [], pending: null, score: 0, routePoints: 0, away: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

export function seated(room: Room): Player[] {
  return room.players.filter((p) => p.seat !== null).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
}

function active(room: Room): Player[] {
  return seated(room).filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

const handSize = (h: Record<Card, number>) => CARDS.reduce((a, c) => a + h[c], 0);

function shuffle<T>(room: Room, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(room.rng) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function log(room: Room, now: number, by: string | null, text: string, auto = false): void {
  const n = (room.log.at(-1)?.n ?? 0) + 1;
  room.log.push({ n, at: now, by, text, auto });
  if (room.log.length > 30) room.log.splice(0, room.log.length - 30);
  if (by) {
    room.last = text;
    room.lastRoute = null;
  }
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const o = input.options ?? {};
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > maxPlayers - 1) throw new GameError(400, `Iron Roads is for two to ${maxPlayers}.`);
  return {
    id: input.id,
    game: 'iron-roads',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    rng: seedRng(o.seed),
    deck: [],
    discard: [],
    market: [],
    ticketDeck: [],
    owners: ROUTES.map(() => null),
    turnId: null,
    turnStartedAt: null,
    drawn: 0,
    turns: 0,
    finalRound: null,
    idle: 0,
    last: null,
    lastRoute: null,
    log: [],
    tally: null,
    result: null,
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function about(_room: Room): string {
  return 'on the TV board · claim the railways round Darlington';
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length >= maxPlayers) throw new GameError(409, `Iron Roads is for up to ${maxPlayers}.`);
  p.status = 'joined';
  room.updatedAt = now;
}

export function decline(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'invited') return;
  p.status = 'declined';
  room.updatedAt = now;
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.turnId = null;
  room.turnStartedAt = null;
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

/**
 * The host leaving the lobby cancels it; the last one out closes the room.
 * Mid-game the leaver's routes stay on the map, their hand goes to the
 * discard, and the rest play on; one player left ends it.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') return;
  p.status = 'left';
  room.updatedAt = now;
  if (room.phase === 'lobby' && playerId === room.hostId) {
    close(room, now);
    return;
  }
  const rest = joined(room);
  if (rest.length === 0) {
    close(room, now);
    return;
  }
  if (playerId === room.hostId) room.hostId = rest[0].id;
  if (p.seat === null || (room.phase !== 'playing' && room.phase !== 'choosing')) return;
  log(room, now, null, `${p.name} left the game.`);
  for (const c of CARDS) for (let k = 0; k < p.hand[c]; k++) room.discard.push(c);
  p.hand = emptyHand();
  if (p.pending) {
    room.ticketDeck.push(...p.pending.ids);
    p.pending = null;
  }
  if (room.finalRound) room.finalRound.left = room.finalRound.left.filter((id) => id !== p.id);
  if (active(room).length < minPlayers) {
    finish(room, 'left', now);
    return;
  }
  if (room.phase === 'choosing') {
    if (active(room).every((x) => !x.pending)) beginPlay(room, now);
    return;
  }
  if (room.turnId === playerId) endTurn(room, p, now);
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  const in_ = joined(room);
  if (in_.length < minPlayers) throw new GameError(409, 'Iron Roads needs at least two players.');
  if (in_.length > maxPlayers) throw new GameError(409, `Iron Roads is for up to ${maxPlayers}: ask somebody to leave.`);
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  room.players = room.players.map((p) => player(p.id, p.name, p.status === 'joined' ? 'joined' : 'invited'));
  Object.assign(room, {
    phase: 'lobby',
    deck: [],
    discard: [],
    market: [],
    ticketDeck: [],
    owners: ROUTES.map(() => null),
    turnId: null,
    turnStartedAt: null,
    drawn: 0,
    turns: 0,
    finalRound: null,
    idle: 0,
    last: null,
    lastRoute: null,
    log: [],
    tally: null,
    result: null,
    startedAt: null,
    phaseEndsAt: now + LOBBY_MS,
    createdAt: now,
    updatedAt: now,
  } satisfies Partial<Room>);
}

// ---- Cards -----------------------------------------------------------------

/** One card off the deck, shuffling the discard back in when it runs dry; null when there are none. */
function drawCard(room: Room): Card | null {
  if (!room.deck.length && room.discard.length) {
    room.deck = shuffle(room, room.discard);
    room.discard = [];
  }
  return room.deck.pop() ?? null;
}

const enginesShowing = (room: Room) => room.market.filter((c) => c === 'engine').length;

/** Fill the market's gaps; three engines or more face up and it is dealt again (a few tries, then left be). */
function refillMarket(room: Room): void {
  for (let tries = 0; tries < 4; tries++) {
    for (let i = 0; i < MARKET_SIZE; i++) if (room.market[i] == null) room.market[i] = drawCard(room);
    if (enginesShowing(room) < 3) return;
    // Only re-deal when there is something else to deal, or it loops on engines.
    const others = [...room.deck, ...room.discard].filter((c) => c !== 'engine').length;
    if (others < 3) return;
    for (let i = 0; i < MARKET_SIZE; i++) {
      const c = room.market[i];
      if (c) room.discard.push(c);
      room.market[i] = null;
    }
  }
}

function dealTickets(room: Room, n: number): number[] {
  return room.ticketDeck.splice(0, n);
}

// ---- Play ------------------------------------------------------------------

function begin(room: Room, now: number): void {
  const order = shuffle(room, joined(room));
  for (const p of room.players) Object.assign(p, { ...player(p.id, p.name, p.status) });
  order.forEach((p, i) => (p.seat = i));
  const cards: Card[] = [];
  for (const c of CARD_COLOURS) for (let k = 0; k < CARDS_PER_COLOUR; k++) cards.push(c);
  for (let k = 0; k < ENGINES; k++) cards.push('engine');
  room.deck = shuffle(room, cards);
  room.discard = [];
  room.market = Array.from({ length: MARKET_SIZE }, () => null);
  room.ticketDeck = shuffle(
    room,
    TICKETS.map((t) => t.id),
  );
  room.owners = ROUTES.map(() => null);
  room.turns = 0;
  room.drawn = 0;
  room.finalRound = null;
  room.idle = 0;
  room.tally = null;
  room.result = null;
  room.log = [];
  room.last = null;
  room.lastRoute = null;
  room.startedAt = now;
  for (const p of order) {
    for (let k = 0; k < START_CARDS; k++) {
      const c = drawCard(room);
      if (c) p.hand[c]++;
    }
    p.pending = { ids: dealTickets(room, START_TICKETS), min: START_KEEP };
  }
  refillMarket(room);
  room.phase = 'choosing';
  room.turnId = null;
  room.turnStartedAt = now;
  room.phaseEndsAt = now + CHOOSE_MS;
  room.updatedAt = now;
  log(room, now, null, `${order.map((p) => p.name).join(', ')} take their seats. Pick your tickets.`);
}

function beginPlay(room: Room, now: number): void {
  const first = active(room)[0];
  room.phase = 'playing';
  room.drawn = 0;
  room.updatedAt = now;
  if (!first) {
    finish(room, 'left', now);
    return;
  }
  setTurn(room, first, now);
  log(room, now, null, `Tickets are in. ${first.name} goes first.`);
}

function setTurn(room: Room, p: Player, now: number): void {
  room.turnId = p.id;
  room.turnStartedAt = now;
  room.drawn = 0;
  // Nothing they could do: the clock runs out at once and `advance` passes them.
  room.phaseEndsAt = stuck(room, p) ? now : now + (p.away > 0 ? AWAY_MS : TURN_MS);
}

function next(room: Room, from: Player): Player | null {
  const order = seated(room);
  const at = order.findIndex((x) => x.id === from.id);
  for (let k = 1; k <= order.length; k++) {
    const p = order[(at + k) % order.length];
    if (p.status === 'joined') return p;
  }
  return null;
}

/** A turn is over: call the last round if it is due, finish if that was the last of it, else pass on. */
function endTurn(room: Room, p: Player, now: number): void {
  room.turns += 1;
  room.drawn = 0;
  room.updatedAt = now;
  if (room.owners.every((o) => o !== null)) {
    finish(room, 'map', now);
    return;
  }
  const players = active(room);
  if (room.finalRound) {
    room.finalRound.left = room.finalRound.left.filter((id) => id !== p.id);
    const nextId = room.finalRound.left.find((id) => players.some((x) => x.id === id));
    if (!nextId) {
      finish(room, room.finalRound.byId === '' ? 'cap' : 'trains', now);
      return;
    }
    setTurn(room, players.find((x) => x.id === nextId)!, now);
    return;
  }
  const cap = room.turns >= TURN_CAP_PER_PLAYER * Math.max(1, players.length);
  if ((p.status === 'joined' && p.trains <= LAST_ROUND_TRAINS) || cap) {
    // Everybody, them too, gets one more go — starting with whoever is next.
    const order: string[] = [];
    let at: Player | null = p;
    for (let k = 0; k < players.length; k++) {
      at = at ? next(room, at) : null;
      if (at && !order.includes(at.id)) order.push(at.id);
    }
    room.finalRound = { byId: p.trains <= LAST_ROUND_TRAINS ? p.id : '', left: order };
    log(
      room,
      now,
      null,
      p.trains <= LAST_ROUND_TRAINS ? `${p.name} is down to ${p.trains} ${p.trains === 1 ? 'train' : 'trains'} — one last turn each.` : 'Last round — one more turn each.',
    );
    const first = players.find((x) => x.id === order[0]);
    if (!first) {
      finish(room, 'trains', now);
      return;
    }
    setTurn(room, first, now);
    return;
  }
  const n = next(room, p);
  if (!n) {
    finish(room, 'left', now);
    return;
  }
  setTurn(room, n, now);
}

function onTurn(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (p.status !== 'joined' || p.seat === null) throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'playing') throw new GameError(409, room.phase === 'choosing' ? 'Pick your tickets first.' : 'The game is not under way.');
  if (room.turnId !== p.id) throw new GameError(409, "It's not your turn.");
  return p;
}

/** Can a second card be taken this turn: the deck, or a market card that is not an engine. */
function canDrawSecond(room: Room): boolean {
  return room.deck.length + room.discard.length > 0 || room.market.some((c) => c && c !== 'engine');
}

function canDrawAny(room: Room): boolean {
  return room.deck.length + room.discard.length > 0 || room.market.some((c) => c !== null);
}

function parseSource(v: unknown): 'deck' | number | null {
  if (v === 'deck') return 'deck';
  const n = typeof v === 'string' && /^\d$/.test(v) ? Number(v) : v;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < MARKET_SIZE) return n;
  return null;
}

/** Draw one card. Two a turn; a face-up engine is the whole turn and never the second. */
export function draw(room: Room, playerId: string, input: { source: unknown }, now: number): void {
  const p = onTurn(room, playerId);
  if (p.pending) throw new GameError(409, 'Choose which tickets to keep first.');
  const source = parseSource(input.source);
  if (source === null) throw new GameError(400, 'Draw from the deck or one of the five face-up cards.');
  p.away = 0;
  takeCard(room, p, source, false, now);
}

function takeCard(room: Room, p: Player, source: 'deck' | number, auto: boolean, now: number): void {
  let card: Card | null;
  if (source === 'deck') {
    card = drawCard(room);
    if (!card) throw new GameError(409, 'The deck is empty — take a face-up card.');
  } else {
    card = room.market[source] ?? null;
    if (!card) throw new GameError(400, 'There is no card there.');
    if (card === 'engine' && room.drawn > 0) throw new GameError(400, "A face-up engine can't be your second card.");
    room.market[source] = null;
    refillMarket(room);
  }
  p.hand[card]++;
  room.idle = 0;
  room.updatedAt = now;
  const faceUpEngine = source !== 'deck' && card === 'engine';
  room.drawn += faceUpEngine ? 2 : 1;
  if (room.drawn >= 2 || !canDrawSecond(room)) {
    const what = faceUpEngine ? 'took an engine' : room.drawn >= 2 ? 'drew two cards' : 'drew a card';
    log(room, now, p.id, `${p.name} ${what}`, auto);
    endTurn(room, p, now);
  }
}

/** How a hand would pay for a route: the colour chosen, or null if it cannot. */
export function payment(hand: Record<Card, number>, length: number, routeColour: CardColour | 'grey', colour: Card): { colour: number; engines: number } | null {
  if (colour === 'engine') return hand.engine >= length ? { colour: 0, engines: length } : null;
  if (routeColour !== 'grey' && colour !== routeColour) return null;
  const c = Math.min(hand[colour], length);
  const e = length - c;
  return hand.engine >= e && c > 0 ? { colour: c, engines: e } : null;
}

/** The colours a hand could pay a route with right now ('engine' = engines alone). */
export function payOptions(hand: Record<Card, number>, length: number, routeColour: CardColour | 'grey'): Card[] {
  const out: Card[] = [];
  for (const c of routeColour === 'grey' ? CARD_COLOURS : [routeColour]) if (payment(hand, length, routeColour, c)) out.push(c);
  if (payment(hand, length, routeColour, 'engine')) out.push('engine');
  return out;
}

/** Claim a route: pay its length in one colour (engines wild), lay the trains, score it. */
export function claim(room: Room, playerId: string, input: { route: unknown; colour?: unknown }, now: number): void {
  const p = onTurn(room, playerId);
  if (p.pending) throw new GameError(409, 'Choose which tickets to keep first.');
  if (room.drawn > 0) throw new GameError(409, 'You are drawing cards this turn — take your second card.');
  const idx = ROUTES.findIndex((r) => r.id === input.route);
  if (idx < 0) throw new GameError(400, 'There is no such route.');
  const rt = ROUTES[idx];
  if (room.owners[idx] !== null) throw new GameError(409, `${routeName(rt)} is already taken.`);
  if (p.trains < rt.length) throw new GameError(400, `That needs ${rt.length} trains and you have ${p.trains}.`);
  const options = payOptions(p.hand, rt.length, rt.colour);
  let colour: Card;
  if (input.colour === undefined || input.colour === null || input.colour === '') {
    if (!options.length) throw new GameError(400, `You need ${rt.length} ${rt.colour === 'grey' ? 'cards of one colour' : rt.colour + ' cards'} for that.`);
    if (rt.colour === 'grey' && options.filter((c) => c !== 'engine').length > 1) throw new GameError(400, 'Pick which colour to pay with.');
    colour = options[0];
  } else {
    if (typeof input.colour !== 'string' || !(CARDS as readonly string[]).includes(input.colour)) throw new GameError(400, 'That is not a card colour.');
    colour = input.colour as Card;
  }
  p.away = 0;
  pay(room, p, idx, colour, false, now);
}

function pay(room: Room, p: Player, idx: number, colour: Card, auto: boolean, now: number): void {
  const rt = ROUTES[idx];
  const cost = payment(p.hand, rt.length, rt.colour, colour);
  if (!cost) throw new GameError(400, `You don't have ${rt.length} ${colour === 'engine' ? 'engines' : `${colour} cards (with engines)`} for that.`);
  if (colour !== 'engine') {
    p.hand[colour] -= cost.colour;
    for (let k = 0; k < cost.colour; k++) room.discard.push(colour);
  }
  p.hand.engine -= cost.engines;
  for (let k = 0; k < cost.engines; k++) room.discard.push('engine');
  room.owners[idx] = p.id;
  p.trains -= rt.length;
  const pts = ROUTE_POINTS[rt.length] ?? 0;
  p.routePoints += pts;
  p.score = p.routePoints;
  room.idle = 0;
  log(room, now, p.id, `${p.name} claimed ${routeName(rt)}`, auto);
  room.lastRoute = rt.id;
  // A face-up market may have run dry while the deck was empty; the paid cards refill it.
  refillMarket(room);
  endTurn(room, p, now);
}

/** Draw three tickets (fewer if the pile is short) and keep at least one. */
export function tickets(room: Room, playerId: string, _input: Record<string, unknown>, now: number): void {
  const p = onTurn(room, playerId);
  if (p.pending) throw new GameError(409, 'Choose which tickets to keep first.');
  if (room.drawn > 0) throw new GameError(409, 'You are drawing cards this turn — take your second card.');
  if (!room.ticketDeck.length) throw new GameError(409, 'There are no tickets left.');
  p.away = 0;
  p.pending = { ids: dealTickets(room, DRAW_TICKETS), min: 1 };
  room.idle = 0;
  room.turnStartedAt = now;
  room.phaseEndsAt = now + TURN_MS;
  room.updatedAt = now;
  log(room, now, null, `${p.name} is looking at new tickets.`);
}

/** Keep some of the tickets on offer; the rest go to the bottom of the pile. */
export function keep(room: Room, playerId: string, input: { tickets: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined' || p.seat === null) throw new GameError(403, 'You are not playing this game.');
  if (!p.pending) throw new GameError(409, 'There are no tickets to choose from.');
  if (room.phase !== 'choosing' && !(room.phase === 'playing' && room.turnId === p.id)) throw new GameError(409, "It's not your turn.");
  const raw = Array.isArray(input.tickets) ? input.tickets : [];
  const ids = [...new Set(raw.map((v) => (typeof v === 'string' ? Number(v) : v)))];
  if (ids.some((id) => typeof id !== 'number' || !p.pending!.ids.includes(id))) throw new GameError(400, 'Keep tickets from the ones you were dealt.');
  const min = Math.min(p.pending.min, p.pending.ids.length);
  if (ids.length < min) throw new GameError(400, `Keep at least ${min === 1 ? 'one' : min}.`);
  p.away = 0;
  settleKeep(room, p, ids as number[], false, now);
}

function settleKeep(room: Room, p: Player, ids: number[], auto: boolean, now: number): void {
  const pick = p.pending!;
  p.tickets.push(...ids);
  room.ticketDeck.push(...pick.ids.filter((id) => !ids.includes(id)));
  p.pending = null;
  room.updatedAt = now;
  if (room.phase === 'choosing') {
    if (active(room).every((x) => !x.pending)) beginPlay(room, now);
    return;
  }
  log(room, now, p.id, `${p.name} kept ${ids.length} new ${ids.length === 1 ? 'ticket' : 'tickets'}`, auto);
  endTurn(room, p, now);
}

// ---- The map, for scoring ---------------------------------------------------

function routesOf(room: Room, playerId: string) {
  return ROUTES.filter((_, i) => room.owners[i] === playerId);
}

/** Whether a set of routes joins two towns. */
export function connects(routes: readonly { a: string; b: string }[], a: string, b: string): boolean {
  if (a === b) return true;
  const seen = new Set([a]);
  const stack = [a];
  while (stack.length) {
    const at = stack.pop()!;
    for (const r of routes) {
      const other = r.a === at ? r.b : r.b === at ? r.a : null;
      if (!other || seen.has(other)) continue;
      if (other === b) return true;
      seen.add(other);
      stack.push(other);
    }
  }
  return false;
}

/** The longest continuous line through a set of routes, in trains (no route used twice; towns may repeat). */
export function longestLine(routes: readonly { a: string; b: string; length: number }[]): number {
  let best = 0;
  // Exact for any hand a real game deals; a budget so a freak one can never stall the server.
  let budget = LONGEST_SEARCH_BUDGET;
  const used = new Array(routes.length).fill(false);
  const walk = (at: string, sum: number) => {
    if (sum > best) best = sum;
    for (let i = 0; i < routes.length && budget > 0; i++) {
      if (used[i]) continue;
      const r = routes[i];
      const other = r.a === at ? r.b : r.b === at ? r.a : null;
      if (!other) continue;
      budget--;
      used[i] = true;
      walk(other, sum + r.length);
      used[i] = false;
    }
  };
  const towns = new Set(routes.flatMap((r) => [r.a, r.b]));
  for (const t of towns) walk(t, 0);
  return best;
}

export function ticketResults(room: Room, p: Player): TicketResult[] {
  const mine = routesOf(room, p.id);
  return p.tickets.map((id) => {
    const t = ticketById(id)!;
    return { id, from: t.a, to: t.b, points: t.points, done: connects(mine, t.a, t.b) };
  });
}

function finish(room: Room, reason: NonNullable<Room['result']>['reason'], now: number): void {
  const tally: Record<string, FinalTally> = {};
  const lines = seated(room).map((p) => ({ p, longest: longestLine(routesOf(room, p.id)) }));
  const top = Math.max(0, ...lines.filter((l) => l.p.status === 'joined').map((l) => l.longest));
  for (const { p, longest } of lines) {
    const results = ticketResults(room, p);
    const ticketPoints = results.reduce((a, t) => a + (t.done ? t.points : -t.points), 0);
    const bonus = top > 0 && longest === top && p.status === 'joined' ? LONGEST_BONUS : 0;
    tally[p.id] = { routePoints: p.routePoints, ticketPoints, longest, longestBonus: bonus, tickets: results };
    p.score = p.routePoints + ticketPoints + bonus;
    if (p.pending) {
      room.ticketDeck.push(...p.pending.ids);
      p.pending = null;
    }
  }
  room.tally = tally;
  const ranked = rank(room, active(room));
  const first = ranked[0];
  room.result = {
    winnerIds: first ? ranked.filter((p) => tieKey(room, p).every((v, i) => v === tieKey(room, first)[i])).map((p) => p.id) : [],
    reason,
  };
  room.phase = 'finished';
  room.turnId = null;
  room.turnStartedAt = null;
  room.finalRound = null;
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
  const names = room.result.winnerIds.map((id) => room.players.find((p) => p.id === id)?.name ?? '?');
  log(room, now, null, names.length ? `${names.join(' and ')} ${names.length > 1 ? 'share' : 'wins'} it.` : 'Game over.');
}

/** Score, then tickets completed, then the longest line. */
function tieKey(room: Room, p: Player): number[] {
  const t = room.tally?.[p.id];
  return [p.score, t ? t.tickets.filter((x) => x.done).length : 0, t?.longest ?? 0];
}

function rank(room: Room, players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    const ka = tieKey(room, a);
    const kb = tieKey(room, b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return (a.seat ?? 0) - (b.seat ?? 0);
  });
}

// ---- The clock --------------------------------------------------------------

/** Nothing at all this player can do: no card to draw, no route to pay for, no ticket left. */
function stuck(room: Room, p: Player): boolean {
  if (p.pending) return false;
  if (canDrawAny(room)) return false;
  if (room.ticketDeck.length) return false;
  return !ROUTES.some((r, i) => room.owners[i] === null && p.trains >= r.length && payOptions(p.hand, r.length, r.colour).length > 0);
}

/** The cheapest tickets on offer, as few as allowed: the safest keep for somebody who is not there. */
function autoKeep(p: Player, keepAll: boolean): number[] {
  const pick = p.pending!;
  if (keepAll) return [...pick.ids];
  const min = Math.min(pick.min, pick.ids.length);
  return [...pick.ids].sort((a, b) => (ticketById(a)?.points ?? 0) - (ticketById(b)?.points ?? 0)).slice(0, min);
}

/**
 * Move a room along the clock. One step per call, each next deadline from
 * `now`, so a room left alone takes one auto-move at a time.
 *  - choosing: anybody still deciding keeps all three;
 *  - a turn: tickets waiting → keep the cheapest; else draw from the deck
 *    (a face-up colour if the deck is dry) until two are drawn; nothing to
 *    draw → the turn passes. A table with nothing to do for a whole round ends.
 */
export function advance(room: Room, now: number, _rng?: Rng): boolean {
  if (!Number.isFinite(now)) return false;
  const due = deadline(room);
  if (due === null || due > now) return false;
  switch (room.phase) {
    case 'lobby':
    case 'finished':
      close(room, due);
      break;
    case 'countdown':
      if (joined(room).length < minPlayers) {
        room.phase = 'lobby';
        room.phaseEndsAt = now + LOBBY_MS;
      } else begin(room, now);
      break;
    case 'choosing':
      for (const p of active(room)) if (p.pending) settleKeep(room, p, autoKeep(p, true), true, now);
      if (room.phase === 'choosing') beginPlay(room, now);
      break;
    case 'playing': {
      const p = room.players.find((x) => x.id === room.turnId);
      if (!p || p.status !== 'joined') {
        room.phaseEndsAt = null;
        break;
      }
      // Somebody with nothing they could do is passed without being marked away.
      if (p.pending || !stuck(room, p)) p.away += 1;
      autoTurn(room, p, now);
      break;
    }
  }
  room.updatedAt = Math.max(room.updatedAt, now);
  return true;
}

function autoTurn(room: Room, p: Player, now: number): void {
  if (p.pending) {
    settleKeep(room, p, autoKeep(p, false), true, now);
    return;
  }
  if (stuck(room, p)) {
    room.idle += 1;
    log(room, now, null, `${p.name} has nothing to do and passes.`, true);
    if (room.idle >= active(room).length) {
      finish(room, 'stuck', now);
      return;
    }
    endTurn(room, p, now);
    return;
  }
  // Draw until the turn ends (two cards, a face-up engine, or nothing more to draw).
  const startTurns = room.turns;
  for (let guard = 0; guard < 3 && room.turns === startTurns && room.phase === 'playing' && room.turnId === p.id; guard++) {
    if (room.deck.length + room.discard.length > 0) takeCard(room, p, 'deck', true, now);
    else {
      const slot = room.market.findIndex((c) => c && (c !== 'engine' || room.drawn === 0));
      if (slot < 0) break;
      takeCard(room, p, slot, true, now);
    }
  }
  if (room.turns === startTurns && room.phase === 'playing' && room.turnId === p.id) {
    // Nothing to draw and no move made: pass, so the table does not wait forever.
    room.idle += 1;
    log(room, now, null, `${p.name} passes.`, true);
    if (room.idle >= active(room).length) finish(room, 'stuck', now);
    else endTurn(room, p, now);
  }
}

export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

/** Who the room waits on, with a key that changes for every new decision. */
export function waitingOn(room: Room): { ids: string[]; key: string; line?: string } | null {
  if (room.phase === 'choosing') {
    const ids = active(room)
      .filter((p) => p.pending)
      .map((p) => p.id);
    return ids.length ? { ids, key: `choose:${room.startedAt}`, line: 'Pick your tickets.' } : null;
  }
  if (room.phase !== 'playing' || !room.turnId) return null;
  return { ids: [room.turnId], key: `${room.turns}:${room.turnId}:${room.drawn}`, line: room.last ? `${room.last}. Your turn.` : 'Your turn.' };
}

// ---- Result -----------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  place: number;
  seat: number | null;
  score: number;
  routePoints: number;
  ticketPoints: number;
  ticketsDone: number;
  ticketsFailed: number;
  longest: number;
  longestBonus: number;
  tickets: TicketResult[];
  result: 'won' | 'lost' | 'drew' | 'left';
}

export function standings(room: Room): Standing[] {
  const wins = room.result?.winnerIds ?? [];
  const order = [...rank(room, active(room)), ...seated(room).filter((p) => p.status !== 'joined')];
  let place = 0;
  let prev: Player | null = null;
  return order.map((p, i) => {
    if (!prev || tieKey(room, p).some((v, k) => v !== tieKey(room, prev!)[k])) place = i + 1;
    prev = p;
    const t = room.tally?.[p.id];
    const left = p.status !== 'joined';
    const results = t?.tickets ?? [];
    return {
      id: p.id,
      name: p.name,
      place: left ? order.length : place,
      seat: p.seat,
      score: p.score,
      routePoints: p.routePoints,
      ticketPoints: t?.ticketPoints ?? 0,
      ticketsDone: results.filter((x) => x.done).length,
      ticketsFailed: results.filter((x) => !x.done).length,
      longest: t?.longest ?? 0,
      longestBonus: t?.longestBonus ?? 0,
      tickets: results.map((x) => ({ ...x })),
      result: left ? 'left' : wins.includes(p.id) ? (wins.length > 1 ? 'drew' : 'won') : 'lost',
    };
  });
}

export function winners(room: Room): string[] {
  return room.result?.winnerIds ?? [];
}

// ---- The wire ---------------------------------------------------------------

const ticketView = (id: number) => {
  const t = ticketById(id)!;
  return { id, from: t.a, to: t.b, name: ticketName(t), points: t.points, line: t.line };
};

/** What everybody may see: the map, the market, counts — never a hand or a ticket until the finish. */
function publicView(room: Room, now: number) {
  const finished = room.phase === 'finished';
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    turnMs: TURN_MS,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    turnId: room.turnId,
    turnStartedAt: room.turnStartedAt,
    drawn: room.drawn,
    turns: room.turns,
    finalRound: room.finalRound ? { byId: room.finalRound.byId, left: [...room.finalRound.left] } : null,
    owners: [...room.owners],
    market: [...room.market],
    deck: room.deck.length,
    discard: room.discard.length,
    ticketDeck: room.ticketDeck.length,
    last: room.last,
    lastRoute: room.lastRoute,
    log: room.log.slice(-6).map((e) => ({ ...e })),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seat: p.seat,
      score: p.score,
      trains: p.trains,
      cards: handSize(p.hand),
      tickets: p.tickets.length,
      routes: room.owners.filter((o) => o === p.id).length,
      choosing: !!p.pending,
      away: p.away > 0,
    })),
    result: room.result ? { ...room.result, winnerIds: [...room.result.winnerIds] } : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

/**
 * One phone's view: the public table plus MY hand, MY tickets (with whether
 * they are joined up yet), the tickets I am choosing from, and — on my turn —
 * the routes I could claim right now with the colours I could pay in.
 */
export function toWire(room: Room, meId: string, now: number) {
  const me = room.players.find((p) => p.id === meId) ?? null;
  const myTurn = room.phase === 'playing' && !!me && room.turnId === meId;
  const mine = me ? routesOf(room, me.id) : [];
  const claimable =
    myTurn && me && !me.pending && room.drawn === 0
      ? ROUTES.flatMap((r, i) => {
          if (room.owners[i] !== null || me.trains < r.length) return [];
          const colours = payOptions(me.hand, r.length, r.colour);
          return colours.length ? [{ route: r.id, colours }] : [];
        })
      : [];
  return {
    ...publicView(room, now),
    meId,
    me: me
      ? {
          hand: { ...me.hand },
          trains: me.trains,
          tickets: me.tickets.map((id) => ({ ...ticketView(id), done: connects(mine, ticketById(id)!.a, ticketById(id)!.b) })),
          pending: me.pending ? { tickets: me.pending.ids.map(ticketView), min: Math.min(me.pending.min, me.pending.ids.length) } : null,
          myTurn,
          canDeck: myTurn && !me.pending && room.deck.length + room.discard.length > 0,
          /** Market slots I may take now (a face-up engine only as a first card). */
          canMarket: myTurn && !me.pending ? room.market.map((c) => !!c && (c !== 'engine' || room.drawn === 0)) : room.market.map(() => false),
          canTickets: myTurn && !me.pending && room.drawn === 0 && room.ticketDeck.length > 0,
          claimable,
        }
      : null,
  };
}

export type WireRoom = ReturnType<typeof toWire>;

/** The TV board: the public table only. */
export function toScreen(room: Room, now: number) {
  return publicView(room, now);
}

export type ScreenRoom = ReturnType<typeof toScreen>;

