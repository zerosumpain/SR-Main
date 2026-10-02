import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ schedules: [] as Array<Record<string, unknown>>, running: [] as unknown[], updates: [] as unknown[], create: vi.fn(), lock: vi.fn() }));
vi.mock('$lib/db/schema', () => ({ forgeSchedules: { enabled: 'enabled', id: 'id' }, jkaiBuilds: { id: 'id', origin: 'origin', status: 'status' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: unknown, b: unknown) => [a, b], and: (...xs: unknown[]) => xs }));
vi.mock('$lib/db', () => ({
  db: {
    select: (cols?: unknown) => ({ from: () => ({ where: () => cols ? { limit: async () => h.running } : Promise.resolve(h.schedules) }) }),
    update: () => ({ set: (v: unknown) => ({ where: async () => { h.updates.push(v); } }) }),
  },
}));
vi.mock('$lib/jkai/forge', () => ({ createForgeBuild: h.create }));
vi.mock('$lib/workflows/leader-lock', () => ({ tryAdvisoryLock: h.lock, FORGE_SCHEDULER_LOCK_LANE: 'jkai:forge-scheduler' }));

import { AUTONOMOUS_PROMPT, cronFiredBetween, runForgeSchedules } from './forge-scheduler';
import { forgeSchedulesActivity, forgeWindow, resetForgeWatermark } from '$lib/heartbeat/activities/forge-schedules';

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  h.schedules = []; h.running = []; h.updates = []; vi.clearAllMocks(); resetForgeWatermark();
  h.create.mockResolvedValue({ buildId: 'build-1' });
});

describe('Forge schedules on the heartbeat', () => {
  it('reads a cron in London time, as the croner did', () => {
    // 09:00 London in summer is 08:00 UTC.
    expect(cronFiredBetween({ cron: '0 9 * * *' }, at('2026-07-01T07:59:00Z'), at('2026-07-01T08:00:30Z'))).toBe(true);
    expect(cronFiredBetween({ cron: '0 9 * * *' }, at('2026-07-01T08:00:30Z'), at('2026-07-01T08:01:30Z'))).toBe(false);
    expect(cronFiredBetween({ cron: 'not a cron' }, at('2026-07-01T08:00:00Z'), at('2026-07-01T08:01:00Z'))).toBeNull();
  });

  it('covers the window since the last tick, and never replays a fire missed while the process was down', () => {
    const now = Date.parse('2026-07-01T08:00:30Z');
    expect(forgeWindow(now, now - 60_000, null)).toBe(now - 60_000);
    expect(forgeWindow(now, null, new Date(now - 30_000))).toBe(now - 60_000);
    expect(forgeWindow(now, null, new Date(now - 6 * 3600_000))).toBe(now - 120_000);
  });

  it('fires a due schedule once, with the autonomous directive, and stamps it', async () => {
    h.schedules = [{ id: 's1', cron: '0 9 * * *', mode: 'autonomous', directive: 'Prefer docs', enabled: true, lastRunAt: null }, { id: 's2', cron: '0 10 * * *', mode: 'scheduled', directive: 'x', enabled: true, lastRunAt: null }];
    const tick = await runForgeSchedules(at('2026-07-01T08:00:30Z'), at('2026-07-01T07:59:30Z'));
    expect(tick).toMatchObject({ leader: true, due: 1, fired: ['s1'], skipped: [] });
    expect(h.create).toHaveBeenCalledWith({ prompt: `${AUTONOMOUS_PROMPT}\n\nAdditional guidance: Prefer docs`, trigger: 'autonomous' });
    expect(h.updates).toEqual([expect.objectContaining({ lastBuildId: 'build-1' })]);
  });

  it('does not fire an occurrence its own last run already covered', async () => {
    h.schedules = [{ id: 's1', cron: '0 9 * * *', mode: 'scheduled', directive: 'go', enabled: true, lastRunAt: at('2026-07-01T08:00:05Z') }];
    expect((await runForgeSchedules(at('2026-07-01T08:00:30Z'), at('2026-07-01T07:59:30Z'))).due).toBe(0);
  });

  it('skips a fire while a Forge build is running', async () => {
    h.schedules = [{ id: 's1', cron: '0 9 * * *', mode: 'scheduled', directive: 'go', enabled: true, lastRunAt: null }];
    h.running = [{ id: 'busy' }];
    expect(await runForgeSchedules(at('2026-07-01T08:00:30Z'), at('2026-07-01T07:59:30Z'))).toMatchObject({ due: 1, fired: [], skipped: ['s1'] });
    expect(h.create).not.toHaveBeenCalled();
  });

  it('runs on the heartbeat at a one-minute cadence', async () => {
    expect(forgeSchedulesActivity.defaultCadenceSeconds).toBe(60);
    const result = await forgeSchedulesActivity.run({ now: Date.parse('2026-07-01T08:00:30Z'), config: {}, action: { lastRunAt: null } as never });
    expect(result).toMatchObject({ outcome: 'ok', summary: 'no Forge schedule due' });
  });
});

describe('the Forge leader lock', () => {
  it('stays passive when another process holds the lane, deciding once per process', async () => {
    vi.stubEnv('JKAI_RUN_WORKER', '1');
    vi.resetModules();
    h.lock.mockResolvedValue(false);
    const fresh = await import('./forge-scheduler');
    h.schedules = [{ id: 's1', cron: '* * * * *', mode: 'scheduled', directive: 'go', enabled: true, lastRunAt: null }];
    expect(await fresh.runForgeSchedules(at('2026-07-01T08:00:30Z'), at('2026-07-01T07:59:30Z'))).toMatchObject({ leader: false, due: 0 });
    await fresh.runForgeSchedules(at('2026-07-01T08:01:30Z'), at('2026-07-01T08:00:30Z'));
    expect(h.lock).toHaveBeenCalledOnce();
    expect(h.create).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
