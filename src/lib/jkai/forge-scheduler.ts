/**
 * Forge trigger schedules — cron-scheduled and autonomous (ROADMAP-driven)
 * brass-and-rails builds, one per enabled `forge_schedules` row.
 *
 * Driven by the heartbeat since 2026-10-02 (`forge-schedules`, every minute),
 * not by an in-memory `croner` job per row plus a reconcile job. Each tick
 * reads the enabled rows and fires every schedule with an occurrence in the
 * window since the last tick, so an API edit (enable, disable, cron change,
 * delete) applies on the next tick with no reconcile loop, and the heartbeat's
 * pulses, failure budget and pause switch cover Forge like everything else.
 *
 * Kept from the croner: the cron is read in the schedule's wall-clock zone
 * (`cronTimezone`, Europe/London), a fire is skipped while a Forge build is
 * already running, and a fire that falls while the process is down is not
 * replayed later. The leader lock is kept too, on its own advisory-lock lane,
 * when the durable run-worker flag is set.
 *
 * On fire a schedule creates a Forge git-target build via `createForgeBuild`
 * (shared with the propose route) and stamps `last_run_at` / `last_build_id`.
 */
import { Cron } from 'croner';
import { db } from '$lib/db';
import { forgeSchedules, jkaiBuilds } from '$lib/db/schema';
import { cronTimezone } from '$lib/workflows/cron-timezone';
import { eq, and } from 'drizzle-orm';
import type { ForgeSchedule } from '$lib/db/schema';
import { createForgeBuild } from '$lib/jkai/forge';

/**
 * The directive the agent receives for an autonomous (backlog-driven) run.
 * Points it at the repo's ROADMAP.md and tells it to do exactly one item.
 */
export const AUTONOMOUS_PROMPT =
  'Autonomous Forge run. Open ROADMAP.md at the repository root. Choose the single ' +
  'highest-priority unchecked `- [ ]` item, implement it with the smallest reasonable ' +
  'change that fits the existing design, then check it off (change `- [ ]` to `- [x]`) ' +
  'in the same change. Ensure `npm run gate` passes. If ROADMAP.md is missing, empty, ' +
  'or every item is already checked, make NO changes and stop.';

/**
 * Kept so `hooks.server.ts` (protected) need not change: the schedule itself
 * is the heartbeat's `forge-schedules` activity now, which the heartbeat seeds.
 */
export async function startForgeScheduler(): Promise<void> {
  console.log('[forge-scheduler] Forge schedules run on the heartbeat (forge-schedules)');
}
export function stopForgeScheduler(): void {}

/**
 * Did this schedule's cron have an occurrence in `(from, to]`? Null when the
 * cron cannot be read — the croner skipped such a row with a warning, and so
 * does the tick. PURE.
 */
export function cronFiredBetween(schedule: Pick<ForgeSchedule, 'cron'> & { timezone?: string }, from: Date, to: Date): boolean | null {
  let cron: Cron;
  try { cron = new Cron(schedule.cron, { timezone: cronTimezone(schedule), paused: true }); }
  catch { return null; }
  const next = cron.nextRun(from);
  return next !== null && next.getTime() <= to.getTime();
}

let leader: Promise<boolean> | null = null;
/** One process owns Forge when the run-worker is enabled; decided once, as before. */
function isForgeLeader(): Promise<boolean> {
  if (process.env.JKAI_RUN_WORKER !== '1') return Promise.resolve(true);
  leader ??= import('$lib/workflows/leader-lock').then(({ tryAdvisoryLock, FORGE_SCHEDULER_LOCK_LANE }) => tryAdvisoryLock(FORGE_SCHEDULER_LOCK_LANE));
  return leader;
}

export interface ForgeTick { leader: boolean; due: number; fired: string[]; skipped: string[]; invalid: string[] }

/**
 * Fire every enabled schedule with an occurrence in `(since, now]`. A row's
 * own `last_run_at` bounds the window too, so overlapping ticks never fire one
 * occurrence twice.
 */
export async function runForgeSchedules(now: Date, since: Date): Promise<ForgeTick> {
  const tick: ForgeTick = { leader: await isForgeLeader(), due: 0, fired: [], skipped: [], invalid: [] };
  if (!tick.leader) return tick;
  const schedules = await db.select().from(forgeSchedules).where(eq(forgeSchedules.enabled, true));
  for (const schedule of schedules) {
    const from = schedule.lastRunAt && schedule.lastRunAt > since ? schedule.lastRunAt : since;
    const fired = cronFiredBetween(schedule, from, now);
    if (fired === null) {
      console.warn(`[forge-scheduler] Schedule ${schedule.id} has an invalid cron (${schedule.cron}) — skipping`);
      tick.invalid.push(schedule.id);
      continue;
    }
    if (!fired) continue;
    tick.due += 1;
    const buildId = await fireForgeSchedule(schedule);
    (buildId ? tick.fired : tick.skipped).push(schedule.id);
  }
  return tick;
}

/** One fire. Returns the build id, or null when skipped or failed. Never throws. */
async function fireForgeSchedule(schedule: ForgeSchedule): Promise<string | null> {
  try {
    // Avoid piling up: if a forge build is already running, skip this fire.
    const [running] = await db.select({ id: jkaiBuilds.id }).from(jkaiBuilds)
      .where(and(eq(jkaiBuilds.origin, 'forge'), eq(jkaiBuilds.status, 'running'))).limit(1);
    if (running) {
      console.log(`[forge-scheduler] Forge build ${running.id} already running — skipping schedule ${schedule.id}`);
      return null;
    }
    const { buildId } = await createForgeBuild({ prompt: resolvePrompt(schedule), trigger: schedule.mode });
    await db.update(forgeSchedules).set({ lastRunAt: new Date(), lastBuildId: buildId }).where(eq(forgeSchedules.id, schedule.id));
    console.log(`[forge-scheduler] Schedule ${schedule.id} (${schedule.mode}) fired — build ${buildId}`);
    return buildId;
  } catch (err) {
    console.error(`[forge-scheduler] Schedule ${schedule.id} fire failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Resolve the agent directive for a schedule fire. */
function resolvePrompt(schedule: ForgeSchedule): string {
  if (schedule.mode === 'autonomous') {
    const extra = schedule.directive?.trim();
    return extra ? `${AUTONOMOUS_PROMPT}\n\nAdditional guidance: ${extra}` : AUTONOMOUS_PROMPT;
  }
  // scheduled mode: the directive IS the prompt.
  return schedule.directive;
}
