import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  notifyThrows: false,
  persistThrows: false,
}));

vi.mock('$lib/datastore', () => ({
  upsertRecord: vi.fn(async (_slug: string, rec: { key: string }) => {
    if (h.persistThrows) throw new Error('datastore down');
    return { id: rec.key };
  }),
}));

vi.mock('$lib/server/notify', () => ({
  notifyOwner: vi.fn(async () => {
    if (h.notifyThrows) throw new Error('notify exploded');
    return { raised: true, whatsapp: true };
  }),
}));

import { upsertRecord } from '$lib/datastore';
import { notifyOwner } from '$lib/server/notify';
import { buildWhatsappSummary, finalizeAndNotify } from './report';
import { COLLECTIONS, emptyPhases, type ImprovementRunData } from './types';

function run(): ImprovementRunData {
  return {
    status: 'complete',
    trigger: 'cron',
    startedAt: '2026-09-26T03:00:00.000Z',
    finishedAt: '2026-09-26T03:10:00.000Z',
    phases: emptyPhases(),
    llmCalls: 4,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.02,
    actions: [],
    report: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.notifyThrows = false;
  h.persistThrows = false;
});

describe('selfimprove finalizeAndNotify', () => {
  it('persists, then tells the owner through notifyOwner with the exact WhatsApp summary', async () => {
    const data = run();
    await finalizeAndNotify('run-1', data);
    expect(data.report).toContain('# Self-improvement run');
    expect(vi.mocked(upsertRecord).mock.calls[0][0]).toBe(COLLECTIONS.improvementRuns);
    expect(notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'build',
        url: '/admin/ai/improvement',
        whatsappText: buildWhatsappSummary(data),
      }),
    );
  });

  it('never throws when the notification path throws', async () => {
    h.notifyThrows = true;
    await expect(finalizeAndNotify('run-2', run())).resolves.toBeUndefined();
  });

  it('propagates a persist failure and notifies nobody', async () => {
    h.persistThrows = true;
    await expect(finalizeAndNotify('run-3', run())).rejects.toThrow('datastore down');
    expect(notifyOwner).not.toHaveBeenCalled();
  });
});
