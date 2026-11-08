// Homestead — an island-settling board game for three to five, as pure
// functions over a room (spec: docs/superpowers/specs/2026-10-22-family-games-
// homestead.md).
//
// Same shape as Liar's Dice and Chess: every function takes `now` (epoch ms),
// the registry owns timers and fan-out, nothing here knows about either. One
// difference: the room carries its OWN seeded generator (`rng`, sfc32 state),
// so a durable room written to the database and read back days later rolls the
// same dice it would have, and a test can seed a whole game. The registry's
// `rng` argument to `advance` is not used.
//
// Hidden information — other players' resource cards, everyone's unplayed
// almanac cards, the deck order, the generator, which card a steal took — never
// leaves `toWire` except to the one player it belongs to.
//
// Every name here is Homestead's own: timber, clay, wool, grain and stone; the
// fox; cottages and towns; almanac cards (ranger, heirloom, pathfinders,
// harvest, market); Longest Trail and Chief Ranger.
//
// The rules live in four files (each under the new-file size gate): this one
// moves the game on; `homestead-model.ts` holds the types and read-only
// queries; `homestead-trade.ts` the bank and offers; `homestead-wire.ts` what
// one phone may see. This module's exports are the game's whole public face.

import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  MAX_PLAYERS,
  isDifficulty,
  DIFFICULTIES,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from './tap-duel';
import {
  RESOURCES,
  ISLAND,
  edgeEnds,
  generateIsland,
  hexCorners,
  isResource,
  parseEdge,
  parseHex,
  parseVertex,
  shuffle,
  type Hex,
  type IslandSize,
  type Resource,
} from './homestead-board';
import {
  COSTS,
  DEADLINE_HOURS,
  MIN_PLAYERS,
  RANGERS_MIN,
  TARGET,
  TRAIL_MIN,
  activePlayer,
  assertActive,
  assertPlaying,
  bestBy,
  byId,
  cottageSpots,
  covers,
  deadline,
  decisionMs,
  emptyHand,
  find,
  finishedMs,
  foxHexes,
  geo,
  handCount,
  handText,
  hexById,
  isCardKind,
  joined,
  lobbyMs,
  log,
  nameOf,
  openBuilding,
  parseCards,
  pay,
  player,
  playing,
  present,
  publicVp,
  randInt,
  roadSpots,
  roller,
  seedRng,
  setupRoadSpots,
  setupSeat,
  stepRefusal,
  toStep,
  totalVp,
  trailLength,
  vertexPips,
  victimsAt,
  voidUncovered,
  waitingIds,
  type CardKind,
  type Hand,
  type Pace,
  type Player,
  type Result,
  type Room,
} from './homestead-model';
import {
  bank,
} from './homestead-trade';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES, RESOURCES };
export type { Difficulty, PlayerStatus, Rng, Resource, IslandSize };
export {
  MIN_PLAYERS,
  PIECES,
  COSTS,
  TARGET,
  DEADLINE_HOURS,
  ASYNC_FINISHED_MS,
  LIVE_MS,
  AWAY_MS,
  nextFloat,
  seedRng,
  player,
  joined,
  activePlayer,
  about,
  decisionMs,
  cottageSpots,
  roadSpots,
  rates,
  trailLength,
  publicVp,
  totalVp,
  foxHexes,
  victimsAt,
  deadline,
  standings,
  winners,
} from './homestead-model';
export type {
  Phase,
  Step,
  Pace,
  Piece,
  CardKind,
  Hand,
  RngState,
  Card,
  Player,
  Offer,
  LogEntry,
  Result,
  Room,
  Standing,
} from './homestead-model';
export {
  bank,
  offer,
  counter,
  accept,
  refuse,
  cancel,
} from './homestead-trade';
export {
  toWire,
} from './homestead-wire';
export type {
  WireRoom,
} from './homestead-wire';

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > MAX_PLAYERS - 1) throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  const o = input.options ?? {};
  const pace: Pace = o.pace === 'async' ? 'async' : 'live';
  const deadlineHours = (DEADLINE_HOURS as readonly unknown[]).includes(o.deadlineHours) ? (o.deadlineHours as number) : 24;
  const islandChoice = o.island === 'standard' || o.island === 'large' ? o.island : 'auto';
  const room: Room = {
    id: input.id,
    game: 'homestead',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    pace,
    deadlineHours,
    islandChoice,
    island: islandChoice,
    vpTarget: TARGET[input.difficulty],
    board: null,
    fox: null,
    buildings: {},
    roads: {},
    seats: [],
    turn: 0,
    active: 0,
    step: 'setup',
    setupIndex: 0,
    setupNeed: 'cottage',
    setupCottage: null,
    foxReturn: 'main',
    dice: null,
    freeRoads: 0,
    discardOwed: {},
    bank: emptyHand(),
    deck: [],
    offers: [],
    nextOffer: 1,
    playedCardThisTurn: false,
    longestTrailId: null,
    chiefRangerId: null,
    log: [],
    logN: 0,
    rng: seedRng(o.seed),
    result: null,
    startedAt: null,
    phaseEndsAt: input.now + lobbyMs(pace, deadlineHours),
    createdAt: input.now,
    updatedAt: input.now,
  };
  return room;
}

// ---- Lobby verbs --------------------------------------------------------------

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
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
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

function finish(room: Room, result: Result, now: number): void {
  room.result = result;
  for (const o of room.offers) if (o.status === 'open') o.status = 'cancelled';
  room.discardOwed = {};
  room.phase = 'finished';
  room.phaseEndsAt = now + finishedMs(room);
  room.updatedAt = now;
  if (result.reason === 'points') {
    log(room, now, 'finish', result.winnerId, `${nameOf(room, result.winnerId)} reached ${totalVp(room, result.winnerId!)} points and won!`);
  } else if (result.reason === 'left') {
    log(room, now, 'finish', result.winnerId, `${nameOf(room, result.winnerId)} is the last one here and wins.`);
  }
}

/**
 * Leaving the lobby as host cancels it. Leaving mid-game: your pieces stay on
 * the island, your resource cards go back to the bank, your offers are
 * cancelled and your turns are skipped. With fewer than two left, the one
 * still here wins.
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
  if (room.phase !== 'playing' || p.seat === null) {
    if (room.phase === 'countdown' && rest.length < MIN_PLAYERS) {
      // Not enough to start: back to the lobby.
      room.phase = 'lobby';
      room.phaseEndsAt = now + lobbyMs(room.pace, room.deadlineHours);
    }
    return;
  }
  for (const r of RESOURCES) {
    room.bank[r] += p.hand[r];
    p.hand[r] = 0;
  }
  p.cards = [];
  delete room.discardOwed[p.id];
  for (const o of room.offers) {
    if (o.status !== 'open') continue;
    if (o.from === p.id || (o.to && o.to.length === 1 && o.to[0] === p.id)) o.status = 'cancelled';
  }
  log(room, now, 'leave', p.id, `${p.name} left the game.`);
  const left = playing(room);
  if (left.length < 2) {
    finish(room, { winnerId: left[0]?.id ?? null, reason: 'left' }, now);
    return;
  }
  // Awards held by somebody who has gone are re-judged without them.
  refreshAwards(room, now);
  const wasActive = room.seats[room.active] === p.id;
  // An award handed over by the leaver can carry the active player to the target on their own turn.
  if (!wasActive && checkWin(room, now)) return;
  if (room.step === 'discard' && !Object.keys(room.discardOwed).length && !wasActive) {
    toStep(room, 'fox', now);
  }
  if (wasActive) {
    if (room.step === 'setup') nextSetup(room, now);
    else nextTurn(room, now);
  }
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length < MIN_PLAYERS) throw new GameError(409, 'Homestead needs three players.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again with whoever is still here — a new island, a new seat order; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    const fresh = player(p.id, p.name, p.status === 'joined' ? 'joined' : 'invited');
    Object.assign(p, fresh);
  }
  room.phase = 'lobby';
  room.island = room.islandChoice;
  room.board = null;
  room.fox = null;
  room.buildings = {};
  room.roads = {};
  room.seats = [];
  room.turn = 0;
  room.active = 0;
  room.step = 'setup';
  room.setupIndex = 0;
  room.setupNeed = 'cottage';
  room.setupCottage = null;
  room.dice = null;
  room.freeRoads = 0;
  room.discardOwed = {};
  room.bank = emptyHand();
  room.deck = [];
  room.offers = [];
  room.playedCardThisTurn = false;
  room.longestTrailId = null;
  room.chiefRangerId = null;
  room.log = [];
  room.result = null;
  room.startedAt = null;
  room.phaseEndsAt = now + lobbyMs(room.pace, room.deadlineHours);
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Starting play --------------------------------------------------------------

function begin(room: Room, now: number): void {
  const seated = shuffle(joined(room).map((p) => p.id), roller(room));
  const size: IslandSize = room.islandChoice === 'auto' ? (seated.length >= 5 ? 'large' : 'standard') : room.islandChoice;
  const spec = ISLAND[size];
  const board = generateIsland(size, roller(room));
  room.board = { size, hexes: board.hexes, harbours: board.harbours };
  room.island = size;
  room.fox = board.hexes.find((h) => h.kind === 'dunes')?.id ?? board.hexes[0].id;
  room.seats = seated;
  for (const p of room.players) {
    Object.assign(p, { ...player(p.id, p.name, p.status), seat: seated.indexOf(p.id) >= 0 ? seated.indexOf(p.id) : null });
  }
  room.bank = { timber: spec.bank, clay: spec.bank, wool: spec.bank, grain: spec.bank, stone: spec.bank };
  room.deck = shuffle(
    (Object.entries(spec.deck) as [CardKind, number][]).flatMap(([k, n]) => Array<CardKind>(n).fill(k)),
    roller(room),
  );
  room.buildings = {};
  room.roads = {};
  room.offers = [];
  room.discardOwed = {};
  room.dice = null;
  room.longestTrailId = null;
  room.chiefRangerId = null;
  room.result = null;
  room.phase = 'playing';
  room.startedAt = now;
  room.setupIndex = -1;
  room.turn = 0;
  log(room, now, 'turn', null, `The island is ready. ${seated.map((id) => nameOf(room, id)).join(', ')} — in that order.`);
  nextSetup(room, now);
}

/** Move on to the next setup placement, skipping anyone who left; after the last, seat 0 rolls. */
function nextSetup(room: Room, now: number): void {
  const n = room.seats.length;
  for (let k = room.setupIndex + 1; k < 2 * n; k++) {
    const seat = setupSeat(n, k);
    if (byId(room, room.seats[seat])?.status !== 'joined') continue;
    room.setupIndex = k;
    room.active = seat;
    room.turn += 1;
    room.setupNeed = 'cottage';
    room.setupCottage = null;
    toStep(room, 'setup', now);
    return;
  }
  // Setup done: the first seat still here takes the first real turn.
  room.setupCottage = null;
  room.active = n - 1;
  nextTurn(room, now, true);
}

/** Pass to the next seat still here; their turn starts at `roll` (and they may already have won). */
function nextTurn(room: Room, now: number, first = false): void {
  for (const o of room.offers) if (o.status === 'open') o.status = 'cancelled';
  room.offers = [];
  room.freeRoads = 0;
  room.discardOwed = {};
  room.playedCardThisTurn = false;
  const n = room.seats.length;
  for (let i = 1; i <= n; i++) {
    const seat = (room.active + i) % n;
    if (byId(room, room.seats[seat])?.status !== 'joined') continue;
    room.active = seat;
    break;
  }
  room.turn += 1;
  const p = activePlayer(room)!;
  log(room, now, 'turn', p.id, first ? `Setup done. ${p.name} rolls first.` : `${p.name}'s turn.`);
  toStep(room, 'roll', now);
  // Reaching the target off-turn (open building) wins at the start of your own turn.
  checkWin(room, now);
}

/** Re-judge Longest Trail (and drop awards held by somebody who left). */
function refreshAwards(room: Room, now: number): void {
  const eligible = playing(room);
  const lengths = new Map(eligible.map((p) => [p.id, trailLength(room, p.id)]));
  const best = Math.max(0, ...lengths.values());
  let holder = room.longestTrailId;
  if (holder && !lengths.has(holder)) holder = null;
  const leaders = [...lengths.entries()].filter(([, n]) => n === best && n >= TRAIL_MIN).map(([id]) => id);
  let next: string | null;
  if (holder && (lengths.get(holder) ?? 0) >= TRAIL_MIN && lengths.get(holder) === best) next = holder;
  else next = leaders.length === 1 ? leaders[0] : null;
  if (next !== room.longestTrailId) {
    room.longestTrailId = next;
    log(
      room,
      now,
      'award',
      next,
      next ? `${nameOf(room, next)} has the Longest Trail (${best}).` : 'Nobody holds the Longest Trail now.',
    );
  }
  if (room.chiefRangerId && !eligible.some((p) => p.id === room.chiefRangerId)) {
    room.chiefRangerId = null;
    const top = Math.max(0, ...eligible.map((p) => p.rangersPlayed));
    const tops = eligible.filter((p) => p.rangersPlayed === top && top >= RANGERS_MIN);
    if (tops.length === 1) room.chiefRangerId = tops[0].id;
    log(room, now, 'award', room.chiefRangerId, room.chiefRangerId ? `${nameOf(room, room.chiefRangerId)} is Chief Ranger.` : 'Nobody is Chief Ranger now.');
  }
}

/** The active player wins the moment their total reaches the target on their own turn. */
function checkWin(room: Room, now: number): boolean {
  if (room.phase !== 'playing' || room.step === 'setup') return false;
  const p = activePlayer(room);
  if (!p || totalVp(room, p.id) < room.vpTarget) return false;
  finish(room, { winnerId: p.id, reason: 'points' }, now);
  return true;
}

// ---- Moves --------------------------------------------------------------------------

/** Roll the two dice on your turn. */
export function roll(room: Room, playerId: string, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['roll']);
  if (!auto) present(room, p, now);
  const a = 1 + randInt(room, 6);
  const b = 1 + randInt(room, 6);
  const total = a + b;
  room.dice = { a, b, total, by: p.id, at: now };
  log(room, now, 'roll', p.id, `${p.name} rolled ${total}.`, { auto });
  if (total === 7) {
    for (const o of room.offers) if (o.status === 'open') o.status = 'cancelled';
    room.discardOwed = {};
    for (const q of playing(room)) {
      const n = handCount(q.hand);
      if (n > 7) room.discardOwed[q.id] = Math.floor(n / 2);
    }
    room.foxReturn = 'main';
    const owing = Object.keys(room.discardOwed);
    if (owing.length) {
      log(room, now, 'discard', null, `${owing.map((id) => `${nameOf(room, id)} discards ${room.discardOwed[id]}`).join(', ')}.`);
      toStep(room, 'discard', now);
    } else toStep(room, 'fox', now);
    return;
  }
  produce(room, total, now);
  toStep(room, 'main', now);
}

/** Every hex with this number and no fox pays its cottages 1 and towns 2 — if the bank can. */
function produce(room: Room, total: number, now: number): void {
  const g = geo(room);
  const owed: Record<Resource, Record<string, number>> = { timber: {}, clay: {}, wool: {}, grain: {}, stone: {} };
  for (const h of room.board!.hexes) {
    if (h.token !== total || h.id === room.fox || !h.resource) continue;
    for (const v of hexCorners(h.q, h.r)) {
      const b = room.buildings[v];
      if (!b || !g.vertexSet.has(v)) continue;
      if (byId(room, b.owner)?.status !== 'joined') continue;
      owed[h.resource][b.owner] = (owed[h.resource][b.owner] ?? 0) + (b.piece === 'town' ? 2 : 1);
    }
  }
  const got: Record<string, Partial<Hand>> = {};
  const short: Resource[] = [];
  for (const r of RESOURCES) {
    const who = Object.entries(owed[r]);
    if (!who.length) continue;
    const sum = who.reduce((n, [, k]) => n + k, 0);
    if (sum > room.bank[r] && who.length > 1) {
      short.push(r);
      continue;
    }
    for (const [id, k] of who) {
      const n = Math.min(k, room.bank[r]);
      if (!n) continue;
      room.bank[r] -= n;
      byId(room, id)!.hand[r] += n;
      (got[id] ??= {})[r] = n;
    }
  }
  const parts = room.seats
    .filter((id) => got[id])
    .map((id) => `${nameOf(room, id)} +${RESOURCES.filter((r) => got[id][r]).map((r) => `${got[id][r]} ${r}`).join(', +')}`);
  let text = parts.length ? `${total}: ${parts.join('; ')}.` : `${total}: nothing this time.`;
  if (short.length) text += ` The bank is short of ${short.join(' and ')}: nobody gets it.`;
  log(room, now, 'produce', null, text);
  voidUncovered(room);
}

/** Put the cards owed on a 7 back in the bank: `{ cards: { timber: 2, … } }`. */
export function discard(room: Room, playerId: string, input: { cards: unknown }, now: number, auto = false): void {
  const p = assertPlaying(room, playerId);
  if (room.step !== 'discard') throw new GameError(409, 'Nothing to discard now.');
  const owed = room.discardOwed[p.id];
  if (!owed) throw new GameError(409, "You don't owe a discard.");
  const cards = parseCards(input.cards, 'discard');
  if (handCount(cards) !== owed) throw new GameError(400, `Discard exactly ${owed} card${owed === 1 ? '' : 's'}.`);
  if (!covers(p.hand, cards)) throw new GameError(400, "You don't have those cards.");
  if (!auto) present(room, p, now);
  pay(room, p, cards);
  delete room.discardOwed[p.id];
  log(room, now, 'discard', p.id, `${p.name} discarded ${handText(cards)}.`, { auto });
  voidUncovered(room);
  if (!Object.keys(room.discardOwed).length) toStep(room, 'fox', now);
}

/** Move the fox: `{ hex, victim? }`. A victim is needed when two or more could be robbed. */
export function fox(room: Room, playerId: string, input: { hex: unknown; victim?: unknown }, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['fox']);
  const at = parseHex(input.hex);
  const id = typeof input.hex === 'string' ? input.hex : '';
  if (!at || !hexById(room, id)) throw new GameError(400, "That's not a spot on the board.");
  if (id === room.fox) throw new GameError(400, 'The fox has to move to a different field.');
  if (!foxHexes(room, p.id).includes(id)) throw new GameError(400, 'The friendly fox leaves smaller farms alone: pick another field.');
  const eligible = victimsAt(room, p.id, id);
  let victim: string | null = null;
  if (eligible.length === 1) {
    if (input.victim != null && input.victim !== eligible[0]) throw new GameError(400, 'The fox can only take from someone with a cottage or town on that field.');
    victim = eligible[0];
  } else if (eligible.length > 1) {
    if (typeof input.victim !== 'string' || !eligible.includes(input.victim)) {
      throw new GameError(400, input.victim == null ? 'Pick who the fox takes from.' : 'The fox can only take from someone with a cottage or town on that field.');
    }
    victim = input.victim;
  } else if (input.victim != null) {
    throw new GameError(400, 'Nobody on that field has a card to take.');
  }
  if (!auto) present(room, p, now);
  room.fox = id;
  const h = hexById(room, id)!;
  log(room, now, 'fox', p.id, `${p.name} moved the fox to the ${h.kind === 'dunes' ? 'dunes' : `${h.resource} ${h.token}`}.`, { auto });
  if (victim) {
    const v = byId(room, victim)!;
    const pool = RESOURCES.flatMap((r) => Array<Resource>(v.hand[r]).fill(r));
    const took = pool[randInt(room, pool.length)];
    v.hand[took] -= 1;
    p.hand[took] += 1;
    log(room, now, 'steal', p.id, `${p.name}'s fox took a card from ${v.name}.`, {
      secret: {
        [p.id]: `Your fox took a ${took} from ${v.name}.`,
        [v.id]: `${p.name}'s fox took a ${took} from you.`,
      },
      auto,
    });
    voidUncovered(room);
  }
  toStep(room, room.foxReturn, now);
}

/**
 * Build `{ piece: road | cottage | town, at: id }`. In setup it is free and
 * placed where the setup says; otherwise it costs and must connect.
 */
export function build(room: Room, playerId: string, input: { piece: unknown; at: unknown }, now: number, auto = false): void {
  const p = assertPlaying(room, playerId);
  const piece = input.piece;
  if (piece !== 'road' && piece !== 'cottage' && piece !== 'town') throw new GameError(400, 'Build a road, a cottage or a town.');
  const isActive = room.seats[room.active] === p.id;
  const g = geo(room);
  const at = typeof input.at === 'string' ? input.at : '';
  const onBoard = piece === 'road' ? !!parseEdge(at) && g.edgeSet.has(at) : !!parseVertex(at) && g.vertexSet.has(at);

  if (room.step === 'setup') {
    if (!isActive) throw new GameError(409, "It's not your turn.");
    if (piece !== room.setupNeed) throw new GameError(409, `Place your ${room.setupNeed} first.`);
    if (!onBoard) throw new GameError(400, "That's not a spot on the board.");
    if (!auto) present(room, p, now);
    if (piece === 'cottage') {
      if (room.buildings[at]) throw new GameError(409, 'Someone just built there.');
      if (!cottageSpots(room, p, true).includes(at)) throw new GameError(400, 'Too close to another cottage: leave a gap of one road.');
      room.buildings[at] = { owner: p.id, piece: 'cottage' };
      p.pieces.cottage -= 1;
      room.setupCottage = at;
      room.setupNeed = 'road';
      const second = room.setupIndex >= room.seats.length;
      let text = `${p.name} placed a cottage.`;
      if (second) {
        const got: Partial<Hand> = {};
        for (const hid of g.vertexLand.get(at)!) {
          const r = hexById(room, hid)?.resource;
          if (r && room.bank[r] > 0) {
            room.bank[r] -= 1;
            p.hand[r] += 1;
            got[r] = (got[r] ?? 0) + 1;
          }
        }
        if (handCount(got)) text = `${p.name} placed a cottage and took ${handText(got)}.`;
      }
      log(room, now, 'setup', p.id, text, { auto });
      room.phaseEndsAt = now + decisionMs(room, 'setup');
      room.updatedAt = now;
      return;
    }
    if (room.roads[at]) throw new GameError(409, 'Someone just built there.');
    if (!setupRoadSpots(room).includes(at)) throw new GameError(400, 'Your road must touch the cottage you just placed.');
    room.roads[at] = p.id;
    p.pieces.road -= 1;
    log(room, now, 'setup', p.id, `${p.name} placed a road.`, { auto });
    nextSetup(room, now);
    return;
  }

  const free = room.step === 'roads' && isActive && piece === 'road';
  if (room.step === 'roads' && isActive && piece !== 'road') throw new GameError(409, stepRefusal(room));
  if (!free) {
    if (room.step !== 'main') throw new GameError(409, isActive ? stepRefusal(room) : "It's not your turn.");
    if (!isActive && !openBuilding(room)) throw new GameError(409, "It's not your turn.");
  }
  if (!onBoard) throw new GameError(400, "That's not a spot on the board.");
  if (p.pieces[piece] <= 0) throw new GameError(409, `You have no ${piece}s left.`);
  if (!free && !covers(p.hand, COSTS[piece])) throw new GameError(409, `You can't afford a ${piece}.`);

  if (piece === 'road') {
    if (room.roads[at]) throw new GameError(409, 'Someone just built there.');
    if (!roadSpots(room, p).includes(at)) throw new GameError(400, 'Roads must join your own roads, cottages or towns.');
  } else if (piece === 'cottage') {
    if (room.buildings[at]) throw new GameError(409, 'Someone just built there.');
    if (g.vertexBoardNeighbours.get(at)!.some((n) => room.buildings[n])) {
      throw new GameError(400, 'Too close to another cottage: leave a gap of one road.');
    }
    if (!g.vertexBoardEdges.get(at)!.some((e) => room.roads[e] === p.id)) throw new GameError(400, 'You need a road next to it.');
  } else {
    const b = room.buildings[at];
    if (!b || b.owner !== p.id || b.piece !== 'cottage') throw new GameError(400, 'A town replaces one of your own cottages.');
  }

  if (!auto) present(room, p, now);
  if (!free) pay(room, p, COSTS[piece]);
  if (piece === 'road') {
    room.roads[at] = p.id;
    p.pieces.road -= 1;
  } else if (piece === 'cottage') {
    room.buildings[at] = { owner: p.id, piece: 'cottage' };
    p.pieces.cottage -= 1;
  } else {
    room.buildings[at] = { owner: p.id, piece: 'town' };
    p.pieces.town -= 1;
    p.pieces.cottage += 1;
  }
  log(room, now, 'build', p.id, `${p.name} built a ${free ? 'free ' : ''}${piece}.`, { auto });
  room.updatedAt = now;
  voidUncovered(room);
  refreshAwards(room, now);
  if (free) {
    room.freeRoads -= 1;
    if (room.freeRoads <= 0 || p.pieces.road <= 0 || !roadSpots(room, p).length) {
      room.freeRoads = 0;
      toStep(room, 'main', now);
    }
  }
  checkWin(room, now);
}

/** Buy the top almanac card. */
export function buy(room: Room, playerId: string, now: number): void {
  const p = assertPlaying(room, playerId);
  const isActive = room.seats[room.active] === p.id;
  if (room.step !== 'main') throw new GameError(409, isActive ? stepRefusal(room) : "It's not your turn.");
  if (!isActive && !openBuilding(room)) throw new GameError(409, "It's not your turn.");
  if (!room.deck.length) throw new GameError(409, 'The almanac deck is empty.');
  if (!covers(p.hand, COSTS.card)) throw new GameError(409, "You can't afford an almanac card.");
  present(room, p, now);
  pay(room, p, COSTS.card);
  const kind = room.deck.pop()!;
  p.cards.push({ kind, boughtTurn: room.turn });
  log(room, now, 'buy', p.id, `${p.name} bought an almanac card.`);
  room.updatedAt = now;
  voidUncovered(room);
  checkWin(room, now);
}

/** Play an almanac card: `{ card, take?: [r, r], resource?: r }`. */
export function play(room: Room, playerId: string, input: { card: unknown; take?: unknown; resource?: unknown }, now: number): void {
  const card = input.card;
  if (!isCardKind(card)) throw new GameError(400, 'Pick an almanac card to play.');
  if (card === 'heirloom') throw new GameError(400, 'Heirlooms are kept, not played: they count at the end.');
  const p = assertActive(room, playerId, card === 'ranger' ? ['roll', 'main'] : ['main']);
  if (room.playedCardThisTurn) throw new GameError(409, 'You have already played an almanac card this turn.');
  const held = p.cards.filter((c) => c.kind === card);
  if (!held.length) throw new GameError(409, `You don't have a ${card} card.`);
  const ready = held.find((c) => c.boughtTurn !== room.turn);
  if (!ready) throw new GameError(409, 'A card bought this turn can be played from your next turn.');

  let take: Resource[] = [];
  let named: Resource | null = null;
  if (card === 'harvest') {
    if (!Array.isArray(input.take) || input.take.length !== 2 || !input.take.every(isResource)) {
      throw new GameError(400, 'Pick two resources to take.');
    }
    take = input.take as Resource[];
    const need: Partial<Hand> = {};
    for (const r of take) need[r] = (need[r] ?? 0) + 1;
    if (!covers(room.bank, need)) throw new GameError(409, "The bank doesn't have those.");
  }
  if (card === 'market') {
    if (!isResource(input.resource)) throw new GameError(400, 'Name a resource.');
    named = input.resource;
  }

  present(room, p, now);
  p.cards.splice(p.cards.indexOf(ready), 1);
  room.playedCardThisTurn = true;
  room.updatedAt = now;
  switch (card) {
    case 'ranger': {
      p.rangersPlayed += 1;
      log(room, now, 'play', p.id, `${p.name} played a ranger.`);
      const holder = room.chiefRangerId ? byId(room, room.chiefRangerId) : null;
      if (p.rangersPlayed >= RANGERS_MIN && room.chiefRangerId !== p.id && (!holder || p.rangersPlayed > holder.rangersPlayed)) {
        room.chiefRangerId = p.id;
        log(room, now, 'award', p.id, `${p.name} is Chief Ranger.`);
      }
      room.foxReturn = room.step === 'roll' ? 'roll' : 'main';
      toStep(room, 'fox', now);
      break;
    }
    case 'pathfinders': {
      log(room, now, 'play', p.id, `${p.name} played pathfinders.`);
      room.freeRoads = Math.min(2, p.pieces.road);
      if (room.freeRoads > 0 && roadSpots(room, p).length) toStep(room, 'roads', now);
      else room.freeRoads = 0;
      break;
    }
    case 'harvest': {
      for (const r of take) {
        room.bank[r] -= 1;
        p.hand[r] += 1;
      }
      log(room, now, 'play', p.id, `${p.name} played a harvest and took ${take[0]} and ${take[1]}.`);
      break;
    }
    case 'market': {
      const r = named!;
      const parts: string[] = [];
      let total = 0;
      for (const q of playing(room)) {
        if (q.id === p.id || !q.hand[r]) continue;
        parts.push(`${q.hand[r]} from ${q.name}`);
        total += q.hand[r];
        p.hand[r] += q.hand[r];
        q.hand[r] = 0;
      }
      log(room, now, 'play', p.id, `${p.name} played a market for ${r}: ${total ? parts.join(', ') : 'nobody had any'}.`);
      voidUncovered(room);
      break;
    }
  }
  checkWin(room, now);
}

/** Stop placing free roads. */
export function skip(room: Room, playerId: string, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['roads']);
  if (!auto) present(room, p, now);
  room.freeRoads = 0;
  toStep(room, 'main', now);
}

/** End your turn. */
export function end(room: Room, playerId: string, now: number, auto = false): void {
  const p = assertActive(room, playerId, ['main']);
  if (!auto) present(room, p, now);
  nextTurn(room, now);
}

/** One timed-out decision, made for whoever the room was waiting on. */
function autoMove(room: Room, now: number): void {
  const p = activePlayer(room)!;
  switch (room.step) {
    case 'setup': {
      if (room.setupNeed === 'cottage') {
        const v = bestBy(cottageSpots(room, p, true), (x) => vertexPips(room, x));
        if (!v) {
          // Nowhere at all to settle (cannot happen on these islands): skip their placement.
          nextSetup(room, now);
          break;
        }
        build(room, p.id, { piece: 'cottage', at: v }, now, true);
      }
      const roads = setupRoadSpots(room);
      const road = bestBy(roads, (e) => {
        const far = edgeEnds(e).find((v) => v !== room.setupCottage)!;
        return geo(room).vertexSet.has(far) ? vertexPips(room, far) : -1;
      });
      endedByClock(room, p, now);
      if (room.phase !== 'playing') break;
      if (road) build(room, p.id, { piece: 'road', at: road }, now, true);
      else nextSetup(room, now);
      break;
    }
    case 'roll':
      roll(room, p.id, now, true);
      break;
    case 'discard':
      for (const id of Object.keys(room.discardOwed)) {
        const q = byId(room, id)!;
        const owe = room.discardOwed[id];
        const h = { ...q.hand };
        const cards: Partial<Hand> = {};
        for (let i = 0; i < owe; i++) {
          const r = bestBy([...RESOURCES], (x) => h[x])!;
          h[r] -= 1;
          cards[r] = (cards[r] ?? 0) + 1;
        }
        discard(room, id, { cards }, now, true);
      }
      break;
    case 'fox': {
      const g = geo(room);
      const hexes = foxHexes(room, p.id).map((id) => hexById(room, id)!);
      const touchesMine = (h: Hex) => hexCorners(h.q, h.r).some((v) => g.vertexSet.has(v) && room.buildings[v]?.owner === p.id);
      const pool = hexes.some((h) => !touchesMine(h)) ? hexes.filter((h) => !touchesMine(h)) : hexes;
      const target = bestBy(pool, (h) =>
        hexCorners(h.q, h.r).reduce((n, v) => {
          const b = g.vertexSet.has(v) ? room.buildings[v] : undefined;
          return b && b.owner !== p.id ? n + h.pips * (b.piece === 'town' ? 2 : 1) : n;
        }, 0),
      )!;
      const victims = victimsAt(room, p.id, target.id);
      const victim = bestBy(victims, (id) => publicVp(room, id) * 1000 + handCount(byId(room, id)!.hand) * 10 - room.seats.indexOf(id) / 10);
      fox(room, p.id, { hex: target.id, victim }, now, true);
      break;
    }
    case 'main':
      endedByClock(room, p, now);
      log(room, now, 'turn', p.id, `${p.name}'s time ran out.`, { auto: true });
      if (room.phase === 'playing') nextTurn(room, now);
      break;
    case 'roads':
      room.freeRoads = 0;
      endedByClock(room, p, now);
      log(room, now, 'turn', p.id, `${p.name}'s time ran out.`, { auto: true });
      if (room.phase === 'playing') nextTurn(room, now);
      break;
  }
}

/** A turn the clock ended: two in a row and they are away; everyone away ends the game. */
function endedByClock(room: Room, p: Player, now: number): void {
  p.autoEnds += 1;
  if (p.autoEnds >= 2 && !p.away) {
    p.away = true;
    log(room, now, 'away', p.id, `${p.name} seems to be away: their turns will be quick until they're back.`);
  }
  if (playing(room).every((q) => q.away)) {
    room.result = { winnerId: null, reason: 'abandoned' };
    log(room, now, 'finish', null, "Everyone's away — game abandoned.");
    close(room, now);
  }
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it. One
 * step per call, each next deadline set from `now`, so a room that was asleep
 * for three days takes one auto-move, not a cascade.
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
      if (joined(room).length < MIN_PLAYERS) {
        room.phase = 'lobby';
        room.phaseEndsAt = now + lobbyMs(room.pace, room.deadlineHours);
      } else begin(room, now);
      break;
    case 'playing':
      autoMove(room, now);
      break;
  }
  return true;
}

// ---- Durable rooms --------------------------------------------------------------------

/** Rooms of this game are written to `game_rooms` and survive a restart. */
export const durable = { schema: 1 };
export const paces = ['live', 'async'] as const;

/** Who the room is waiting on, with a key that changes for every new decision. */
export function waitingOn(room: Room): { ids: string[]; key: string; line?: string } | null {
  if (room.phase !== 'playing') return null;
  const ids = waitingIds(room);
  if (!ids.length) return null;
  const active = room.seats[room.active];
  const name = nameOf(room, active);
  const dice = room.dice;
  if (room.step === 'discard') {
    return { ids, key: `${room.turn}:discard`, line: `${name} rolled a 7: time to discard.` };
  }
  let line: string;
  switch (room.step) {
    case 'setup':
      line = `Your turn to place a ${room.setupNeed}.`;
      break;
    case 'roll':
      line = 'Your turn to roll.';
      break;
    case 'fox':
      line = 'Move the fox.';
      break;
    case 'roads':
      line = 'Place your free roads.';
      break;
    default: {
      // This line goes only to the active player: word it for them.
      const lastRoll = [...room.log].reverse().find((e) => e.kind === 'roll');
      if (!dice || dice.by !== active) line = 'Your move.';
      else if (lastRoll?.by === active && lastRoll.auto) line = `The dice rolled ${dice.total} for you.`;
      else line = `You rolled ${dice.total}.`;
    }
  }
  return { ids, key: `${room.turn}:${room.step}:${active}`, line };
}

/** A live room read back after a restart: the running decision gets its full time again. */
export function resume(room: Room, now: number, _pausedMs: number): void {
  if (room.phase === 'countdown') room.phaseEndsAt = now + COUNTDOWN_MS;
  else if (room.phase === 'playing') room.phaseEndsAt = now + decisionMs(room, room.step);
}
