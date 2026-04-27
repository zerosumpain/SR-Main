import { db } from '$lib/db';
import { pulseEvents, pulseSettings } from '$lib/db/schema';
import { lt } from 'drizzle-orm';
import { publishPulseEvent } from './pulse-bus';
import type { PulseEvent, NewPulseEvent } from '$lib/db/schema';

export interface PulseJobContext {
  now: number;
}

interface ScheduledJob {
  kind: string;
  intervalMs: number;
  enabled: boolean;
  lastRunAt: number;
  run: () => Promise<NewPulseEvent[]>;
}

let timer: ReturnType<typeof setInterval> | null = null;
let activeJobs = 0;
let lastJobCompletedAt: number = 0;
let idleQuietMs = 300_000;
const scheduled: ScheduledJob[] = [];

const TICK_MS = 60_000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function setActiveJobs(n: number) { activeJobs = n; }
export function noteJobCompleted() { lastJobCompletedAt = Date.now(); }

export function startIdleCycler(opts: { force?: boolean } = {}): void {
  if (timer) return;
  if (process.env.PULSE_DISABLED === '1') return;
  if (process.env.NODE_ENV === 'test' && !opts.force) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  console.log('[pulse-cycler] started');
}

export function stopIdleCycler(): void {
  if (timer) { clearInterval(timer); timer = null; }
  scheduled.length = 0;
}

async function tick(): Promise<void> {
  try {
    if (activeJobs > 0) return;
    if (Date.now() - lastJobCompletedAt < idleQuietMs && lastJobCompletedAt > 0) return;
    const due = scheduled.filter((j) => j.enabled && Date.now() - j.lastRunAt >= j.intervalMs);
    for (const job of due) {
      if (activeJobs > 0) break; // bail if a real job arrives mid-tick
      try {
        const events = await job.run();
        job.lastRunAt = Date.now();
        if (events.length > 0) {
          const inserted = await db.insert(pulseEvents).values(events).returning();
          for (const ev of inserted) publishPulseEvent(ev as PulseEvent);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pulse-cycler] ${job.kind} error:`, msg);
        try {
          await db.insert(pulseEvents).values({
            kind: job.kind,
            severity: 'error',
            summary: `${job.kind} failed: ${msg.slice(0, 120)}`,
            details: { error: msg },
          } satisfies NewPulseEvent);
        } catch { /* swallow nested DB error */ }
      }
    }
    await db.delete(pulseEvents).where(lt(pulseEvents.at, new Date(Date.now() - RETENTION_MS)));
  } catch (err) {
    console.error('[pulse-cycler] tick error:', err instanceof Error ? err.message : err);
  }
}

export async function loadSettings(): Promise<void> {
  try {
    const [row] = await db.select().from(pulseSettings).limit(1);
    if (!row) return;
    idleQuietMs = row.idleQuietMs;
    // Subsequent tasks (15-19) extend `scheduled` here by reading row.schedules.
    // The skeleton starts with no jobs registered; tests inject one via _internal.setRunner.
  } catch { /* table may not exist in tests */ }
}

export const _internal = {
  timer: () => timer,
  setActiveJobs,
  setLastJobCompletedAt: (n: number) => { lastJobCompletedAt = n; },
  setIdleQuietMs: (n: number) => { idleQuietMs = n; },
  setRunner: (r: () => Promise<NewPulseEvent[]>) => {
    scheduled.length = 0;
    scheduled.push({ kind: 'test', intervalMs: 0, enabled: true, lastRunAt: 0, run: r });
  },
  tickNow: tick,
};
