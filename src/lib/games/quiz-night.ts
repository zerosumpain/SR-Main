// Quiz Night — the rules, as pure functions over a room (see `tap-duel.ts`).
//
// The questions are written by jkai ONCE, while the lobby fills
// (`quiz-night.server.ts`), and checked here before a room may use them. From
// then on the model is out of the loop: the server holds the answers, marks
// every pick, and the phone never sees which option is right until the reveal.

import { z } from 'zod';
import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  MAX_PLAYERS,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from './tap-duel';

export { COUNTDOWN_MS, FINISHED_MS, LOBBY_MS };

export const AUDIENCES = ['kids', 'family', 'adults'] as const;
export type Audience = (typeof AUDIENCES)[number];

export type Phase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'finished' | 'closed';
export type Prep = 'writing' | 'ready' | 'failed';

export const QUESTIONS = 10;
/** Fewer usable questions than this and the game is not worth starting. */
export const MIN_QUESTIONS = 6;
export const OPTIONS = 4;
export const REVEAL_MS = 4_000;
/** After the clock, how long an answer already in flight may still land. */
export const GRACE_MS = 750;
export const TOPIC_MAX = 60;

export const TIME_MS: Record<Difficulty, number> = { easy: 20_000, medium: 15_000, hard: 10_000 };
const BASE_POINTS = 500;
const SPEED_POINTS = 500;

export interface Question {
  prompt: string;
  options: string[];
  answerIndex: number;
  explain: string | null;
}

export interface Pick {
  question: number;
  choice: number;
  ms: number;
  points: number;
}

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
  picks: Pick[];
}

export interface Room {
  id: string;
  game: 'quiz-night';
  difficulty: Difficulty;
  audience: Audience;
  /** What the host asked for; null = jkai picks. */
  topic: string | null;
  /** The topic jkai actually wrote about — the same as `topic` unless it picked. */
  title: string | null;
  hostId: string;
  phase: Phase;
  prep: Prep;
  prepError: string | null;
  players: Player[];
  questions: Question[];
  /** Index of the current question; -1 before the first. */
  index: number;
  questionStartsAt: number | null;
  /** Lobby expiry, countdown end, the question's clock, reveal end, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

/** A topic as the host typed it, made safe to quote to the model: one line, bounded, or null. */
export function cleanTopic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TOPIC_MAX);
  return t.length >= 2 ? t : null;
}

function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, score: 0, picks: [] };
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
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > MAX_PLAYERS - 1) throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  const audience = input.options?.audience;
  const topic = cleanTopic(input.options?.topic);
  return {
    id: input.id,
    game: 'quiz-night',
    difficulty: input.difficulty,
    audience: isAudience(audience) ? audience : 'family',
    topic,
    title: topic,
    hostId: input.host.id,
    phase: 'lobby',
    prep: 'writing',
    prepError: null,
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    questions: [],
    index: -1,
    questionStartsAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The writer's result lands here — questions already checked by `validateQuestions`. */
export function ready(room: Room, result: { title: string | null; questions: Question[] }, now: number): void {
  if (room.phase === 'closed') return;
  room.questions = result.questions;
  if (result.title) room.title = result.title;
  room.prep = 'ready';
  room.prepError = null;
  room.updatedAt = now;
}

export function failed(room: Room, message: string, now: number): void {
  if (room.phase === 'closed') return;
  room.prep = 'failed';
  room.prepError = message;
  room.updatedAt = now;
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
  if (room.phase === 'question') revealIfAnswered(room, now);
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  if (room.prep === 'writing') throw new GameError(409, 'jkai is still writing the questions.');
  if (room.prep === 'failed') throw new GameError(409, room.prepError ?? 'The questions could not be written.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/**
 * Play again with the SAME questions would be a memory test, so "again" is a
 * fresh room from the phone's side: the registry deals a new one. Here it only
 * refuses, so the verb means the same thing in every game's vocabulary.
 */
export function again(room: Room, playerId: string, _now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  throw new GameError(409, 'Start a new quiz for fresh questions.');
}

function points(ms: number, timeMs: number): number {
  const left = Math.max(0, Math.min(1, 1 - ms / timeMs));
  return BASE_POINTS + Math.round(SPEED_POINTS * left);
}

/** One answer per player per question, timed from when the question opened on the server. */
export function answer(room: Room, playerId: string, input: { question: number; choice: number }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'question' || input.question !== room.index) throw new GameError(409, 'That question has closed.');
  if (!Number.isInteger(input.choice) || input.choice < 0 || input.choice >= OPTIONS) {
    throw new GameError(400, 'Pick one of the four answers.');
  }
  if (p.picks.some((x) => x.question === room.index)) return;
  const q = room.questions[room.index];
  const timeMs = TIME_MS[room.difficulty];
  const ms = Math.max(0, Math.min(timeMs, now - (room.questionStartsAt ?? now)));
  const pts = input.choice === q.answerIndex ? points(ms, timeMs) : 0;
  p.picks.push({ question: room.index, choice: input.choice, ms, points: pts });
  p.score += pts;
  room.updatedAt = now;
  revealIfAnswered(room, now);
}

function revealIfAnswered(room: Room, now: number): void {
  if (joined(room).every((p) => p.picks.some((x) => x.question === room.index))) reveal(room, now);
}

function reveal(room: Room, now: number): void {
  room.phase = 'reveal';
  room.phaseEndsAt = now + REVEAL_MS;
  room.updatedAt = now;
}

function ask(room: Room, index: number, now: number): void {
  room.phase = 'question';
  room.index = index;
  room.questionStartsAt = now;
  room.phaseEndsAt = now + TIME_MS[room.difficulty];
  room.updatedAt = now;
}

export function advance(room: Room, now: number, _rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due" and run the
  // whole game to its end in one call.
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 40; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case 'lobby':
      case 'finished':
        close(room, due);
        break;
      case 'countdown':
        ask(room, 0, due);
        break;
      case 'question':
        reveal(room, due);
        break;
      case 'reveal':
        if (room.index + 1 >= room.questions.length) {
          room.phase = 'finished';
          room.phaseEndsAt = due + FINISHED_MS;
          room.updatedAt = due;
        } else {
          ask(room, room.index + 1, due);
        }
        break;
    }
  }
  return changed;
}

export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phase === 'question' ? room.phaseEndsAt + GRACE_MS : room.phaseEndsAt;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  correct: number;
  avgMs: number | null;
}

export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === 'joined' || p.picks.length > 0)
    .map((p) => {
      const right = p.picks.filter((x) => x.points > 0);
      return {
        id: p.id,
        name: p.name,
        score: p.score,
        correct: right.length,
        avgMs: right.length ? Math.round(right.reduce((a, x) => a + x.ms, 0) / right.length) : null,
      };
    })
    .sort((a, b) => b.score - a.score || b.correct - a.correct);
}

export function winners(list: Standing[]): string[] {
  if (list.length < 2 || list[0].score === 0) return [];
  return list.filter((s) => s.score === list[0].score).map((s) => s.id);
}

// ── Checking what the model wrote ──────────────────────────────────────────

/**
 * Words that have no place in a family quiz, matched as whole words in any
 * question, option or explanation. The prompt asks for family-safe content;
 * this is the check that does not take the model's word for it. A question
 * that trips it is dropped, not repaired.
 */
const BLOCKED = new RegExp(
  '\\b(' +
    [
      'sex\\w*', 'porn\\w*', 'nude\\w*', 'naked', 'erotic\\w*', 'orgasm\\w*', 'genital\\w*', 'penis\\w*', 'vagina\\w*',
      'fuck\\w*', 'shit\\w*', 'cunt\\w*', 'bitch\\w*', 'bastard\\w*', 'whore\\w*', 'slut\\w*', 'dick', 'cock\\w*',
      'rape\\w*', 'raping', 'molest\\w*', 'suicide\\w*', 'self-harm', 'overdos\\w*', 'cocaine', 'heroin', 'meth',
      'nazi\\w*', 'genocide', 'torture\\w*', 'behead\\w*', 'dismember\\w*', 'gore',
    ].join('|') +
    ')\\b',
  'i',
);

export function isClean(text: string): boolean {
  return !BLOCKED.test(text);
}

const QuestionSchema = z.object({
  prompt: z.string().trim().min(8).max(220),
  options: z.array(z.string().trim().min(1).max(80)).length(OPTIONS),
  answerIndex: z.number().int().min(0).max(OPTIONS - 1),
  explain: z.string().trim().max(240).nullish(),
});

const BatchSchema = z.object({
  title: z.string().trim().min(1).max(TOPIC_MAX).nullish(),
  questions: z.array(z.unknown()),
});

/**
 * The model's JSON, reduced to questions a room can use: well-formed, four
 * distinct options, clean, no repeats — then the options SHUFFLED, so the
 * right answer is not wherever the model habitually puts it. Returns null if
 * fewer than MIN_QUESTIONS survive.
 */
export function validateQuestions(
  raw: unknown,
  rng: Rng,
): { title: string | null; questions: Question[]; dropped: number } | null {
  const batch = BatchSchema.safeParse(raw);
  if (!batch.success) return null;
  const seen = new Set<string>();
  const out: Question[] = [];
  let dropped = 0;
  for (const item of batch.data.questions) {
    const q = QuestionSchema.safeParse(item);
    if (!q.success) {
      dropped++;
      continue;
    }
    const { prompt, options, answerIndex } = q.data;
    const explain = q.data.explain?.trim() || null;
    const key = prompt.toLowerCase().replace(/\W+/g, ' ').trim();
    const distinct = new Set(options.map((o) => o.toLowerCase())).size === OPTIONS;
    const clean = [prompt, ...options, explain ?? ''].every(isClean);
    if (!distinct || !clean || seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    const order = [0, 1, 2, 3];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    out.push({ prompt, options: order.map((i) => options[i]), answerIndex: order.indexOf(answerIndex), explain });
    if (out.length === QUESTIONS) break;
  }
  if (out.length < MIN_QUESTIONS) return null;
  const title = batch.data.title?.trim() || null;
  return { title: title && isClean(title) ? title : null, questions: out, dropped };
}

// ── What a phone sees ──────────────────────────────────────────────────────

export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  const q = room.index >= 0 ? room.questions[room.index] : undefined;
  const open = room.phase === 'question';
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    audience: room.audience,
    topic: room.topic,
    title: room.title,
    phase: room.phase,
    prep: room.prep,
    prepError: room.prepError,
    hostId: room.hostId,
    meId,
    questionCount: room.questions.length,
    timeMs: TIME_MS[room.difficulty],
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      score: p.score,
      isHost: p.id === room.hostId,
    })),
    phaseEndsAt: room.phaseEndsAt,
    question:
      q && (open || room.phase === 'reveal')
        ? {
            index: room.index,
            prompt: q.prompt,
            options: q.options,
            startsAt: room.questionStartsAt,
            // Who has answered, never what — until the reveal.
            answeredIds: room.players.filter((p) => p.picks.some((x) => x.question === room.index)).map((p) => p.id),
            answerIndex: open ? null : q.answerIndex,
            explain: open ? null : q.explain,
            picks: open
              ? []
              : room.players.flatMap((p) =>
                  p.picks
                    .filter((x) => x.question === room.index)
                    .map((x) => ({ playerId: p.id, choice: x.choice, points: x.points, ms: x.ms })),
                ),
            myChoice: room.players.find((p) => p.id === meId)?.picks.find((x) => x.question === room.index)?.choice ?? null,
          }
        : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
