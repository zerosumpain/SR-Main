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
import * as mission from './mission';
import * as oneClue from './one-clue';
import * as fakeArtist from './fake-artist';
import * as passThePlate from './pass-the-plate';
import * as fireworks from './fireworks';
import * as manhunt from './manhunt';
import * as homestead from './homestead';
import * as hometowns from './hometowns/hometowns';
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
  'mission',
  'one-clue',
  'fake-artist',
  'pass-the-plate',
  'fireworks',
  'manhunt',
  'homestead',
  'hometowns',
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

/**
 * A game's own action. It may return `false` to say it changed nothing worth
 * storing or sending (telemetry, a canary report): the room is then neither
 * written nor re-sent to its phones. Anything else is a change.
 */
type Move = (room: RoomBase, playerId: string, body: Record<string, unknown>, now: number) => void | boolean;

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
  /**
   * The API has checked this player is a parent (Manhunt: who may inherit the
   * host role). Server-only; never a move a phone can post. A game whose
   * parents change what it stores or shows (Hometowns: an adult's seat)
   * returns true when this changed the room, which is then written and sent.
   */
  noteParent?(room: RoomBase, playerId: string): boolean | void;
  /** The game's own actions, by the name the phone posts. */
  moves: Record<string, Move>;
  /**
   * The leaderboard's high score for one row of this game's finished
   * `standings`, when it is not the row's own numeric `score` (the default).
   * Null: this game has no score, and its board ranks by wins.
   */
  resultScore?(standing: { id: string; [key: string]: unknown }): number | null;
  /** Most players a room may hold, when not the registry's default (`MAX_PLAYERS`, five). */
  maxPlayers?: number;
  /** Fewest joined players `start` accepts, when more than two (for tests that play every game). */
  minPlayers?: number;
  /**
   * The leaderboard rank for one finished standing, when the game breaks a
   * score tie itself (the default ranks by score alone). Null: the default.
   */
  resultRank?(standing: { id: string; [key: string]: unknown }): number | null;
  /**
   * Rooms of this game are written to `game_rooms` and survive a restart
   * (spec: 2026-10-22-family-games-durable-rooms.md). `schema` is bumped when
   * the room's stored shape changes; a row written under an older schema is
   * passed to `revive` (null = cannot: the room is closed and logged). The
   * room MUST be JSON-safe: plain objects, arrays, strings, finite numbers,
   * booleans, null — no Map, Set, Date, functions or class instances.
   * `reviveAll`: `revive` also sees rows of the current schema, so a game can
   * fill fields added within a schema and knows every room it is handed
   * from the table is a new object (Hometowns moves its delta cursor on).
   */
  durable?: {
    schema: number;
    revive?(state: Record<string, unknown>, fromSchema: number): RoomBase | null;
    /**
     * Erasing an account (`$lib/people/erase`) deletes every room the person
     * sits in — the right answer for a game that lasts an evening. A game
     * that lasts months and seats a whole family (a Hometowns county) defines
     * this instead: take `playerId`'s seat out of `room` (remove it, or keep
     * an anonymous placeholder the game can still play around) and return
     * the room, which is kept for everyone else. After it, the id must appear
     * nowhere in the room, and the person's name and anything they wrote must
     * be gone. If they were hosting, the host passes to another person in
     * the room who is playing — for a parent-hosted game, one of the parents
     * the game noted (`noteParent`), or null when there is none. A placeholder
     * kept in their seat never has a player id ('p_…'). The registry checks
     * the id, the name as a whole value, that a real person is left and that
     * a new host is playing, and deletes the room after all if any fails.
     * Null, or a throw: delete the room as before. Pure; `now` is the
     * erasure's instant.
     */
    erasePlayer?(room: RoomBase, playerId: string, now: number): RoomBase | null;
  };
  /**
   * Somebody may be invited into a room that has already started (a county
   * a late joiner moves into), not only while it is a lobby. Absent: the
   * host's invite is refused once the game is under way, as for every game
   * before this. The invitee answers with the usual `join`, which is the
   * game's own and decides what a late join means.
   */
  joinRunning?: boolean;
  /**
   * A `joinRunning` game's seating for a late invite: put `player` in the
   * running room as an invitee (a new row with status 'invited', or their
   * old row marked 'invited' again if they declined or left before), or
   * throw a GameError saying why there is no place (the county is full).
   * Absent: the lobby's rule (`player(id, name, 'invited')`, or the old row
   * re-marked). Never called for a lobby.
   */
  seat?(room: RoomBase, player: { id: string; name: string }, now: number): void;
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
  mission: {
    ...mission,
    maxPlayers: mission.MAX_PLAYERS,
    minPlayers: mission.MIN_PLAYERS,
    moves: {
      // Raw on purpose: each types its own fields (400 with a sentence for a team that cannot go).
      ready: (room, playerId, _body, now) => mission.ready(room as mission.Room, playerId, now),
      propose: (room, playerId, body, now) => mission.propose(room as mission.Room, playerId, { team: body.team }, now),
      vote: (room, playerId, body, now) => mission.vote(room as mission.Room, playerId, { approve: body.approve }, now),
      play: (room, playerId, body, now) => mission.play(room as mission.Room, playerId, { card: body.card }, now),
      guess: (room, playerId, body, now) => mission.guess(room as mission.Room, playerId, { playerId: body.playerId }, now),
    },
  },
  'one-clue': {
    ...oneClue,
    maxPlayers: oneClue.MAX_PLAYERS,
    minPlayers: oneClue.MIN_PLAYERS,
    moves: {
      // Raw on purpose: each types its own fields (400 with a sentence).
      clue: (room, playerId, body, now) => oneClue.clue(room as oneClue.Room, playerId, { text: body.text, lock: body.lock }, now),
      veto: (room, playerId, body, now) => oneClue.veto(room as oneClue.Room, playerId, { playerId: body.playerId }, now),
      unveto: (room, playerId, body, now) =>
        oneClue.unveto(room as oneClue.Room, playerId, { playerId: body.playerId }, now),
      done: (room, playerId, _body, now) => oneClue.done(room as oneClue.Room, playerId, now),
      guess: (room, playerId, body, now) => oneClue.guess(room as oneClue.Room, playerId, { text: body.text }, now),
      pass: (room, playerId, _body, now) => oneClue.pass(room as oneClue.Room, playerId, now),
    },
  },
  'fake-artist': {
    ...fakeArtist,
    maxPlayers: fakeArtist.MAX_PLAYERS,
    minPlayers: fakeArtist.MIN_PLAYERS,
    moves: {
      // Raw on purpose: each types its own fields (400 with a sentence for a bad line or vote).
      stroke: (room, playerId, body, now) =>
        fakeArtist.stroke(room as fakeArtist.Room, playerId, { points: body.points, end: body.end }, now),
      vote: (room, playerId, body, now) =>
        fakeArtist.vote(room as fakeArtist.Room, playerId, { playerId: body.playerId }, now),
      guess: (room, playerId, body, now) => fakeArtist.guess(room as fakeArtist.Room, playerId, { text: body.text }, now),
    },
  },
  'pass-the-plate': {
    ...passThePlate,
    moves: {
      // Raw on purpose: `pick` types its own fields (400 with a sentence for a card not on the plate).
      pick: (room, playerId, body, now) =>
        passThePlate.pick(room as passThePlate.Room, playerId, { cards: body.cards }, now),
    },
  },
  fireworks: {
    ...fireworks,
    moves: {
      // Raw on purpose: each types its own fields (400 with a sentence for a bad hint or card).
      hint: (room, playerId, body, now) =>
        fireworks.hint(room as fireworks.Room, playerId, { to: body.to, colour: body.colour, rank: body.rank }, now),
      play: (room, playerId, body, now) => fireworks.play(room as fireworks.Room, playerId, { card: body.card }, now),
      discard: (room, playerId, body, now) =>
        fireworks.discard(room as fireworks.Room, playerId, { card: body.card }, now),
    },
  },
  manhunt: {
    ...manhunt,
    moves: {
      // Raw on purpose: each types its own fields (400 for a place that is not on the map).
      area: (room, playerId, body, now) =>
        manhunt.setArea(
          room as manhunt.Room,
          playerId,
          { lat: body.lat, lng: body.lng, radius: body.radius, minutes: body.minutes },
          now,
        ),
      runner: (room, playerId, body, now) =>
        manhunt.pickRunner(room as manhunt.Room, playerId, { playerId: body.playerId }, now),
      position: (room, playerId, body, now) =>
        void manhunt.position(
          room as manhunt.Room,
          playerId,
          { lat: body.lat, lng: body.lng, accuracy: body.accuracy, at: body.at },
          now,
        ),
      catch: (room, playerId, _body, now) => manhunt.claimCatch(room as manhunt.Room, playerId, now),
      confirm: (room, playerId, _body, now) => manhunt.confirmCatch(room as manhunt.Room, playerId, now),
    },
  },
  homestead: {
    // Exports durable = { schema: 1 }, paces = ['live', 'async'], waitingOn and resume.
    ...homestead,
    minPlayers: homestead.MIN_PLAYERS,
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
  // A county of up to six towns over months (spec 2026-10-24 Hometowns §10.1).
  // Exports durable = { schema, revive, reviveAll }, paces = ['async'], maxPlayers = 6,
  // revision, waitingOn, noteParent and its moves: every engine move by name
  // (`build`, `budget`, `sprint` …) plus `stats`. Each move types its own body.
  hometowns: {
    ...hometowns,
    moves: Object.fromEntries(
      Object.entries(hometowns.moves).map(([name, fn]): [string, Move] => [name, (room, p, b, now) => fn(room as hometowns.Room, p, b, now)]),
    ),
  },
};
