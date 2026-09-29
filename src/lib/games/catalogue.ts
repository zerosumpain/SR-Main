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
}

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
};
