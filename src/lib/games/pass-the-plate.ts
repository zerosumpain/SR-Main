// Pass the Plate — a card-drafting picnic, as pure functions over a room.
//
// Same shape as Liar's Dice (`liars-dice.ts`): every function takes `now`
// (epoch ms) and, where it shuffles or picks for somebody, a `rng`, so a whole
// game plays in a test without a clock. The live registry owns timers and
// fan-out; nothing here knows about either.
//
// Three rounds. Each round everyone is dealt a plate of food cards (10 each
// for two players, down to 7 each for five). Every turn everybody secretly
// takes one card off the plate in front of them; when all have chosen, the
// choices go down on the table together and every plate is passed on — to the
// next seat in rounds 1 and 3, the other way in round 2. When the plates are
// empty the round is scored, the table is cleared (ice cream stays), and the
// next round is dealt from a freshly shuffled deck. The deck, the names and the
// numbers below are this game's own.
//
// Hidden information: a phone sees its OWN plate and its own pending choice.
// Everybody's table (the cards already taken) is public, as are hand sizes and
// who has chosen this turn — never what.
//
// The turn clock: anyone who has not chosen when it runs out has a card taken
// for them at random (marked `auto` on the wire), so a stalled phone never
// holds the table up.

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

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, MAX_PLAYERS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'picking' | 'scoring' | 'finished' | 'closed';

export const ROUNDS = 3;
export const MIN_PLAYERS = 2;

/** Cards each, by how many sat down for the round. */
export const HAND_SIZE: Record<number, number> = { 2: 10, 3: 9, 4: 8, 5: 7 };

/** How long a turn lasts before the server takes a card for whoever has not chosen. */
export const TURN_MS: Record<Difficulty, number> = {
  easy: 40_000,
  medium: 30_000,
  hard: 20_000,
};
/** How long the round's scores stay up before the next deal. */
export const SCORING_MS = 8_000;

// ---- The deck --------------------------------------------------------------

export const KINDS = [
  'pancake',
  'pizza',
  'popcorn',
  'berry1',
  'berry2',
  'berry3',
  'pie2',
  'pie3',
  'pie4',
  'gravy',
  'spoon',
  'icecream',
] as const;
export type Kind = (typeof KINDS)[number];

export type Family = 'pair' | 'triple' | 'sliding' | 'majority' | 'pie' | 'multiplier' | 'takeTwo' | 'dessert';

export interface CardInfo {
  name: string;
  emoji: string;
  family: Family;
  /** Copies in the full deck. */
  count: number;
  /** Berries on the card (majority), or the pie's points. */
  value: number;
  /** What it does, in a sentence for the reference card. */
  rule: string;
}

/** Pairs: every complete pair of pancakes. */
export const PAIR_POINTS = 6;
/** Triples: every complete set of three pizza slices. */
export const TRIPLE_POINTS = 12;
/** Popcorn by how many you hold: index = count, capped at the last entry. */
export const POPCORN_POINTS = [0, 1, 3, 6, 10, 14, 18] as const;
/** Strawberries: most berries this round, and second most. */
export const BERRY_MOST = 7;
export const BERRY_SECOND = 3;
/** A pie after an unspent gravy jug scores this many times its points. */
export const GRAVY_TIMES = 2;
/** Ice cream at the end of the game: most scoops, and fewest (three or more players). */
export const ICE_CREAM_POINTS = 5;

export const CARDS: Record<Kind, CardInfo> = {
  pancake: {
    name: 'Pancake Stack',
    emoji: '🥞',
    family: 'pair',
    count: 14,
    value: 0,
    rule: `Every two make a pair worth ${PAIR_POINTS}. An odd one left over scores nothing.`,
  },
  pizza: {
    name: 'Pizza Slice',
    emoji: '🍕',
    family: 'triple',
    count: 14,
    value: 0,
    rule: `Every three make a whole pizza worth ${TRIPLE_POINTS}. One or two on their own score nothing.`,
  },
  popcorn: {
    name: 'Popcorn',
    emoji: '🍿',
    family: 'sliding',
    count: 14,
    value: 0,
    rule: 'The more you have, the better: 1, 3, 6, 10, 14 points, and 18 for six or more.',
  },
  berry1: {
    name: 'One Strawberry',
    emoji: '🍓',
    family: 'majority',
    count: 6,
    value: 1,
    rule: `Count your berries. Most this round scores ${BERRY_MOST}, second most ${BERRY_SECOND}.`,
  },
  berry2: {
    name: 'Two Strawberries',
    emoji: '🍓',
    family: 'majority',
    count: 12,
    value: 2,
    rule: `Count your berries. Most this round scores ${BERRY_MOST}, second most ${BERRY_SECOND}.`,
  },
  berry3: {
    name: 'Three Strawberries',
    emoji: '🍓',
    family: 'majority',
    count: 8,
    value: 3,
    rule: `Count your berries. Most this round scores ${BERRY_MOST}, second most ${BERRY_SECOND}.`,
  },
  pie2: { name: 'Mini Pie', emoji: '🥧', family: 'pie', count: 6, value: 2, rule: 'Worth 2. Double after a gravy jug.' },
  pie3: { name: 'Pie', emoji: '🥧', family: 'pie', count: 10, value: 3, rule: 'Worth 3. Double after a gravy jug.' },
  pie4: { name: 'Family Pie', emoji: '🥧', family: 'pie', count: 6, value: 4, rule: 'Worth 4. Double after a gravy jug.' },
  gravy: {
    name: 'Gravy Jug',
    emoji: '🫗',
    family: 'multiplier',
    count: 6,
    value: 0,
    rule: 'The next pie you take is worth double. Scores nothing by itself.',
  },
  spoon: {
    name: 'Serving Spoon',
    emoji: '🥄',
    family: 'takeTwo',
    count: 4,
    value: 0,
    rule: 'On a later turn, take two cards at once. The spoon goes back on the plate you pass on.',
  },
  icecream: {
    name: 'Ice Cream',
    emoji: '🍨',
    family: 'dessert',
    count: 12,
    value: 0,
    rule: `Kept to the end of the game. Most scoops scores ${ICE_CREAM_POINTS}; fewest loses ${ICE_CREAM_POINTS} (not with two players).`,
  },
};

/** Easy leaves out the two cards that change how you take: the gravy jug and the serving spoon. */
export function deckKinds(difficulty: Difficulty): Kind[] {
  return difficulty === 'easy' ? KINDS.filter((k) => k !== 'gravy' && k !== 'spoon') : [...KINDS];
}

/** Every card in this difficulty's deck, kinds in catalogue order. */
export function deckFor(difficulty: Difficulty): Kind[] {
  return deckKinds(difficulty).flatMap((k) => Array.from({ length: CARDS[k].count }, () => k));
}

/**
 * What the phone shows to help. `gains`: every card on my plate says what it
 * would add now, plus my round so far (easy). `total`: my round so far only
 * (medium). `none` (hard).
 */
export type Hints = 'gains' | 'total' | 'none';
export const HINTS: Record<Difficulty, Hints> = { easy: 'gains', medium: 'total', hard: 'none' };

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- Scoring (pure) --------------------------------------------------------

export interface Card {
  /** Unique within the room, across rounds: what a pick names. */
  uid: number;
  kind: Kind;
}

/** A card on somebody's table, in the order it was taken. */
export interface Played extends Card {
  /** A pie that took a gravy jug's double. */
  boosted: boolean;
  /** A gravy jug a pie has used. */
  spent: boolean;
}

/** Put a taken card on a table: a pie uses the oldest unspent gravy jug. */
export function place(table: Played[], card: Card): void {
  const entry: Played = { uid: card.uid, kind: card.kind, boosted: false, spent: false };
  if (CARDS[card.kind].family === 'pie') {
    const jug = table.find((c) => c.kind === 'gravy' && !c.spent);
    if (jug) {
      jug.spent = true;
      entry.boosted = true;
    }
  }
  table.push(entry);
}

export function berriesOf(table: readonly Card[]): number {
  return table.reduce((n, c) => n + (CARDS[c.kind].family === 'majority' ? CARDS[c.kind].value : 0), 0);
}

export interface Breakdown {
  pancakes: number;
  pizza: number;
  popcorn: number;
  pies: number;
}

/** A table's points that need nobody else's: pairs, triples, popcorn and pies. */
export function ownPoints(table: readonly Played[]): Breakdown {
  const n = (k: Kind) => table.filter((c) => c.kind === k).length;
  const popcorn = n('popcorn');
  return {
    pancakes: Math.floor(n('pancake') / 2) * PAIR_POINTS,
    pizza: Math.floor(n('pizza') / 3) * TRIPLE_POINTS,
    popcorn: POPCORN_POINTS[Math.min(popcorn, POPCORN_POINTS.length - 1)],
    pies: table.reduce(
      (sum, c) => sum + (CARDS[c.kind].family === 'pie' ? CARDS[c.kind].value * (c.boosted ? GRAVY_TIMES : 1) : 0),
      0,
    ),
  };
}

export function ownTotal(table: readonly Played[]): number {
  const b = ownPoints(table);
  return b.pancakes + b.pizza + b.popcorn + b.pies;
}

/** What taking `card` would add to `table`'s own points right now (berries and ice cream are 0 here). */
export function gainOf(table: readonly Played[], card: Card): number {
  const next = table.map((c) => ({ ...c }));
  place(next, card);
  return ownTotal(next) - ownTotal(table);
}

/**
 * Strawberry points for a round. Only someone with at least one berry scores.
 * The most berries scores BERRY_MOST; players tied for most split it (rounded
 * down) and nobody scores second. Otherwise the second most scores
 * BERRY_SECOND, split (rounded down) between any tied for it.
 */
export function berryPoints(counts: readonly { id: string; berries: number }[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(counts.map((c) => [c.id, 0]));
  const any = counts.filter((c) => c.berries > 0);
  if (!any.length) return out;
  const top = Math.max(...any.map((c) => c.berries));
  const first = any.filter((c) => c.berries === top);
  for (const c of first) out[c.id] = Math.floor(BERRY_MOST / first.length);
  if (first.length > 1) return out;
  const rest = any.filter((c) => c.berries < top);
  if (!rest.length) return out;
  const next = Math.max(...rest.map((c) => c.berries));
  const second = rest.filter((c) => c.berries === next);
  for (const c of second) out[c.id] = Math.floor(BERRY_SECOND / second.length);
  return out;
}

/**
 * Ice cream at the game's end. If everyone has the same number nobody scores.
 * Otherwise the most scoops score ICE_CREAM_POINTS, split (rounded down)
 * between any tied; with three or more players the fewest lose
 * ICE_CREAM_POINTS, split the same way. Zero scoops counts as fewest.
 */
export function dessertPoints(counts: readonly { id: string; scoops: number }[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(counts.map((c) => [c.id, 0]));
  if (counts.length < 2) return out;
  const most = Math.max(...counts.map((c) => c.scoops));
  const fewest = Math.min(...counts.map((c) => c.scoops));
  if (most === fewest) return out;
  const top = counts.filter((c) => c.scoops === most);
  for (const c of top) out[c.id] = Math.floor(ICE_CREAM_POINTS / top.length);
  if (counts.length >= 3) {
    const bottom = counts.filter((c) => c.scoops === fewest);
    for (const c of bottom) out[c.id] = -Math.floor(ICE_CREAM_POINTS / bottom.length);
  }
  return out;
}

export interface RoundRow extends Breakdown {
  playerId: string;
  berryCount: number;
  berries: number;
  /** Scoops taken this round (scored at the end of the game). */
  scoops: number;
  total: number;
}

/** Score one round's tables. */
export function scoreRound(tables: readonly { id: string; table: readonly Played[] }[]): RoundRow[] {
  const berries = berryPoints(tables.map((t) => ({ id: t.id, berries: berriesOf(t.table) })));
  return tables.map((t) => {
    const own = ownPoints(t.table);
    const row: RoundRow = {
      playerId: t.id,
      ...own,
      berryCount: berriesOf(t.table),
      berries: berries[t.id] ?? 0,
      scoops: t.table.filter((c) => c.kind === 'icecream').length,
      total: 0,
    };
    row.total = row.pancakes + row.pizza + row.popcorn + row.pies + row.berries;
    return row;
  });
}

// ---- The room --------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Sat at the table when play started: the ones standings are about. */
  seated: boolean;
  /** The plate in front of me. Never another phone's to see. */
  hand: Card[];
  /** My choice this turn (one uid, or two with a spoon); null until I choose. Never another phone's to see. */
  pick: number[] | null;
  /** This round's table, in the order taken. */
  played: Played[];
  /** Scoops kept from finished rounds. */
  iceCream: number;
  /** Points per finished round. */
  rounds: number[];
  /** The round they left in; null while in. */
  leftRound: number | null;
}

export interface TurnPlay {
  playerId: string;
  cards: Card[];
  /** The turn clock ran out and the server took a card for them. */
  auto: boolean;
}

export interface RoundResult {
  round: number;
  rows: RoundRow[];
}

export interface DessertRow {
  playerId: string;
  scoops: number;
  points: number;
}

export interface Room {
  id: string;
  game: 'pass-the-plate';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** 1-based; 0 before the first deal. */
  round: number;
  /** 1-based turn within the round. */
  turn: number;
  /** Cards each were dealt this round. */
  handSize: number;
  nextUid: number;
  /** What everybody took last turn, revealed together. */
  lastTurn: TurnPlay[] | null;
  results: RoundResult[];
  /** The ice cream, once the game is over. */
  dessert: DessertRow[] | null;
  startedAt: number | null;
  /** Lobby expiry, countdown end, turn clock, scoring end, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seated: false, hand: [], pick: null, played: [], iceCream: 0, rounds: [], leftRound: null };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

/** Players at the table: seated and still here. Seat order. */
export function active(room: Room): Player[] {
  return room.players.filter((p) => p.seated && p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

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
  return {
    id: input.id,
    game: 'pass-the-plate',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    round: 0,
    turn: 0,
    handSize: 0,
    nextUid: 1,
    lastTurn: null,
    results: [],
    dessert: null,
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line. */
export function about(room: Room): string {
  switch (room.difficulty) {
    case 'easy':
      return 'Three rounds · simple deck · hints on';
    case 'medium':
      return 'Three rounds · full deck';
    default:
      return 'Three rounds · full deck · no hints';
  }
}

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

/**
 * Leaving the lobby as host cancels the game. Leaving later hands the host role
 * on, and the last one out closes the room. Mid-game the leaver's plate leaves
 * with them (the others' plates are all one size, so passing carries on round
 * the smaller table), their points so far stay in the standings below everyone
 * still playing, and a table left with one player ends with them the winner.
 * If everyone else had already chosen, the turn is revealed at once.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') return;
  const wasIn = p.seated;
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
  if (!wasIn || (room.phase !== 'picking' && room.phase !== 'scoring')) return;

  p.hand = [];
  p.pick = null;
  p.leftRound = room.round;
  if (active(room).length < MIN_PLAYERS) {
    finish(room, now);
    return;
  }
  if (room.phase === 'picking' && active(room).every((x) => x.pick !== null)) reveal(room, now, null);
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length < MIN_PLAYERS) throw new GameError(409, 'Pass the Plate needs at least two players.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    Object.assign(p, { seated: false, hand: [], pick: null, played: [], iceCream: 0, rounds: [], leftRound: null });
  }
  room.phase = 'lobby';
  room.round = 0;
  room.turn = 0;
  room.handSize = 0;
  room.lastTurn = null;
  room.results = [];
  room.dessert = null;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Play ------------------------------------------------------------------

/** Which way plates go this round: to the next seat (left) in odd rounds, back (right) in round 2. */
export function direction(round: number): 'left' | 'right' {
  return round % 2 === 0 ? 'right' : 'left';
}

/** A fresh shuffle of the difficulty's deck, and a plate each for everyone at the table. */
function deal(room: Room, now: number, rng: Rng): void {
  const table = active(room);
  room.round += 1;
  room.turn = 1;
  room.handSize = HAND_SIZE[Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, table.length))];
  const deck = shuffle(deckFor(room.difficulty), rng);
  for (const p of room.players) {
    p.hand = [];
    p.pick = null;
    p.played = [];
  }
  table.forEach((p, i) => {
    p.hand = deck.slice(i * room.handSize, (i + 1) * room.handSize).map((kind) => ({ uid: room.nextUid++, kind }));
  });
  room.lastTurn = null;
  room.phase = 'picking';
  room.phaseEndsAt = now + TURN_MS[room.difficulty];
  room.updatedAt = now;
}

function hasSpoon(p: Player): boolean {
  return p.played.some((c) => c.kind === 'spoon');
}

/** Why a choice is not allowed, or null if it is. */
export function pickProblem(p: Pick<Player, 'hand' | 'played'>, cards: unknown): string | null {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 2) return 'Choose one card from your plate.';
  if (!cards.every((c) => typeof c === 'number' && Number.isInteger(c))) return 'Choose one card from your plate.';
  if (new Set(cards).size !== cards.length) return 'Choose two different cards.';
  if (!cards.every((c) => p.hand.some((h) => h.uid === c))) return 'That card is not on your plate any more.';
  if (cards.length === 2) {
    if (!p.played.some((c) => c.kind === 'spoon')) return 'Taking two needs a serving spoon on your table.';
    if (p.hand.length < 2) return 'There is only one card left on your plate.';
  }
  return null;
}

/**
 * Choose this turn's card: `{ cards: [uid] }`, or `{ cards: [uid, uid] }` with
 * a serving spoon on your table. A choice can be changed until everyone has
 * chosen; the last one in reveals the turn.
 */
export function pick(room: Room, playerId: string, input: { cards: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined' || !p.seated) throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'picking') {
    throw new GameError(
      409,
      room.phase === 'finished' ? 'That game is over.' : room.phase === 'scoring' ? 'The round is being scored.' : 'The game has not started.',
    );
  }
  const problem = pickProblem(p, input.cards);
  if (problem) throw new GameError(400, problem);
  p.pick = [...(input.cards as number[])];
  room.updatedAt = now;
  if (active(room).every((x) => x.pick !== null)) reveal(room, now, null);
}

/**
 * Everybody's choice goes down together and the plates move on. Anyone who has
 * not chosen gets a random card (needs `rng`; the last pick never does). A
 * two-card take puts the spoon back on the plate before it is passed.
 */
function reveal(room: Room, now: number, rng: Rng | null): void {
  const table = active(room);
  const plays: TurnPlay[] = [];
  for (const p of table) {
    let auto = false;
    if (p.pick === null || pickProblem(p, p.pick) !== null) {
      if (!p.hand.length) {
        p.pick = [];
      } else {
        const r = rng ? rng() : 0;
        const at = Math.min(p.hand.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * p.hand.length)));
        p.pick = [p.hand[at].uid];
        auto = true;
      }
    }
    const taken = p.pick.map((uid) => p.hand.find((c) => c.uid === uid)!).filter(Boolean);
    p.hand = p.hand.filter((c) => !p.pick!.includes(c.uid));
    for (const c of taken) place(p.played, c);
    if (taken.length === 2) {
      const at = p.played.findIndex((c) => c.kind === 'spoon');
      if (at >= 0) {
        const [spoon] = p.played.splice(at, 1);
        p.hand.push({ uid: spoon.uid, kind: spoon.kind });
      }
    }
    p.pick = null;
    plays.push({ playerId: p.id, cards: taken.map((c) => ({ uid: c.uid, kind: c.kind })), auto });
  }
  room.lastTurn = plays;

  // Pass every plate on.
  const hands = table.map((p) => p.hand);
  const step = direction(room.round) === 'left' ? 1 : -1;
  table.forEach((p, i) => {
    p.hand = hands[(i - step + table.length) % table.length];
  });

  if (table.every((p) => p.hand.length === 0)) {
    scoreTheRound(room, now);
  } else {
    room.turn += 1;
    room.phaseEndsAt = now + TURN_MS[room.difficulty];
  }
  room.updatedAt = now;
}

function scoreTheRound(room: Room, now: number): void {
  const table = active(room);
  const rows = scoreRound(table.map((p) => ({ id: p.id, table: p.played })));
  for (const row of rows) {
    const p = table.find((x) => x.id === row.playerId)!;
    p.rounds.push(row.total);
    p.iceCream += row.scoops;
  }
  room.results.push({ round: room.round, rows });
  room.phase = 'scoring';
  room.phaseEndsAt = now + SCORING_MS;
  room.updatedAt = now;
}

/**
 * The end of the game. Finishing mid-round (the table dropped to one) does not
 * score the unfinished round: its tables are cleared, so the wire's scoops,
 * the dessert rows and the standings all count the same finished rounds.
 */
function finish(room: Room, now: number): void {
  if (room.phase === 'picking') {
    for (const p of room.players) p.played = [];
    room.lastTurn = null;
  }
  const table = active(room);
  const points = dessertPoints(table.map((p) => ({ id: p.id, scoops: p.iceCream })));
  room.dessert = table.map((p) => ({ playerId: p.id, scoops: p.iceCream, points: points[p.id] ?? 0 }));
  for (const p of room.players) {
    p.hand = [];
    p.pick = null;
  }
  room.phase = 'finished';
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it.
 * Returns whether anything changed. As in Liar's Dice, each step sets its next
 * deadline from `now`, so one call takes ONE step of play and a stale or
 * far-future `now` cannot auto-play the game.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 3; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case 'lobby':
      case 'finished':
        close(room, due);
        break;
      case 'countdown':
        for (const p of room.players) {
          p.seated = p.status === 'joined';
          p.leftRound = null;
        }
        room.startedAt = now;
        if (active(room).length < MIN_PLAYERS) finish(room, now);
        else deal(room, now, rng);
        break;
      case 'picking':
        reveal(room, now, rng);
        break;
      case 'scoring':
        if (room.round < ROUNDS && active(room).length >= MIN_PLAYERS) deal(room, now, rng);
        else finish(room, now);
        break;
    }
    if (room.phase !== 'closed') break;
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

// ---- Result ----------------------------------------------------------------

/** Points so far: finished rounds, plus the ice cream once the game is over. */
export function totalOf(room: Room, p: Player): number {
  const dessert = room.dessert?.find((d) => d.playerId === p.id)?.points ?? 0;
  return p.rounds.reduce((a, b) => a + b, 0) + dessert;
}

/**
 * Scoops so far. While a round is being played its table's ice cream is
 * added; once it is scored (scoring, finished) it is already in `iceCream`.
 */
function scoopsOf(room: Room, p: Player): number {
  const onTable = room.phase === 'picking' ? p.played.filter((c) => c.kind === 'icecream').length : 0;
  return p.iceCream + onTable;
}

/** Left during play (picking or scoring). Leaving the results screen does not count. */
function leftEarly(p: Player): boolean {
  return p.leftRound !== null;
}

export interface Standing {
  id: string;
  name: string;
  place: number;
  score: number;
  /** Ice cream scoops: the tie-break. */
  scoops: number;
  /** They left before the end. */
  left: boolean;
}

/**
 * Everyone who sat down: those still playing by points, more ice cream
 * breaking a tie (still level shares the place), then anyone who left, by
 * points.
 */
export function standings(room: Room): Standing[] {
  const seated = room.players.filter((p) => p.seated);
  const row = (p: Player) => ({ id: p.id, name: p.name, score: totalOf(room, p), scoops: p.iceCream, left: leftEarly(p) });
  const by = (a: ReturnType<typeof row>, b: ReturnType<typeof row>) => b.score - a.score || b.scoops - a.scoops;
  const playing = seated.filter((p) => !leftEarly(p)).map(row).sort(by);
  const gone = seated.filter((p) => leftEarly(p)).map(row).sort(by);
  const out: Standing[] = [];
  playing.forEach((r, i) => {
    const prev = out[i - 1];
    const place = prev && prev.score === r.score && prev.scoops === r.scoops ? prev.place : i + 1;
    out.push({ ...r, place });
  });
  gone.forEach((r) => out.push({ ...r, place: out.length + 1 }));
  return out;
}

/** Top score among those still playing; ice cream breaks a tie, and a dead heat shares it. */
export function winners(room: Room): string[] {
  return standings(room)
    .filter((s) => !s.left && s.place === 1)
    .map((s) => s.id);
}

/**
 * The room as one player's phone sees it. My plate and my pending choice
 * only; for everyone else, how many cards they hold and whether they have
 * chosen. Every table is public.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const hints = HINTS[room.difficulty];
  const me = room.players.find((p) => p.id === meId) ?? null;
  const table = active(room);
  const at = me ? table.findIndex((p) => p.id === me.id) : -1;
  const step = direction(Math.max(1, room.round)) === 'left' ? 1 : -1;
  const neighbour = (k: number) => (at >= 0 && table.length > 1 ? table[(at + k + table.length) % table.length].id : null);
  const card = (c: Card) => ({ uid: c.uid, kind: c.kind });
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    rounds: ROUNDS,
    round: room.round,
    turn: room.turn,
    handSize: room.handSize,
    direction: direction(Math.max(1, room.round)),
    passTo: neighbour(step),
    passFrom: neighbour(-step),
    turnMs: TURN_MS[room.difficulty],
    scoringMs: SCORING_MS,
    hints,
    kinds: deckKinds(room.difficulty).map((kind) => ({ kind, ...CARDS[kind] })),
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    hand: me
      ? me.hand.map((c) => ({ ...card(c), gain: hints === 'gains' ? gainOf(me.played, c) : null }))
      : [],
    myPick: me?.pick ? [...me.pick] : [],
    canTakeTwo: !!me && room.phase === 'picking' && hasSpoon(me) && me.hand.length >= 2,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seated: p.seated,
      handCount: p.hand.length,
      picked: room.phase === 'picking' && p.pick !== null,
      played: p.played.map((c) => ({ ...card(c), boosted: c.boosted, spent: c.spent })),
      iceCream: scoopsOf(room, p),
      berries: berriesOf(p.played),
      score: totalOf(room, p),
      roundSoFar: hints === 'none' && !finished ? null : ownTotal(p.played),
      left: p.seated && p.status === 'left',
    })),
    lastTurn: room.lastTurn ? room.lastTurn.map((t) => ({ playerId: t.playerId, cards: t.cards.map(card), auto: t.auto })) : null,
    results: room.results.map((r) => ({ round: r.round, rows: r.rows.map((x) => ({ ...x })) })),
    dessert: room.dessert ? room.dessert.map((d) => ({ ...d })) : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;

/**
 * The leaderboard's rank for one finished standing: the game's own place, so
 * a score tie lost on ice cream is recorded below the winner, not beside it.
 */
export function resultRank(standing: { id: string; [key: string]: unknown }): number | null {
  const v = standing.place;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}
