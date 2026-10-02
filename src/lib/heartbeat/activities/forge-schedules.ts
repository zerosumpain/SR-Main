import { runForgeSchedules } from '$lib/jkai/forge-scheduler';
import type { ActivityHandler } from '../types';

const CADENCE_S = 60;

/**
 * The end of the window the last tick covered, per process — the croner it
 * replaced was per process too. The first tick after a boot looks back one
 * cadence (two at most), never further: a fire that fell while the process was
 * down is not replayed, as before.
 */
let watermark: number | null = null;

/** The window `(since, now]` this tick covers. PURE given its inputs. */
export function forgeWindow(now: number, previous: number | null, lastRunAt: Date | null): number {
  if (previous !== null && previous < now) return previous;
  const floor = now - 2 * CADENCE_S * 1000;
  return lastRunAt ? Math.max(floor, Math.min(lastRunAt.getTime(), now - CADENCE_S * 1000)) : now - CADENCE_S * 1000;
}

/** Test seam: forget the watermark. */
export function resetForgeWatermark(): void { watermark = null; }

/**
 * Forge's schedules (`forge_schedules`), checked every minute. See
 * `$lib/jkai/forge-scheduler` for what a fire does and what it kept from the
 * croner. No idle gate: a schedule is a time the owner chose, and the croner
 * never waited for the owner to go quiet either.
 */
export const forgeSchedulesActivity: ActivityHandler = {
  name: 'forge-schedules',
  description:
    'Fires the Forge schedules (forge_schedules): cron-scheduled and autonomous ROADMAP builds, in Europe/London time, one at a time — a fire is skipped while a Forge build is running.',
  defaultCadenceSeconds: CADENCE_S,
  defaultEnabled: true,
  defaultConfig: {},

  async run(ctx) {
    const since = forgeWindow(ctx.now, watermark, ctx.action.lastRunAt ?? null);
    const tick = await runForgeSchedules(new Date(ctx.now), new Date(since));
    if (!tick.leader) return { outcome: 'skipped', summary: 'not the Forge leader (advisory lock held elsewhere)' };
    watermark = ctx.now;
    return {
      outcome: tick.due ? 'fired' : 'ok',
      summary: tick.due ? `${tick.fired.length} Forge build(s) started, ${tick.skipped.length} skipped` : 'no Forge schedule due',
      details: { ...tick },
    };
  },
};
