import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HeartbeatAction } from '$lib/db/schema';
import type { ImprovementRunData } from '$lib/selfimprove/types';

// Mutable hostname — the prod-only gate the croner used to own now lives in
// the activity, and it is the one piece of that move that could silently stop
// self-improvement running at all.
const h = vi.hoisted(() => ({ host: 'vps-prod' }));
vi.mock('os', () => ({ default: { hostname: () => h.host } }));

vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn() }));
vi.mock('$lib/selfimprove/run', () => ({
  runImprovementNow: vi.fn(),
  isUserActive: vi.fn(),
}));

import { getSetting } from '$lib/server/models/settings';
import { runImprovementNow, isUserActive } from '$lib/selfimprove/run';
import { daydreamImprove } from './daydream-improve';

function ctx(config: Record<string, unknown> = {}) {
  return { now: Date.now(), config, action: {} as HeartbeatAction };
}

function runData(over: Partial<ImprovementRunData> = {}): ImprovementRunData {
  return {
    status: 'complete',
    trigger: 'cron',
    startedAt: new Date().toISOString(),
    phases: {
      gather: { status: 'ok' },
      learn: { status: 'ok' },
      discover: { status: 'ok' },
      build: { status: 'ok' },
      repair: { status: 'ok' },
      optimise: { status: 'ok' },
      propose: { status: 'ok' },
      report: { status: 'ok' },
    },
    llmCalls: 9,
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0,
    actions: [],
    report: '',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.host = 'vps-prod';
  vi.mocked(getSetting).mockResolvedValue(null as never);
  vi.mocked(isUserActive).mockResolvedValue(false as never);
  vi.mocked(runImprovementNow).mockResolvedValue({ runId: 'r1', data: runData() } as never);
});

describe('the gates carried over from the croner', () => {
  it('does not run on homeserv', async () => {
    h.host = 'homeserv';
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('skipped');
    expect(r.summary).toMatch(/homeserv/);
    expect(runImprovementNow).not.toHaveBeenCalled();
  });

  it('runs on homeserv when the config opts in', async () => {
    h.host = 'homeserv';
    const r = await daydreamImprove.run(ctx({ allowDevHost: true }));
    expect(r.outcome).toBe('ok');
    expect(runImprovementNow).toHaveBeenCalled();
  });

  it('runs on homeserv when SELF_IMPROVE_ALLOW_DEV=1', async () => {
    h.host = 'homeserv';
    process.env.SELF_IMPROVE_ALLOW_DEV = '1';
    try {
      const r = await daydreamImprove.run(ctx());
      expect(r.outcome).toBe('ok');
    } finally {
      delete process.env.SELF_IMPROVE_ALLOW_DEV;
    }
  });

  it('respects the kill switch', async () => {
    vi.mocked(getSetting).mockResolvedValue(false as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('skipped');
    expect(r.summary).toMatch(/kill switch/);
    expect(runImprovementNow).not.toHaveBeenCalled();
  });

  it('treats an unset kill switch as enabled', async () => {
    vi.mocked(getSetting).mockResolvedValue(null as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('ok');
  });

  it('skips when the owner has been active', async () => {
    vi.mocked(isUserActive).mockResolvedValue(true as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('skipped');
    expect(runImprovementNow).not.toHaveBeenCalled();
  });
});

describe('outcome mapping', () => {
  it('reports what the night shipped', async () => {
    vi.mocked(runImprovementNow).mockResolvedValue({
      runId: 'r1',
      data: runData({
        actions: [
          { kind: 'tool_shipped', detail: 'a' },
          { kind: 'tool_shipped', detail: 'b' },
          { kind: 'backlog_added', detail: 'c' },
          { kind: 'pr_opened', detail: 'd' },
          { kind: 'policy_published', detail: 'e' },
        ],
      }),
    } as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('ok');
    expect(r.summary).toContain('2 tool(s) shipped');
    expect(r.summary).toContain('1 queued');
    expect(r.summary).toContain('1 draft PR(s)');
    expect(r.details?.shipped).toBe(2);
  });

  it('keeps the summary inside the pulse column limit', async () => {
    vi.mocked(runImprovementNow).mockResolvedValue({
      runId: 'r1',
      data: runData({
        actions: Array.from({ length: 200 }, () => ({ kind: 'tool_shipped' as const, detail: 'x' })),
      }),
    } as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.summary.length).toBeLessThanOrEqual(200);
  });

  it('names a failed phase rather than reporting a clean night', async () => {
    vi.mocked(runImprovementNow).mockResolvedValue({
      runId: 'r1',
      data: runData({
        status: 'partial',
        phases: { ...runData().phases, build: { status: 'failed', detail: 'boom' } },
      }),
    } as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.summary).toMatch(/failed: build/);
  });

  it('marks a failed run as an error so the failure budget sees it', async () => {
    vi.mocked(runImprovementNow).mockResolvedValue({
      runId: 'r1',
      data: runData({ status: 'failed' }),
    } as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('error');
  });

  it('a budget-exceeded night is not an error — it did work and stopped', async () => {
    vi.mocked(runImprovementNow).mockResolvedValue({
      runId: 'r1',
      data: runData({ status: 'budget_exceeded' }),
    } as never);
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('ok');
  });

  it('treats the overlap guard as a skip, not a fault', async () => {
    // A manual "Run now" holding the lock must not charge the failure budget:
    // three of those in a row would pause the activity for nothing.
    vi.mocked(runImprovementNow).mockRejectedValue(
      new Error('a self-improvement run is already in progress'),
    );
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('skipped');
    expect(r.summary).toMatch(/already in progress/);
  });

  it('reports a genuine throw as an error', async () => {
    vi.mocked(runImprovementNow).mockRejectedValue(new Error('database is on fire'));
    const r = await daydreamImprove.run(ctx());
    expect(r.outcome).toBe('error');
    expect(r.summary).toMatch(/on fire/);
  });
});

describe('the schedule it declares', () => {
  it('opens and closes early enough to finish before the 04:00 model-routing slot', () => {
    // The run is capped at 25 minutes (BUDGET_CAPS.maxWallMs). A window that
    // closed at or after 03:35 could start a run that overran into the next
    // job's slot — that boundary is the whole reason the cap is 25 minutes.
    expect(daydreamImprove.defaultActiveHours).toEqual({
      start: '02:30',
      end: '03:55',
      tz: 'Europe/London',
    });
    const [h, m] = daydreamImprove.defaultActiveHours!.start.split(':').map(Number);
    expect(h * 60 + m + 25).toBeLessThan(4 * 60);
  });

  it('is daily, so it cannot run twice in one night', () => {
    expect(daydreamImprove.defaultCadenceSeconds).toBe(86_400);
  });
});
