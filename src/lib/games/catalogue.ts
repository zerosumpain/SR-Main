// The games the rooms can host, each a rules module behind one interface.
//
// A rules module is pure (see `tap-duel.ts`): every function takes `now`, and
// the dealing ones a `rng`. The lobby verbs — join, decline, leave, start,
// again (and invite, which the registry runs on `player`) — mean the same thing in every game; what differs is the game's own
// moves (`tap`, `guess`) and what a phone may see (`toWire`).

import * as tapDuel from './tap-duel';
import * as wordleRace from './wordle-race';
import * as quizNight from './quiz-night';
import * as anagramBlitz from './anagram-blitz';
import * as mathsSprint from './maths-sprint';
import * as sequenceMemory from './sequence-memory';
import * as boggle from './boggle';
import * as categories from './categories';
import * as liarsDice from './liars-dice';
import * as drawGuess from './draw-guess';
import * as marbleRace from './marble-race';
import * as chess from './chess';
import * as homestead from './homestead';
import { writeQuiz } from './quiz-night.server';
import type { Difficulty, PlayerStatus, Rng } from './tap-duel';

export const GAME_IDS = [
  'tap-duel',
  'wordle-race',
  'quiz-night',
  'anagram-blitz',
  'maths-sprint',
  'sequence-memory',
  'boggle',
  'categories',
  'liars-dice',
  'draw-guess',
  'marble-race',
  'chess',
  'homestead',
] as const;
export type GameId = (typeof GAME_IDS)[number];

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);
}

/** What the registry reads of any room: who is in it, who hosts, where it is. */
export interface RoomBase {
  id: string;
  game: GameId;
  difficulty: Difficulty;
  hostId: string;
  phase: string;
  players: { id: string; name: string; status: PlayerStatus }[];
  phaseEndsAt: number | null;
  /** Set by a game that supports pace (from `options.pace`); absent = 'live'. */
  pace?: Pace;
}

/** How fast a room's turns go: 'live' (everyone at the table, short timers) or 'async' (a move a day). */
export type Pace = 'live' | 'async';
export const PACES = ['live', 'async'] as const;

type Move = (room: RoomBase, playerId: string, body: Record<string, unknown>, now: number) => void;

// Method syntax on purpose: each module's functions take its own Room, and
// method parameters are checked bivariantly, so a module fits without casts.
export interface GameRules {
  createRoom(input: {
    id: string;
    host: { id: string; name: string };
    invite: { id: string; name: string }[];
    difficulty: Difficulty;
    /** Game-specific choices from the create request (Quiz Night: topic, audience). */
    options?: Record<string, unknown>;
    now: number;
  }): RoomBase;
  /**
   * Work a room needs before it can start, run once after it is created —
   * Quiz Night writes its questions here. It settles the room itself and must
   * not throw; the registry tells the room's phones when it resolves.
   */
  prepare?(room: RoomBase): Promise<void>;
  /** One line for an invite banner saying what this game is about, or null. */
  about?(room: RoomBase): string | null;
  /** A fresh player row in this game's own shape — for an invite sent from the lobby. */
  player(id: string, name: string, status: PlayerStatus): RoomBase['players'][number];
  join(room: RoomBase, playerId: string, now: number): void;
  decline(room: RoomBase, playerId: string, now: number): void;
  leave(room: RoomBase, playerId: string, now: number): void;
  start(room: RoomBase, playerId: string, now: number): void;
  again(room: RoomBase, playerId: string, now: number): void;
  advance(room: RoomBase, now: number, rng: Rng): boolean;
  deadline(room: RoomBase): number | null;
  /**
   * `since` is what a phone already holds of a game that can send itself as
   * changes (Draw & Guess's drawing revision); a game without that ignores it.
   */
  toWire(room: RoomBase, meId: string, now: number, since?: number | null): { id: string; phase: string; serverNow: number };
  /**
   * The cursor a phone holds after this room's wire — what it would send back
   * as `since`. Only games that send changes have one; the stream keeps it per
   * subscriber, so each frame after the first carries only what is new.
   */
  revision?(room: RoomBase): number;
  /** The game's own actions, by the name the phone posts. */
  moves: Record<string, Move>;
  /**
   * The leaderboard's high score for one row of this game's finished
   * `standings`, when it is not the row's own numeric `score` (the default).
   * Null: this game has no score, and its board ranks by wins.
   */
  resultScore?(standing: { id: string; [key: string]: unknown }): number | null;
  /**
   * Rooms of this game are written to `game_rooms` and survive a restart
   * (spec: 2026-10-22-family-games-durable-rooms.md). `schema` is bumped when
   * the room's stored shape changes; a row written under an older schema is
   * passed to `revive` (null = cannot: the room is closed and logged). The
   * room MUST be JSON-safe: plain objects, arrays, strings, finite numbers,
   * booleans, null — no Map, Set, Date, functions or class instances.
   */
  durable?: { schema: number; revive?(state: Record<string, unknown>, fromSchema: number): RoomBase | null };
  /** The paces a host may pick; absent = ['live']. */
  paces?: readonly Pace[];
  /**
   * Who the room is waiting on right now, and a key that changes whenever a
   * new decision starts (turn + step + who). Null when nobody (lobby,
   * countdown, finished). Drives the "your move" push and the lobby's
   * `myTurn`; `line` is the push body's first sentence ("Sam rolled a 9.").
   */
  waitingOn?(room: RoomBase): { ids: string[]; key: string; line?: string } | null;
  /**
   * A live-pace room read back after a restart: restart the running
   * decision's timer from `now` (a deploy is a pause, never a timeout).
   * `pausedMs` is how long it was down. Not called for async rooms.
   */
  resume?(room: RoomBase, now: number, pausedMs: number): void;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const GAMES: Record<GameId, GameRules> = {
  'tap-duel': {
    ...tapDuel,
    moves: {
      tap: (room, playerId, body, now) =>
        tapDuel.tap(
          room as tapDuel.Room,
          playerId,
          { round: num(body.round) ?? -1, reactionMs: num(body.reactionMs), early: body.early === true },
          now,
        ),
    },
  },
  'wordle-race': {
    ...wordleRace,
    moves: {
      guess: (room, playerId, body, now) => wordleRace.guess(room as wordleRace.Room, playerId, { word: body.word }, now),
    },
  },
  'quiz-night': {
    ...quizNight,
    prepare: (room) => writeQuiz(room as quizNight.Room),
    moves: {
      answer: (room, playerId, body, now) =>
        quizNight.answer(room as quizNight.Room, playerId, { question: num(body.question) ?? -1, choice: num(body.choice) ?? -1 }, now),
    },
  },
  'anagram-blitz': {
    ...anagramBlitz,
    moves: {
      word: (room, playerId, body, now) => anagramBlitz.word(room as anagramBlitz.Room, playerId, { word: body.word }, now),
    },
  },
  'maths-sprint': {
    ...mathsSprint,
    moves: {
      // Raw on purpose: `answer` types its own fields (409 for a stale index, 400 for a non-integer).
      answer: (room, playerId, body, now) =>
        mathsSprint.answer(room as mathsSprint.Room, playerId, { index: body.index, value: body.value }, now),
    },
  },
  'sequence-memory': {
    ...sequenceMemory,
    // The longest sequence repeated: its standings carry no `score`.
    resultScore: (s) => (typeof s.best === 'number' ? s.best : null),
    moves: {
      attempt: (room, playerId, body, now) =>
        sequenceMemory.attempt(room as sequenceMemory.Room, playerId, { round: num(body.round) ?? -1, taps: body.taps }, now),
    },
  },
  boggle: {
    ...boggle,
    moves: {
      word: (room, playerId, body, now) =>
        boggle.word(room as boggle.Room, playerId, { word: body.word, path: body.path }, now),
    },
  },
  categories: {
    ...categories,
    moves: {
      // Raw on purpose: each types its own fields (400 for a slot off the card).
      answer: (room, playerId, body, now) =>
        categories.answer(room as categories.Room, playerId, { index: body.index, text: body.text }, now),
      veto: (room, playerId, body, now) =>
        categories.veto(room as categories.Room, playerId, { playerId: body.playerId, index: body.index }, now),
      unveto: (room, playerId, body, now) =>
        categories.unveto(room as categories.Room, playerId, { playerId: body.playerId, index: body.index }, now),
      done: (room, playerId, _body, now) => categories.done(room as categories.Room, playerId, now),
    },
  },
  'liars-dice': {
    ...liarsDice,
    moves: {
      // Raw on purpose: `bid` types its own fields (400 with a sentence for a bad bid).
      bid: (room, playerId, body, now) =>
        liarsDice.bid(room as liarsDice.Room, playerId, { quantity: body.quantity, face: body.face }, now),
      liar: (room, playerId, _body, now) => liarsDice.liar(room as liarsDice.Room, playerId, now),
    },
  },
  'draw-guess': {
    ...drawGuess,
    moves: {
      pick: (room, playerId, body, now) => drawGuess.pick(room as drawGuess.Room, playerId, { index: body.index }, now),
      stroke: (room, playerId, body, now) =>
        drawGuess.stroke(
          room as drawGuess.Room,
          playerId,
          { id: body.id, color: body.color, width: body.width, points: body.points },
          now,
        ),
      undo: (room, playerId, _body, now) => drawGuess.undo(room as drawGuess.Room, playerId, now),
      clear: (room, playerId, _body, now) => drawGuess.clear(room as drawGuess.Room, playerId, now),
      guess: (room, playerId, body, now) => drawGuess.guess(room as drawGuess.Room, playerId, { text: body.text }, now),
    },
  },
  'marble-race': {
    ...marbleRace,
    moves: {
      // Raw on purpose: each checks its own fields (400 for a marble or order that cannot be).
      course: (room, playerId, body, now) => marbleRace.chooseCourse(room as marbleRace.Room, playerId, body.course, now),
      back: (room, playerId, body, now) => marbleRace.back(room as marbleRace.Room, playerId, body.marble, now),
      finish: (room, playerId, body, now) => marbleRace.finish(room as marbleRace.Room, playerId, body.order, now),
    },
  },
  chess: {
    ...chess,
    moves: {
      // Raw on purpose: `move` types its own fields (400 with a sentence for a bad square or move).
      move: (room, playerId, body, now) =>
        chess.move(room as chess.Room, playerId, { from: body.from, to: body.to, promotion: body.promotion }, now),
      resign: (room, playerId, _body, now) => chess.resign(room as chess.Room, playerId, now),
      draw: (room, playerId, _body, now) => chess.draw(room as chess.Room, playerId, now),
    },
  },
  homestead: {
    // Exports durable = { schema: 1 }, paces = ['live', 'async'], waitingOn and resume.
    ...homestead,
    moves: {
      // Raw on purpose: each types its own fields (400 with a sentence for a bad spot or hand).
      roll: (room, p, _b, now) => homestead.roll(room as homestead.Room, p, now),
      build: (room, p, b, now) => homestead.build(room as homestead.Room, p, { piece: b.piece, at: b.at }, now),
      buy: (room, p, _b, now) => homestead.buy(room as homestead.Room, p, now),
      play: (room, p, b, now) =>
        homestead.play(room as homestead.Room, p, { card: b.card, take: b.take, resource: b.resource }, now),
      fox: (room, p, b, now) => homestead.fox(room as homestead.Room, p, { hex: b.hex, victim: b.victim }, now),
      discard: (room, p, b, now) => homestead.discard(room as homestead.Room, p, { cards: b.cards }, now),
      bank: (room, p, b, now) => homestead.bank(room as homestead.Room, p, { give: b.give, get: b.get }, now),
      offer: (room, p, b, now) => homestead.offer(room as homestead.Room, p, { give: b.give, want: b.want, to: b.to }, now),
      counter: (room, p, b, now) =>
        homestead.counter(room as homestead.Room, p, { offerId: b.offerId, give: b.give, want: b.want }, now),
      accept: (room, p, b, now) => homestead.accept(room as homestead.Room, p, { offerId: b.offerId }, now),
      refuse: (room, p, b, now) => homestead.refuse(room as homestead.Room, p, { offerId: b.offerId }, now),
      cancel: (room, p, b, now) => homestead.cancel(room as homestead.Room, p, { offerId: b.offerId }, now),
      skip: (room, p, _b, now) => homestead.skip(room as homestead.Room, p, now),
      end: (room, p, _b, now) => homestead.end(room as homestead.Room, p, now),
    },
  },
};
