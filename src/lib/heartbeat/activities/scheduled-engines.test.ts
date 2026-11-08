import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ setting: undefined as boolean | undefined, host: 'vps', select: vi.fn(), drift: vi.fn() }));
vi.mock('os', () => ({ default: { hostname: () => h.host } }));
vi.mock('node:os', () => ({ default: { hostname: () => h.host } }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn(async () => h.setting) }));
vi.mock('$lib/routing/run', () => ({ runSelectionNow: h.select }));
vi.mock('$lib/routing/events', () => ({ ensureRoutingCollections: vi.fn(async () => {}) }));
vi.mock('$lib/server/models/codex-discovery', () => ({ loadDiscoveredCodexModels: vi.fn() }));
vi.mock('$lib/datastore', () => ({ ensureCollection: vi.fn(), insertRecord: vi.fn(), queryRecords: vi.fn() }));
vi.mock('$lib/voice/card', () => ({ getVoiceCard: () => null }));
vi.mock('$lib/db', () => ({ db: {} }));

import { modelRouting } from './model-routing';
import { voiceDrift } from './voice-drift';
import { isDriftDay, runMonthlyDriftCheck } from '$lib/voice/drift-engine';

const ctx = (iso = '2026-10-01T05:00:00Z') => ({ now: Date.parse(iso), config: {}, action: {} as never });

beforeEach(() => { h.setting = undefined; h.host = 'vps'; vi.clearAllMocks(); });

describe('model-routing on the heartbeat', () => {
  it('lands where the 04:00 London croner did, daily', () => {
    expect(modelRouting.defaultActiveHours).toEqual({ start: '04:00', end: '04:55', tz: 'Europe/London' });
    expect(modelRouting.defaultCadenceSeconds).toBe(86_400);
  });

  it('runs the selection as the nightly trigger', async () => {
    h.select.mockResolvedValue({ id: 'run-12345678', run: { status: 'complete' } });
    await expect(modelRouting.run(ctx())).resolves.toMatchObject({ outcome: 'ok' });
    expect(h.select).toHaveBeenCalledWith({ trigger: 'cron' });
  });

  it('keeps the kill switch, the prod-only host gate and the overlap guard', async () => {
    h.setting = false;
    await expect(modelRouting.run(ctx())).resolves.toMatchObject({ outcome: 'skipped', summary: 'kill switch is off' });
    h.setting = undefined; h.host = 'homeserv';
    await expect(modelRouting.run(ctx())).resolves.toMatchObject({ outcome: 'skipped', summary: expect.stringMatching(/homeserv/) });
    h.host = 'vps';
    h.select.mockRejectedValue(new Error('a selection is already running'));
    await expect(modelRouting.run(ctx())).resolves.toMatchObject({ outcome: 'skipped' });
    expect(h.select).toHaveBeenCalledOnce();
  });
});

describe('voice-drift on the heartbeat', () => {
  it('looks daily in the 06:00 London window and acts only on the 1st (London calendar)', async () => {
    expect(voiceDrift.defaultActiveHours).toEqual({ start: '06:00', end: '06:55', tz: 'Europe/London' });
    expect(isDriftDay(new Date('2026-10-01T05:30:00Z'))).toBe(true);
    // 23:30 UTC on the 30th is already the 1st in London during BST.
    expect(isDriftDay(new Date('2026-09-30T23:30:00Z'))).toBe(true);
    expect(isDriftDay(new Date('2026-10-02T05:30:00Z'))).toBe(false);
    await expect(voiceDrift.run(ctx('2026-10-02T05:00:00Z'))).resolves.toMatchObject({ outcome: 'skipped', summary: 'not the 1st of the month' });
  });

  it('keeps the kill switch and the prod-only host gate', async () => {
    h.setting = false;
    await expect(runMonthlyDriftCheck(new Date('2026-10-01T05:00:00Z'))).resolves.toEqual({ ran: false, reason: 'kill switch is off' });
    h.host = 'homeserv';
    await expect(runMonthlyDriftCheck(new Date('2026-10-01T05:00:00Z'))).resolves.toMatchObject({ ran: false, reason: expect.stringMatching(/homeserv/) });
  });

  it('runs the check on the 1st and reports a missing card plainly', async () => {
    await expect(voiceDrift.run(ctx())).resolves.toMatchObject({ outcome: 'ok', summary: expect.stringMatching(/no Voice Card/) });
  });
});
