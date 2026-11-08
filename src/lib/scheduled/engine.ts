import { db } from '$lib/db';
import { scheduledCallbacks } from '$lib/db/schema';
import { and, eq, lte } from 'drizzle-orm';
import { fireCallback } from './executor';

const TICK_MS = 10_000;

let tickerTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
/**
 * Callbacks firing now. A heartbeat turn runs through jkai core and can take
 * longer than a tick; the row is still 'pending' until it finishes, so without
 * this the next tick would fire it a second time.
 */
const inFlight = new Set<string>();

export async function startScheduledEngine(): Promise<void> {
  if (started) return;
  started = true;
  console.log('[scheduled] starting engine');
  void runTick().catch((e) => console.error('[scheduled] initial tick failed:', e));
  tickerTimer = setInterval(() => {
    void runTick().catch((e) => console.error('[scheduled] tick failed:', e));
  }, TICK_MS);
}

export function stopScheduledEngine(): void {
  if (tickerTimer) clearInterval(tickerTimer);
  tickerTimer = null;
  started = false;
  console.log('[scheduled] engine stopped');
}

async function runTick(): Promise<void> {
  const now = new Date();
  const due = await db
    .select()
    .from(scheduledCallbacks)
    .where(and(eq(scheduledCallbacks.status, 'pending'), lte(scheduledCallbacks.fireAt, now)))
    .limit(50);
  for (const row of due) {
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    void fireCallback(row).then((r) => {
      console.log(`[scheduled] ${row.name} ${r.deferred ? 'deferred' : r.ok ? 'ok' : 'fail'} — ${r.summary.slice(0, 120)}`);
    }).catch((e) => console.error(`[scheduled] ${row.name} threw:`, e))
      .finally(() => inFlight.delete(row.id));
  }
}
