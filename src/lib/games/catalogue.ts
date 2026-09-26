// The games the rooms can host, each a rules module behind one interface.
//
// A rules module is pure (see `tap-duel.ts`): every function takes `now`, and
// the dealing ones a `rng`. The lobby verbs — join, decline, leave, start,
// again — mean the same thing in every game; what differs is the game's own
// moves (`tap`, `guess`) and what a phone may see (`toWire`).

import * as tapDuel from './tap-duel';
import * as wordleRace from './wordle-race';
import * as quizNight from './quiz-night';
import { writeQuiz } from './quiz-night.server';
import type { Difficulty, PlayerStatus, Rng } from './tap-duel';

export const GAME_IDS = ['tap-duel', 'wordle-race', 'quiz-night'] as const;
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
  join(room: RoomBase, playerId: string, now: number): void;
  decline(room: RoomBase, playerId: string, now: number): void;
  leave(room: RoomBase, playerId: string, now: number): void;
  start(room: RoomBase, playerId: string, now: number): void;
  again(room: RoomBase, playerId: string, now: number): void;
  advance(room: RoomBase, now: number, rng: Rng): boolean;
  deadline(room: RoomBase): number | null;
  toWire(room: RoomBase, meId: string, now: number): { id: string; phase: string; serverNow: number };
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
};
