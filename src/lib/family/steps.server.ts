// The family steps board — storage, the pilot poll and the pushes.
//
// The poll (`refreshAndCheck`) is the ONLY writer: the `family-steps` heartbeat
// runs it every 15 minutes through the day, and `family-steps-4pm` runs it
// once more before telling everyone their place. The phone's GET reads the
// stored rows and never waits on the pilot.
//
// Spec: docs/superpowers/specs/2026-09-28-family-steps-and-tasks.md

import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyStepsDay, familyStepsEvent } from '$lib/db/schema';
import { pilotDay } from '$lib/home/presence/companion-accounts';
import { pushToEmails } from '$lib/server/push-devices';
import type { PushMessage } from '$lib/server/apns';
import { familyRoster, nameFromEmail, type FamilyPerson } from './roster.server';
import {
  dethroneDecision,
  dethroneText,
  leaderOf,
  londonWindow,
  previousDay,
  rankBoard,
  standingsText,
  todaysSteps,
  type BoardRow,
  type Ranked,
  type StepsWindow,
} from './steps';

/** The app routes a tap on either push here (`category`), or by `url`. */
export const STEPS_URL = 'sr://family/steps';
export const STEPS_CATEGORY = 'family-steps';

/** Someone with no steps row for this long drops off the board. */
const BOARD_RECENT_DAYS = 14;

type EventKind = 'dethroned' | 'standings';

async function rowsFor(day: string): Promise<Array<BoardRow & { checkedAt: Date }>> {
  const rows = await db.select().from(familyStepsDay).where(eq(familyStepsDay.day, day));
  return rows.map((r) => ({ email: r.email, steps: r.steps, updatedAt: r.updatedAt, checkedAt: r.checkedAt }));
}

async function upsertSteps(day: string, email: string, steps: number, now: Date): Promise<void> {
  await db
    .insert(familyStepsDay)
    .values({ day, email, steps, updatedAt: now, checkedAt: now })
    .onConflictDoUpdate({
      target: [familyStepsDay.day, familyStepsDay.email],
      set: {
        steps,
        checkedAt: now,
        // Moves only when the count moves: it is when they REACHED it, which
        // is what breaks a tie at the top.
        updatedAt: sql`CASE WHEN ${familyStepsDay.steps} <> excluded.steps THEN excluded.updated_at ELSE ${familyStepsDay.updatedAt} END`,
      },
    });
}

async function eventCounts(day: string, kind: EventKind): Promise<Map<string, number>> {
  const rows = await db
    .select({ email: familyStepsEvent.email, n: sql<number>`count(*)::int` })
    .from(familyStepsEvent)
    .where(and(eq(familyStepsEvent.day, day), eq(familyStepsEvent.kind, kind)))
    .groupBy(familyStepsEvent.email);
  return new Map(rows.map((r) => [r.email, Number(r.n)]));
}

async function recordEvent(day: string, email: string, kind: EventKind, now: Date): Promise<void> {
  await db.insert(familyStepsEvent).values({ day, email, kind, at: now });
}

export interface RefreshResult {
  day: string;
  asked: number;
  written: number;
  failed: number;
  pushed: string | null;
}

/**
 * Ask the pilot for each board member's count, one at a time (each call has
 * the pilot client's own 8 s timeout), and store what came back. No account
 * (404) or no step record today writes nothing.
 */
async function refresh(people: readonly FamilyPerson[], window: StepsWindow, now: Date, fetchImpl: typeof fetch) {
  let written = 0;
  let failed = 0;
  for (const p of people) {
    const r = await pilotDay(p.email, window, fetchImpl);
    if (!r.ok) {
      if (r.reason !== 'not-found') failed++;
      continue;
    }
    const steps = todaysSteps(r.value.timeline.steps, window);
    if (steps === null) continue;
    await upsertSteps(window.day, p.email, steps, now);
    written++;
  }
  return { written, failed };
}

function stepsPush(body: string, collapse: string): PushMessage {
  return {
    title: 'Family steps',
    body,
    category: STEPS_CATEGORY,
    threadId: STEPS_CATEGORY,
    level: 'active',
    relevance: 0.5,
    collapseId: collapse,
    userInfo: { category: STEPS_CATEGORY, url: STEPS_URL },
  };
}

// The two activities can land on the same tick; one poll at a time keeps the
// before/after comparison and the push cap honest.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Poll everyone on the board, then push whoever lost the top spot — unless it
 * is the day's first poll, they are only level, or they have had two today.
 */
export function refreshAndCheck(now = new Date(), fetchImpl: typeof fetch = fetch, push = pushToEmails): Promise<RefreshResult> {
  return serial(async () => {
    const window = londonWindow(now);
    const people = (await familyRoster(now.getTime())).filter((p) => p.pilot);
    const before = leaderOf(await rowsFor(window.day));
    const { written, failed } = await refresh(people, window, now, fetchImpl);
    const after = await rowsFor(window.day);
    const counts = await eventCounts(window.day, 'dethroned');
    const decision = dethroneDecision({ before, after, dethronedToday: (e) => counts.get(e) ?? 0 });
    let pushed: string | null = null;
    if (decision) {
      const names = new Map(people.map((p) => [p.email, p.name]));
      const leaderName = names.get(decision.newLeader) ?? nameFromEmail(decision.newLeader);
      await recordEvent(window.day, decision.email, 'dethroned', now);
      await push(
        [decision.email],
        stepsPush(dethroneText(leaderName, decision.leaderSteps, decision.mySteps), `steps-top-${window.day}`),
      );
      pushed = decision.email;
    }
    return { day: window.day, asked: people.length, written, failed, pushed };
  });
}

export interface BoardPerson extends BoardRow {
  id: string;
  name: string;
  /** Null when they have no count yet today. */
  reachedAt: Date | null;
}

export interface StepsBoard {
  window: StepsWindow;
  board: Array<Ranked<BoardPerson>>;
  checkedAt: Date | null;
  yesterday: { leaderName: string; steps: number } | null;
}

/**
 * Today's board from the stored rows: everyone in the family on the app who
 * has counted any steps in the last fortnight, with no row today = 0 at the
 * bottom. Nobody outside the family, whatever rows exist.
 */
export async function stepsBoard(now = new Date()): Promise<StepsBoard> {
  const window = londonWindow(now);
  const roster = await familyRoster(now.getTime());
  const byEmail = new Map(roster.map((p) => [p.email, p]));
  const since = new Date(Date.parse(`${window.day}T12:00:00Z`) - BOARD_RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const recent = await db
    .selectDistinct({ email: familyStepsDay.email })
    .from(familyStepsDay)
    .where(and(gte(familyStepsDay.day, since), sql`${familyStepsDay.steps} > 0`));
  const today = await rowsFor(window.day);
  const todayBy = new Map(today.map((r) => [r.email, r]));

  const emails = new Set<string>();
  for (const r of recent) if (byEmail.has(r.email)) emails.add(r.email);
  for (const r of today) if (byEmail.has(r.email)) emails.add(r.email);

  // No row today sorts after every row (and among themselves by name).
  const LATE = new Date(8.64e15);
  const people: BoardPerson[] = [...emails].map((email) => {
    const p = byEmail.get(email)!;
    const row = todayBy.get(email);
    return { email, id: p.id, name: p.name, steps: row?.steps ?? 0, updatedAt: row?.updatedAt ?? LATE, reachedAt: row?.updatedAt ?? null };
  });
  people.sort((a, b) => a.name.localeCompare(b.name));
  const board = rankBoard(people);

  const checked = today.filter((r) => emails.has(r.email)).map((r) => r.checkedAt.getTime());
  const checkedAt = checked.length ? new Date(Math.max(...checked)) : null;

  const yRows = (await rowsFor(previousDay(window.day))).filter((r) => byEmail.has(r.email));
  const yLeader = leaderOf(yRows);
  const yesterday = yLeader
    ? { leaderName: byEmail.get(yLeader)?.name ?? nameFromEmail(yLeader), steps: yRows.find((r) => r.email === yLeader)!.steps }
    : null;

  return { window, board, checkedAt, yesterday };
}

export interface StandingsResult {
  day: string;
  board: number;
  pushed: number;
  skipped?: string;
}

/**
 * The 4pm push: refresh, then tell everyone on the board their place. One a
 * day each (a `standings` event), and nothing at all with fewer than two.
 */
export async function pushStandings(now = new Date(), fetchImpl: typeof fetch = fetch, push = pushToEmails): Promise<StandingsResult> {
  await refreshAndCheck(now, fetchImpl, push);
  const { window, board } = await stepsBoard(now);
  if (board.length < 2) return { day: window.day, board: board.length, pushed: 0, skipped: 'fewer than two on the board' };
  const sent = await eventCounts(window.day, 'standings');
  let pushed = 0;
  for (const person of board) {
    if ((sent.get(person.email) ?? 0) > 0) continue;
    const body = standingsText(board, person.email);
    if (!body) continue;
    // Recorded before the push: a phone Apple refuses must not be retried every tick.
    await recordEvent(window.day, person.email, 'standings', now);
    await push([person.email], stepsPush(body, `steps-4pm-${window.day}`));
    pushed++;
  }
  return { day: window.day, board: board.length, pushed };
}

/** Whether everyone on today's board has had their 4pm push — a cheap early exit. */
export async function standingsDone(now = new Date()): Promise<boolean> {
  const { window, board } = await stepsBoard(now);
  if (board.length < 2) return false;
  const sent = await eventCounts(window.day, 'standings');
  return board.every((p) => (sent.get(p.email) ?? 0) > 0);
}
