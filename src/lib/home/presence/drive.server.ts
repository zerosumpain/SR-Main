// src/lib/home/presence/drive.server.ts
//
// Storage for ./drive: each companion phone's harsh braking and acceleration,
// in app_settings under `home.presence.drive.<subject>` (the tail of raw
// fixes the next run starts from, and the newest KEEP_EVENTS events). Fed by
// the companion ingest with every raw fix it reads, thinned or not; read by
// the journey push for the events inside a trip.

import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { emptyDriveState, foldDriveFixes, type DriveFix, type DriveState } from './drive';

export const driveKey = (subject: string) => `home.presence.drive.${subject}`;

/** Fold one ingest page's raw fixes into each person's state. Never throws. */
export async function recordDriveFixes(bySubject: ReadonlyMap<string, DriveFix[]>): Promise<{ events: number; error?: string }> {
  let events = 0;
  try {
    for (const [subject, fixes] of bySubject) {
      if (!fixes.length) continue;
      await db.transaction(async (tx) => {
        const key = driveKey(subject);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
        const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, key));
        const before = (row?.value as DriveState | undefined) ?? emptyDriveState();
        const { state, added } = foldDriveFixes(before, fixes);
        if (state === before) return;
        events += added.length;
        await tx.insert(appSettings).values({ key, value: state })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: state, updatedAt: new Date() } });
      });
    }
    return { events };
  } catch (err) {
    return { events, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A person's stored events, newest last. Empty when there are none. */
export async function loadDriveState(subject: string): Promise<DriveState> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, driveKey(subject)));
  return (row?.value as DriveState | undefined) ?? emptyDriveState();
}
