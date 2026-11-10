// src/lib/daydream/act/standing.server.ts
//
// Standing orders: a note's step carried out with no tap, when the autonomy
// ladder (`autonomy.ts`) has that kind on `do`. Called by the think loop as it
// delivers a note, so what reaches him is "Done: …" with an Undo, not a
// question.
//
// Lights are the one kind with a condition and an afterwards. They go off by
// themselves only when the house is EMPTY — a light turned off around someone
// sitting under it is not help — and they come back on when anyone returns.
// Owner, 2026-11-10: "if automating lights off when nobody in, i want to
// reverse that when people come back home."
//
// Everything that reaches outside the note goes through `runSolution` / `doIt`
// with `standing`. Lights and reminders are unattended tool calls, held to
// their kind by the tool contract; a draft and a tracker are held by `doIt` and
// `runSolution` refusing every other kind when standing.

import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings, daydreamThoughts } from '$lib/db/schema';
import { localDayOf } from '../think/shelf';
import { autoKindOf, mayAuto, type AutoKind } from './autonomy';
import { loadAutonomy, recordAuto, recordRestore } from './autonomy.server';
import { readSolve } from './solution';

export const AWAY_LIGHTS_KEY = 'daydream.away_lights';
/** Lights it turned off are put back only this long after. Past it, the house
 *  has been through a night and a morning and "as you left it" means nothing. */
export const AWAY_RESTORE_HOURS = 24;

export interface AwayLights {
  thoughtId: string;
  at: string;
}

export type StandingResult = { acted: true; kind: AutoKind; message: string } | { acted: false; why: string };

/** Who is in. `empty` needs EVERY member known to be out: a stale fix, or a
 *  member who is not sharing, may be someone sitting under the light. */
export async function houseNow(): Promise<{ empty: boolean; anyoneHome: boolean }> {
  const [{ loadHousehold }, { nowStatus }] = await Promise.all([import('$lib/home/presence/household'), import('$lib/home/presence/now')]);
  const { members } = await loadHousehold();
  const statuses = members.map((m) => nowStatus(m));
  const anyoneHome = statuses.includes('home');
  return { empty: statuses.length > 0 && statuses.every((s) => s === 'out'), anyoneHome };
}

async function readAway(): Promise<AwayLights[]> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AWAY_LIGHTS_KEY)).limit(1);
  return Array.isArray(row?.value) ? (row.value as AwayLights[]).filter((a) => a && typeof a.thoughtId === 'string' && typeof a.at === 'string') : [];
}

/** Straight to the table under a lock, for the reason `autonomy.server.ts` gives. */
async function changeAway(fn: (list: AwayLights[]) => AwayLights[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${AWAY_LIGHTS_KEY}))`);
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AWAY_LIGHTS_KEY)).limit(1);
    const next = fn(Array.isArray(row?.value) ? (row.value as AwayLights[]) : []);
    await tx
      .insert(appSettings)
      .values({ key: AWAY_LIGHTS_KEY, value: next })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  });
}

const noBacklog = () => {
  throw new Error('a standing order never builds');
};

/**
 * Carry out a new note's step if the ladder allows it. Never throws: a
 * standing order that could not run leaves the note as it was, with its
 * button, and says why.
 */
export async function actStanding(note: { id: string; title: string; actions: unknown }, now = new Date()): Promise<StandingResult> {
  try {
    const found = autoKindOf(note.actions);
    if (!found) return { acted: false, why: 'no step it may take by itself' };
    const allowed = mayAuto(await loadAutonomy(), found.kind, localDayOf(now), localDayOf);
    if (!allowed.ok) return { acted: false, why: allowed.why };

    if (found.kind === 'solve:home') {
      const house = await houseNow();
      if (!house.empty) return { acted: false, why: house.anyoneHome ? 'someone is home' : 'not everyone is known to be out' };
    }

    let message: string;
    if (found.via === 'do') {
      const { doIt } = await import('./act.server');
      const res = await doIt(note.id, now, {}, { standing: true });
      if (!res.ok) return { acted: false, why: res.reason };
      if (res.already) return { acted: false, why: 'already done' };
      message = res.label;
    } else {
      const { runSolution } = await import('./solution.server');
      const res = await runSolution(note.id, noBacklog, now, { standing: true });
      if (!res.ok) return { acted: false, why: res.reason };
      if (res.already) return { acted: false, why: 'already done' };
      message = res.message;
    }

    await recordAuto({ at: now.toISOString(), kind: found.kind, thoughtId: note.id, title: note.title.slice(0, 120) });
    if (found.kind === 'solve:home') await changeAway((list) => [...list.filter((a) => a.thoughtId !== note.id), { thoughtId: note.id, at: now.toISOString() }]);
    return { acted: true, kind: found.kind, message };
  } catch (err) {
    return { acted: false, why: String(err instanceof Error ? err.message : err).slice(0, 160) };
  }
}

/** What the push says after an automatic act. */
export function doneWords(kind: AutoKind, message: string): string {
  const tail =
    kind === 'solve:home'
      ? 'They come back on when someone gets home. Undo is on the note.'
      : kind === 'email_draft'
        ? 'It is a draft in Gmail — nothing has been sent. Read it on the note, then send or discard it.'
        : 'Undo is on the note.';
  return `${message.replace(/\s+$/, '')}${/[.!?]$/.test(message.trim()) ? '' : '.'} ${tail}`;
}

// ── Someone came home ──────────────────────────────────────────────────────

let lastLook = 0;
const LOOK_EVERY_MS = 60_000;

/** Reset between tests. */
export function resetAwayLights(): void {
  lastLook = 0;
}

/**
 * Turn back on the lights it turned off in an empty house, now that someone is
 * home. Called every tick of `household-live`; a quiet call is one small read
 * a minute. A note he already undid, or one older than `AWAY_RESTORE_HOURS`,
 * is dropped without touching a light.
 */
export async function restoreAwayLights(now = new Date()): Promise<{ restored: number; dropped: number }> {
  if (now.getTime() - lastLook < LOOK_EVERY_MS) return { restored: 0, dropped: 0 };
  lastLook = now.getTime();
  const waiting = await readAway();
  if (!waiting.length) return { restored: 0, dropped: 0 };

  const fresh = waiting.filter((a) => now.getTime() - Date.parse(a.at) <= AWAY_RESTORE_HOURS * 3_600_000);
  const gone = new Set(waiting.filter((a) => !fresh.includes(a)).map((a) => a.thoughtId));
  let restored = 0;
  // Checked whether or not anyone is home: a record he undid while out must
  // not outlive the undo and switch on lights he later turned off himself.
  const live: AwayLights[] = [];
  for (const a of fresh) {
    const [row] = await db.select({ actions: daydreamThoughts.proposedActions }).from(daydreamThoughts).where(eq(daydreamThoughts.id, a.thoughtId)).limit(1);
    const done = readSolve(row?.actions)?.stored.done;
    // Undone by him already, pressed again by hand, or the note is gone.
    if (!done || done.undoneAt || !done.auto || done.at !== a.at) gone.add(a.thoughtId);
    else live.push(a);
  }
  if (live.length && (await houseNow()).anyoneHome) {
    const { restoreHome } = await import('./solution.server');
    for (const a of live) {
      const res = await restoreHome(a.thoughtId, now);
      // Home Assistant unreachable: left waiting, tried again next minute.
      if (!res.ok) continue;
      await recordRestore(a.thoughtId, now).catch(() => {});
      gone.add(a.thoughtId);
      restored++;
    }
  }
  if (gone.size) await changeAway((list) => list.filter((a) => !gone.has(a.thoughtId)));
  return { restored, dropped: gone.size - restored };
}
