// Codenames — the word-association team game, as pure functions over a room
// (spec: docs/superpowers/specs/2026-11-01-family-games-tv-quiz-codenames.md).
//
// Same shape as Azul: every function takes `now` (epoch ms), the registry owns
// timers and fan-out, and the room carries its OWN seeded generator (`rng`,
// sfc32) so a durable room read back after a deploy deals what it would have.
//
// The game:
//  - 25 word cards in a 5×5 grid. A secret key makes 9 of them the starting
//    team's agents, 8 the other team's, 7 bystanders and 1 the assassin.
//  - Each team has a spymaster, who sees the key, and operatives, who do not.
//    On a team's turn its spymaster gives ONE word and a number ("ocean 2");
//    the word may not be, contain or sit inside a word still face down.
//  - The operatives then touch cards, up to the number plus one. Their own
//    agent: they may go on. A bystander or the other team's agent ends the
//    turn (the other team's is theirs for good). The assassin loses the game.
//    They may stop after the first guess.
//  - The first team with every agent found wins, even when the other team
//    turned their last one over for them.
//
// Two teams need four players. Two or three play the co-operative variant: one
// team (red) against the other team's spymaster, who is nobody — at the end of
// each red turn one blue agent is turned over by itself. Red wins by finding
// all nine first.
//
// The key is the whole secret. A phone is sent it only while its player is a
// spymaster; the TV board and the operatives see a card's colour only once it
// is turned over — and everybody sees the rest of the key when the game ends.

import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  isDifficulty,
  DIFFICULTIES,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from './tap-duel';
import { nextFloat, seedRng, type RngState } from './homestead-model';
import { normalise, sameStem } from './one-clue';
import { WORDS } from './words/codenames';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'clue' | 'guess' | 'finished' | 'closed';
export type Team = 'red' | 'blue';
export type Kind = Team | 'neutral' | 'assassin';
export type Mode = 'teams' | 'coop';

export const TEAMS: readonly Team[] = ['red', 'blue'];
export const isTeam = (v: unknown): v is Team => v === 'red' || v === 'blue';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
/** Fewest players for two teams; under this the table plays co-op. */
export const TEAMS_MIN = 4;
export const CARDS = 25;
export const GRID = 5;
/** Agents the starting team has; the other team has one fewer. */
export const FIRST_AGENTS = 9;
export const NEUTRALS = 7;
export const MAX_CLUE = 24;
export const MAX_COUNT = 9;

/** How long a spymaster has to think of a clue. Out of time: the turn passes. */
export const CLUE_MS: Record<Difficulty, number> = { easy: 300_000, medium: 150_000, hard: 90_000 };
/** How long the operatives have to touch cards. Out of time: the turn ends. */
export const GUESS_MS: Record<Difficulty, number> = { easy: 300_000, medium: 150_000, hard: 90_000 };
/** After a time limit, how long a guess already in flight may still land. */
export const GRACE_MS = 750;

// ---- The room ------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Chosen in the lobby (null = put me anywhere); fixed at the start. */
  team: Team | null;
  /** Asked to give the clues (lobby), or does (in play). */
  spymaster: boolean;
}

export interface Card {
  word: string;
  kind: Kind;
  /** Turned over: by whom (a player id, or 'auto' for co-op's turn) — null while face down. */
  by: string | null;
  /** Which turn turned it over, for the board's order. */
  turn: number | null;
}

export interface Clue {
  team: Team;
  by: string;
  word: string;
  count: number;
  /** Cards turned over on this clue, in order. */
  cards: number[];
  at: number;
}

export interface LastReveal {
  card: number;
  kind: Kind;
  team: Team;
  /** A player id, or 'auto' (co-op's own turn). */
  by: string;
  at: number;
}

export interface Result {
  /** The team that won; null when co-op lost. */
  winner: Team | null;
  reason: 'agents' | 'assassin' | 'left';
}

export interface Room {
  id: string;
  game: 'codenames';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  mode: Mode;
  rng: RngState;
  cards: Card[];
  starting: Team;
  turnTeam: Team;
  /** Turns in the whole game (each clue, or each passed clue). */
  turns: number;
  /** This turn's clue, once given. */
  clue: Clue | null;
  /** Every clue given, oldest first. */
  clues: Clue[];
  last: LastReveal | null;
  result: Result | null;
  /** Spymasters of the last game, so `again` hands the role on. */
  pastSpymasters: string[];
  startedAt: number | null;
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, team: null, spymaster: false };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

function shuffle<T>(room: Room, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(room.rng) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red');

/** Players of a team still in the game. */
export function teamOf(room: Room, team: Team): Player[] {
  return joined(room).filter((p) => p.team === team);
}

export function spymasterOf(room: Room, team: Team): Player | null {
  return teamOf(room, team).find((p) => p.spymaster) ?? null;
}

/** Agents of a team still face down. */
export function agentsLeft(room: Room, team: Team): number {
  return room.cards.filter((c) => c.kind === team && c.by === null).length;
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
  if (invited.length > MAX_PLAYERS - 1) throw new GameError(400, `Codenames is for two to ${MAX_PLAYERS}.`);
  return {
    id: input.id,
    game: 'codenames',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    mode: 'teams',
    rng: seedRng(input.options?.seed),
    cards: [],
    starting: 'red',
    turnTeam: 'red',
    turns: 0,
    clue: null,
    clues: [],
    last: null,
    result: null,
    pastSpymasters: [],
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function about(room: Room): string {
  const n = joined(room).length;
  return n >= TEAMS_MIN ? 'two teams, one spymaster each' : 'co-op: one team against the clock';
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length >= MAX_PLAYERS) throw new GameError(409, `Codenames is for up to ${MAX_PLAYERS}.`);
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
 * Leaving the lobby as host cancels the game; the last one out closes it.
 * Mid-game a spymaster who leaves hands the role to a team-mate; a team left
 * with nobody loses, and co-op with one player left ends.
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
  if (room.phase !== 'clue' && room.phase !== 'guess') return;
  const team = p.team;
  if (!team) return;
  const mates = teamOf(room, team);
  if (room.mode === 'coop' ? rest.length < 2 : !mates.length) {
    finish(room, { winner: room.mode === 'coop' ? null : other(team), reason: 'left' }, now);
    return;
  }
  // The role passes on; a team down to its spymaster still plays — they guess as well (`mayGuess`).
  if (p.spymaster && !mates.some((m) => m.spymaster)) mates[0].spymaster = true;
}

/** Lobby: pick a team (or null for anywhere) and whether you would give the clues. */
export function pickTeam(room: Room, playerId: string, input: { team: unknown; spymaster: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'Join the game first.');
  if (room.phase !== 'lobby') throw new GameError(409, 'Teams are fixed once the game starts.');
  if (input.team !== null && input.team !== undefined && !isTeam(input.team)) throw new GameError(400, 'Red or blue.');
  p.team = isTeam(input.team) ? input.team : null;
  p.spymaster = input.spymaster === true;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length < MIN_PLAYERS) throw new GameError(409, 'Codenames needs at least two players.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again with whoever is still here: same teams, the clue-giving handed on. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  const past = room.players.filter((p) => p.spymaster).map((p) => p.id);
  room.pastSpymasters = [...new Set([...room.pastSpymasters, ...past])];
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.spymaster = false;
  }
  Object.assign(room, {
    phase: 'lobby',
    cards: [],
    turns: 0,
    clue: null,
    clues: [],
    last: null,
    result: null,
    startedAt: null,
    createdAt: now,
    updatedAt: now,
  } satisfies Partial<Room>);
  room.phaseEndsAt = now + LOBBY_MS;
}

// ---- Teams ---------------------------------------------------------------

/**
 * Fix the teams: everyone keeps the team they picked where that still leaves
 * two on each side; the rest fill the smaller team. Co-op puts everybody on
 * red. Each team's spymaster is whoever asked (the first who did), else
 * somebody who has not had a go yet, else anybody.
 */
function seatTeams(room: Room): void {
  const people = joined(room);
  room.mode = people.length >= TEAMS_MIN ? 'teams' : 'coop';
  if (room.mode === 'coop') {
    for (const p of people) p.team = 'red';
  } else {
    const loose = shuffle(room, people.filter((p) => !p.team));
    for (const p of loose) p.team = teamOf(room, 'red').length <= teamOf(room, 'blue').length ? 'red' : 'blue';
    for (const t of TEAMS) {
      // Too few on one side: move over the people who did not ask to give clues, newest pick first.
      while (teamOf(room, t).length < 2) {
        const from = teamOf(room, other(t));
        const mover = [...from].reverse().find((p) => !p.spymaster) ?? from.at(-1);
        if (!mover) break;
        mover.team = t;
      }
    }
  }
  for (const t of room.mode === 'coop' ? (['red'] as Team[]) : TEAMS) {
    const members = teamOf(room, t);
    const asked = members.filter((p) => p.spymaster);
    for (const p of members) p.spymaster = false;
    const fresh = shuffle(room, members.filter((p) => !room.pastSpymasters.includes(p.id)));
    const pick = asked[0] ?? fresh[0] ?? shuffle(room, members)[0];
    if (pick) pick.spymaster = true;
  }
  // Everybody has had a go: start the rotation again.
  if (people.every((p) => room.pastSpymasters.includes(p.id))) room.pastSpymasters = [];
}

function deal(room: Room, now: number): void {
  seatTeams(room);
  room.starting = room.mode === 'coop' ? 'red' : nextFloat(room.rng) < 0.5 ? 'red' : 'blue';
  const words = shuffle(room, WORDS).slice(0, CARDS);
  const kinds: Kind[] = [
    ...Array<Kind>(FIRST_AGENTS).fill(room.starting),
    ...Array<Kind>(FIRST_AGENTS - 1).fill(other(room.starting)),
    ...Array<Kind>(NEUTRALS).fill('neutral'),
    'assassin',
  ];
  const key = shuffle(room, kinds);
  room.cards = words.map((word, i) => ({ word, kind: key[i], by: null, turn: null }));
  room.turnTeam = room.starting;
  room.turns = 0;
  room.clue = null;
  room.clues = [];
  room.last = null;
  room.result = null;
  room.startedAt = now;
  beginTurn(room, room.starting, now);
}

function beginTurn(room: Room, team: Team, now: number): void {
  room.phase = 'clue';
  room.turnTeam = team;
  room.turns += 1;
  room.clue = null;
  room.phaseEndsAt = now + CLUE_MS[room.difficulty];
  room.updatedAt = now;
}

/** The turn is over: hand it on (co-op: the other side turns one of its own over first). */
function endTurn(room: Room, now: number): void {
  if (room.mode === 'coop') {
    const blue = room.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'blue' && c.by === null);
    const pick = blue.length ? blue[Math.floor(nextFloat(room.rng) * blue.length)] : null;
    if (pick) {
      pick.c.by = 'auto';
      pick.c.turn = room.turns;
      room.last = { card: pick.i, kind: 'blue', team: 'blue', by: 'auto', at: now };
    }
    if (agentsLeft(room, 'blue') === 0) {
      finish(room, { winner: null, reason: 'agents' }, now);
      return;
    }
    beginTurn(room, 'red', now);
    return;
  }
  beginTurn(room, other(room.turnTeam), now);
}

function finish(room: Room, result: Result, now: number): void {
  room.result = result;
  room.phase = 'finished';
  room.clue = null;
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

// ---- Play ----------------------------------------------------------------

/**
 * Whether a clue may be given with these cards face down: one word of letters
 * (a hyphen or apostrophe inside is fine), no longer than MAX_CLUE, and not a
 * face-down word, nor sharing its root, nor its start or end, nor one made by
 * starting with it (catfish for CAT; a word of four or more, ending with it too). Returns
 * the sentence for the spymaster, or null when it is fine.
 */
export function clueProblem(text: string, faceDown: readonly string[]): string | null {
  const raw = text.trim();
  if (!raw) return 'Type a clue.';
  if (raw.length > MAX_CLUE) return `Keep it under ${MAX_CLUE} letters.`;
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(raw)) return 'One word, letters only.';
  const c = normalise(raw).replace(/ /g, '');
  if (!c) return 'One word, letters only.';
  for (const word of faceDown) {
    const w = normalise(word);
    if (c === w || sameStem(c, w)) return `That is a word on the board.`;
    // A compound or a part: snowman for SNOW, bank for BANKRUPT. Only at an
    // end — planet is a fair clue with NET on the board, education with CAT.
    const holds = w.length >= 4 ? c.startsWith(w) || c.endsWith(w) : w.length === 3 && c.startsWith(w);
    const inside = c.length >= 3 && (w.startsWith(c) || w.endsWith(c));
    if (holds || inside) return `Too close to ${word.toUpperCase()}.`;
  }
  return null;
}

/** The spymaster of the team whose turn it is gives the clue. */
export function giveClue(room: Room, playerId: string, input: { word: unknown; count: unknown }, now: number): void {
  const p = find(room, playerId);
  if (room.phase !== 'clue') throw new GameError(409, room.phase === 'guess' ? 'The clue is already given.' : 'Not now.');
  if (p.status !== 'joined' || p.team !== room.turnTeam || !p.spymaster) throw new GameError(403, 'Only the spymaster gives the clue.');
  if (typeof input.word !== 'string') throw new GameError(400, 'Type a clue.');
  const count = typeof input.count === 'number' ? input.count : Number.NaN;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new GameError(400, `A number from 1 to ${MAX_COUNT}.`);
  const problem = clueProblem(input.word, room.cards.filter((c) => c.by === null).map((c) => c.word));
  if (problem) throw new GameError(400, problem);
  room.clue = { team: room.turnTeam, by: p.id, word: input.word.trim().toUpperCase(), count, cards: [], at: now };
  room.clues.push(room.clue);
  room.phase = 'guess';
  room.phaseEndsAt = now + GUESS_MS[room.difficulty];
  room.updatedAt = now;
}

/** Who may touch a card this turn: the team's operatives, or the spymaster when they are alone on it. */
export function mayGuess(room: Room, p: Player): boolean {
  if (p.status !== 'joined' || p.team !== room.turnTeam) return false;
  if (!p.spymaster) return true;
  return teamOf(room, room.turnTeam).every((m) => m.spymaster);
}

export function guessesLeft(room: Room): number {
  return room.clue ? room.clue.count + 1 - room.clue.cards.length : 0;
}

/** An operative turns a card over. */
export function guess(room: Room, playerId: string, input: { card: unknown }, now: number): void {
  const p = find(room, playerId);
  if (room.phase !== 'guess' || !room.clue) throw new GameError(409, room.phase === 'clue' ? 'Wait for the clue.' : 'Not now.');
  if (!mayGuess(room, p)) throw new GameError(403, p.team === room.turnTeam ? 'The spymaster cannot guess.' : "It is the other team's turn.");
  const i = typeof input.card === 'number' ? input.card : Number.NaN;
  if (!Number.isInteger(i) || i < 0 || i >= room.cards.length) throw new GameError(400, 'Pick a card on the board.');
  const card = room.cards[i];
  // Two phones touching the same card at once: the second is a no-op, not an error.
  if (card.by !== null) return;
  const team = room.turnTeam;
  card.by = p.id;
  card.turn = room.turns;
  room.clue.cards.push(i);
  room.last = { card: i, kind: card.kind, team, by: p.id, at: now };
  room.updatedAt = now;
  if (card.kind === 'assassin') {
    finish(room, { winner: room.mode === 'coop' ? null : other(team), reason: 'assassin' }, now);
    return;
  }
  for (const t of TEAMS) {
    if (agentsLeft(room, t) === 0 && room.cards.some((c) => c.kind === t)) {
      finish(room, { winner: room.mode === 'coop' ? (t === 'red' ? 'red' : null) : t, reason: 'agents' }, now);
      return;
    }
  }
  if (card.kind !== team || guessesLeft(room) <= 0) endTurn(room, now);
}

/** Stop guessing, once at least one card is turned over on this clue. */
export function pass(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (room.phase !== 'guess' || !room.clue) throw new GameError(409, 'Not now.');
  if (!mayGuess(room, p)) throw new GameError(403, "It is not your team's turn to guess.");
  if (!room.clue.cards.length) throw new GameError(409, 'Make at least one guess first.');
  endTurn(room, now);
}

// ---- The clock -------------------------------------------------------------

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
        room.phaseEndsAt = now + LOBBY_MS;
      } else deal(room, now);
      break;
    case 'clue':
      // No clue in time: the turn passes with nothing turned over.
      endTurn(room, now);
      break;
    case 'guess':
      endTurn(room, now);
      break;
  }
  return true;
}

export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phase === 'guess' ? room.phaseEndsAt + GRACE_MS : room.phaseEndsAt;
}

// ---- Durable rooms ----------------------------------------------------------

export const durable = { schema: 1 };

export function waitingOn(room: Room): { ids: string[]; key: string; line?: string } | null {
  if (room.phase === 'clue') {
    const s = spymasterOf(room, room.turnTeam);
    return s ? { ids: [s.id], key: `${room.turns}:clue`, line: 'Your team needs a clue.' } : null;
  }
  if (room.phase === 'guess' && room.clue) {
    const ids = joined(room).filter((p) => mayGuess(room, p)).map((p) => p.id);
    return { ids, key: `${room.turns}:guess`, line: `The clue is ${room.clue.word} ${room.clue.count}.` };
  }
  return null;
}

/** A live room read back after a restart: the running step gets its full time again. */
export function resume(room: Room, now: number, _pausedMs: number): void {
  if (room.phase === 'countdown') room.phaseEndsAt = now + COUNTDOWN_MS;
  else if (room.phase === 'clue') room.phaseEndsAt = now + CLUE_MS[room.difficulty];
  else if (room.phase === 'guess') room.phaseEndsAt = now + GUESS_MS[room.difficulty];
}

// ---- Result --------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  team: Team | null;
  spymaster: boolean;
  /** Agents the player's team found. */
  score: number;
  place: number;
  result: 'won' | 'lost' | 'left';
}

export function standings(room: Room): Standing[] {
  const winner = room.result?.winner ?? null;
  const rows = room.players
    .filter((p) => p.team && (p.status === 'joined' || p.status === 'left'))
    .map((p) => {
      const team = p.team as Team;
      const total = room.cards.filter((c) => c.kind === team).length;
      const won = p.status === 'joined' && winner === team;
      return {
        id: p.id,
        name: p.name,
        team,
        spymaster: p.spymaster,
        score: total - agentsLeft(room, team),
        place: won ? 1 : 2,
        result: (p.status !== 'joined' ? 'left' : won ? 'won' : 'lost') as Standing['result'],
      };
    });
  return rows.sort((a, b) => a.place - b.place || b.score - a.score);
}

export function winners(room: Room): string[] {
  const winner = room.result?.winner;
  return winner ? joined(room).filter((p) => p.team === winner).map((p) => p.id) : [];
}

// ---- The wire ---------------------------------------------------------------

/**
 * The room as one phone (or the TV board, `meId` '') sees it. A face-down
 * card's kind goes only to a spymaster (`key`), or to everybody once the game
 * is over.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const me = room.players.find((p) => p.id === meId) ?? null;
  const seesKey = finished || (!!me && me.status === 'joined' && me.spymaster && room.phase !== 'lobby' && room.phase !== 'countdown');
  const teams = (room.mode === 'coop' ? (['red', 'blue'] as Team[]) : TEAMS).map((t) => ({
    team: t,
    agents: room.cards.filter((c) => c.kind === t).length,
    left: agentsLeft(room, t),
    spymasterId: spymasterOf(room, t)?.id ?? null,
  }));
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    mode: room.phase === 'lobby' ? (joined(room).length >= TEAMS_MIN ? 'teams' : 'coop') : room.mode,
    clueMs: CLUE_MS[room.difficulty],
    guessMs: GUESS_MS[room.difficulty],
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    starting: room.starting,
    turnTeam: room.turnTeam,
    turns: room.turns,
    cards: room.cards.map((c, i) => ({
      i,
      word: c.word,
      kind: c.by !== null ? c.kind : null,
      by: c.by,
      turn: c.turn,
    })),
    key: seesKey ? room.cards.map((c) => c.kind) : null,
    clue: room.clue ? { ...room.clue, cards: [...room.clue.cards], guessesLeft: guessesLeft(room) } : null,
    clues: room.clues.map((c) => ({ ...c, cards: [...c.cards] })),
    teams,
    last: room.last ? { ...room.last } : null,
    canGuess: !!me && room.phase === 'guess' && mayGuess(room, me),
    canClue: !!me && room.phase === 'clue' && me.status === 'joined' && me.spymaster && me.team === room.turnTeam,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      team: p.team,
      spymaster: p.spymaster,
    })),
    result: room.result ? { ...room.result } : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

/** The TV board's view: what an operative sees, as nobody in particular. */
export function toScreen(room: Room, now: number) {
  return toWire(room, '', now);
}

export type WireRoom = ReturnType<typeof toWire>;
