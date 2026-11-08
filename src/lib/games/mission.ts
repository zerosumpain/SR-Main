// Secret Mission — a hidden-roles team game, as pure functions over a room.
//
// Same shape as Liar's Dice (`liars-dice.ts`): every function takes `now`
// (epoch ms) and, where it deals, a `rng`, so a whole game plays in a test
// without a clock. The registry owns timers and fan-out.
//
// The table is split in secret into the CREW and the SPIES (5 players: three
// crew, two spies). Spies know each other; the crew know nobody. Five missions
// are run: each round a leader proposes a team, everybody votes approve or
// reject at once (the votes are shown together), and a majority sends the team
// out — otherwise leadership passes on, and five rejected proposals in a row
// hand the game to the spies. On a mission each member secretly plays Succeed
// or Sabotage (the crew can only succeed — the server refuses anything else);
// the table learns the counts only. Three successful missions win it for the
// crew, three sabotaged ones for the spies.
//
// Medium and hard add two roles: the LOOKOUT (crew, knows every spy) and the
// TRACKER (a spy). If the crew win on missions, the spies get one guess at the
// Lookout; naming them steals the win.
//
// Talking happens out loud, round the table: the phones only hold the secrets
// and the votes. A stalled player never holds the room up — their clock runs
// out and the server moves for them (see `advance`): a leader's team is drawn
// at random, a missing vote approves, a missing mission card succeeds.

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

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase =
  | 'lobby'
  | 'countdown'
  | 'roles'
  | 'proposing'
  | 'voting'
  | 'tally'
  | 'mission'
  | 'outcome'
  | 'hunt'
  | 'finished'
  | 'closed';

export type Side = 'crew' | 'spies';
export type Role = 'crew' | 'spy' | 'lookout' | 'tracker';
export type Card = 'succeed' | 'sabotage';

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
export const MISSIONS = 5;
/** Missions one side needs to win. */
export const WIN_AT = 3;
/** Rejected proposals in a row that hand the game to the spies. */
export const MAX_REJECTIONS = 5;

/** Spies at each table size; everyone else is crew. */
export const SPIES_FOR: Record<number, number> = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

/** Team size for each of the five missions, by table size. */
export const TEAM_SIZES: Record<number, readonly number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

/** Sabotage cards it takes to fail mission `index` (0-based): two on the fourth at seven or more. */
export function sabotagesNeeded(seats: number, index: number): number {
  return index === 3 && seats >= 7 ? 2 : 1;
}

/** The clocks a player has before the server moves for them. */
export interface Clocks {
  proposeMs: number;
  voteMs: number;
  missionMs: number;
}
export const CLOCKS: Record<Difficulty, Clocks> = {
  easy: { proposeMs: 120_000, voteMs: 60_000, missionMs: 45_000 },
  medium: { proposeMs: 90_000, voteMs: 45_000, missionMs: 30_000 },
  hard: { proposeMs: 60_000, voteMs: 30_000, missionMs: 20_000 },
};
/** Time to read your role card, unless everyone taps "Got it" first. */
export const ROLES_MS = 30_000;
/** How long the votes stay up after a proposal is decided. */
export const TALLY_MS = 6_000;
/** How long a mission's result stays up. */
export const OUTCOME_MS = 7_000;
/** The Tracker's time to name the Lookout. */
export const HUNT_MS = 90_000;

/** Whether the Lookout and the Tracker are in play: medium and hard. */
export function specials(difficulty: Difficulty): boolean {
  return difficulty !== 'easy';
}

export function sideOf(role: Role): Side {
  return role === 'spy' || role === 'tracker' ? 'spies' : 'crew';
}

/** The rule in a sentence, for the phone. */
export function ruleLine(difficulty: Difficulty): string {
  return specials(difficulty)
    ? 'The Lookout knows the spies. If the crew win, the Tracker gets one guess at the Lookout to steal it.'
    : 'Crew and spies only: nobody but the spies knows anything.';
}

// ---- The room ------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** At the table when the roles were dealt. */
  seated: boolean;
  /** Dealt at the countdown's end. Never another phone's to see. */
  role: Role | null;
  /** Tapped "Got it" on their role card. */
  ready: boolean;
  /** This proposal's vote; null until cast. Hidden until the tally. */
  vote: boolean | null;
  /** This mission's card; null until played. Never on the wire but your own. */
  card: Card | null;
}

export interface Tally {
  mission: number;
  attempt: number;
  leaderId: string;
  team: string[];
  approve: string[];
  reject: string[];
  /** Voted for by the server: their clock ran out, or they had left. */
  auto: string[];
  approved: boolean;
  /** The leader's clock ran out and the server drew the team. */
  autoTeam: boolean;
}

export interface MissionResult {
  mission: number;
  leaderId: string;
  team: string[];
  needed: number;
  /** Only the count: who played what is never told. */
  sabotages: number;
  succeeded: boolean;
}

export type Reason = 'missions' | 'sabotage' | 'rejections' | 'hunt' | 'abandoned';

export interface Result {
  winner: Side | null;
  reason: Reason;
  /** Who the Tracker named; null when there was no guess. */
  guessId: string | null;
}

export interface Room {
  id: string;
  game: 'mission';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** Players seated when the roles were dealt; the table's size for every rule. */
  seats: number;
  /** 1-based mission number; 0 before the deal. */
  mission: number;
  /** Proposals made this mission, 1-based. */
  attempt: number;
  /** Rejected proposals in a row. */
  rejections: number;
  leaderId: string | null;
  /** The team proposed (voting) or sent (mission). */
  team: string[] | null;
  /** The leader's clock ran out and the server drew this team. */
  autoTeam: boolean;
  tallies: Tally[];
  missions: MissionResult[];
  result: Result | null;
  /** Who had left when the game finished: standings are frozen on this, so leaving the results screen changes nothing. */
  leftAtFinish: string[];
  startedAt: number | null;
  /** Lobby expiry, countdown end, each phase's clock, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seated: false, role: null, ready: false, vote: null, card: null };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

/** Everyone dealt a role, gone or not, in seat order. */
export function seatedPlayers(room: Room): Player[] {
  return room.players.filter((p) => p.seated);
}

/** Seated and still here. */
export function active(room: Room): Player[] {
  return room.players.filter((p) => p.seated && p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

/** Mission `index`'s team size at this table (0-based). */
export function teamSize(room: Room, index = room.mission - 1): number {
  const sizes = TEAM_SIZES[room.seats] ?? TEAM_SIZES[MIN_PLAYERS];
  return sizes[Math.max(0, Math.min(MISSIONS - 1, index))];
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
    game: 'mission',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [
      player(input.host.id, input.host.name, 'joined'),
      ...invited.map((p) => player(p.id, p.name, 'invited')),
    ],
    seats: 0,
    mission: 0,
    attempt: 0,
    rejections: 0,
    leaderId: null,
    team: null,
    autoTeam: false,
    tallies: [],
    missions: [],
    result: null,
    leftAtFinish: [],
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line. */
export function about(room: Room): string {
  return specials(room.difficulty) ? 'With a Lookout and a Tracker' : 'Crew and spies only';
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (joined(room).length >= MAX_PLAYERS) throw new GameError(409, `The table is full: up to ${MAX_PLAYERS}.`);
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

const IN_PLAY: readonly Phase[] = ['roles', 'proposing', 'voting', 'tally', 'mission', 'outcome', 'hunt'];

/**
 * Leaving the lobby as host cancels it; the last one out closes the room.
 * Mid-game the leaver keeps their seat and their secret, and the server plays
 * for them from then on — their vote approves, their mission card succeeds, a
 * lead that would be theirs passes them by. A table left with fewer than three
 * people cannot carry on: the game ends, roles shown, and nobody wins it.
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
  if (!p.seated || !IN_PLAY.includes(room.phase)) return;

  if (active(room).length < 3) {
    settleOrAbandon(room, now);
    return;
  }
  switch (room.phase) {
    case 'roles':
      if (active(room).every((x) => x.ready)) beginProposal(room, room.leaderId, now);
      break;
    case 'proposing':
      if (room.leaderId === playerId) beginProposal(room, nextLeader(room, playerId)?.id ?? null, now);
      break;
    case 'voting':
      if (active(room).every((x) => x.vote !== null)) tally(room, now);
      break;
    case 'mission':
      if (missionComplete(room)) resolveMission(room, now);
      break;
    case 'hunt':
      // The guess was theirs to make: the crew keep the win.
      if (p.role === 'tracker') finish(room, 'crew', 'missions', null, now);
      break;
  }
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  const n = joined(room).length;
  if (n < MIN_PLAYERS) throw new GameError(409, `Secret Mission needs at least ${MIN_PLAYERS} players.`);
  if (n > MAX_PLAYERS) throw new GameError(409, `Up to ${MAX_PLAYERS} players.`);
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

function resetPlay(room: Room): void {
  for (const p of room.players) {
    p.seated = false;
    p.role = null;
    p.ready = false;
    p.vote = null;
    p.card = null;
  }
  room.seats = 0;
  room.mission = 0;
  room.attempt = 0;
  room.rejections = 0;
  room.leaderId = null;
  room.team = null;
  room.autoTeam = false;
  room.tallies = [];
  room.missions = [];
  room.result = null;
  room.leftAtFinish = [];
  room.startedAt = null;
}

/** The host plays again with whoever is still here — new roles; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) p.status = p.status === 'joined' ? 'joined' : 'invited';
  resetPlay(room);
  room.phase = 'lobby';
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Dealing -------------------------------------------------------------

/** A shuffled copy (Fisher–Yates on the room's rng). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Roles for `n` seats: spies first in the dealt list, then crew. */
export function rolesFor(n: number, withSpecials: boolean): Role[] {
  const spies = SPIES_FOR[n] ?? Math.ceil(n / 3);
  const roles: Role[] = [];
  for (let i = 0; i < n; i++) roles.push(i < spies ? 'spy' : 'crew');
  if (withSpecials) {
    roles[0] = 'tracker';
    roles[spies] = 'lookout';
  }
  return roles;
}

function deal(room: Room, now: number, rng: Rng): void {
  const table = joined(room);
  if (table.length < MIN_PLAYERS) {
    // Somebody left during the countdown: back to the lobby to find another.
    room.phase = 'lobby';
    room.phaseEndsAt = now + LOBBY_MS;
    room.updatedAt = now;
    return;
  }
  resetPlay(room);
  for (const p of table) p.seated = true;
  room.seats = table.length;
  const roles = shuffle(rolesFor(table.length, specials(room.difficulty)), rng);
  table.forEach((p, i) => (p.role = roles[i]));
  room.mission = 1;
  room.attempt = 0;
  room.leaderId = table[Math.min(table.length - 1, Math.floor(rng() * table.length))].id;
  room.startedAt = now;
  room.phase = 'roles';
  room.phaseEndsAt = now + ROLES_MS;
  room.updatedAt = now;
}

/** The next seated player still here after `fromId` (wrapping); null if nobody is. */
function nextLeader(room: Room, fromId: string | null): Player | null {
  const seats = room.players;
  const at = fromId === null ? -1 : seats.findIndex((p) => p.id === fromId);
  for (let k = 1; k <= seats.length; k++) {
    const p = seats[(at + k + seats.length) % seats.length];
    if (p.seated && p.status === 'joined') return p;
  }
  return null;
}

/** `id` if they can lead, else the next who can. */
function leaderFrom(room: Room, id: string | null): Player | null {
  const p = id === null ? null : room.players.find((x) => x.id === id);
  if (p && p.seated && p.status === 'joined') return p;
  return nextLeader(room, id);
}

function beginProposal(room: Room, leaderId: string | null, now: number): void {
  room.leaderId = leaderFrom(room, leaderId)?.id ?? null;
  room.attempt += 1;
  room.team = null;
  room.autoTeam = false;
  for (const p of room.players) {
    p.vote = null;
    p.card = null;
  }
  room.phase = 'proposing';
  room.phaseEndsAt = now + CLOCKS[room.difficulty].proposeMs;
  room.updatedAt = now;
}

// ---- Moves ---------------------------------------------------------------

function seatedMe(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (!p.seated || p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  return p;
}

function wrongPhase(room: Room): GameError {
  const says: Partial<Record<Phase, string>> = {
    lobby: 'The game has not started.',
    countdown: 'The game has not started.',
    roles: 'Everyone is still reading their role.',
    proposing: 'The leader is still picking a team.',
    voting: 'The table is voting.',
    tally: 'The votes are being shown.',
    mission: 'The team is on its mission.',
    outcome: 'The mission is being shown.',
    hunt: 'The Tracker is choosing.',
    finished: 'That game is over.',
    closed: 'That game is over.',
  };
  return new GameError(409, says[room.phase] ?? 'Not now.');
}

/** "Got it": I have read my role card. When everyone has, the first leader picks. */
export function ready(room: Room, playerId: string, now: number): void {
  const p = seatedMe(room, playerId);
  if (room.phase !== 'roles') throw wrongPhase(room);
  if (p.ready) return;
  p.ready = true;
  room.updatedAt = now;
  if (active(room).every((x) => x.ready)) beginProposal(room, room.leaderId, now);
}

/** Why a team cannot go, or null if it can: the right size, distinct, all at the table. */
export function teamProblem(room: Room, team: unknown): string | null {
  const size = teamSize(room);
  if (!Array.isArray(team) || !team.every((x) => typeof x === 'string')) return `Pick ${size} players.`;
  const ids = team as string[];
  if (new Set(ids).size !== ids.length) return 'Pick each player once.';
  if (ids.length !== size) return `This mission needs a team of ${size}.`;
  const seated = new Set(seatedPlayers(room).map((p) => p.id));
  if (!ids.every((id) => seated.has(id))) return 'Pick players at this table.';
  return null;
}

function sendToVote(room: Room, team: string[], auto: boolean, now: number): void {
  // Seat order, so the team reads the same on every phone.
  const order = room.players.map((p) => p.id);
  room.team = [...team].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  room.autoTeam = auto;
  for (const p of room.players) p.vote = null;
  room.phase = 'voting';
  room.phaseEndsAt = now + CLOCKS[room.difficulty].voteMs;
  room.updatedAt = now;
}

/** The leader proposes `{ team: [playerId] }`. 400 with a sentence for a team that cannot go. */
export function propose(room: Room, playerId: string, input: { team: unknown }, now: number): void {
  seatedMe(room, playerId);
  if (room.phase !== 'proposing') throw wrongPhase(room);
  if (room.leaderId !== playerId) throw new GameError(409, "You are not leading this time.");
  const problem = teamProblem(room, input.team);
  if (problem) throw new GameError(400, problem);
  sendToVote(room, input.team as string[], false, now);
}

/** A team drawn for a leader whose clock ran out: players still here first, then the gone. */
export function autoTeam(room: Room, rng: Rng): string[] {
  const size = teamSize(room);
  const here = shuffle(active(room).map((p) => p.id), rng);
  const gone = shuffle(
    seatedPlayers(room)
      .filter((p) => p.status !== 'joined')
      .map((p) => p.id),
    rng,
  );
  return [...here, ...gone].slice(0, size);
}

/** Approve or reject the team: `{ approve: true | false }`. One vote each; the table sees them together. */
export function vote(room: Room, playerId: string, input: { approve: unknown }, now: number): void {
  const p = seatedMe(room, playerId);
  if (room.phase !== 'voting') throw wrongPhase(room);
  if (typeof input.approve !== 'boolean') throw new GameError(400, 'Approve or reject.');
  if (p.vote !== null) throw new GameError(409, 'You have voted.');
  p.vote = input.approve;
  room.updatedAt = now;
  if (active(room).every((x) => x.vote !== null)) tally(room, now);
}

/** Count the votes: anyone who has not voted (out of time, or gone) approves. A strict majority sends the team. */
function tally(room: Room, now: number): void {
  const auto: string[] = [];
  for (const p of seatedPlayers(room)) {
    if (p.vote === null) {
      p.vote = true;
      auto.push(p.id);
    }
  }
  const seated = seatedPlayers(room);
  const approve = seated.filter((p) => p.vote === true).map((p) => p.id);
  const reject = seated.filter((p) => p.vote === false).map((p) => p.id);
  const approved = approve.length > reject.length;
  room.tallies.push({
    mission: room.mission,
    attempt: room.attempt,
    leaderId: room.leaderId ?? '',
    team: [...(room.team ?? [])],
    approve,
    reject,
    auto,
    approved,
    autoTeam: room.autoTeam,
  });
  room.rejections = approved ? 0 : room.rejections + 1;
  room.phase = 'tally';
  room.phaseEndsAt = now + TALLY_MS;
  room.updatedAt = now;
}

function missionComplete(room: Room): boolean {
  const team = new Set(room.team ?? []);
  return active(room)
    .filter((p) => team.has(p.id))
    .every((p) => p.card !== null);
}

/** On the team: `{ card: "succeed" | "sabotage" }`. The crew can only succeed. */
export function play(room: Room, playerId: string, input: { card: unknown }, now: number): void {
  const p = seatedMe(room, playerId);
  if (room.phase !== 'mission') throw wrongPhase(room);
  if (!(room.team ?? []).includes(playerId)) throw new GameError(409, 'You are not on this mission.');
  if (input.card !== 'succeed' && input.card !== 'sabotage') throw new GameError(400, 'Play Succeed or Sabotage.');
  if (p.card !== null) throw new GameError(409, 'You have played your card.');
  if (input.card === 'sabotage' && p.role && sideOf(p.role) === 'crew') {
    throw new GameError(400, 'The crew can only play Succeed.');
  }
  p.card = input.card;
  room.updatedAt = now;
  if (missionComplete(room)) resolveMission(room, now);
}

/** Every card in: a missing one (out of time, or gone) succeeds. Only the count is kept. */
function resolveMission(room: Room, now: number): void {
  const team = new Set(room.team ?? []);
  let sabotages = 0;
  for (const p of room.players) {
    if (team.has(p.id) && p.card === 'sabotage') sabotages++;
    p.card = null;
  }
  const needed = sabotagesNeeded(room.seats, room.mission - 1);
  room.missions.push({
    mission: room.mission,
    leaderId: room.leaderId ?? '',
    team: [...(room.team ?? [])],
    needed,
    sabotages,
    succeeded: sabotages < needed,
  });
  room.phase = 'outcome';
  room.phaseEndsAt = now + OUTCOME_MS;
  room.updatedAt = now;
}

/** The Tracker names who they think the Lookout is: `{ playerId }`. */
export function guess(room: Room, playerId: string, input: { playerId: unknown }, now: number): void {
  const p = seatedMe(room, playerId);
  if (room.phase !== 'hunt') throw wrongPhase(room);
  if (p.role !== 'tracker') throw new GameError(403, 'Only the Tracker guesses.');
  const target = room.players.find((x) => x.id === input.playerId);
  if (!target || !target.seated || target.id === playerId) throw new GameError(400, 'Pick a player at this table.');
  if (target.role && sideOf(target.role) === 'spies') throw new GameError(400, 'Pick one of the crew.');
  if (target.role === 'lookout') finish(room, 'spies', 'hunt', target.id, now);
  else finish(room, 'crew', 'missions', target.id, now);
}

export function score(room: Room): { crew: number; spies: number } {
  const crew = room.missions.filter((m) => m.succeeded).length;
  return { crew, spies: room.missions.length - crew };
}

/**
 * Too few left to carry on. A result already earned stands: the third mission
 * scored (outcome), the fifth rejection counted (tally), the crew's three
 * successes (hunt). Only an undecided game is abandoned.
 */
function settleOrAbandon(room: Room, now: number): void {
  const s = score(room);
  if (room.phase === 'outcome' && s.spies >= WIN_AT) return finish(room, 'spies', 'sabotage', null, now);
  if (room.phase === 'outcome' && s.crew >= WIN_AT) return finish(room, 'crew', 'missions', null, now);
  if (room.phase === 'hunt') return finish(room, 'crew', 'missions', null, now);
  if (room.phase === 'tally') {
    const last = room.tallies[room.tallies.length - 1];
    if (last && !last.approved && room.rejections >= MAX_REJECTIONS) return finish(room, 'spies', 'rejections', null, now);
  }
  finish(room, null, 'abandoned', null, now);
}

function finish(room: Room, winner: Side | null, reason: Reason, guessId: string | null, now: number): void {
  room.result = { winner, reason, guessId };
  room.leftAtFinish = room.players.filter((p) => p.status !== 'joined').map((p) => p.id);
  for (const p of room.players) {
    p.vote = null;
    p.card = null;
  }
  room.phase = 'finished';
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/** After a mission is shown: a side with three wins it (or the hunt begins), else the next mission. */
function afterOutcome(room: Room, now: number): void {
  const s = score(room);
  if (s.spies >= WIN_AT) {
    finish(room, 'spies', 'sabotage', null, now);
    return;
  }
  if (s.crew >= WIN_AT) {
    const tracker = active(room).find((p) => p.role === 'tracker');
    const lookout = seatedPlayers(room).find((p) => p.role === 'lookout');
    if (tracker && lookout) {
      room.phase = 'hunt';
      room.team = null;
      room.phaseEndsAt = now + HUNT_MS;
      room.updatedAt = now;
    } else {
      finish(room, 'crew', 'missions', null, now);
    }
    return;
  }
  room.mission += 1;
  room.attempt = 0;
  beginProposal(room, nextLeader(room, room.leaderId)?.id ?? null, now);
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it.
 * Returns whether anything changed.
 *
 * As Liar's Dice: every deadline after a step is set from `now`, so one call
 * takes ONE step of play and the next player gets their full clock. A stale or
 * far-future `now` cannot auto-play a whole game in one call, and a `now` that
 * is not a number moves nothing.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
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
      break;
    case 'roles':
      beginProposal(room, room.leaderId, now);
      break;
    case 'proposing':
      if (!leaderFrom(room, room.leaderId)) {
        finish(room, null, 'abandoned', null, now);
        break;
      }
      room.leaderId = leaderFrom(room, room.leaderId)!.id;
      sendToVote(room, autoTeam(room, rng), true, now);
      break;
    case 'voting':
      tally(room, now);
      break;
    case 'tally': {
      const last = room.tallies[room.tallies.length - 1];
      if (last?.approved) {
        for (const p of room.players) p.card = null;
        room.phase = 'mission';
        room.phaseEndsAt = now + CLOCKS[room.difficulty].missionMs;
        room.updatedAt = now;
        // A team of people who have all left has nothing to wait for.
        if (missionComplete(room)) resolveMission(room, now);
      } else if (room.rejections >= MAX_REJECTIONS) {
        finish(room, 'spies', 'rejections', null, now);
      } else {
        beginProposal(room, nextLeader(room, room.leaderId)?.id ?? null, now);
      }
      break;
    }
    case 'mission':
      resolveMission(room, now);
      break;
    case 'outcome':
      afterOutcome(room, now);
      break;
    case 'hunt':
      // No name in time: the crew keep the win.
      finish(room, 'crew', 'missions', null, now);
      break;
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
  /** 1 for the winning side (still at the table), 2 for everyone else; all 1 when nobody won. */
  place: number;
  role: Role;
  side: Side;
  won: boolean;
  left: boolean;
}

/** The winning side first, still-here winners at place 1. */
export function standings(room: Room): Standing[] {
  const winner = room.result?.winner ?? null;
  const rows = seatedPlayers(room).map((p) => {
    const side = sideOf(p.role ?? 'crew');
    // Frozen at the finish: leaving the results screen does not undo a win.
    const left = room.result ? room.leftAtFinish.includes(p.id) : p.status !== 'joined';
    const won = winner !== null && side === winner && !left;
    return { id: p.id, name: p.name, place: winner === null ? 1 : won ? 1 : 2, role: p.role ?? 'crew', side, won, left };
  });
  return rows.sort((a, b) => a.place - b.place);
}

export function winners(room: Room): string[] {
  return standings(room)
    .filter((s) => s.won)
    .map((s) => s.id);
}

/**
 * The room as one player's phone sees it.
 *
 * Mine: my role and side, and — if I am a spy or the Lookout — who the spies
 * are. Never anyone else's role, vote before the tally, or mission card: the
 * others' rows say only whether they have voted or played. In the hunt the
 * spies are shown to everyone (they choose out loud). Once finished every role
 * is shown; who played Sabotage never is — missions are counts only.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const hunting = room.phase === 'hunt';
  const me = room.players.find((p) => p.id === meId);
  const myRole = me?.seated ? me.role : null;
  const knowsSpies = myRole !== null && (sideOf(myRole) === 'spies' || myRole === 'lookout');
  const team = room.team ?? [];
  const showTeam = ['voting', 'tally', 'mission', 'outcome'].includes(room.phase);
  const tracker = seatedPlayers(room).find((p) => p.role === 'tracker');
  const isSpy = (p: Player) => p.role !== null && sideOf(p.role) === 'spies';
  const clocks = CLOCKS[room.difficulty];
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    rule: ruleLine(room.difficulty),
    specials: specials(room.difficulty),
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    seats: room.seats,
    spyCount: room.seats ? (SPIES_FOR[room.seats] ?? 0) : 0,
    teamSizes: room.seats ? [...(TEAM_SIZES[room.seats] ?? [])] : [],
    sabotagesNeeded: room.seats ? [0, 1, 2, 3, 4].map((i) => sabotagesNeeded(room.seats, i)) : [],
    proposeMs: clocks.proposeMs,
    voteMs: clocks.voteMs,
    missionMs: clocks.missionMs,
    huntMs: HUNT_MS,
    mission: room.mission,
    attempt: room.attempt,
    rejections: room.rejections,
    maxRejections: MAX_REJECTIONS,
    leaderId: room.leaderId,
    team: showTeam ? [...team] : null,
    autoTeam: showTeam ? room.autoTeam : false,
    score: score(room),
    secret:
      myRole === null
        ? null
        : {
            role: myRole,
            side: sideOf(myRole),
            spies: knowsSpies
              ? seatedPlayers(room)
                  .filter((p) => p.id !== meId && isSpy(p))
                  .map((p) => p.id)
              : [],
            vote: room.phase === 'voting' ? (me?.vote ?? null) : null,
            card: room.phase === 'mission' ? (me?.card ?? null) : null,
          },
    trackerId: hunting || finished ? (tracker?.id ?? null) : null,
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seated: p.seated,
      ready: p.ready,
      voted: room.phase === 'voting' ? p.vote !== null : false,
      onTeam: showTeam && team.includes(p.id),
      played: room.phase === 'mission' && team.includes(p.id) ? p.card !== null : false,
      role: finished ? p.role : null,
      side: finished && p.role ? sideOf(p.role) : hunting && isSpy(p) ? 'spies' : null,
    })),
    tallies: room.tallies.map((t) => ({ ...t, team: [...t.team], approve: [...t.approve], reject: [...t.reject], auto: [...t.auto] })),
    missions: room.missions.map((m) => ({ ...m, team: [...m.team] })),
    result: finished && room.result ? { ...room.result } : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
