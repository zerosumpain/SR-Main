import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ owner: true, controlsCalls: 0 }));

vi.mock('$lib/server/owner', () => ({ isOwnerRequest: vi.fn(async () => h.owner) }));
vi.mock('$lib/db', () => ({ db: { select: () => ({ from: () => ({ where: async () => [{ n: 0 }] }) }) } }));
vi.mock('$lib/builds/loop-health', () => ({
  loadLoopHealth: vi.fn(async () => ({ tools: { shippedRecently: 0, windowDays: 14, shippedRecentlyCalled: 0 } })),
  loopVerdict: vi.fn(() => 'quiet'),
}));
vi.mock('$lib/builds/overnight.server', () => ({ loadOvernight: vi.fn(async () => ({ passes: [], costUsd: 0, dearest: null })) }));
vi.mock('$lib/selfimprove/backlog', () => ({ listBacklog: vi.fn(async () => []), isOwnerAccepted: vi.fn(() => false) }));
vi.mock('$lib/dashboard/improvement.server', () => ({
  loadImprovementDashboard: vi.fn(async () => ({ runs: [] })),
  loadImprovementControls: vi.fn(async () => {
    h.controlsCalls++;
    return { enabled: true, schedule: { display: '03:30' }, running: false, apis: [{ key: 'tfl', data: { name: 'TfL' } }], tools: [] };
  }),
}));

import { load } from './+page.server';

const run = () => load({} as never) as Promise<Record<string, unknown>>;

beforeEach(() => {
  h.owner = true;
  h.controlsCalls = 0;
});

describe('/jkai/develop/improvement controls', () => {
  it('loads the engine switches for the owner', async () => {
    const data = await run();
    expect(data.member).toBe(false);
    expect((data.controls as { enabled: boolean }).enabled).toBe(true);
  });

  it('never loads them for a member', async () => {
    h.owner = false;
    const data = await run();
    expect(data.member).toBe(true);
    expect(data.controls).toBeNull();
    expect(data.improvement).toBeNull();
    expect(h.controlsCalls).toBe(0);
  });
});
