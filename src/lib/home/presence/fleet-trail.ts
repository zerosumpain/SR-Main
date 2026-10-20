// The last fix each household subject's phone sent, for the fleet view: when
// the companion was last heard from, and the battery it reported. Per
// SUBJECT, because the trail is — the fleet view maps subjects to addresses
// through the household rows.

import { desc } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';

export interface LastFix {
  at: Date;
  batteryPct: number | null;
}

export async function lastFixBySubject(): Promise<Map<string, LastFix>> {
  const rows = await db
    .selectDistinctOn([daydreamTrail.subject], {
      subject: daydreamTrail.subject,
      ts: daydreamTrail.ts,
      batteryPct: daydreamTrail.batteryPct,
    })
    .from(daydreamTrail)
    .orderBy(daydreamTrail.subject, desc(daydreamTrail.ts));
  return new Map(rows.map((r) => [r.subject, { at: r.ts, batteryPct: r.batteryPct }]));
}
