// Fireworks — a co-operative card game, as pure functions over a room.
//
// Same shape as Liar's Dice (`liars-dice.ts`): every function takes `now`
// (epoch ms) and, where it shuffles, a `rng`, so a whole game plays in a test
// without a clock. The live registry owns timers and fan-out; nothing here
// knows about either.
//
// The table builds five fireworks together, one per colour, each from 1 up to
// 5 in order. The twist: you hold your cards facing AWAY from you. Every phone
// sees everyone else's cards, and of its own only what the team's hints have
// said. On your turn you give a hint (one colour or one number, pointing at
// every matching card in one other player's hand; costs a hint token), drop a
// card (wins a token back), or play one: the next number for its colour joins
// the firework, anything else is a misfire. The team scores the top of every
// firework.
//
// HIDDEN INFORMATION: a player's own hand never goes on their own wire, only
// what hints told them (`knows`: the colours and numbers each card can still
// be). The deck never goes on anybody's. `toWire` is the only door out.
//
// The turn clock: a player who lets it run out drops their oldest card no hint
// has touched (see `autoMove`), marked `auto` in the log.

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

export type Phase = 'lobby' | 'countdown' | 'playing' | 'finished' | 'closed';

/** The five colours a hint may name. */
export const BASE_COLOURS = ['red', 'yellow', 'green', 'blue', 'white'] as const;
export type BaseColour = (typeof BASE_COLOURS)[number];
/** Hard's sixth suit: every colour hint points at it, and no hint names it. */
export const PRISM = 'prism' as const;
export type Colour = BaseColour | typeof PRISM;

export const RANKS = [1, 2, 3, 4, 5] as const;
/** Copies of each number in one colour: three 1s, two each of 2–4, one 5. */
export const COPIES: Record<number, number> = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };
export const MAX_HINTS = 8;

/** Misfires the team can survive is this less one: the last one ends the game. */
export const MISFIRES: Record<Difficulty, number> = { easy: 4, medium: 3, hard: 3 };
/** How long a turn lasts before the server drops a card for you. */
export const TURN_MS: Record<Difficulty, number> = { easy: 90_000, medium: 75_000, hard: 60_000 };

export function coloursFor(difficulty: Difficulty): Colour[] {
  return difficulty === 'hard' ? [...BASE_COLOURS, PRISM] : [...BASE_COLOURS];
}

export function isBaseColour(v: unknown): v is BaseColour {
  return typeof v === 'string' && (BASE_COLOURS as readonly string[]).includes(v);
}

/** Cards in a hand: five for two or three players, four for four or five. */
export function handSize(players: number): number {
  return players <= 3 ? 5 : 4;
}

/** The rule in a sentence, sent on the wire so the phone never has to know it. */
export function ruleLine(difficulty: Difficulty): string {
  const m = MISFIRES[difficulty];
  if (difficulty === 'hard')
    return `Six colours: the prism cards light up for every colour hint. ${m} misfires and the show is over.`;
  if (difficulty === 'easy')
    return `${m} misfires and the show is over. Your cards show what they could still be.`;
  return `${m} misfires and the show is over.`;
}

// ---- The room ------------------------------------------------------------

export interface Card {
  /** Its place in this game's shuffled deck: says nothing about the card. */
  id: number;
  colour: Colour;
  rank: number;
}

/** What the team's hints have said about one card in a hand. Public. */
export interface Knowledge {
  /** Colour hints that pointed at it. */
  colours: BaseColour[];
  /** Colour hints given to this hand that did not. */
  notColours: BaseColour[];
  /** The number a hint pointed at it with. */
  rank: number | null;
  /** Number hints given to this hand that did not. */
  notRanks: number[];
}

export interface HandCard {
  card: Card;
  knows: Knowledge;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** At the table when play started: the team the result is about. */
  seated: boolean;
  /** Oldest first. Never this player's own to see. */
  hand: HandCard[];
}

export type LogEntry =
  | {
      kind: 'hint';
      by: string;
      to: string;
      colour: BaseColour | null;
      rank: number | null;
      /** The cards it pointed at. */
      cards: number[];
      at: number;
    }
  | { kind: 'play'; by: string; card: Card; ok: boolean; auto: boolean; at: number }
  | { kind: 'discard'; by: string; card: Card; auto: boolean; at: number };

export type Ending = 'perfect' | 'misfires' | 'deck' | 'left';

export interface Room {
  id: string;
  game: 'fireworks';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** Undealt cards, top last. Never on any wire but as a count. */
  deck: Card[];
  /** The top number of each firework (0 = not started). */
  stacks: Record<string, number>;
  discards: Card[];
  hints: number;
  misfires: number;
  turnId: string | null;
  /** Turns taken in this game. */
  turn: number;
  /**
   * Once the last card is drawn, who still gets their one last turn; null
   * while the deck has cards. Empty = the show is over.
   */
  finalTurns: string[] | null;
  log: LogEntry[];
  ending: Ending | null;
  startedAt: number | null;
  /** Lobby expiry, countdown end, turn clock, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seated: false, hand: [] };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

/** The players still at the table, seat order. */
export function active(room: Room): Player[] {
  return room.players.filter((p) => p.seated && p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

function emptyStacks(difficulty: Difficulty): Record<string, number> {
  return Object.fromEntries(coloursFor(difficulty).map((c) => [c, 0]));
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter(
    (p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i,
  );
  if (invited.length > MAX_PLAYERS - 1) throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  return {
    id: input.id,
    game: 'fireworks',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    deck: [],
    stacks: emptyStacks(input.difficulty),
    discards: [],
    hints: MAX_HINTS,
    misfires: 0,
    turnId: null,
    turn: 0,
    finalTurns: null,
    log: [],
    ending: null,
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line: "5 colours · 3 misfires". */
export function about(room: Room): string {
  return `${coloursFor(room.difficulty).length} colours · ${MISFIRES[room.difficulty]} misfires`;
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
  room.turnId = null;
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

function finish(room: Room, ending: Ending, now: number): void {
  room.phase = 'finished';
  room.ending = ending;
  room.turnId = null;
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/** The next player still at the table after `fromId`, seat order (wrapping). */
function nextActive(room: Room, fromId: string | null): Player | null {
  const seats = room.players;
  const at = fromId === null ? -1 : seats.findIndex((p) => p.id === fromId);
  for (let k = 1; k <= seats.length; k++) {
    const p = seats[(at + k + seats.length) % seats.length];
    if (p.seated && p.status === 'joined') return p;
  }
  return null;
}

/**
 * Leaving the lobby as host cancels the game. Leaving later hands the host role
 * to the next player, and the last one out closes the room. Mid-game, the
 * leaver's cards go face up on the discard pile (no misfire, no token) and the
 * team plays on; a team left with one player ends the show with the score it
 * has — one player cannot be given a hint.
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
  if (room.phase !== 'playing' || !p.seated) return;

  room.discards.push(...p.hand.map((h) => h.card));
  p.hand = [];
  if (room.finalTurns) room.finalTurns = room.finalTurns.filter((id) => id !== playerId);
  if (active(room).length < 2) {
    finish(room, 'left', now);
    return;
  }
  if (room.finalTurns && room.finalTurns.length === 0) {
    finish(room, 'deck', now);
    return;
  }
  if (room.turnId === playerId) {
    room.turnId = nextActive(room, playerId)?.id ?? null;
    room.phaseEndsAt = now + TURN_MS[room.difficulty];
  }
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length < 2) throw new GameError(409, 'Fireworks needs at least two players.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again — same difficulty — with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.seated = false;
    p.hand = [];
  }
  room.phase = 'lobby';
  room.deck = [];
  room.stacks = emptyStacks(room.difficulty);
  room.discards = [];
  room.hints = MAX_HINTS;
  room.misfires = 0;
  room.turnId = null;
  room.turn = 0;
  room.finalTurns = null;
  room.log = [];
  room.ending = null;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Cards ---------------------------------------------------------------

/** Every card of a difficulty's deck, shuffled; ids are the shuffled order. */
export function buildDeck(difficulty: Difficulty, rng: Rng): Card[] {
  const cards: { colour: Colour; rank: number }[] = [];
  for (const colour of coloursFor(difficulty))
    for (const rank of RANKS) for (let k = 0; k < COPIES[rank]; k++) cards.push({ colour, rank });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  // Numbered after the shuffle, so an id is no clue to what the card is.
  return cards.map((c, i) => ({ id: i + 1, ...c }));
}

export function maxScore(difficulty: Difficulty): number {
  return coloursFor(difficulty).length * 5;
}

export function score(room: Room): number {
  return Object.values(room.stacks).reduce((n, v) => n + v, 0);
}

function fresh(card: Card): HandCard {
  return { card, knows: { colours: [], notColours: [], rank: null, notRanks: [] } };
}

/** Whether a hint of `colour` points at a card of `cardColour`. */
export function colourTouches(colour: BaseColour, cardColour: Colour): boolean {
  return cardColour === colour || cardColour === PRISM;
}

/** The colours a card can still be, from the hints alone. */
export function possibleColours(knows: Knowledge, difficulty: Difficulty): Colour[] {
  return coloursFor(difficulty).filter((c) => {
    if (c === PRISM) return knows.notColours.length === 0;
    return !knows.notColours.includes(c) && knows.colours.every((h) => h === c);
  });
}

/** The numbers a card can still be, from the hints alone. */
export function possibleRanks(knows: Knowledge): number[] {
  if (knows.rank !== null) return [knows.rank];
  return RANKS.filter((r) => !knows.notRanks.includes(r));
}

/** Whether any hint has pointed at the card. */
export function touched(knows: Knowledge): boolean {
  return knows.colours.length > 0 || knows.rank !== null;
}

/**
 * What one of `viewer`'s own cards can still be, counting the copies that
 * viewer can SEE elsewhere (fireworks, discards, other hands) — never their
 * own hand. Easy's "your card could be" line.
 */
export function deduce(room: Room, viewerId: string, knows: Knowledge): { colours: Colour[]; ranks: number[] } {
  const seen = new Map<string, number>();
  const see = (c: { colour: Colour; rank: number }) => {
    const k = `${c.colour}:${c.rank}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  };
  for (const [colour, top] of Object.entries(room.stacks))
    for (let r = 1; r <= top; r++) see({ colour: colour as Colour, rank: r });
  for (const c of room.discards) see(c);
  for (const p of room.players) if (p.id !== viewerId) for (const h of p.hand) see(h.card);

  const colours = new Set<Colour>();
  const ranks = new Set<number>();
  for (const c of possibleColours(knows, room.difficulty))
    for (const r of possibleRanks(knows))
      if ((seen.get(`${c}:${r}`) ?? 0) < COPIES[r]) {
        colours.add(c);
        ranks.add(r);
      }
  const order = coloursFor(room.difficulty);
  return { colours: order.filter((c) => colours.has(c)), ranks: RANKS.filter((r) => ranks.has(r)) };
}

/** Deal the table in and give the host the first turn. */
function deal(room: Room, now: number, rng: Rng): void {
  for (const p of room.players) {
    p.seated = p.status === 'joined';
    p.hand = [];
  }
  const table = active(room);
  room.deck = buildDeck(room.difficulty, rng).reverse();
  const size = handSize(table.length);
  for (let k = 0; k < size; k++) for (const p of table) p.hand.push(fresh(room.deck.pop()!));
  room.stacks = emptyStacks(room.difficulty);
  room.discards = [];
  room.hints = MAX_HINTS;
  room.misfires = 0;
  room.turn = 0;
  room.finalTurns = null;
  room.log = [];
  room.ending = null;
  room.startedAt = now;
  room.phase = 'playing';
  const first = table.find((p) => p.id === room.hostId) ?? table[0];
  room.turnId = first?.id ?? null;
  room.phaseEndsAt = now + TURN_MS[room.difficulty];
  room.updatedAt = now;
}

function assertTurn(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (p.status !== 'joined' || !p.seated) throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'playing')
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : 'The game has not started.');
  if (room.turnId !== playerId) throw new GameError(409, "It's not your turn.");
  return p;
}

function cardIndex(p: Player, card: unknown): number {
  const i = typeof card === 'number' && Number.isInteger(card) ? p.hand.findIndex((h) => h.card.id === card) : -1;
  if (i < 0) throw new GameError(400, 'That card is not in your hand.');
  return i;
}

/** After a play or a drop: take the top card, if there is one. */
function draw(room: Room, p: Player): void {
  const next = room.deck.pop();
  if (next) p.hand.push(fresh(next));
  // The last card is out: everyone, this player included, has one more turn.
  if (room.deck.length === 0 && room.finalTurns === null) room.finalTurns = active(room).map((x) => x.id);
}

/** A turn is over: end the show if it is, else hand the turn on with a fresh clock. */
function endTurn(room: Room, p: Player, now: number, drewBeforeLap: boolean): void {
  room.turn += 1;
  room.updatedAt = now;
  if (score(room) === maxScore(room.difficulty)) return finish(room, 'perfect', now);
  if (room.misfires >= MISFIRES[room.difficulty]) return finish(room, 'misfires', now);
  // The turn that drew the last card is not the player's last turn: it started the lap.
  if (room.finalTurns && !drewBeforeLap) room.finalTurns = room.finalTurns.filter((id) => id !== p.id);
  if (room.finalTurns && room.finalTurns.length === 0) return finish(room, 'deck', now);
  room.turnId = nextActive(room, p.id)?.id ?? null;
  room.phaseEndsAt = now + TURN_MS[room.difficulty];
}

function playAt(room: Room, p: Player, index: number, auto: boolean, now: number): void {
  const lap = room.finalTurns !== null;
  const [{ card }] = p.hand.splice(index, 1);
  const ok = room.stacks[card.colour] === card.rank - 1;
  if (ok) {
    room.stacks[card.colour] = card.rank;
    // Finishing a firework wins a token back.
    if (card.rank === 5 && room.hints < MAX_HINTS) room.hints += 1;
  } else {
    room.misfires += 1;
    room.discards.push(card);
  }
  room.log.push({ kind: 'play', by: p.id, card: { ...card }, ok, auto, at: now });
  draw(room, p);
  endTurn(room, p, now, !lap);
}

function discardAt(room: Room, p: Player, index: number, auto: boolean, now: number): void {
  const lap = room.finalTurns !== null;
  const [{ card }] = p.hand.splice(index, 1);
  room.discards.push(card);
  if (room.hints < MAX_HINTS) room.hints += 1;
  room.log.push({ kind: 'discard', by: p.id, card: { ...card }, auto, at: now });
  draw(room, p);
  endTurn(room, p, now, !lap);
}

/** Play one of your cards (`{ card: id }`): onto its firework if it is next, else a misfire. */
export function play(room: Room, playerId: string, input: { card: unknown }, now: number): void {
  const p = assertTurn(room, playerId);
  playAt(room, p, cardIndex(p, input.card), false, now);
}

/** Drop one of your cards (`{ card: id }`) to win a hint token back. Refused while every token is in. */
export function discard(room: Room, playerId: string, input: { card: unknown }, now: number): void {
  const p = assertTurn(room, playerId);
  const i = cardIndex(p, input.card);
  if (room.hints >= MAX_HINTS)
    throw new GameError(409, `All ${MAX_HINTS} hint tokens are in — give a hint or play a card.`);
  discardAt(room, p, i, false, now);
}

/**
 * Tell another player about their hand: `{ to, colour }` or `{ to, rank }`.
 * Points at EVERY matching card, must point at one at least, and costs a token.
 * A bad hint is refused (400) with a sentence and costs nothing.
 */
export function hint(
  room: Room,
  playerId: string,
  input: { to: unknown; colour?: unknown; rank?: unknown },
  now: number,
): void {
  const p = assertTurn(room, playerId);
  if (room.hints <= 0) throw new GameError(409, 'No hint tokens left — play or drop a card.');
  const target = room.players.find((x) => x.id === input.to);
  if (!target || target.id === p.id || !target.seated || target.status !== 'joined')
    throw new GameError(400, 'Pick another player at the table to hint.');
  const hasColour = input.colour !== undefined && input.colour !== null;
  const hasRank = input.rank !== undefined && input.rank !== null;
  if (hasColour === hasRank) throw new GameError(400, 'Hint one colour or one number.');
  let colour: BaseColour | null = null;
  let rank: number | null = null;
  if (hasColour) {
    if (!isBaseColour(input.colour)) throw new GameError(400, `Hint one of: ${BASE_COLOURS.join(', ')}.`);
    colour = input.colour;
  } else {
    const r = input.rank;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5)
      throw new GameError(400, 'Hint a number from 1 to 5.');
    rank = r;
  }
  const hit = target.hand.filter((h) =>
    colour !== null ? colourTouches(colour, h.card.colour) : h.card.rank === rank,
  );
  if (hit.length === 0) throw new GameError(400, `${target.name} has no card that hint points at.`);
  for (const h of target.hand) {
    const on = hit.includes(h);
    if (colour !== null) {
      if (on && !h.knows.colours.includes(colour)) h.knows.colours.push(colour);
      if (!on && !h.knows.notColours.includes(colour)) h.knows.notColours.push(colour);
    } else if (rank !== null) {
      if (on) h.knows.rank = rank;
      else if (!h.knows.notRanks.includes(rank)) h.knows.notRanks.push(rank);
    }
  }
  room.hints -= 1;
  room.log.push({ kind: 'hint', by: p.id, to: target.id, colour, rank, cards: hit.map((h) => h.card.id), at: now });
  endTurn(room, p, now, false);
}

/** The card the server drops for a player whose clock ran out: the oldest no hint has touched, else the oldest. */
export function autoMove(room: Room): { card: number } | null {
  const p = room.players.find((x) => x.id === room.turnId);
  if (!p || p.hand.length === 0) return null;
  const pick = p.hand.find((h) => !touched(h.knows)) ?? p.hand[0];
  return { card: pick.card.id };
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it.
 * Returns whether anything changed. One call takes ONE step of play (every
 * deadline after a step is set from `now`), so a stale or far-future `now`
 * cannot auto-play a whole game.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  const due = deadline(room);
  if (due === null || due > now) return false;
  switch (room.phase) {
    case 'lobby':
    case 'finished':
      close(room, due);
      break;
    case 'countdown':
      deal(room, now, rng);
      // Somebody left during the countdown: one player cannot play alone.
      if (active(room).length < 2) finish(room, 'left', now);
      break;
    case 'playing': {
      const p = room.players.find((x) => x.id === room.turnId);
      const move = autoMove(room);
      if (!p || !move || p.status !== 'joined') {
        // Nobody's turn, or nothing to drop: hand it on rather than stall.
        const next = p ? nextActive(room, p.id) : nextActive(room, null);
        if (p && room.finalTurns) room.finalTurns = room.finalTurns.filter((id) => id !== p.id);
        if (!next || (room.finalTurns && room.finalTurns.length === 0)) finish(room, 'deck', now);
        else {
          room.turnId = next.id;
          room.phaseEndsAt = now + TURN_MS[room.difficulty];
          room.updatedAt = now;
        }
        break;
      }
      // Timed out: drop a card. With every token in, it is still dropped, for no token.
      discardAt(room, p, p.hand.findIndex((h) => h.card.id === move.card), true, now);
      break;
    }
  }
  return true;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

// ---- Result --------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  /** Everyone shares first: the team wins or loses together. */
  place: 1;
  /** The team's score: the tops of the fireworks. */
  score: number;
  maxScore: number;
  /** They left before the end. */
  left: boolean;
}

/** The whole team, seat order, each with the team's score. */
export function standings(room: Room): Standing[] {
  const s = score(room);
  return room.players
    .filter((p) => p.seated)
    .map((p) => ({ id: p.id, name: p.name, place: 1, score: s, maxScore: maxScore(room.difficulty), left: p.status === 'left' }));
}

/** A perfect show is a win for everyone at the table; anything less is a score. */
export function winners(room: Room): string[] {
  if (room.phase !== 'finished' || score(room) !== maxScore(room.difficulty)) return [];
  return room.players.filter((p) => p.seated).map((p) => p.id);
}

const wireCard = (c: Card) => ({ id: c.id, colour: c.colour, rank: c.rank });

/**
 * The room as one player's phone sees it. Everyone else's hand face up, with
 * what each of them knows; my own hand as ids and knowledge only — colour and
 * number are null until the game is finished. On easy each of my cards also
 * says what it could still be, counting the copies I can see.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const easy = room.difficulty === 'easy';
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    rule: ruleLine(room.difficulty),
    colours: coloursFor(room.difficulty),
    hintColours: [...BASE_COLOURS],
    turnMs: TURN_MS[room.difficulty],
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    turnId: room.turnId,
    turn: room.turn,
    hints: room.hints,
    maxHints: MAX_HINTS,
    misfires: room.misfires,
    maxMisfires: MISFIRES[room.difficulty],
    deck: room.deck.length,
    finalTurns: room.finalTurns ? room.finalTurns.length : null,
    stacks: { ...room.stacks },
    score: score(room),
    maxScore: maxScore(room.difficulty),
    discards: room.discards.map(wireCard),
    log: room.log.map((e) =>
      e.kind === 'hint'
        ? { kind: e.kind, by: e.by, to: e.to, colour: e.colour, rank: e.rank, cards: [...e.cards], ok: null, auto: false, card: null }
        : { kind: e.kind, by: e.by, to: null, colour: null, rank: null, cards: [], ok: e.kind === 'play' ? e.ok : null, auto: e.auto, card: wireCard(e.card) },
    ),
    players: room.players.map((p) => {
      const mine = p.id === meId && !finished;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        isHost: p.id === room.hostId,
        seated: p.seated,
        hand: p.hand.map((h) => ({
          id: h.card.id,
          colour: mine ? null : h.card.colour,
          rank: mine ? null : h.card.rank,
          knows: {
            colours: possibleColours(h.knows, room.difficulty),
            ranks: possibleRanks(h.knows),
            hinted: touched(h.knows),
          },
          could: mine && easy ? deduce(room, meId, h.knows) : null,
        })),
      };
    }),
    ending: room.ending,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
