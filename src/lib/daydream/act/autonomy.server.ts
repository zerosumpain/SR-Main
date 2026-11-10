// src/lib/daydream/act/autonomy.server.ts
//
// The autonomy ladder's state (`autonomy.ts`), read and written. One
// `app_settings` row — five kinds and a short log, so no table and no grant.
//
// Read and written STRAIGHT from the table under an advisory lock, not through
// `getSetting`: that cache is per process, and this row is written by the
// heartbeat (an automatic act) and by the web process (his Undo, his tap, his
// setting). A cached read in one would put the other's write back.

import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { cleanState, withAuto, withLevel, withRestore, withTap, withUndo, type AutoKind, type AutoLogEntry, type AutonomyState, type Level } from './autonomy';

export const AUTONOMY_KEY = 'daydream.autonomy';

export async function loadAutonomy(): Promise<AutonomyState> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AUTONOMY_KEY)).limit(1);
  return cleanState(row?.value);
}

async function mutate<T>(fn: (state: AutonomyState) => { state: AutonomyState; out: T }): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${AUTONOMY_KEY}))`);
    const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AUTONOMY_KEY)).limit(1);
    const { state, out } = fn(cleanState(row?.value));
    await tx
      .insert(appSettings)
      .values({ key: AUTONOMY_KEY, value: state })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: state, updatedAt: new Date() } });
    return out;
  });
}

export function recordAuto(entry: AutoLogEntry): Promise<void> {
  return mutate((s) => ({ state: withAuto(s, entry), out: undefined }));
}

/** He took back something it did by itself. Returns the kind put back to ask, if this was the one that did it. */
export function recordAutoUndo(thoughtId: string, now = new Date()): Promise<AutoKind | null> {
  return mutate((s) => {
    const r = withUndo(s, thoughtId, now);
    return { state: r.state, out: r.demoted };
  });
}

export function recordRestore(thoughtId: string, now = new Date()): Promise<void> {
  return mutate((s) => ({ state: withRestore(s, thoughtId, now), out: undefined }));
}

/** He pressed a step of this kind himself. */
export function recordTap(kind: AutoKind, now = new Date()): Promise<boolean> {
  return mutate((s) => {
    const r = withTap(s, kind, now);
    return { state: r.state, out: r.promoted };
  });
}

export function setLevel(kind: AutoKind, level: Level, now = new Date()): Promise<void> {
  return mutate((s) => ({ state: withLevel(s, kind, level, now), out: undefined }));
}
