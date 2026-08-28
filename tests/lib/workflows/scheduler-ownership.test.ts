import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Who is allowed to hold a live cron job, and how a schedule written by another
 * process ever starts running.
 *
 * Cron registration is in-memory, so it is only correct in the process that
 * owns scheduling. That was implicit while every writer was the web app. It
 * stopped being true when WhatsApp chat moved into packages/jkai-wa-worker
 * (JKAI_SERVICE_ROLE=whatsapp) — a process built NOT to schedule, because two
 * schedulers on one database fire every cron twice. A reminder created over
 * WhatsApp would have registered its cron in the worker: the wrong process,
 * and a double-fire the moment the web app next restarted and loaded the row.
 *
 * So registration is gated on ownership, and the owner re-syncs against the
 * table. Both halves are tested here because either alone is a silent failure:
 * gate without sweep = the reminder never runs; sweep without gate = it runs
 * twice.
 */

const rows = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => rows.current }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

vi.mock('$lib/workflows', () => ({ engine: {} }));

const ROLE = 'JKAI_SERVICE_ROLE';
const original = process.env[ROLE];

afterEach(() => {
  if (original === undefined) delete process.env[ROLE];
  else process.env[ROLE] = original;
  vi.resetModules();
});

beforeEach(() => {
  rows.current = [];
  vi.resetModules();
});

const CRON = { id: 's1', workflowId: 'wf-1', type: 'cron', enabled: true, config: { expression: '0 9 9 * *' } };

describe('cron ownership', () => {
  it('the WhatsApp worker saves a schedule but never registers it', async () => {
    process.env[ROLE] = 'whatsapp';
    const { registerCronJob, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    registerCronJob(CRON);
    expect(getActiveJobs().size).toBe(0);
  });

  it('the web process registers on the spot, as it always has', async () => {
    process.env[ROLE] = 'web';
    const { registerCronJob, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    registerCronJob(CRON);
    expect(getActiveJobs().has('s1')).toBe(true);
  });
});

describe('reconcileSchedules', () => {
  it('adopts a schedule another process wrote — the WhatsApp reminder', async () => {
    process.env[ROLE] = 'web';
    const { reconcileSchedules, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    expect(getActiveJobs().size).toBe(0);

    rows.current = [CRON];
    expect(await reconcileSchedules()).toEqual({ added: 1, removed: 0 });
    expect(getActiveJobs().has('s1')).toBe(true);
  });

  it('re-registers a schedule whose time was changed elsewhere', async () => {
    process.env[ROLE] = 'web';
    const { reconcileSchedules, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    rows.current = [CRON];
    await reconcileSchedules();
    const before = getActiveJobs().get('s1');

    rows.current = [{ ...CRON, config: { expression: '0 18 9 * *' } }];
    expect(await reconcileSchedules()).toEqual({ added: 1, removed: 0 });
    expect(getActiveJobs().get('s1')).not.toBe(before);
  });

  it('leaves an unchanged schedule alone', async () => {
    process.env[ROLE] = 'web';
    const { reconcileSchedules, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    rows.current = [CRON];
    await reconcileSchedules();
    const before = getActiveJobs().get('s1');

    expect(await reconcileSchedules()).toEqual({ added: 0, removed: 0 });
    expect(getActiveJobs().get('s1')).toBe(before);
  });

  it('drops a schedule deleted or disabled elsewhere', async () => {
    process.env[ROLE] = 'web';
    const { reconcileSchedules, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    rows.current = [CRON];
    await reconcileSchedules();

    rows.current = [];
    expect(await reconcileSchedules()).toEqual({ added: 0, removed: 1 });
    expect(getActiveJobs().size).toBe(0);
  });

  it('is inert in a process that does not own cron', async () => {
    process.env[ROLE] = 'whatsapp';
    const { reconcileSchedules, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    rows.current = [CRON];
    expect(await reconcileSchedules()).toEqual({ added: 0, removed: 0 });
    expect(getActiveJobs().size).toBe(0);
  });

  it('survives one poison row and still registers the rest', async () => {
    process.env[ROLE] = 'web';
    const { reconcileSchedules, getActiveJobs } = await import('../../../src/lib/workflows/scheduler');
    rows.current = [
      { id: 'bad', workflowId: 'wf-bad', type: 'cron', enabled: true, config: { expression: 'not a cron' } },
      CRON,
    ];
    await reconcileSchedules();
    expect(getActiveJobs().has('s1')).toBe(true);
    expect(getActiveJobs().has('bad')).toBe(false);
  });
});
