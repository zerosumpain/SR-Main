// The family steps board — the pure half. Everything here is PURE: the London
// day, today's count out of the pilot's step records, the ranking, the leader,
// whether a change at the top earns a push, and the words of every push.
//
// Spec: docs/superpowers/specs/2026-09-28-family-steps-and-tasks.md

import type { PushMessage } from '$lib/server/apns';
import { localDayStart } from '$lib/home/presence/types';

export const FAMILY_TZ = 'Europe/London';

/** At most this many "knocked off the top" pushes per person per day. */
export const DETHRONE_CAP = 2;

export interface StepsWindow {
  /** YYYY-MM-DD, the London calendar day. */
  day: string;
  /** Epoch seconds, London midnight to the next. */
  from: number;
  to: number;
  /** Minutes BEHIND UTC, as the pilot wants it: British Summer Time is -60. */
  tz: number;
}

function isoDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FAMILY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The London day an instant falls in, as a pilot window. Correct across both clock changes. */
export function londonWindow(now: Date): StepsWindow {
  const start = localDayStart(now, FAMILY_TZ);
  const day = isoDay(new Date(start.getTime() + 3_600_000));
  // 26 h on is always inside the next day, whatever the clocks did.
  const next = localDayStart(new Date(start.getTime() + 26 * 3_600_000), FAMILY_TZ);
  const tz = Math.round((start.getTime() - Date.parse(`${day}T00:00:00Z`)) / 60_000);
  return { day, from: Math.floor(start.getTime() / 1000), to: Math.floor(next.getTime() / 1000), tz };
}

/** The London day before `day` (YYYY-MM-DD). */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** A phone's local day may begin this long before London's: UTC+14 is the
 *  furthest any clock runs ahead. */
export const AHEAD_OF_LONDON_S = 14 * 3600;

/**
 * Today's count from the pilot's step records. The pilot keeps ONE cumulative
 * record per local day, so this picks, never sums: the largest value among the
 * records that START inside today's window. Null when there is none — no
 * steps today is not the same as zero steps recorded.
 *
 * "Inside" reaches back `AHEAD_OF_LONDON_S` before London's midnight, because a
 * record starts at the PHONE's midnight. On the family's Rome trip (from 26 Oct
 * 2026, with the clocks just gone back) Rome's midnight was 23:00 London time,
 * every phone's day began before the window, and the board counted nobody — the
 * counts dropped out one by one as each phone landed and took Rome time. The
 * pilot already answers with every record that overlaps the window; the
 * yesterday of a phone behind London ends inside it but STARTS before this
 * reach (UTC-1 or later begins after London's midnight), so it is never taken.
 */
export function todaysSteps(
  records: ReadonlyArray<{ value: number; start: string; end: string }>,
  window: Pick<StepsWindow, 'from' | 'to'>,
): number | null {
  let best: number | null = null;
  for (const r of records) {
    const at = Date.parse(r.start) / 1000;
    if (!Number.isFinite(at) || at < window.from - AHEAD_OF_LONDON_S || at >= window.to) continue;
    if (!Number.isFinite(r.value) || r.value < 0) continue;
    const v = Math.round(r.value);
    if (best === null || v > best) best = v;
  }
  return best;
}

export interface BoardRow {
  email: string;
  steps: number;
  /** When they reached this count. Ties at a count go to the earlier. */
  updatedAt: Date;
}

export type Ranked<T extends BoardRow = BoardRow> = T & { rank: number };

/**
 * Most steps first; a tie shares its rank (1, 1, 3) and is ordered by who got
 * there first. PURE.
 */
export function rankBoard<T extends BoardRow>(rows: readonly T[]): Array<Ranked<T>> {
  const sorted = [...rows].sort(
    (a, b) => b.steps - a.steps || a.updatedAt.getTime() - b.updatedAt.getTime() || a.email.localeCompare(b.email),
  );
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.steps !== sorted[i - 1].steps) rank = i + 1;
    return { ...r, rank };
  });
}

/** Who is top: rank 1, the first to reach it on a tie. Nobody while no one has a step. */
export function leaderOf(rows: readonly BoardRow[]): string | null {
  const top = rankBoard(rows)[0];
  return top && top.steps > 0 ? top.email : null;
}

export interface Dethroned {
  /** Who to tell. */
  email: string;
  newLeader: string;
  leaderSteps: number;
  mySteps: number;
}

/**
 * Whether a refresh knocked someone off the top, and they should hear about it.
 *
 * Not on the day's first refresh (there was no leader to lose), not when the
 * old leader is merely level with the new one (a tie is not a loss), and not
 * past the day's cap of pushes. PURE.
 */
export function dethroneDecision(input: {
  before: string | null;
  after: readonly BoardRow[];
  dethronedToday: (email: string) => number;
  cap?: number;
}): Dethroned | null {
  const { before } = input;
  if (!before) return null;
  const ranked = rankBoard(input.after);
  const leader = leaderOf(input.after);
  if (!leader || leader === before) return null;
  const old = ranked.find((r) => r.email === before);
  const top = ranked.find((r) => r.email === leader);
  if (!old || !top || old.rank === 1) return null;
  if (input.dethronedToday(before) >= (input.cap ?? DETHRONE_CAP)) return null;
  return { email: before, newLeader: leader, leaderSteps: top.steps, mySteps: old.steps };
}

const NUM = new Intl.NumberFormat('en-GB');

export function formatSteps(n: number): string {
  return NUM.format(Math.round(n));
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function dethroneText(newLeaderName: string, leaderSteps: number, mySteps: number): string {
  return `Knocked off the top — ${newLeaderName} has ${formatSteps(leaderSteps)} steps, you have ${formatSteps(mySteps)}.`;
}

/**
 * The 4pm line for one person on the board, or null if they are not on it.
 * `board` is ranked and named. PURE.
 */
export function standingsText(board: ReadonlyArray<Ranked<BoardRow & { name: string }>>, email: string): string | null {
  const me = board.find((r) => r.email === email);
  if (!me) return null;
  const n = board.length;
  const level = board.filter((r) => r.rank === me.rank && r.email !== email);
  if (me.rank === 1) {
    if (level.length) {
      return `You're joint top with ${formatSteps(me.steps)} steps — level with ${level[0].name}.`;
    }
    const second = board.find((r) => r.rank > 1);
    if (!second) return `You're top with ${formatSteps(me.steps)} steps.`;
    return `You're top with ${formatSteps(me.steps)} steps — ${formatSteps(me.steps - second.steps)} ahead of ${second.name}.`;
  }
  const leader = board[0];
  const place = `${level.length ? 'joint ' : ''}${ordinal(me.rank)}`;
  return `You're ${place} of ${n} with ${formatSteps(me.steps)} steps — ${formatSteps(leader.steps - me.steps)} behind ${leader.name}.`;
}

// ── "Ask everyone's phone" (opening the steps screen) ─────────────────────

/** The silent push's category: the app reports what it was asked for. */
export const REPORT_CATEGORY = 'family-report';
/** At most one round of silent pushes per this long, across the whole family. */
export const ASK_GAP_MS = 60_000;
/** When the pilot is read again after a round: woken phones upload in seconds, slow ones in a minute. */
export const ASK_REREAD_MS = [25_000, 60_000] as const;

/** Whether a round asked at `lastAt` (or never) still covers `now`. */
export function askThrottled(lastAt: number | null, now: number): boolean {
  return lastAt !== null && now - lastAt >= 0 && now - lastAt < ASK_GAP_MS;
}

/**
 * The silent push that wakes a family phone to upload today's steps (and a
 * fresh fix) to the pilot. Nothing on the lock screen. Apple holds it two
 * minutes for a phone that is off: after that the board has moved on.
 */
export function stepsAskPush(): PushMessage {
  return {
    title: '',
    body: '',
    background: true,
    category: REPORT_CATEGORY,
    ttlSeconds: 120,
    userInfo: { category: REPORT_CATEGORY, reason: 'steps' },
  };
}

/**
 * The leader the heartbeat's poll compares against. A re-read after an ask
 * stores fresh counts WITHOUT pushing; it remembers who led before it, so the
 * next poll still sees a change at the top the re-read stored, and the
 * dethroned person still hears. A remembered leader from another day is
 * ignored.
 */
export function dethroneBaseline(
  remembered: { day: string; leader: string | null } | null,
  day: string,
  stored: string | null,
): string | null {
  return remembered && remembered.day === day ? remembered.leader : stored;
}
