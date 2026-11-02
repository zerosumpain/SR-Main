// Snap Happy — the rules, as pure functions over a room (the Tap Duel shape).
//
// A reaction game for the TV. Each round names a target ("Snap on the steam
// engine"), then the TV flicks through pictures — kettles, teapots, buses, a
// custard cream — and the target turns up once, somewhere in the run. Players
// hit SNAP on their phones when they see it. Fastest right snap scores most;
// snapping on anything else (or before it shows) costs a point.
//
// Fairness rests on Tap Duel's two choices. The server deals the whole run
// AHEAD — every flip's time — so the TV shows the target at the same instant
// for everyone; and a phone sends the moment it was tapped, on the server's
// clock (its own clock plus the skew its stream measured), so the network
// never enters a score. The run stays off the phones until the round is over:
// a phone cannot know when the target comes, only that it has to watch.

import { GameError, isDifficulty, DIFFICULTIES, type Difficulty, type PlayerStatus, type Rng } from './tap-duel';

export { GameError, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'armed' | 'result' | 'finished' | 'closed';

export const ROUNDS = 8;
export const maxPlayers = 8;
export const minPlayers = 1;
export const LOBBY_MS = 3 * 60_000;
export const COUNTDOWN_MS = 3_000;
/** The target is shown alone first, so everybody knows what to look for. */
export const INTRO_MS = 2_500;
export const RESULT_MS = 4_000;
export const FINISHED_MS = 10 * 60_000;
/** After the window closes, how long a snap already in flight may still land. */
export const GRACE_MS = 800;
/** Faster than anybody can see a picture: a guess, scored as early. */
export const ANTICIPATION_MS = 120;
/** A tap the phone says happened more than this far from now is not believed; now is used. */
const CLOCK_SLACK_MS = 4_000;
/** Pictures after the target, so the run does not stop on it and give it away. */
const TAIL_FLIPS = 2;

/** Points for the first, second and every later right snap; a wrong or early snap costs one. */
export const PLACE_POINTS = [3, 2, 1] as const;
export const PENALTY = 1;

/**
 * The pictures (drawn on the TV by `SnapPicture.svelte`): things from a Kelly
 * kitchen and a Darlington street. `like` names lookalikes for the hard rounds.
 */
export const PICTURES = {
  engine: { label: 'the steam engine', like: ['bus', 'boat'] },
  kettle: { label: 'the kettle', like: ['teapot', 'mug'] },
  teapot: { label: 'the teapot', like: ['kettle', 'mug'] },
  mug: { label: 'the mug of tea', like: ['teapot', 'kettle'] },
  biscuit: { label: 'the custard cream', like: ['toast', 'cake'] },
  scone: { label: 'the scone', like: ['cake', 'biscuit'] },
  bus: { label: 'the red bus', like: ['engine', 'boat'] },
  clock: { label: 'the clock tower', like: ['bridge', 'umbrella'] },
  bridge: { label: 'the bridge', like: ['clock', 'boat'] },
  umbrella: { label: 'the umbrella', like: ['boot', 'clock'] },
  boot: { label: 'the wellie', like: ['umbrella', 'sheep'] },
  bike: { label: 'the bike', like: ['bus', 'boat'] },
  boat: { label: 'the boat', like: ['bridge', 'engine'] },
  sheep: { label: 'the sheep', like: ['boot', 'cake'] },
  toast: { label: 'the toast', like: ['biscuit', 'cake'] },
  cake: { label: 'the cake', like: ['scone', 'toast'] },
} as const;
export type Picture = keyof typeof PICTURES;
export const PICTURE_IDS = Object.keys(PICTURES) as Picture[];

interface Tuning {
  flipMs: number;
  windowMs: number;
  /** Pictures before the target. */
  before: [number, number];
  /** Of those, how many are lookalikes of the target. */
  lookalikes: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { flipMs: 1_100, windowMs: 2_000, before: [3, 5], lookalikes: 0 },
  medium: { flipMs: 850, windowMs: 1_500, before: [4, 7], lookalikes: 1 },
  hard: { flipMs: 650, windowMs: 1_100, before: [5, 9], lookalikes: 2 },
};

export interface Flip {
  pic: Picture;
  at: number;
}

export interface Snap {
  playerId: string;
  /** From the target showing; null for a miss (too slow) or an early/wrong snap. */
  reactionMs: number | null;
  early: boolean;
  points: number;
}

export interface Round {
  number: number;
  target: Picture;
  /** When the run of pictures begins (after the intro). */
  startsAt: number;
  flips: Flip[];
  /** When the target shows. */
  goAt: number;
  windowMs: number;
  closesAt: number;
  snaps: Snap[];
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
  reactions: number[];
  wrong: number;
}

export interface Room {
  id: string;
  game: 'snap-happy';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  rounds: number;
  round: Round | null;
  /** Targets already used, so a game does not repeat one. */
  used: Picture[];
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, score: 0, reactions: [], wrong: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
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
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > maxPlayers - 1) throw new GameError(400, `Up to ${maxPlayers} players.`);
  return {
    id: input.id,
    game: 'snap-happy',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    rounds: ROUNDS,
    round: null,
    used: [],
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function about(room: Room): string {
  return `${room.rounds} rounds · ${room.difficulty}`;
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
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.score = 0;
    p.reactions = [];
    p.wrong = 0;
  }
  room.phase = 'lobby';
  room.round = null;
  room.used = [];
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

const pickOne = <T>(xs: readonly T[], rng: Rng): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];

/** A round's run: the target once, after a few others (lookalikes among them on harder rounds), then a short tail. */
export function dealRound(number: number, difficulty: Difficulty, used: readonly Picture[], now: number, rng: Rng): Round {
  const t = TUNING[difficulty];
  const fresh = PICTURE_IDS.filter((p) => !used.includes(p));
  const target = pickOne(fresh.length ? fresh : PICTURE_IDS, rng);
  const others = PICTURE_IDS.filter((p) => p !== target);
  const count = t.before[0] + Math.floor(rng() * (t.before[1] - t.before[0] + 1));
  const like = PICTURES[target].like as readonly Picture[];
  const before: Picture[] = [];
  for (let i = 0; i < count; i++) {
    // Lookalikes sit late in the run, where a twitchy thumb is most tempted.
    const lookalike = i >= count - t.lookalikes;
    let pic = lookalike ? pickOne(like, rng) : pickOne(others, rng);
    if (before.length && before[before.length - 1] === pic) pic = pickOne(others.filter((p) => p !== pic), rng);
    before.push(pic);
  }
  const tail = Array.from({ length: TAIL_FLIPS }, () => pickOne(others, rng));
  const startsAt = now + INTRO_MS;
  const run = [...before, target, ...tail];
  const flips = run.map((pic, i) => ({ pic, at: startsAt + i * t.flipMs }));
  const goAt = startsAt + before.length * t.flipMs;
  return { number, target, startsAt, flips, goAt, windowMs: t.windowMs, closesAt: goAt + t.windowMs + GRACE_MS, snaps: [] };
}

/**
 * One snap per player per round: `at` is when the phone was tapped, on the
 * server's clock as the phone reckons it. Before the target shows, or faster
 * than a person can see it, is early (a point off); after the window is a
 * miss. The server only refuses the impossible.
 */
export function snap(room: Room, playerId: string, input: { round: unknown; at: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  const r = room.round;
  if (room.phase !== 'armed' || !r || r.number !== input.round) throw new GameError(409, 'That round is over.');
  if (r.snaps.some((x) => x.playerId === playerId)) return;
  if (now < r.startsAt) throw new GameError(409, 'Wait for the pictures.');
  const said = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : now;
  const at = Math.abs(said - now) > CLOCK_SLACK_MS ? now : said;
  const reaction = Math.round(at - r.goAt);
  const early = reaction < ANTICIPATION_MS;
  r.snaps.push({ playerId, reactionMs: early || reaction > r.windowMs ? null : reaction, early, points: 0 });
  room.updatedAt = now;
  if (joined(room).every((x) => r.snaps.some((s) => s.playerId === x.id))) settle(room, now);
}

function settle(room: Room, now: number): void {
  const r = room.round!;
  const right = r.snaps.filter((s) => s.reactionMs !== null).sort((a, b) => a.reactionMs! - b.reactionMs!);
  right.forEach((s, i) => (s.points = PLACE_POINTS[Math.min(i, PLACE_POINTS.length - 1)]));
  for (const s of r.snaps) if (s.early) s.points = -PENALTY;
  for (const s of r.snaps) {
    const p = room.players.find((q) => q.id === s.playerId);
    if (!p) continue;
    p.score = Math.max(0, p.score + s.points);
    if (s.early) p.wrong++;
    else if (s.reactionMs !== null) p.reactions.push(s.reactionMs);
  }
  room.used = [...room.used, r.target];
  room.phase = 'result';
  room.phaseEndsAt = now + RESULT_MS;
  room.updatedAt = now;
}

export function advance(room: Room, now: number, rng: Rng): boolean {
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 20; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case 'lobby':
      case 'finished':
        close(room, due);
        break;
      case 'countdown':
        room.phase = 'armed';
        room.round = dealRound(1, room.difficulty, room.used, due, rng);
        room.phaseEndsAt = null;
        room.updatedAt = due;
        break;
      case 'armed':
        settle(room, due);
        break;
      case 'result': {
        const next = (room.round?.number ?? 0) + 1;
        if (next > room.rounds) {
          room.phase = 'finished';
          room.phaseEndsAt = due + FINISHED_MS;
        } else {
          room.phase = 'armed';
          room.round = dealRound(next, room.difficulty, room.used, due, rng);
          room.phaseEndsAt = null;
        }
        room.updatedAt = due;
        break;
      }
    }
  }
  return changed;
}

export function deadline(room: Room): number | null {
  if (room.phase === 'closed') return null;
  if (room.phase === 'armed') return room.round?.closesAt ?? null;
  return room.phaseEndsAt;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  bestMs: number | null;
  wrong: number;
}

/** Most points first; a tie goes to the quicker best snap. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === 'joined' || p.reactions.length > 0 || p.wrong > 0)
    .map((p) => ({ id: p.id, name: p.name, score: p.score, bestMs: p.reactions.length ? Math.min(...p.reactions) : null, wrong: p.wrong }))
    .sort((a, b) => b.score - a.score || (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity));
}

/** Nobody wins on nothing. Ties on points share it. */
export function winners(list: Standing[]): string[] {
  if (!list.length || list[0].score <= 0) return [];
  return list.filter((s) => s.score === list[0].score).map((s) => s.id);
}

function players(room: Room) {
  return room.players.map((p) => ({ id: p.id, name: p.name, status: p.status, score: p.score, isHost: p.id === room.hostId }));
}

/**
 * The room as a phone sees it: the target and when the round is live, never
 * the run (it would say when to tap) until the round is over. Who has snapped
 * shows as it happens; how they did shows at the result.
 */
export function toWire(room: Room, meId: string, now: number) {
  const r = room.round;
  const live = room.phase === 'armed';
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    rounds: room.rounds,
    players: players(room),
    phaseEndsAt: room.phaseEndsAt,
    round: r
      ? {
          number: r.number,
          target: r.target,
          targetLabel: PICTURES[r.target].label,
          startsAt: r.startsAt,
          closesAt: r.closesAt,
          goAt: live ? null : r.goAt,
          snappedIds: r.snaps.map((s) => s.playerId),
          mine: r.snaps.find((s) => s.playerId === meId) ?? null,
          snaps: live ? null : r.snaps,
        }
      : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;

/** The TV: the whole run (it is the one showing it), who has snapped, and the result once settled. */
export function toScreen(room: Room, now: number) {
  const r = room.round;
  const live = room.phase === 'armed';
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    rounds: room.rounds,
    players: players(room),
    phaseEndsAt: room.phaseEndsAt,
    round: r
      ? {
          number: r.number,
          target: r.target,
          targetLabel: PICTURES[r.target].label,
          startsAt: r.startsAt,
          flips: r.flips,
          goAt: r.goAt,
          closesAt: r.closesAt,
          snappedIds: r.snaps.map((s) => s.playerId),
          snaps: live ? null : r.snaps,
        }
      : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type ScreenRoom = ReturnType<typeof toScreen>;
