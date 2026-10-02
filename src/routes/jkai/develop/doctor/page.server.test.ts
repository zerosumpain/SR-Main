import { beforeEach, describe, expect, it, vi } from 'vitest';

// The doctor lives in SR-Workflows; this page asks it for the owner's view and
// strips it for a member. The remote is faked with what it would return.
const h = vi.hoisted(() => ({ owner: true, fail: false }));

vi.mock('$lib/server/owner', () => ({ isOwnerRequest: vi.fn(async () => h.owner) }));
vi.mock('$lib/workflows/doctor-client', () => ({
  doctorOverview: vi.fn(async () => {
    if (h.fail) throw new Error('Workflows runtime unavailable');
    return {
      runs: [{ runId: 'r1', createdAt: '2026-10-02T04:30:00.000Z', data: { status: 'complete', trigger: 'cron', costUsd: 0.2, phases: { gather: { status: 'ok', detail: 'Burn failed', ms: 4 } }, actions: [{ kind: 'proposal', detail: 'Burn / Fetch' }], report: 'Burn' } }],
      stories: [{ id: 'f1', workflowName: 'Burn' }],
      storySummary: '1 proposed',
      prime: { workflowsFailing: 1 },
      stats: { costUsd: 0.2, openFindings: 1 },
      lastRun: null,
      signatures: [{ workflowName: 'Burn' }],
      silent: [{ workflowName: 'Burn' }],
      runaways: [{ workflowName: 'Burn' }],
      deadNodeTypes: [{ workflowName: 'Burn' }],
      liveFailed: false,
      switches: { enabled: true, autoApply: false, breaker: true },
      lookbackDays: 7,
      schedule: { expr: '05:00–05:55 Europe/London', tz: 'Europe/London', display: '05:00 Europe/London', armed: true },
      running: false,
      queuedRunId: 'q-Burn',
      controls: {
        caps: { breakerFailures: 10, workflows: 3, fixes: 5, quietHours: 24 },
        findings: [{ key: 'f1', workflowName: 'Burn', changedFields: ['token'], revertKind: 'node', status: 'auto_fixed' }],
      },
    };
  }),
}));

import { load } from './+page.server';

const run = () => load({} as never) as Promise<Record<string, unknown>>;

beforeEach(() => {
  h.owner = true;
  h.fail = false;
});

describe('/jkai/develop/doctor', () => {
  it('gives the owner the remote page, the switches and the undo list', async () => {
    const data = await run();
    const controls = data.controls as { caps: Record<string, number>; findings: Array<{ changedFields: string[] }> };
    expect(controls.caps.breakerFailures).toBe(10);
    expect(controls.findings[0].changedFields).toEqual(['token']);
    expect(data.member).toBe(false);
    expect(data.unavailable).toBe(false);
    expect(data.schedule).toMatchObject({ display: '05:00 Europe/London', armed: true });
  });

  it('gives a member the nights as numbers: no controls, no names, no cost', async () => {
    h.owner = false;
    const data = await run();
    expect(data.controls).toBeNull();
    expect(data.member).toBe(true);
    expect(JSON.stringify(data)).not.toContain('Burn');
    expect((data.stats as { costUsd: number }).costUsd).toBe(0);
    expect((data.runs as Array<{ data: { phases: Record<string, unknown> } }>)[0].data.phases.gather).toEqual({ status: 'ok', ms: 4 });
    expect(data.storySummary).toBe('1 proposed');
  });

  it('renders an honest empty page when SR-Workflows cannot be reached', async () => {
    h.fail = true;
    const data = await run();
    expect(data.unavailable).toBe(true);
    expect(data.controls).toBeNull();
    expect(data.switches).toEqual({ enabled: true, autoApply: false, breaker: false });
    expect(data.runs).toEqual([]);
  });
});
