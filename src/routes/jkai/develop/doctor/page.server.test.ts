import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ owner: true }));

vi.mock('$lib/server/owner', () => ({ isOwnerRequest: vi.fn(async () => h.owner) }));
vi.mock('$lib/datastore', () => ({ getCollectionBySlug: vi.fn(async () => null), queryRecords: vi.fn() }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn(async () => null) }));
vi.mock('$lib/workflowdoctor/fix', () => ({ isAutoApplyEnabled: vi.fn(async () => false), isBreakerEnabled: vi.fn(async () => true) }));
vi.mock('$lib/workflowdoctor/run', () => ({ getDoctorStatus: vi.fn(() => ({ running: false })) }));
vi.mock('$lib/heartbeat/activity-schedule', () => ({ doctorSchedule: vi.fn(async () => ({ window: '0 5 * * * Europe/London', display: '05:00' })) }));
vi.mock('$lib/workflowdoctor/triage', () => ({ triageNow: vi.fn(async () => null) }));
vi.mock('$lib/workflowdoctor/findings', () => ({
  listFindings: vi.fn(async () => [{ key: 'f1', data: {
    workflowId: 'w', workflowName: 'Burn', canvasSlug: 'burn', nodeId: 'n', nodeType: 'http', nodeLabel: 'Fetch', fixKind: 'config',
    status: 'auto_fixed', occurrences: 1, firstSeen: '', lastSeen: '', updatedAt: '', symptom: 's', cause: 'c', causeSource: 'linter',
    fix: 'f', beforeImage: { changedFields: { token: 'OLD-SECRET' } },
  } }]),
}));

import { load } from './+page.server';

const run = () => load({} as never) as Promise<Record<string, unknown>>;

beforeEach(() => { h.owner = true; });

describe('/jkai/develop/doctor controls', () => {
  it('gives the owner the switches and the undo list, with field names but no old values', async () => {
    const data = await run();
    const controls = data.controls as { caps: Record<string, number>; findings: Array<{ changedFields: string[] }> };
    expect(controls.caps.breakerFailures).toBeGreaterThan(0);
    expect(controls.findings[0].changedFields).toEqual(['token']);
    expect(JSON.stringify(data)).not.toContain('OLD-SECRET');
    expect(data.member).toBe(false);
  });

  it('gives a member no controls and no findings', async () => {
    h.owner = false;
    const data = await run();
    expect(data.controls).toBeNull();
    expect(data.member).toBe(true);
    expect(JSON.stringify(data)).not.toContain('Burn');
  });
});
